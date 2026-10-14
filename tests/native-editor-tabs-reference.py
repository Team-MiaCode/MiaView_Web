"""Capture pinned EditorTabBar with normal and overflowing document tabs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--qt-host", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
workspace = root / ".deps/ui-reference"
output = root / ".assets/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
commit = records["sourceCommit"]
path = "src/app/ui/editor/EditorTabBar.qml"
source = subprocess.check_output(["git", "-C", str(args.source), "show", f"{commit}:{path}"])
(workspace / "EditorTabBar.qml").write_bytes(source)
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", QT_QUICK_CONTROLS_STYLE="Basic")
for theme in records["themes"]:
    for width in [480, 240]:
        image = output / f"editor-tabs-{width}-{theme}.png"
        image.unlink(missing_ok=True)
        scene = workspace / "editor-tabs-reference.qml"
        scene.write_text(f'''pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import MiaCode.UI
Rectangle {{
    id: root; width: {width}; height: 34; color: Theme.colors.background.editorTabStrip
    FontLoader {{ source: "file:///C:/Windows/Fonts/msyh.ttc" }}
    QtObject {{ id: preferences; property string activeThemeToken: {json.dumps(theme)}; property bool darkTheme: {str(not theme.endswith('light')).lower()}; property bool blurMaterialsEnabled: false; property string uiFontFamily: "Microsoft YaHei UI"; property int fontSize: 13; property font codeFont: Qt.font({{family: "Consolas", pixelSize: 14}}); property int editorBlockSpacing: 0 }}
    QtObject {{ id: state
        property var openEditorTabs: ["metadata", "difficulty:5", "difficulty:6"]
        property string activeEditorKey: "difficulty:6"
        property string metadataEditorKey: "metadata"
        property string latencyEditorKey: "latency"
        property string netUploadEditorKey: "net-upload"
        property string netDownloadEditorKey: "net-download"
        function isNetEditor(key) {{ return false }}
        function difficultyEditorKey(id) {{ return "difficulty:" + id }}
        function activateEditor(key) {{ activeEditorKey = key }}
        function closeEditor(key) {{}}
        function swapEditorTabs(a, b) {{}}
    }}
    QtObject {{ id: documentModel
        property var difficulties: [{{id: 5, label: "MASTER", designer: "MiaCode"}}, {{id: 6, label: "Re:MASTER", designer: "MiaCode"}}]
        property var dirtyEditorKeys: ["difficulty:5"]
        property string currentFilePath: "Song/maidata.txt"
        property string currentFileName: "maidata.txt"
        signal difficultyCloseAccepted(int difficultyId)
        function requestCloseDifficulty(id) {{}}
    }}
    QtObject {{ id: pages; property string activePageId: ""; function openLatencyPage() {{}} }}
    Component.onCompleted: Theme.preferences = preferences
    EditorTabBar {{ id: captureTabs; anchors.fill: parent; viewState: state; documentSession: documentModel; commands: ({{}}); pages: pages }}
    Timer {{ interval: 100; running: true; onTriggered: captureTabs.revealActiveTab() }}
    Timer {{ interval: 600; running: true; onTriggered: root.grabToImage(function(result) {{ result.saveToFile({json.dumps(image.as_posix())}); Qt.quit() }}) }}
}}
''', encoding="utf-8")
        run = subprocess.run([str(args.qt_host / "bin/qmlscene.exe"), "-translation", str(workspace / "zh_CN.qm"), "-I", str(workspace), str(scene)], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        if run.returncode or not image.is_file():
            raise RuntimeError(run.stdout + run.stderr)
        records["themes"][theme][f"editor-tabs-{width}"] = {"image": image.name, "sourceSha256": hashlib.sha256(source).hexdigest(), "size": [width, 34]}
        print(f"Captured {image.name}", flush=True)
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
