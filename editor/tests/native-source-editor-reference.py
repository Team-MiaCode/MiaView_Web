"""Capture pinned Scintilla appearance and native editor metrics."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--host", type=Path)
parser.add_argument("--qt-host", type=Path)
parser.add_argument("--prepare-only", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
workspace = root / ".deps/ui-reference"
output = root / ".assets/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
commit = records["sourceCommit"]
paths = ["app/ui/editor/ScintillaDslStyler.cpp", "app/ui/editor/ScintillaDslStyler.h", "app/ui/editor/ScintillaDocumentAdapter.cpp", "app/ui/editor/ScintillaDocumentAdapter.h", "editor/BookmarkCommentSyntax.cpp", "editor/BookmarkCommentSyntax.h"]
hashes = {}
for path in paths:
    data = subprocess.check_output(["git", "-C", str(args.source), "show", f"{commit}:src/{path}"])
    target = root / ".deps/editor-reference-source" / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    hashes[path] = hashlib.sha256(data).hexdigest()
dependency = subprocess.check_output(["git", "-C", str(args.source), "ls-tree", commit, "third_party/ScintillaQuick"], text=True).split()[2]
scintilla = root / ".deps/scintilla-reference"
if not scintilla.exists():
    subprocess.run(["git", "clone", "--no-checkout", "https://github.com/imakris/ScintillaQuick.git", str(scintilla)], check=True)
    subprocess.run(["git", "-C", str(scintilla), "checkout", "--detach", dependency], check=True)
actual = subprocess.check_output(["git", "-C", str(scintilla), "rev-parse", "HEAD"], text=True).strip()
if actual != dependency:
    raise RuntimeError(f"Reference ScintillaQuick requires {dependency}, found {actual}")
font = workspace / "MapleMonoNormalNL-CN-Regular.ttf"
font_data = subprocess.check_output(["git", "-C", str(args.source), "show", f"{commit}:assets/fonts/MapleMonoNormalNL-CN-Regular.ttf"])
font.write_bytes(font_data)
if args.prepare_only:
    print(f"Prepared editor source {commit} and ScintillaQuick {dependency}")
    raise SystemExit(0)
if args.host is None or args.qt_host is None:
    parser.error("--host and --qt-host are required for capture")
palettes = json.loads((root / "ui/components/theme.json").read_text(encoding="utf-8"))["themes"]
text = "(120){4}\n1,2,3,4,5,6,7,8,\n1b,2x,3h[4:1],4-8[4:1],\nA1,B2,C,D3,E4,E"
log_directory = root / "artifacts/source-editor/native"
log_directory.mkdir(parents=True, exist_ok=True)
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="rhi", QT_FONT_DPI="96", QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
env["PATH"] = str(args.qt_host.resolve() / "bin") + os.pathsep + env["PATH"]
env["QT_PLUGIN_PATH"] = str(args.qt_host.resolve() / "plugins")
for theme in records["themes"]:
    colors = {name: palettes[theme][key] for name, key in {
        "text": "text-editor", "background": "background-surface", "lineNumber": "text-line-number", "accent": "accent-primary",
        "keyword": "syntax-keyword", "duration": "syntax-duration", "comment": "syntax-comment", "error": "syntax-error", "warning": "syntax-warning",
        "follow": "state-follow-highlight", "currentLine": "state-focus-line", "selection": "state-selection-highlight"}.items()}
    for key, color in colors.items():
        if color.startswith("rgba"):
            r, g, b, a = map(float, re.findall(r"[\d.]+", color))
            colors[key] = f"#{round(a * 255):02x}{int(r):02x}{int(g):02x}{int(b):02x}"
    captures = []
    for width, height in [(600, 240), (280, 180)]:
        name = f"source-editor-{width}x{height}-{theme}"
        image = output / f"{name}.png"
        image.unlink(missing_ok=True)
        fixture = workspace / "editor.json"
        fixture.write_text(json.dumps({"text": text, "colors": colors, "fontSize": 14, "fontPath": str(font.resolve()), "blockSpacing": 3}), encoding="utf-8")
        run = subprocess.run([str(args.host.resolve()), "--editor", str(fixture), "--viewport", f"{width}x{height}", "--capture", str(image)], env=env,
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        log = run.stdout + run.stderr
        (log_directory / f"{name}.log").write_text(log, encoding="utf-8")
        if run.returncode or not image.is_file():
            raise RuntimeError(log)
        metrics = re.search(r"MIACODE_EDITOR_REFERENCE\s+(\{[^\n]+\})", log)
        if not metrics:
            raise RuntimeError(log)
        captures.append({"image": image.name, "width": width, "height": height, "metrics": json.loads(metrics[1])})
        print(f"Captured {name}", flush=True)
    records["themes"][theme]["sourceEditor"] = {"sourceSha256": hashes, "scintillaCommit": dependency, "fontSha256": hashlib.sha256(font_data).hexdigest(), "captures": captures}
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
