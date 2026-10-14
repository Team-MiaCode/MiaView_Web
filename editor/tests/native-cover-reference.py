"""Capture the original cover studio with its native layout and preview types."""
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
parser.add_argument("--ref", default="8770413f965084f2e0567ae44c235b8a34377861")
parser.add_argument("--host", type=Path, help="Built native-reference executable")
parser.add_argument("--prepare-only", action="store_true")
parser.add_argument("--only", default="canvas,card,image,text")
args = parser.parse_args()
source = args.source.resolve()
workspace = root / ".deps/ui-reference"
output = root / ".assets/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
if records["sourceCommit"] != args.ref:
    raise RuntimeError("Generate the shared UI reference for this source commit")

def source_bytes(path):
    return subprocess.check_output(["git", "-C", str(source), "show", f"{args.ref}:{path}"])

resource_paths = subprocess.check_output(["git", "-C", str(source), "ls-tree", "-r", "--name-only", args.ref, "src/intro"], text=True).splitlines()
resources = []
for path in resource_paths:
    relative = Path(path).relative_to("src/intro")
    if relative.parts[0] not in ["qml", "assets", "templates"]:
        continue
    target = workspace / "intro" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    data = source_bytes(path)
    target.write_bytes(data)
    resources.append({"source": path, "sha256": hashlib.sha256(data).hexdigest()})
icon_path = "resources/icons/app-original.png"
icon = source_bytes(icon_path)
(workspace / "icons").mkdir(parents=True, exist_ok=True)
(workspace / "icons/app-original.png").write_bytes(icon)
resources.append({"source": icon_path, "sha256": hashlib.sha256(icon).hexdigest()})
page_path = "src/app/ui/export/CoverExportPage.qml"
header_path = "src/app/ui/export/CoverExportSession.h"
for path in [page_path, "src/app/ui/export/CoverLayerList.qml"]:
    (workspace / Path(path).name).write_bytes(source_bytes(path))
if args.prepare_only:
    print(f"Prepared original cover resources: {len(resources)} files", flush=True)
    raise SystemExit(0)
if not args.host:
    parser.error("--host is required for capture")

sizes = [(720, 720), (960, 720), (1280, 720), (1080, 1080), (1440, 1080), (1920, 1080), (1440, 1440), (1920, 1440), (2560, 1440)]
values = {
    "pageSessionActive": True, "selectedDifficultyId": 5,
    "difficulties": [{"id": 2, "name": "BASIC"}, {"id": 5, "name": "MASTER"}],
    "resolutionOptions": [{"label": f"{w}×{h} ({'1:1' if w == h else '4:3' if w * 3 == h * 4 else '16:9'})", "width": w, "height": h} for w, h in sizes],
    "resolutionIndex": 3, "outputWidth": 1080, "outputHeight": 1080, "outputFile": "card.jpg",
    "backgroundBrightness": 0.45, "blurBackground": True, "cardMode": "auto", "longTextMode": "shrink",
    "fontLibraryOptions": [{"path": "", "label": "默认字体", "family": ""}],
    "chartFrameAvailable": True, "chartFrameDuration": 30,
    "templateMap": json.loads(source_bytes("src/intro/templates/maimai_banner.json")),
    "trackOverrides": {"title": "MiaCode Example", "artist": "Team MiaCode", "designer": "MiaCode", "difficulty": "MASTER", "level": "13+", "mode": "DX", "bpm": "120"},
}
cpp_header = source_bytes(header_path).decode("utf-8")
types = {"bool": ("bool", False), "int": ("int", 0), "double": ("real", 0), "QString": ("string", ""), "QUrl": ("url", ""), "QStringList": ("var", []), "QVariantList": ("var", []), "QVariantMap": ("var", {}), "QObject*": ("var", None)}
properties = []
for cpp_type, name in re.findall(r"Q_PROPERTY\(\s*(\S+)\s+(\w+)\s", cpp_header):
    if name == "layoutModel":
        properties.append("property var layoutModel: referenceCoverLayout")
    elif name == "activeLayer":
        properties.append("property var activeLayer: { const layers = layoutModel.layers; for (let i = 0; i < layers.length; i++) if (layers[i].key === activeLayerKey) return layers[i]; return null }")
    elif name == "activeLayerKey":
        properties.append('property string activeLayerKey: "card"')
    else:
        qml_type, default = types[cpp_type]
        properties.append(f"property {qml_type} {name}: {json.dumps(values.get(name, default), ensure_ascii=False)}")
