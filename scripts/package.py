"""Create HACS and manual installation packages with pinned local UI assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
component = root / "custom_components" / "pv_manager"
(root / "dist").mkdir(exist_ok=True)
for name, base in [("pv-manager.zip", component), ("pv-manager-manual.zip", root)]:
    with ZipFile(root / "dist" / name, "w", ZIP_DEFLATED) as archive:
        for file in sorted(component.rglob("*")):
            if file.is_file() and "__pycache__" not in file.parts:
                archive.write(file, file.relative_to(base))
    print(name)
