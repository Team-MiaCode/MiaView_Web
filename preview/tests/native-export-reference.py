"""Render the original export page with versioned session properties and options."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--qt-host", type=Path, required=True)
parser.add_argument("--ref", default="8770413f965084f2e0567ae44c235b8a34377861")
parser.add_argument("--component-ref", help="Fixed component commit recorded alongside the shared UI baseline")
parser.add_argument("--lrelease", type=Path, help="Translation compiler for a component-specific catalogue")
parser.add_argument("--only", default="output,video,gameplay,skin,intro")
args = parser.parse_args()
source = args.source.resolve()
workspace = root / ".deps/ui-reference"
output = root / ".assets/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
if records["sourceCommit"] != args.ref:
    raise RuntimeError("Generate the shared UI reference module for the requested source commit")

def source_bytes(path):
    return subprocess.check_output(["git", "-C", str(source), "show", f"{args.component_ref or args.ref}:{path}"])

component_theme_sha = records["themeSha256"]
if args.component_ref:
    baseline_workspace = workspace
    workspace = workspace / f"export-{args.component_ref[:12]}"
    module = workspace / "MiaCode/UI"
    module.mkdir(parents=True, exist_ok=True)
    names = []
    paths = subprocess.check_output(["git", "-C", str(source), "ls-tree", "-r", "--name-only", args.component_ref,
                                     "src/app/ui/components", "src/app/ui/resources/icons"], text=True).splitlines()
    for path in paths:
        item = Path(path)
        if path.startswith("src/app/ui/components/") and item.suffix == ".qml":
            (module / item.name).write_bytes(source_bytes(path))
            names.append(item.stem)
        elif path.startswith("src/app/ui/resources/icons/"):
            target = module / "icons" / item.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source_bytes(path))
    theme_bytes = source_bytes("src/app/ui/theme/Theme.qml")
    component_theme_sha = hashlib.sha256(theme_bytes).hexdigest()
    (module / "Theme.qml").write_bytes(theme_bytes)
    (module / "qmldir").write_text("module MiaCode.UI\nsingleton Theme 1.0 Theme.qml\n" +
                                 "\n".join(f"{name} 1.0 {name}.qml" for name in names) + "\n", encoding="utf-8")
    shutil.copyfile(baseline_workspace / "PreviewModels.qml", workspace / "PreviewModels.qml")
    (workspace / "PreviewAppearancePages.qml").write_bytes(source_bytes("src/app/ui/preview/PreviewAppearancePages.qml"))

translation = workspace / "zh_CN.qm"
if args.component_ref:
    if not args.lrelease:
        parser.error("--component-ref requires --lrelease to compile its own translations")
    catalogue_source = workspace / "export-zh_CN.ts"
    catalogue_source.write_bytes(source_bytes("translations/zh_CN.ts"))
    translation = workspace / "export-zh_CN.qm"
    subprocess.run([str(args.lrelease), "-idbased", str(catalogue_source), "-qm", str(translation)], check=True, capture_output=True)

resources = {}
for weight in ["Heavy", "Bold"]:
    path = f"src/intro/assets/fonts/ResourceHanRoundedCN-{weight}.ttf"
    font = workspace / f"ResourceHanRoundedCN-{weight}.ttf"
    data = source_bytes(path)
    font.write_bytes(data)
    resources[f"qrc:/intro/assets/fonts/{font.name}"] = {"source": path, "url": font.as_uri(), "sha256": hashlib.sha256(data).hexdigest()}
paths = ["src/app/ui/export/ExportVideoPage.qml", "src/app/ui/export/ExportRangeSelector.qml"]
for path in paths:
    data = source_bytes(path)
    for old, resource in resources.items():
        data = data.replace(old.encode(), resource["url"].encode())
    (workspace / Path(path).name).write_bytes(data)

catalogue = {message.get("id"): message.findtext("translation") for message in ET.fromstring(source_bytes("translations/zh_CN.ts")).iter("message")}
def translated(key):
    return catalogue.get(key) or key

sizes = [(720, 720), (960, 720), (1280, 720), (1080, 1080), (1440, 1080), (1920, 1080), (1440, 1440), (1920, 1440), (2560, 1440)]
values = {
    "pageSessionActive": True, "selectedDifficultyId": 5, "activeTab": "export", "settingsTab": "output", "unavailableReason": "",
    "difficulties": [{"id": 2, "name": "BASIC"}, {"id": 5, "name": "MASTER"}],
    "outputPath": "MiaCode.mp4", "outputWidth": 1080, "outputHeight": 1080, "resolutionIndex": 3,
    "resolutionOptions": [{"label": f"{w}x{h} ({'1:1' if w == h else '4:3' if w * 3 == h * 4 else '16:9'})", "width": w, "height": h} for w, h in sizes],
    "fps": 60, "fpsOptions": [30, 60, 120], "audioBitrateKbps": 192, "audioBitrateOptions": [128, 160, 192, 256, 320],
    "presetIndex": 1, "presetOptions": [translated(f"dialog.video_export.preset.{key}") for key in ["fast", "high_quality"]],
    "sizePresetOptions": [translated(f"dialog.video_export.size_preset.{key}") for key in ["standard", "compact", "ultra_compact_with_pv", "ultra_compact"]],
    "introEnabled": True, "introBlurBackground": True, "introPvSegmentSeconds": 12, "introPvMusicSeconds": 8,
    "introSoundOptions": [{"fileName": "", "label": translated("qml.default")}],
    "fontLibraryOptions": [{"path": "", "family": "", "label": translated("card_font.default")}],
    "exportEndSeconds": 30, "contentDurationSeconds": 30, "minimumExportRangeSeconds": 5, "fullRangeExport": True,
    "rangePreviewAvailable": True,
}
header_path = "src/app/ui/export/ExportSession.h"
header = source_bytes(header_path).decode("utf-8")
types = {"bool": ("bool", False), "int": ("int", 0), "double": ("real", 0), "QString": ("string", ""), "QUrl": ("url", ""), "QStringList": ("var", []), "QVariantList": ("var", []), "QVariantMap": ("var", {}), "QObject*": ("var", None)}
properties = []
for cpp_type, name in re.findall(r"Q_PROPERTY\(\s*(\S+)\s+(\w+)\s", header):
    qml_type, default = types[cpp_type]
    properties.append(f"property {qml_type} {name}: {json.dumps(values.get(name, default), ensure_ascii=False)}")
methods = []
for return_type, name, parameters in re.findall(r"Q_INVOKABLE\s+(\w+)\s+(\w+)\(([^)]*)\)", header):
    arguments = [part.strip().split()[-1].split("=")[0] for part in parameters.split(",") if part.strip()]
    result = f"return {arguments[0]}" if return_type == "QString" and arguments else ""
    methods.append(f"function {name}({','.join(arguments)}) {{ {result} }}")
model = "QtObject { id: exportModel;\n" + "\n".join(properties + methods) + "\nsignal introChanged()\nsignal rangeChanged()\n}"
common = """import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import MiaCode.UI
Rectangle {
 id: root; width: 800; height: 900; color: Theme.colors.background.panel
 FontLoader { source: "file:///C:/Windows/Fonts/msyh.ttc" }
 FontLoader { source: "file:///C:/Windows/Fonts/msyhbd.ttc" }
 QtObject { id: preferences; property string activeThemeToken: THEME; property bool darkTheme: activeThemeToken !== "light" && activeThemeToken !== "legacy_light"; property bool blurMaterialsEnabled: false; property string uiFontFamily: "Microsoft YaHei UI"; property int fontSize: 13; property font codeFont: Qt.font({family: "Consolas", pixelSize: 14}); property int editorBlockSpacing: 0 }
 Component.onCompleted: Theme.preferences = preferences
 PreviewModels { id: previewModels }
 MODEL
 QtObject { id: pagesModel; property var exportSession: exportModel }
 QtObject { id: previewModel; property real positionSeconds: 0; property real lowerBoundSeconds: 0; property real upperBoundSeconds: 30; function beginScrub() {} function updateScrub(value) {} function endScrub(value) {} }
 ExportVideoPage { id: page; anchors.fill: parent; pages: pagesModel; previewSession: previewModel; previewSettings: previewModels.previewModel }
 Timer { interval: 100; running: true; onTriggered: { exportModel.activeTab = MODE; exportModel.settingsTab = TAB; capture.start() } }
 Timer { id: capture; interval: 600; onTriggered: root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() }) }
}
""".replace("MODEL", model)
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
exe = args.qt_host / "bin" / ("qmlscene.exe" if os.name == "nt" else "qmlscene")
fixture = workspace / "export-reference.qml"
for theme in records["themes"]:
    for tab in args.only.split(","):
        image = output / f"export-{tab}-{theme}.png"
        fixture.write_text(common.replace("THEME", json.dumps(theme)).replace("MODE", json.dumps("export")).replace("TAB", json.dumps(tab)).replace("OUTPUT", json.dumps(image.as_posix())), encoding="utf-8")
        result = subprocess.run([str(exe), "-translation", str(translation), "-I", str(workspace), str(fixture)], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        if result.returncode or not image.is_file():
            raise RuntimeError(result.stdout + result.stderr)
        resource_inventory = {key: {"source": item["source"], "sha256": item["sha256"]} for key, item in resources.items()}
        records["themes"][theme].setdefault("export", {})[tab] = {"image": image.name, "componentCommit": args.component_ref or args.ref, "themeSha256": component_theme_sha, "sourceSha256": hashlib.sha256(source_bytes(paths[0])).hexdigest(), "translationSha256": hashlib.sha256(source_bytes("translations/zh_CN.ts")).hexdigest(), "sessionHeaderSha256": hashlib.sha256(source_bytes(header_path)).hexdigest(), "resources": resource_inventory, "width": 800, "height": 900}
        print(f"Rendered original export {tab} {theme}: {image.name}", flush=True)
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