methods = []
for name, parameters in re.findall(r"Q_INVOKABLE\s+void\s+(\w+)\(([^)]*)\)", cpp_header):
    arguments = [part.strip().split()[-1] for part in parameters.split(",") if part.strip()]
    body = "activeLayerKey = key" if name == "selectLayerKey" else ""
    methods.append(f"function {name}({','.join(arguments)}) {{ {body} }}")
model = "QtObject { id: coverModel;\n" + "\n".join(properties + methods) + "\n}"
scene = '''import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import MiaCode.UI
Rectangle {
 id: root; width: 1200; height: 720; color: Theme.colors.background.panel
 FontLoader { source: "file:///C:/Windows/Fonts/msyh.ttc" }
 FontLoader { source: "file:///C:/Windows/Fonts/msyhbd.ttc" }
 QtObject { id: preferences; property string activeThemeToken: THEME; property bool darkTheme: activeThemeToken !== "light" && activeThemeToken !== "legacy_light"; property bool blurMaterialsEnabled: false; property string uiFontFamily: "Microsoft YaHei UI"; property int fontSize: 13; property font codeFont: Qt.font({family: "Consolas", pixelSize: 14}); property int editorBlockSpacing: 0 }
 Component.onCompleted: Theme.preferences = preferences
 MODEL
 CoverExportPage { id: page; anchors.fill: parent; coverSession: coverModel }
 function findInspectorTabs(item) { if (item.tabs && item.tabs.length === 2 && item.tabs[0].id === "canvas") return item; for (const child of item.children || []) { const found = findInspectorTabs(child); if (found) return found } return null }
 Timer { interval: 100; running: true; onTriggered: { coverModel.activeLayerKey = ACTIVE; if (TAB === "layer") findInspectorTabs(page).selectTab(1); capture.start() } }
 Timer { id: capture; interval: 700; onTriggered: root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() }) }
}
'''.replace("MODEL", model)
fixture = workspace / "cover-reference.qml"
layout_file = workspace / "cover-layout.json"
layers = [
    {"key": "card", "kind": "card", "label": "Difficulty card", "nx": .5, "ny": .5, "sizeFraction": .85, "z": 0, "visible": True, "locked": False, "opacity": 1},
    {"key": "text", "kind": "text", "label": "Text", "nx": .5, "ny": .2, "sizeFraction": .08, "z": 1, "visible": True, "locked": False, "opacity": 1, "text": "MiaCode", "textColor": "#FFFFFF", "textBold": False},
    {"key": "image", "kind": "image", "label": "Image", "nx": .5, "ny": .5, "sizeFraction": .2, "z": 2, "visible": False, "locked": False, "opacity": .8, "imagePath": ""},
]
layout_file.write_text(json.dumps({"layers": layers}, ensure_ascii=False), encoding="utf-8")
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
for theme in records["themes"]:
    for tab in args.only.split(","):
        image = output / f"cover-{tab}-{theme}.png"
        previous_mtime = image.stat().st_mtime_ns if image.exists() else 0
        fixture.write_text(scene.replace("THEME", json.dumps(theme)).replace("ACTIVE", json.dumps("card" if tab == "canvas" else tab)).replace("TAB", json.dumps("canvas" if tab == "canvas" else "layer")).replace("OUTPUT", json.dumps(image.as_posix())), encoding="utf-8")
        result = subprocess.run([str(args.host.resolve()), "--translation", str(workspace / "zh_CN.qm"), "-I", str(workspace), "--layout", str(layout_file), str(fixture)], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
        if result.returncode or not image.is_file() or image.stat().st_mtime_ns == previous_mtime:
            raise RuntimeError(result.stdout + result.stderr)
        if struct.unpack("!II", image.read_bytes()[16:24]) != (1200, 720):
            raise RuntimeError(f"Unexpected captured dimensions: {image}")
        (root / "artifacts/workbench-ui/native-cover").mkdir(parents=True, exist_ok=True)
        (root / "artifacts/workbench-ui/native-cover" / f"{tab}-{theme}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        records["themes"][theme].setdefault("cover", {})[tab] = {"image": image.name, "componentCommit": args.ref, "sourceSha256": hashlib.sha256(source_bytes(page_path)).hexdigest(), "headerSha256": hashlib.sha256(source_bytes(header_path)).hexdigest(), "resources": resources, "width": 1200, "height": 720, "layers": layers}
        print(f"Rendered original cover {tab} {theme}: {image.name}", flush=True)
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
