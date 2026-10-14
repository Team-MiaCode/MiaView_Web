"""Capture the original BottomPanel analysis content in four themes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
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
path = "src/app/ui/timeline/BottomPanel.qml"
source = subprocess.check_output(["git", "-C", str(args.source), "show", f"{commit}:{path}"]).decode("utf-8")

def block(marker, offset=0):
    start = source.index(marker, offset)
    opening = source.index("{", start)
    depth = 0
    tokens = re.compile(r'''//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}]''')
    for token in tokens.finditer(source, opening):
        if token.group() == "{":
            depth += 1
        elif token.group() == "}":
            depth -= 1
            if depth == 0:
                return source[start:token.end()]
    raise ValueError(marker)

issue = block("component AnalysisIssueRow:")
panels = {}
for kind in ["validation", "muri"]:
    position = source.index(f'visible: root.timelineSession.currentTabId === "{kind}"')
    start = source.rfind("    Item {", 0, position)
    panels[kind] = block("Item {", start).replace("anchors.top: tabs.bottom", "anchors.top: parent.top")

rows = {
    "validation": [{"severity": "error", "line": 3, "column": 4, "detail": "音符格式无效"}, {"severity": "warning", "line": 8, "column": 2, "detail": "请检查谱面等级", "code": "missing_difficulty_level"}],
    "muri": [{"severity": "error", "alert": "muri", "title": "Slide", "line": 3, "column": 4, "detail": "滑动轨迹与后续音符重叠"}, {"severity": "warning", "alert": "warning", "title": "Touch", "line": 8, "column": 2, "detail": "触摸区域需要检查"}],
}
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software")
exe = args.qt_host / "bin/qmlscene.exe"
for theme in records["themes"]:
    for kind in panels:
        for state in ["empty", "pending", "results"]:
            image = output / f"analysis-{kind}-{state}-{theme}.png"
            image.unlink(missing_ok=True)
            fixture = workspace / "analysis.qml"
            active_rows = rows[kind] if state == "results" else []
            fixture.write_text(f'''pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import MiaCode.UI
Rectangle {{
    id: root; width: 800; height: 240; color: Theme.colors.background.panel
    FontLoader {{ source: "file:///C:/Windows/Fonts/msyh.ttc" }}
    FontLoader {{ source: "{(workspace / 'MapleMonoNormalNL-CN-Regular.ttf').as_uri()}" }}
    QtObject {{ id: preferences; property string activeThemeToken: {json.dumps(theme)}; property bool darkTheme: {str(not theme.endswith('light')).lower()}; property bool blurMaterialsEnabled: false; property string uiFontFamily: "Microsoft YaHei UI"; property int fontSize: 13; property font codeFont: Qt.font({{family: "Maple Mono Normal NL CN", pointSize: 14}}) }}
    property var timelineSession: ({{currentTabId: {json.dumps(kind)}}})
    property var documentSession: ({{syntaxErrorCount: {1 if active_rows else 0}, syntaxWarningCount: {1 if active_rows else 0}}})
    property var analysisSession: ({{pending: {str(state == 'pending').lower()}, validationRows: {json.dumps(active_rows if kind == 'validation' else [], ensure_ascii=False)}, muriRows: {json.dumps(active_rows if kind == 'muri' else [], ensure_ascii=False)}, activateRow: function(row) {{}}}})
    property real analysisTextLeftInset: Theme.panelPadding + Theme.chromePadding
    property real analysisListLeftInset: Math.max(0, analysisTextLeftInset - Theme.rowPaddingX)
    property real analysisVerticalSpacing: Theme.chromeInsetY
    property real contentTopMargin: 0
    property int muriIssueCount: {1 if active_rows else 0}
    property int muriWarningCount: {1 if active_rows else 0}
    Component.onCompleted: {{ Theme.preferences = preferences; content.active = true }}
    {issue}
    Loader {{ id: content; anchors.fill: parent; active: false; sourceComponent: Component {{ Item {{
        anchors.fill: parent
        {panels[kind]}
    }} }} }}
    Timer {{ interval: 600; running: true; onTriggered: root.grabToImage(function(result) {{ result.saveToFile({json.dumps(image.as_posix())}); Qt.quit() }}) }}
}}
''', encoding="utf-8")
            result = subprocess.run([str(exe), "-translation", str(workspace / "zh_CN.qm"), "-I", str(workspace), str(fixture)], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
            if result.returncode or not image.is_file():
                raise RuntimeError(result.stdout + result.stderr)
            records["themes"][theme][f"analysis-{kind}-{state}"] = {"image": image.name, "sourceSha256": hashlib.sha256(source.encode()).hexdigest(), "sourceRegions": ["AnalysisIssueRow", f"{kind} Item"], "size": [800, 240]}
            print(f"Captured {image.name}", flush=True)
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
