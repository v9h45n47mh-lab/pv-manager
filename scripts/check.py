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
version = json.loads((component / "manifest.json").read_text())["version"]
assert version == json.loads((root / "package.json").read_text())["version"]
assert f'VERSION = "{version}"' in (component / "__init__.py").read_text()
frontend = component / "frontend"
card = (frontend / "pv-manager-card.js").read_text()
assert f"const VERSION = '{version}'" in card
assert f"from './data.js?v={version}'" in card, "Version the data module with the card to prevent stale imports"
lock = json.loads((frontend / "family-ui.lock.json").read_text())
assert lock["version"] == "1.9.6"
for file, expected in lock["files"].items():
    assert hashlib.sha256((frontend / "family-ui" / lock["version"] / file).read_bytes()).hexdigest() == expected
assert hashlib.sha256((frontend / "family-ui" / lock["version"] / "LICENSE").read_bytes()).hexdigest() == lock["licenseSha256"]
print('Metadata, Python syntax, local UI checksums OK')

# Brand assets are shipped identically for local HA brands and repository metadata.
import struct
for prefix in ("", "dark_"):
    for suffix, size in (("", 256), ("@2x", 512)):
        name = prefix + "icon" + suffix + ".png"
        data = (component / "brand" / name).read_bytes()
        assert data[:8] == b"\x89PNG\r\n\x1a\n", name
        assert struct.unpack(">II", data[16:24]) == (size, size), name
        assert data[25] == 6, "RGBA PNG required"
        assert data == (root / "brand" / name).read_bytes(), name
print("Brand icons: dimensions, transparency channel and distribution copies OK")
