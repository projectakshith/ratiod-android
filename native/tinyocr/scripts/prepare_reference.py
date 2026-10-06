"""Fetch immutable public checkpoint/corpus for model export; never read SRM sessions."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

REV = "d59c4474cb5371bbe7866b18e6ffa1af0908dbae"
BASE = f"https://raw.githubusercontent.com/wtfPrethiv/TinyOCR/{REV}/"
ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_SHA256 = "e9072bf58ad9ccbba4326ae9f2a607e6d64edebd52cd9ac0025e21aea419326e"

def fetch(path, blob_sha=None):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(BASE + path, timeout=30) as response:
        data = response.read()
    if path.endswith(".pt") and hashlib.sha256(data).hexdigest() != CHECKPOINT_SHA256:
        raise ValueError("Checkpoint checksum mismatch")
    if blob_sha and hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest() != blob_sha:
        raise ValueError("Reference image checksum mismatch")
    target.write_bytes(data)
fetch("model/best_captcha_crnn.pt")
with urllib.request.urlopen(f"https://api.github.com/repos/wtfPrethiv/TinyOCR/git/trees/{REV}?recursive=1") as response:
    tree = json.load(response)["tree"]
entries = sorted((entry for entry in tree if entry["path"].startswith("data/student_portal/") and entry["path"].endswith(".png")), key=lambda entry: entry["path"])[:512]
if len(entries) != 512:
    raise ValueError("Expected 512 immutable public samples")
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(lambda entry: fetch(entry["path"], entry["sha"]), entries))
print(f"Prepared immutable checkpoint and {len(entries)} public model-validation samples.")
