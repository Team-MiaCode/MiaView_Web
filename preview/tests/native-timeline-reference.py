"""Capture the upstream timeline scene with the pinned UI palette and native QSG layers."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--host", type=Path, required=True)
parser.add_argument("--qt-host", type=Path, required=True)
parser.add_argument("--themes", default="dark,light,legacy,legacy_light")
parser.add_argument("--states", default="empty,chart,waveform")
parser.add_argument("--sizes", default="800x240,400x220")
args = parser.parse_args()
source = root / "vendor/MiaCode"
workspace = root / ".deps/ui-reference"
output = root / ".assets/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
palettes = json.loads((root / "ui/components/theme.json").read_text(encoding="utf-8"))["themes"]
commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
paths = list((source / "src/timeline").rglob("*.cpp")) + list((source / "src/timeline").rglob("*.h"))
hashes = {path.relative_to(source).as_posix(): hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest() for path in paths}
text = "(120){4}\n1,2,3,4,5,6,7,8,\n1b,2x,3h[4:1],4-8[4:1],\nA1,B2,C,D3,E4,E\n"
env = dict(os.environ, QT_QPA_PLATFORM="offscreen",
           QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
env["QT_QUICK_BACKEND"] = "rhi"
env["PATH"] = str(args.qt_host.resolve() / "bin") + os.pathsep + env["PATH"]
env["QT_PLUGIN_PATH"] = str(args.qt_host.resolve() / "plugins")
log_directory = root / "artifacts/timeline/native"
log_directory.mkdir(parents=True, exist_ok=True)
for theme in args.themes.split(","):
    previous = records["themes"][theme].get("timeline", {})
    captures = {(value["state"], value["width"], value["height"]): value for value in previous.get("captures", [])}
    palette = palettes[theme]
    colors = {}
    for key in ["window", "header", "sidebar", "base", "border", "axis", "gridMajor", "gridSubdivision", "gridMinor", "laneEven", "laneOdd", "label", "textSecondary", "waveStroke"]:
        surface = {"window": "surface", "header": "panel", "sidebar": "panel", "base": "surface"}.get(key)
        value = palette[f"background-{surface}" if surface else "timeline-" + re.sub(r"[A-Z]", lambda match: "-" + match[0].lower(), key)]
        colors[key] = [float(channel) for channel in re.findall(r"[\d.]+", value)] if value.startswith("rgb") else value
    for size in args.sizes.split(","):
        width, height = map(int, size.split("x"))
        for state in args.states.split(","):
            name = f"timeline-{size}-{state}-{theme}"
            image = output / f"{name}.png"
            fixture = {"text": "" if state == "empty" else text, "documentLoaded": state != "empty", "colors": colors, "waveform": state == "waveform",
                       "zoomScale": .5, "skinDirectory": (source / "assets/skin/skinDX").as_posix()}
            (workspace / "timeline.json").write_text(json.dumps(fixture), encoding="utf-8")
            previous_mtime = image.stat().st_mtime_ns if image.exists() else 0
            try:
                result = subprocess.run([str(args.host.resolve()), "--timeline", str(workspace / "timeline.json"),
                                         "--capture", str(image), "--viewport", size],
                                        env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
            except subprocess.TimeoutExpired as error:
                log = (error.stdout or b"") + (error.stderr or b"")
                (log_directory / f"{name}.log").write_bytes(log)
                raise RuntimeError(log.decode("utf-8", errors="replace")) from error
            (log_directory / f"{name}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
            if result.returncode or not image.is_file() or image.stat().st_mtime_ns == previous_mtime:
                raise RuntimeError(f"Native timeline capture exited {result.returncode}:\n" + result.stdout + result.stderr)
            if struct.unpack("!II", image.read_bytes()[16:24]) != (width, height):
                raise RuntimeError(f"Unexpected timeline capture size: {image}")
            captures[(state, width, height)] = {"state": state, "width": width, "height": height, "image": image.name}
            print(f"Rendered native timeline {name}", flush=True)
    records["themes"][theme]["timeline"] = {"rendererSourceCommit": commit, "paletteSourceCommit": records["sourceCommit"],
                                           "sourceSha256": hashes, "captures": list(captures.values()), "fixture": text}
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
