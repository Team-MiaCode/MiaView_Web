"""Render original auxiliary QML pages against the versioned UI reference module."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--qt-host", type=Path, required=True)
parser.add_argument("--ref", default="8770413f965084f2e0567ae44c235b8a34377861")
parser.add_argument("--only", default="about,bookmarks,designer-slots,difficulty-header,difficulty-header-narrow,metadata,metadata-narrow,chart-sidebar")
args = parser.parse_args()
source = args.source.resolve()
output = root / ".assets/ui-reference"
workspace = root / ".deps/ui-reference"
records = json.loads((output / "reference.json").read_text(encoding="utf-8"))
if records["sourceCommit"] != args.ref:
    raise RuntimeError("Generate the shared UI reference module for the requested source commit")

def source_bytes(path):
    return subprocess.check_output(["git", "-C", str(source), "show", f"{args.ref}:{path}"])

component_paths = {
    "AboutReference": "src/app/ui/components/AboutDialog.qml",
    "DesignerSlotsDialog": "src/app/ui/editor/DesignerSlotsDialog.qml",
    "BookmarkList": "src/app/ui/editor/BookmarkList.qml",
    "EditorPane": "src/app/ui/editor/EditorPane.qml",
    "ChartFieldSidebar": "src/app/ui/sidebar/ChartFieldSidebar.qml",
    "DifficultyList": "src/app/ui/sidebar/DifficultyList.qml",
}
app_icon = workspace / "icons/app.png"
app_icon.write_bytes(source_bytes("resources/icons/app.png"))
code_font = workspace / "MapleMonoNormalNL-CN-Regular.ttf"
code_font.write_bytes(source_bytes("assets/fonts/MapleMonoNormalNL-CN-Regular.ttf"))
for name, path in component_paths.items():
    data = source_bytes(path)
    if name == "AboutReference":
        data = data.replace(b"qrc:/icons/app.png", app_icon.as_uri().encode("utf-8"))
    if name != "EditorPane":
        (workspace / f"{name}.qml").write_bytes(data)

def qml_block(source, marker):
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 0
    tokens = re.compile(r'''//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[{}]''')
    for token in tokens.finditer(source, opening):
        if token.group() == "{":
            depth += 1
        elif token.group() == "}":
            depth -= 1
            if depth == 0:
                return source[start:token.end()]
    raise ValueError(f"Unclosed QML block: {marker}")

editor_source = source_bytes(component_paths["EditorPane"]).decode("utf-8").replace("\r\n", "\n")
header_field = qml_block(editor_source, "    component DifficultyHeaderField: Item {")
header_item = qml_block(editor_source, "    Item {\n        id: difficultyHeader")
metadata_field = qml_block(editor_source, "    component MetadataField: ColumnLayout {")
metadata_item = qml_block(editor_source, "    Flickable {").replace("    Flickable {", "    Flickable { id: captureItem;", 1)

build_info = json.loads((root / "native/toolchain.json").read_text(encoding="utf-8"))
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
platform = f"WebAssembly / {build_info['wasmArch']} / Qt {build_info['qtVersion']}"
common = """import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Effects
import MiaCode.UI
Rectangle {
    id: root; width: 800; height: 720; color: Theme.colors.background.panel
    FontLoader { source: "file:///C:/Windows/Fonts/segoeui.ttf" }
    FontLoader { source: "file:///C:/Windows/Fonts/seguisb.ttf" }
    FontLoader { source: "file:///C:/Windows/Fonts/msyh.ttc" }
    FontLoader { source: "file:///C:/Windows/Fonts/msyhbd.ttc" }
    FontLoader { source: CODE_FONT_URL }
    QtObject {
        id: preferences
        property string activeThemeToken: THEME
        property bool darkTheme: activeThemeToken !== "light" && activeThemeToken !== "legacy_light"
        property bool blurMaterialsEnabled: false
        property string uiFontFamily: "Microsoft YaHei UI"
        property int fontSize: 13
        property font codeFont: Qt.font({family: "Maple Mono Normal NL CN", pointSize: 14})
        property int editorBlockSpacing: 0
        function aboutInfo() { return {version: VERSION, platform: PLATFORM, buildType: "Release", title: qsTrId("action.about"), platformLabel: qsTrId("about.platform"), buildTypeLabel: qsTrId("about.build_type")} }
    }
    property var documentSession: documentModel
    property var viewState: pageState
    QtObject {
        id: pageState
        property bool difficultyEditorActive: true
        property bool metadataEditorActive: false
        property bool latencyEditorActive: false
        property string activeSidebarView: "chart"
        property string activeEditorKey: "difficulty:5"
        property bool difficultySectionExpanded: true
        function difficultyEditorKey(id) { return "difficulty:" + id }
        function bookmarkGroupExpanded(id) { return true }
        function setBookmarkGroupExpanded(id, expanded) {}
        function openDifficultyEditor(id) {}
        function openMetadataEditor() {}
    }
    QtObject { id: pagesModel; property bool overlayActive: false; function leaveOverlayPage() {} function openLatencyPage() {} }
    QtObject {
        id: documentModel
        property string currentDifficultyLevel: "13+"
        property string currentDifficultyOffset: "0.125"
        property string currentDifficultyDesigner: "MiaCode"
        property string metadataDesigner: "MiaCode"
        property string metadataTitle: "MiaCode Example"
        property string metadataArtist: "Team MiaCode"
        property string metadataFirst: "0.125"
        property string metadataClockCount: "4"
        property string metadataCoverSource: ""
        property bool metadataHasVideo: false
        property string metadataResolvedVideoPath: ""
        property string metadataExtraText: "&custom=value"
        property bool metadataNeedsAttention: false
        property string metadataAttentionText: ""
        property int currentDifficultyId: 5
        property int bookmarkGeneration: 1
        property var difficulties: [{id: 2, label: "BASIC"}, {id: 5, label: "MASTER"}]
        property var availableDifficulties: [{id: 1, label: "EASY"}, {id: 3, label: "ADVANCED"}, {id: 4, label: "EXPERT"}, {id: 6, label: "Re:MASTER"}, {id: 7, label: "UTAGE"}]
        function bookmarksForDifficulty(id) { return id === 5 ? [{line: 2, title: "主歌"}, {line: 8, title: "副歌"}] : [] }
        function navigateToBookmark(id, line) {}
        property bool unifiedDesignerEnabled: false
        property var designerSlots: [{id: 1, name: "EASY", designer: "", hasChart: false}, {id: 2, name: "BASIC", designer: "MiaCode", hasChart: true}, {id: 3, name: "ADVANCED", designer: "", hasChart: false}, {id: 4, name: "EXPERT", designer: "", hasChart: false}, {id: 5, name: "MASTER", designer: "MiaCode", hasChart: true}, {id: 6, name: "Re:MASTER", designer: "", hasChart: false}, {id: 7, name: "UTAGE", designer: "", hasChart: false}]
    }
    QtObject { id: commandModel; function applyDesignerSlots(slots, unified, name) {} }
    Component.onCompleted: Theme.preferences = preferences
""".replace("VERSION", json.dumps(version)).replace("PLATFORM", json.dumps(platform)).replace("CODE_FONT_URL", json.dumps(code_font.as_uri()))
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
exe = args.qt_host / "bin" / ("qmlscene.exe" if os.name == "nt" else "qmlscene")
fixture = workspace / "auxiliary.qml"
for theme in records["themes"]:
    for page in args.only.split(","):
        image = output / f"{page}-{theme}.png"
        image.unlink(missing_ok=True)
        page_common = common
        if page.startswith("difficulty-header"):
            content = "    Item { id: tabs; height: 0 }\n" + header_field + "\n" + header_item + """
    Timer { interval: 600; running: true; onTriggered: root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() }) }
}
"""
            width = 240 if page.endswith("narrow") else 480
            page_common = common.replace("width: 800; height: 720; color: Theme.colors.background.panel", f"width: {width}; height: difficultyHeader.height; color: Theme.colors.background.surface")
            component = "EditorPane"
        elif page.startswith("metadata"):
            content = "    Item { id: tabs; height: 0 }\n    QtObject { id: designerSlotsDialog; function open() {} }\n" + metadata_field + "\n" + metadata_item + """
    Timer { interval: 600; running: true; onTriggered: root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() }) }
}
"""
            width = 360 if page.endswith("narrow") else 800
            page_common = common.replace("width: 800; height: 720", f"width: {width}; height: captureItem.contentHeight")
            page_common = page_common.replace("property bool metadataEditorActive: false", "property bool metadataEditorActive: true")
            component = "EditorPane"
        elif page == "chart-sidebar":
            content = """
    ChartFieldSidebar { id: captureItem; width: 240; height: 480; viewState: pageState; documentSession: documentModel; commands: commandModel; pages: pagesModel }
    Timer { interval: 600; running: true; onTriggered: captureItem.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() }) }
}
"""
            component = "ChartFieldSidebar"
        elif page == "bookmarks":
            content = """
    QtObject { id: editor; function jumpToLine(line) {} }
    BookmarkList { id: captureItem; width: 240; height: 120; editor: editor; bookmarks: [{line: 2, title: "主歌"}, {line: 8, title: "副歌"}] }
    Timer { interval: 600; running: true; onTriggered: captureItem.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() }) }
}
"""
            component = "BookmarkList"
        else:
            component = "AboutReference" if page == "about" else "DesignerSlotsDialog"
            binding = "preferences: preferences" if page == "about" else "documentSession: documentModel; commands: commandModel"
            content = """
    COMPONENT { id: dialog; BINDING }
    Timer { interval: 100; running: true; onTriggered: { dialog.open(); capture.start() } }
    Timer { id: capture; interval: 600; onTriggered: {
        let surface = dialog.contentItem.parent
        let origin = dialog.body.mapToItem(surface, 0, 0)
        console.warn("MIACODE_PAGE_REFERENCE " + JSON.stringify({x: origin.x, y: origin.y, width: dialog.body.width, height: dialog.body.height}))
        surface.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
    } }
}
""".replace("COMPONENT", component).replace("BINDING", binding)
        fixture.write_text((page_common.replace("THEME", json.dumps(theme)) + content).replace("OUTPUT", json.dumps(image.as_posix())), encoding="utf-8")
        result = subprocess.run([str(exe), "-translation", str(workspace / "zh_CN.qm"), "-I", str(workspace), str(fixture)], env=env,
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        if result.returncode or not image.is_file():
            raise RuntimeError(result.stdout + result.stderr)
        record = {"image": image.name, "sourceSha256": hashlib.sha256(source_bytes(component_paths[component])).hexdigest()}
        record["uiFontFamily"] = "Microsoft YaHei UI"
        if component == "EditorPane":
            record["sourceRegions"] = ["MetadataField", "metadata Flickable"] if page.startswith("metadata") else ["DifficultyHeaderField", "difficultyHeader"]
        if page.startswith("metadata"):
            record["codeFont"] = {"family": "Maple Mono Normal NL CN", "pointSize": 14, "sourceSha256": hashlib.sha256(code_font.read_bytes()).hexdigest()}
        trace = result.stdout + "\n" + result.stderr
        geometry = [line.split("MIACODE_PAGE_REFERENCE ", 1)[1] for line in trace.splitlines() if "MIACODE_PAGE_REFERENCE " in line]
        if geometry:
            record["bodyBounds"] = json.loads(geometry[-1])
        if page == "about":
            record["resourceUrls"] = {"qrc:/icons/app.png": "resources/icons/app.png"}
            record["resourceSha256"] = hashlib.sha256(app_icon.read_bytes()).hexdigest()
        records["themes"][theme][page] = record
        print(f"Rendered original {page} {theme}: {image.name}", flush=True)
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
