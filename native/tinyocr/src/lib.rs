//! Library adaptation of TinyOCR; no server is compiled into Android.
pub mod error;
pub mod preprocessing {
    pub mod image;
}
pub mod decoding {
    pub mod ctc_greedy;
}

use decoding::ctc_greedy::{GreedyCtcDecoder, NUM_CLASSES, TIMESTEPS, Vocab};
use error::AppError;
use ort::{
    inputs,
    session::{Session, builder::GraphOptimizationLevel},
    value::TensorRef,
};
use std::path::Path;

/// Sensitive prediction. Deliberately no Debug/Serialize implementation.
pub struct Prediction {
    pub text: String,
    pub score: f32,
}
pub trait Solver: Send {
    fn predict(&mut self, bytes: &[u8]) -> Result<Prediction, AppError>;
}

pub struct Engine {
    session: Session,
    decoder: GreedyCtcDecoder,
}
impl Engine {
    pub fn load(model: &Path, vocab: &Path) -> Result<Self, AppError> {
        let decoder = GreedyCtcDecoder::new(Vocab::load(vocab)?);
        // No tracing/logging of inputs, outputs, paths or backend errors.
        let failure = |_| AppError::Backend("model initialization failed".into());
        let builder = Session::builder().map_err(failure)?;
        let builder = builder
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|_| AppError::Backend("model initialization failed".into()))?;
        let mut builder = builder
            .with_intra_threads(1)
            .map_err(|_| AppError::Backend("model initialization failed".into()))?;
        let session = builder
            .commit_from_file(model)
            .map_err(|_| AppError::Backend("model initialization failed".into()))?;
        let mut engine = Self { session, decoder };
        engine.infer(&vec![0.0; preprocessing::image::INPUT_LEN])?;
        Ok(engine)
    }
    fn infer(&mut self, tensor: &[f32]) -> Result<Vec<f32>, AppError> {
        let input = TensorRef::from_array_view((vec![1_i64, 1, 45, 175], tensor))
            .map_err(|_| AppError::Backend("invalid tensor".into()))?;
        let output = self
            .session
            .run(inputs![input])
            .map_err(|_| AppError::Backend("inference failed".into()))?;
        let (shape, data) = output["logits"]
            .try_extract_tensor::<f32>()
            .map_err(|_| AppError::Backend("invalid output".into()))?;
        if shape.as_ref() != [1, TIMESTEPS as i64, NUM_CLASSES as i64]
            || data.iter().any(|v| !v.is_finite())
        {
            return Err(AppError::Backend("invalid output shape".into()));
        }
        Ok(data.to_vec())
    }
}
impl Solver for Engine {
    fn predict(&mut self, bytes: &[u8]) -> Result<Prediction, AppError> {
        if bytes.len() > 1024 * 1024 {
            return Err(AppError::PayloadTooLarge);
        }
        let tensor = preprocessing::image::preprocess(bytes)?;
        let logits = self.infer(&tensor)?;
        let text = self.decoder.decode_row(&logits, NUM_CLASSES);
        let score = minimum_emitted_score(&logits);
        Ok(Prediction { text, score })
    }
}

// Uncalibrated confidence heuristic; preserves upstream greedy decoding unchanged.
fn minimum_emitted_score(logits: &[f32]) -> f32 {
    let mut score = 1.0_f32;
    let mut previous = 0;
    let mut emitted = false;
    for row in logits.chunks_exact(NUM_CLASSES) {
        let best = row.iter().enumerate().fold(
            0,
            |best, (i, value)| if value > &row[best] { i } else { best },
        );
        if best != 0 && best != previous {
            let probability = 1.0 / row.iter().map(|v| (v - row[best]).exp()).sum::<f32>();
            score = score.min(probability);
            emitted = true;
        }
        previous = best;
    }
    if emitted { score } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uncertainty_gate_detects_ambiguous_and_blank_logits() {
        assert_eq!(
            minimum_emitted_score(&vec![0.0; NUM_CLASSES * TIMESTEPS]),
            0.0
        );
        let mut logits = vec![0.0; NUM_CLASSES * TIMESTEPS];
        logits[11] = 0.1;
        assert!(minimum_emitted_score(&logits) < 0.9);
        logits[11] = 20.0;
        assert!(minimum_emitted_score(&logits) > 0.9);
    }
    #[test]
    #[ignore = "requires ORT_DYLIB_PATH; run explicitly after provisioning the runtime"]
    fn model_golden_parity_when_runtime_is_configured() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut engine = Engine::load(
            &root.join("model/captcha_crnn.onnx"),
            &root.join("model/vocab.json"),
        )
        .unwrap();
        let meta: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("tests/golden/meta.json")).unwrap())
                .unwrap();
        let input = std::fs::read(root.join("tests/golden/input.bin")).unwrap();
        let reference = std::fs::read(root.join("tests/golden/logits.bin")).unwrap();
        let floats = |b: &[u8]| {
            b.chunks_exact(4)
                .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
                .collect::<Vec<_>>()
        };
        let input = floats(&input);
        let reference = floats(&reference);
        for (i, tensor) in input
            .chunks_exact(preprocessing::image::INPUT_LEN)
            .enumerate()
        {
            let logits = engine.infer(tensor).unwrap();
            let expected =
                &reference[i * TIMESTEPS * NUM_CLASSES..(i + 1) * TIMESTEPS * NUM_CLASSES];
            assert!(
                logits
                    .iter()
                    .zip(expected)
                    .all(|(a, b)| (a - b).abs() < 2e-3)
            );
            assert!(
                engine.decoder.decode_row(&logits, NUM_CLASSES)
                    == meta["greedy_texts"][i].as_str().unwrap()
            );
        }
    }
}
