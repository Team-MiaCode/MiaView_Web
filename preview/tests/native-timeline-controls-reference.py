"""Capture the pinned timeline zoom and brightness popups."""
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
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--qt-host", type=Path, required=True)
parser.add_argument("--host", type=Path, required=True)
parser.add_argument("--ref", default="8770413f965084f2e0567ae44c235b8a34377861")
args = parser.parse_args()
workspace = root / ".deps/ui-reference"
output = root / ".assets/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
hashes = {}
for name in ["TimelineZoomMenu", "TimelineBrightnessMenu"]:
    data = subprocess.check_output(["git", "-C", str(args.source.resolve()), "show", f"{args.ref}:src/app/ui/timeline/{name}.qml"])
    (workspace / f"{name}.qml").write_bytes(data)
    hashes[name] = hashlib.sha256(data).hexdigest()
scene = '''import QtQuick
import QtQuick.Controls
import QtQuick.Window
import MiaCode.UI
Item {
 id: root; width: 320; height: 260
 FontLoader { source: "file:///C:/Windows/Fonts/msyh.ttc" }
 FontLoader { source: "file:///C:/Windows/Fonts/msyhbd.ttc" }
 QtObject { id: preferences;
  property string activeThemeToken: THEME
  property bool darkTheme: activeThemeToken !== "light" && activeThemeToken !== "legacy_light"
  property bool blurMaterialsEnabled: false
  property string uiFontFamily: "Microsoft YaHei UI"
  property int fontSize: 13
  property font codeFont: Qt.font({family: "Consolas", pixelSize: 14})
  property int editorBlockSpacing: 0
 }
 QtObject { id: bridge;
  property real zoomScale: .5
  property var zoomPresetValues: [.25, .5, .75, 1, 1.5, 2, 3]
  property real waveformBrightness: 2
  property real measureLineBrightness: .2
  function applyZoomPreset(scale) { zoomScale = scale }
 }
 Component.onCompleted: Theme.preferences = preferences
 AppDropDownButton { id: zoom; x: 20; y: 220; compact: true; text: "50%"; sizeToLabels: ["25%", "50%", "75%", "100%", "150%", "200%", "300%"] }
 IconButton { id: brightness; x: 276; y: 220; compact: true; iconSource: "icons/sliders-horizontal.svg" }
 TimelineZoomMenu { id: zoomMenu; stateBridge: bridge }
 TimelineBrightnessMenu { id: brightnessMenu; stateBridge: bridge }
 Timer { interval: 100; running: true; onTriggered: {
  if (MODE === "zoom") zoomMenu.openAt(zoom); else brightnessMenu.openAt(brightness)
  capture.start()
 } }
 Timer { id: capture; interval: 500; onTriggered: {
  const menu = MODE === "zoom" ? zoomMenu : brightnessMenu
  const point = menu.contentItem.mapToItem(root, -menu.leftPadding, -menu.topPadding)
  console.warn("MIACODE_TIMELINE_CONTROL " + JSON.stringify({x: point.x, y: point.y, width: menu.width, height: menu.height, zoomWidth: zoom.width, zoomHeight: zoom.height}))
  root.Window.window.contentItem.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
 } }
}
'''
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
env["PATH"] = str(args.qt_host.resolve() / "bin") + os.pathsep + env["PATH"]
env["QT_PLUGIN_PATH"] = str(args.qt_host.resolve() / "plugins")
exe = args.host.resolve()
log_directory = root / "artifacts/timeline-controls/native"
log_directory.mkdir(parents=True, exist_ok=True)
for theme in records["themes"]:
    captures = {}
    for mode in ["zoom", "brightness"]:
        image = output / f"timeline-controls-{mode}-{theme}.png"
        fixture = workspace / "timeline-controls-reference.qml"
        fixture.write_text(scene.replace("THEME", json.dumps(theme)).replace("MODE", json.dumps(mode)).replace("OUTPUT", json.dumps(image.as_posix())), encoding="utf-8")
        result = subprocess.run([str(exe), "--translation", str(workspace / "zh_CN.qm"), "--viewport", "320x260", "-I", str(workspace), str(fixture)],
                                env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        log = result.stdout + result.stderr
        (log_directory / f"{mode}-{theme}.log").write_text(log, encoding="utf-8")
        if result.returncode or not image.is_file():
            raise RuntimeError(log)
        if struct.unpack("!II", image.read_bytes()[16:24]) != (320, 260):
            raise RuntimeError(f"Unexpected captured size: {image}")
        match = re.search(r"MIACODE_TIMELINE_CONTROL (\{[^\n]+\})", log)
        if not match:
            raise RuntimeError(log)
        captures[mode] = {"image": image.name, "bounds": json.loads(match[1])}
        print(f"Rendered original timeline {mode} {theme}", flush=True)
    records["themes"][theme]["timelineControls"] = {"componentCommit": args.ref, "sourceSha256": hashes, "captures": captures}
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
