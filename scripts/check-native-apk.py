"""Verify native ABI/assets and ELF 16 KB LOAD alignment in a built APK."""
import hashlib
from pathlib import Path
import struct
import sys
import zipfile

apk = Path(sys.argv[1])
root = Path(__file__).resolve().parents[1]
abis = ("arm64-v8a", "x86_64")
with zipfile.ZipFile(apk) as archive:
    names = set(archive.namelist())
    for abi in abis:
        for library in ("libratiod_core.so", "libonnxruntime.so"):
            name = f"lib/{abi}/{library}"
            data = archive.read(name)
            assert data[:6] == b"\x7fELF\x02\x01", f"Unexpected ELF format: {name}"
            assert struct.unpack_from("<H", data, 18)[0] == {"arm64-v8a": 183, "x86_64": 62}[abi], f"Wrong machine ABI: {name}"
            phoff = struct.unpack_from("<Q", data, 32)[0]
            entry_size, count = struct.unpack_from("<HH", data, 54)
            loads = []
            for i in range(count):
                entry = struct.unpack_from("<IIQQQQQQ", data, phoff + i * entry_size)
                if entry[0] == 1:
                    loads.append(entry)
                    assert entry[7] >= 16384, f"Insufficient ELF alignment: {name}"
                    assert (entry[3] - entry[2]) % 16384 == 0, f"Unaligned ELF segment: {name}"
            assert loads, f"Missing LOAD segments: {name}"
    for name in ("captcha_crnn.onnx", "vocab.json"):
        bundled = archive.read(f"assets/ratiod-core/{name}")
        reference = (root / "native/tinyocr/model" / name).read_bytes()
        assert hashlib.sha256(bundled).digest() == hashlib.sha256(reference).digest(), f"Asset mismatch: {name}"
    assert "assets/public/index.html" in names, "Missing bundled Capacitor UI"
    assert "assets/ratiod-core/licenses/tinyocr/LICENSE" in names
    assert "assets/ratiod-core/licenses/core/LICENSE-AGPL-3.0" in names
    assert "assets/ratiod-core/licenses/onnxruntime/LICENSE" in names
    assert "assets/ratiod-core/licenses/onnxruntime/ThirdPartyNotices.txt" in names
print("APK verified: ARM64/x86_64 Rust + OCR, 16 KB ELF segments, matching model assets, bundled UI.")
