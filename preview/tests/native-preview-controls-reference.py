"""Capture the original transport and note statistics with their source geometry."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--qt-host", type=Path, required=True)
parser.add_argument("--ref", default="8770413f965084f2e0567ae44c235b8a34377861")
args = parser.parse_args()
workspace = root / ".deps/ui-reference"
output = root / ".assets/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
if records["sourceCommit"] != args.ref:
    raise RuntimeError("Reference UI module must use the selected source revision")

def source_bytes(path):
    return subprocess.check_output(["git", "-C", str(args.source.resolve()), "show", f"{args.ref}:{path}"])

components = ["PreviewTransport", "PreviewRateMenu", "PreviewCanvasMenu", "NoteStatistics"]
hashes = {}
for name in components:
    data = source_bytes(f"src/app/ui/preview/{name}.qml")
    (workspace / f"{name}.qml").write_bytes(data)
    hashes[name] = hashlib.sha256(data).hexdigest()

statistics = []
for kind, name, value in [("tap", "TAP", "8/12"), ("hold", "HOLD", "2/4"), ("slide", "SLIDE", "1/3"),
                          ("touch", "TOUCH", "1/2"), ("break", "BREAK", "1/2"), ("total", "总计", "13/23")]:
    icon = workspace / f"note-{kind}.png"
    if kind != "total":
        icon.write_bytes(source_bytes(f"assets/skin/skinDX/{'tap_break' if kind == 'break' else kind}.png"))
    statistics.append({"kind": kind, "name": name, "value": value, "iconSource": icon.as_uri() if kind != "total" else ""})

fixture = workspace / "preview-controls-reference.qml"
scene = '''import QtQuick
import QtQuick.Controls
import MiaCode.UI
Rectangle {
 id: root; width: WIDTH; height: transport.height + statistics.height
 color: Theme.colors.background.panel
 FontLoader { source: "file:///C:/Windows/Fonts/msyh.ttc" }
 FontLoader { source: "file:///C:/Windows/Fonts/msyhbd.ttc" }
 QtObject { id: preferences;
  property string activeThemeToken: THEME
  property bool darkTheme: activeThemeToken !== "light" && activeThemeToken !== "legacy_light"
  property bool blurMaterialsEnabled: false
  property string uiFontFamily: "Microsoft YaHei UI"
  property int fontSize: 13
  property font codeFont: Qt.font({family: "Consolas", pixelSize: 14})
  property bool previewCanvasFreeAspect: false
  property bool previewHidePv: false
 }
 QtObject { id: preview;
  property bool playing: false
  property real positionSeconds: 15
  property real durationSeconds: 120
  property real lowerBoundSeconds: 0
  property real rate: 1
  property var mediaHost: ({chartHasVideoBackground: true})
  function stop() {}
  function beginScrub() {}
  function updateScrub(second) {}
  function endScrub(second) {}
 }
 QtObject { id: exportSession;
  property bool rangePreviewAvailable: false
  property bool rangePlaybackEnabled: false
  property real exportStartSeconds: 0
  property real exportEndSeconds: 120
  property real contentDurationSeconds: 120
 }
 Component.onCompleted: Theme.preferences = preferences
 PreviewTransport { id: transport; width: parent.width; height: implicitHeight
  previewSession: preview; preferences: preferences; exportSession: exportSession; enabled: LOADED; dataAvailable: LOADED
 }
 NoteStatistics { id: statistics; y: transport.height; width: parent.width; statistics: STATS; enabled: LOADED; dataAvailable: LOADED }
 function controls(item, values) {
  if (item.visible && item.tooltip !== undefined && item.iconSource !== undefined) {
   const point = item.mapToItem(root, 0, 0)
   values.push({iconSource: String(item.iconSource), x: point.x, y: point.y, width: item.width, height: item.height})
  }
  for (const child of item.children || []) controls(child, values)
 }
 Timer { interval: 700; running: true; onTriggered: {
  let values = []; controls(transport, values)
  console.warn("MIACODE_PREVIEW_CONTROLS " + JSON.stringify({width: root.width, height: root.height, transportHeight: transport.height, statisticsHeight: statistics.height, controls: values}))
  root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
 } }
}
'''
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
exe = args.qt_host.resolve() / "bin" / ("qmlscene.exe" if os.name == "nt" else "qmlscene")
for theme in records["themes"]:
    captures = []
    for width in [600, 340]:
        for loaded in [False, True]:
            image = output / f"preview-controls-{width}-{'loaded' if loaded else 'empty'}-{theme}.png"
            text = scene.replace("WIDTH", str(width)).replace("THEME", json.dumps(theme)).replace("LOADED", str(loaded).lower())
            text = text.replace("STATS", json.dumps(statistics, ensure_ascii=False)).replace("OUTPUT", json.dumps(image.as_posix()))
            fixture.write_text(text, encoding="utf-8")
            result = subprocess.run([str(exe), "-translation", str(workspace / "zh_CN.qm"), "-I", str(workspace), str(fixture)],
                                    env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
            if result.returncode or not image.is_file():
                raise RuntimeError(result.stdout + result.stderr)
            trace = result.stdout + "\n" + result.stderr
            values = [line.split("MIACODE_PREVIEW_CONTROLS ", 1)[1] for line in trace.splitlines() if "MIACODE_PREVIEW_CONTROLS " in line]
            geometry = json.loads(values[-1])
            png_size = struct.unpack(">II", image.read_bytes()[16:24])
            if png_size != (width, round(geometry["height"])):
                raise RuntimeError(f"Capture dimensions {png_size} differ from the QML geometry")
            captures.append({"image": image.name, "loaded": loaded, **geometry})
            print(f"Captured original preview controls: {image.name}", flush=True)
    records["themes"][theme]["previewControls"] = {"sourceCommit": args.ref, "componentSha256": hashes, "captures": captures}
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
