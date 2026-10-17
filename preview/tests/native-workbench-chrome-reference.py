"""Capture the original workbench toolbar and status bar."""
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
hashes = {}
for name in ["MainToolBar", "StatusBar", "WindowGestureArea"]:
    path = f"src/app/ui/chrome/{name}.qml"
    source = subprocess.check_output(["git", "-C", str(args.source), "show", f"{commit}:{path}"])
    (workspace / f"{name}.qml").write_bytes(source)
    hashes[name] = hashlib.sha256(source).hexdigest()
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", QT_QUICK_CONTROLS_STYLE="Basic")
for theme in records["themes"]:
    for kind in ["toolbar", "statusbar"]:
        height = 30 if kind == "toolbar" else 23
        component = 'MainToolBar { anchors.fill: parent; hostWindow: ({}); windowChrome: ({}); sidebarActive: true; bottomActive: true; canUndo: true; canRedo: true }' if kind == "toolbar" else 'StatusBar { anchors.fill: parent; documentName: "Song/maidata.txt"; difficultyActive: true; cursorLine: 3; cursorColumn: 4 }'
        image = output / f"workbench-{kind}-{theme}.png"
        image.unlink(missing_ok=True)
        fixture = workspace / "workbench-chrome.qml"
        fixture.write_text(f'''import QtQuick
import QtQuick.Controls
import MiaCode.UI
Rectangle {{
    id: root; width: 800; height: {height}
    FontLoader {{ source: "file:///C:/Windows/Fonts/msyh.ttc" }}
    QtObject {{ id: preferences; property string activeThemeToken: {json.dumps(theme)}; property bool darkTheme: {str(not theme.endswith('light')).lower()}; property bool blurMaterialsEnabled: false; property string uiFontFamily: "Microsoft YaHei UI"; property int fontSize: 13; property font codeFont: Qt.font({{family: "Consolas", pixelSize: 14}}); property int editorBlockSpacing: 0 }}
    Component.onCompleted: Theme.preferences = preferences
    {component}
    Timer {{ interval: 600; running: true; onTriggered: root.grabToImage(function(result) {{ result.saveToFile({json.dumps(image.as_posix())}); Qt.quit() }}) }}
}}
''', encoding="utf-8")
        run = subprocess.run([str(args.qt_host / "bin/qmlscene.exe"), "-translation", str(workspace / "zh_CN.qm"), "-I", str(workspace), str(fixture)], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        if run.returncode or not image.is_file():
            raise RuntimeError(run.stdout + run.stderr)
        records["themes"][theme][f"workbench-{kind}"] = {"image": image.name, "sourceSha256": hashes, "size": [800, height]}
        print(f"Captured {image.name}", flush=True)
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
