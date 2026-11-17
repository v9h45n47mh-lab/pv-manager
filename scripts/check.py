"""Validate installation metadata, source syntax and vendored assets."""
import ast
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
component = root / "custom_components" / "pv_manager"
for file in component.rglob("*.py"):
    ast.parse(file.read_text())
for file in component.rglob("*.json"):
    json.loads(file.read_text())
assert json.loads((component / "manifest.json").read_text())["version"] == json.loads((root / "package.json").read_text())["version"]
frontend = component / "frontend"
lock = json.loads((frontend / "family-ui.lock.json").read_text())
assert lock["version"] == "1.9.0"
for file, expected in lock["files"].items():
    assert hashlib.sha256((frontend / "family-ui" / lock["version"] / file).read_bytes()).hexdigest() == expected
assert hashlib.sha256((frontend / "family-ui" / lock["version"] / "LICENSE").read_bytes()).hexdigest() == lock["licenseSha256"]
print('Metadata, Python syntax, local UI checksums OK')
