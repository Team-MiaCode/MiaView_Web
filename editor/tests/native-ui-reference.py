"""Render the original QML controls into a versioned UI reference gallery."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--qt-host", type=Path, required=True)
parser.add_argument("--ref", default="8770413f965084f2e0567ae44c235b8a34377861")
parser.add_argument("--lrelease", type=Path, help="Qt Linguist translation compiler")
args = parser.parse_args()
source = args.source.resolve()
output = root / ".assets/ui-reference"
module = root / ".deps/ui-reference/MiaCode/UI"
module.mkdir(parents=True, exist_ok=True)
output.mkdir(parents=True, exist_ok=True)
def source_bytes(path):
    return subprocess.check_output(["git", "-C", str(source), "show", f"{args.ref}:{path}"])

translation = root / ".deps/ui-reference/zh_CN.ts"
translation.write_bytes(source_bytes("translations/zh_CN.ts"))
translation_qm = translation.with_suffix(".qm")
subprocess.run([str(args.lrelease or args.qt_host / "bin" / ("lrelease.exe" if os.name == "nt" else "lrelease")),
                "-idbased", str(translation), "-qm", str(translation_qm)], check=True, capture_output=True)
(root / ".deps/ui-reference/WelcomePage.qml").write_bytes(source_bytes("src/app/ui/layout/WelcomePage.qml"))
(root / ".deps/ui-reference/LatencyPage.qml").write_bytes(source_bytes("src/app/ui/latency/LatencyPage.qml"))
(root / ".deps/ui-reference/PreferencesDialog.qml").write_bytes(source_bytes("src/app/ui/preferences/PreferencesDialog.qml"))
shutil.copyfile(root / "tests/qml/preferences-models.qml", root / ".deps/ui-reference/PreferencesModels.qml")
for name in ["PreviewAppearancePages", "PreviewSettingsDialog", "AudioSettingsDialog"]:
    (root / ".deps/ui-reference" / f"{name}.qml").write_bytes(source_bytes(f"src/app/ui/preview/{name}.qml"))
catalogue = {message.get("id"): message.findtext("translation") for message in ET.fromstring(translation.read_bytes()).iter("message")}
shortcut_source = json.loads(source_bytes("resources/shortcuts.json"))
shortcut_rows = []
for shortcut_id in shortcut_source["editable"]:
    item = shortcut_source["actions"][shortcut_id]
    shortcut_rows.append({"id": shortcut_id, "labelKey": item.get("label_key", ""), "labelFallback": item.get("label_en", shortcut_id),
                          "shortcutText": item.get("default", ""), "defaultText": item.get("default", ""), "isDefault": True})
def translated(key):
    return catalogue.get(key) or key
def options(prefix, keys):
    return [{"value": index, "label": translated(f"{prefix}.{key}")} for index, key in enumerate(keys)]
preview_cpp = source_bytes("src/app/ui/preview/PreviewSettingsModel.cpp").decode("utf-8")
label_block = preview_cpp.split("QVariantMap PreviewSettingsModel::labels() const", 1)[1].split("QString PreviewSettingsModel::videoGroupLabel", 1)[0]
labels = {key: translated(label) for key, label in re.findall(r'QStringLiteral\("(\w+)"\),\s*text\("([^"]+)"\)', label_block)}
preview_properties = {
    "values": {"brightnessOuter": 50, "brightnessInner": 20, "layoutSquareScale": 95, "scaleMode": 0, "smoothBrightness": True,
               "showTimestamp": True, "touchPadAuthoringShortcut": False, "forceLabeledJudgeLineWhenPaused": False, "showDebugInfo": False,
               "tapFlowSpeed": 7.5, "touchFlowSpeed": 8, "slideEarlierOnTop": True, "centerDisplay": 0, "tapJudgeTextDistance": 1,
               **{f"judgeEffect{kind}": True for kind in ["Slide", "Tap", "Break", "Touch"]}},
    "labels": labels,
    "videoGroupLabel": translated("dialog.render_settings.visual_group"),
    "gameplayGroupLabel": translated("dialog.render_settings.gameplay_group"),
    "skinGroupLabel": translated("dialog.render_settings.skin_group"),
    "scaleModeOptions": options("dialog.render_settings.video.scale", ["fill", "fit", "square_fit", "inner_circle_fit_outer_fill"]),
    "slideStackOrderOptions": [{"value": value, "label": translated(f"dialog.render_settings.gameplay.slide_stack_order.{key}")} for value, key in [(True, "dx_style"), (False, "finale_style")]],
    "centerDisplayOptions": options("dialog.render_settings.gameplay.center_display", ["off", "combo", "achievement_dx_plus", "achievement_dx_minus_100", "achievement_dx_minus_101", "dx_score_plus", "dx_score_minus", "achievement_finale_plus"]),
    "tapJudgeTextDistanceOptions": options("dialog.render_settings.gameplay.tap_judge_text_distance", ["inner", "middle", "outer"]),
    "judgeEffectOptions": [{"value": f"judgeEffect{kind}", "label": translated(f"dialog.render_settings.gameplay.judge_effect.{kind.lower()}")} for kind in ["Slide", "Tap", "Break", "Touch"]],
    "skinOptions": [{"id": skin, "label": skin} for skin in ["SD", "DX"]], "skinIndex": 1,
    "skinJudgeEffectOptions": [translated(f"dialog.skin_settings.chart_effect.{key}") for key in ["standard", "starry"]], "skinJudgeEffectIndex": 0,
    "outlineOptions": [{"id": key, "label": translated(f"dialog.render_settings.gameplay.judge_line.{key}")} for key in ["point", "line", "area", "area_labeled"]], "outlineIndex": 1,
    "hudFontAreaOptions": [{"id": key, "label": translated(f"dialog.video_export.option.hud_font_area.{key}")} for key in ["chart_info", "timestamp", "center_display", "object_stats", "debug"]], "hudFontAreaIndex": 0,
    "fontLibraryOptions": [{"path": "", "label": translated("card_font.default"), "family": "Segoe UI"}], "hudFontPath": "",
    "hudFontSample": "MiaCode · 0123456789 · 谱面预览",
}
audio_channels = [{"key": key, "label": translated(f"dialog.render_settings.audio.{token}"), "percent": 100, "muted": False}
                  for key, token in [("global", "global"), ("track", "track"), ("answer", "answer"), ("tap", "tap"), ("ex", "ex"), ("break", "break"), ("breakSlide", "break_slide"), ("slide", "slide"), ("touch", "touch"), ("firework", "firework"), ("intro", "intro")]]
model_qml = "import QtQuick\nItem {\n property alias previewModel: previewModel\n property alias audioModel: audioModel\n QtObject {\n id: previewModel\n"
model_qml += "\n".join(f"property var {key}: {json.dumps(value, ensure_ascii=False)}" for key, value in preview_properties.items())
model_qml += '\nproperty font hudFont: Qt.font({family: "Segoe UI"})\nfunction refresh() {}\nfunction setValue(key, value) {}\n}\n'
model_qml += "QtObject {\n id: audioModel\n signal changed()\n property bool breakSlideTailCheerMuted: false\n function releaseAudition() {}\n function channels() { return " + json.dumps(audio_channels, ensure_ascii=False) + " }\n}\n}\n"
(root / ".deps/ui-reference/PreviewModels.qml").write_text(model_qml, encoding="utf-8")

paths = subprocess.check_output(["git", "-C", str(source), "ls-tree", "-r", "--name-only", args.ref,
                                 "src/app/ui/components", "src/app/ui/resources/icons"], text=True).splitlines()
names = []
for path in paths:
    original = Path(path)
    if path.startswith("src/app/ui/components/") and original.suffix == ".qml":
        (module / original.name).write_bytes(source_bytes(path))
        names.append(original.stem)
    elif path.startswith("src/app/ui/resources/icons/"):
        destination = module / "icons" / original.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source_bytes(path))
        preview_icon = root / ".deps/ui-reference/icons" / original.name
        preview_icon.parent.mkdir(parents=True, exist_ok=True)
        preview_icon.write_bytes(source_bytes(path))
theme_bytes = source_bytes("src/app/ui/theme/Theme.qml")
(module / "Theme.qml").write_bytes(theme_bytes)
(module / "qmldir").write_text("module MiaCode.UI\nsingleton Theme 1.0 Theme.qml\n" +
                             "\n".join(f"{name} 1.0 {name}.qml" for name in names) + "\n", encoding="utf-8")
records = {"sourceCommit": args.ref, "themeSha256": hashlib.sha256(theme_bytes).hexdigest(),
           "uiFontFamily": "Microsoft YaHei UI", "uiFontSource": "src/app/main.cpp",
           "uiFontSourceSha256": hashlib.sha256(source_bytes("src/app/main.cpp")).hexdigest(), "themes": {}}
previous = json.loads((output / "reference.json").read_text(encoding="utf-8")) if (output / "reference.json").is_file() else {}
if previous.get("sourceCommit") == args.ref and previous.get("uiFontFamily") == records["uiFontFamily"]:
    records["themes"] = previous["themes"]
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software",
           QT_FORCE_STDERR_LOGGING="1", QT_LOGGING_TO_CONSOLE="1")
exe = args.qt_host / "bin" / ("qmlscene.exe" if os.name == "nt" else "qmlscene")
for theme in ["dark", "light", "legacy", "legacy_light"]:
    image = output / f"{theme}.png"
    image.unlink(missing_ok=True)
    fixture = root / ".deps/ui-reference/gallery.qml"
    fixture.write_text("""import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import MiaCode.UI
Rectangle {
    id: root
    width: 800; height: 420
    color: Theme.colors.background.surface
    FontLoader { source: "file:///C:/Windows/Fonts/segoeui.ttf" }
    FontLoader { source: "file:///C:/Windows/Fonts/seguisb.ttf" }
    FontLoader { source: "file:///C:/Windows/Fonts/msyh.ttc" }
    FontLoader { source: "file:///C:/Windows/Fonts/msyhbd.ttc" }
    QtObject {
        id: preferences
        property string activeThemeToken: THEME
        property bool darkTheme: activeThemeToken !== "light" && activeThemeToken !== "legacy_light"
        property bool blurMaterialsEnabled: false
        property string uiFontFamily: "Microsoft YaHei UI"
        property int fontSize: 13
        property font codeFont: Qt.font({family: "Consolas", pixelSize: 14})
        property int editorBlockSpacing: 0
    }
    Component.onCompleted: Theme.preferences = preferences
    Text { x: 24; y: 22; text: "MiaCode · 公共控件"; color: Theme.colors.text.active; font.family: Theme.uiFont; font.pixelSize: 15; font.weight: Font.DemiBold }
    Text { x: 24; y: 70; text: "谱面标题"; color: Theme.colors.text.primary; font.family: Theme.uiFont; font.pixelSize: 13 }
    AppTextField { id: textField; objectName: "textField"; x: 24; y: 94; width: 352; text: "MiaCode Example" }
    Text { x: 424; y: 70; text: "难度"; color: Theme.colors.text.primary; font.family: Theme.uiFont; font.pixelSize: 13 }
    AppComboBox { id: combo; objectName: "combo"; x: 424; y: 94; width: 352; model: ["MASTER", "EXPERT"] }
    AppButton { id: regularButton; objectName: "regularButton"; x: 24; y: 156; text: "打开谱面" }
    AppButton { id: primaryButton; objectName: "primaryButton"; x: 136; y: 156; text: "导出视频"; emphasized: true }
    AppButton { id: disabledButton; objectName: "disabledButton"; x: 248; y: 156; text: "取消任务"; enabled: false }
    AppCheckBox { id: checkedBox; objectName: "checkedBox"; x: 24; y: 218; width: 352; text: "自动保存"; checked: true }
    AppCheckBox { id: uncheckedBox; objectName: "uncheckedBox"; x: 424; y: 218; width: 352; text: "自由画布"; checked: false }
    IconButton { id: playButton; objectName: "playButton"; x: 24; y: 280; iconSource: Qt.resolvedUrl("MiaCode/UI/icons/play.svg"); tooltip: "播放" }
    IconButton { id: settingsButton; objectName: "settingsButton"; x: 74; y: 280; iconSource: Qt.resolvedUrl("MiaCode/UI/icons/settings.svg"); tooltip: "设置" }
    Rectangle { x: 24; y: 342; width: 752; height: 1; color: Theme.colors.border.normal }
    Text { x: 24; y: 364; text: "Simai · 语法与无理分析 · 13px"; color: Theme.colors.text.secondary; font.family: Theme.uiFont; font.pixelSize: 12 }
    Timer {
        interval: 600; running: true
        onTriggered: {
            let items = [textField, combo, regularButton, primaryButton, disabledButton, checkedBox, uncheckedBox, playButton, settingsButton]
            let values = items.map(function(item) { return {name: item.objectName, x: item.x, y: item.y, width: item.width, height: item.height, fontSize: item.font.pixelSize, fontFamily: item.font.family} })
            console.warn("MIACODE_REFERENCE " + JSON.stringify({controls: values, colors: {surface: Theme.colors.background.surface.toString(), text: Theme.colors.text.active.toString(), accent: Theme.colors.accent.primary.toString()}}))
            root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
        }
    }
}
""".replace("THEME", json.dumps(theme)).replace("OUTPUT", json.dumps(image.as_posix())), encoding="utf-8")
    result = subprocess.run([str(exe), "-I", str(root / ".deps/ui-reference"), str(fixture)],
                            env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    trace = result.stdout + "\n" + result.stderr
    if result.returncode or not image.is_file():
        raise RuntimeError(trace)
    lines = [line for line in trace.splitlines() if "MIACODE_REFERENCE " in line]
    if not lines:
        raise RuntimeError("Reference metrics were not emitted: " + trace)
    line = lines[-1]
    records["themes"].setdefault(theme, {}).update(json.loads(line.split("MIACODE_REFERENCE ", 1)[1]))
    print(f"Rendered original QML {theme}: {image.name}", flush=True)

    # The page uses its original QML and translated strings with an empty recent-file model.
    welcome_image = output / f"welcome-{theme}.png"
    welcome_image.unlink(missing_ok=True)
    common = fixture.read_text(encoding="utf-8").split("    Text {", 1)[0]
    fixture.write_text(common + """
    QtObject { id: session; function recentDocuments() { return [] } }
    WelcomePage { id: welcome; anchors.fill: parent; documentSession: session }
    Timer {
        interval: 600; running: true
        onTriggered: {
            root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
        }
    }
}
""".replace("OUTPUT", json.dumps(welcome_image.as_posix())), encoding="utf-8")
    result = subprocess.run([str(exe), "-translation", str(translation_qm), "-I", str(root / ".deps/ui-reference"), str(fixture)],
                            env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    if result.returncode or not welcome_image.is_file():
        raise RuntimeError(result.stdout + result.stderr)
    records["themes"][theme]["welcome"] = {"image": welcome_image.name,
        "sourceSha256": hashlib.sha256(source_bytes("src/app/ui/layout/WelcomePage.qml")).hexdigest(),
        "translationSha256": hashlib.sha256(translation.read_bytes()).hexdigest()}
    print(f"Rendered original welcome page {theme}: {welcome_image.name}", flush=True)

    latency_image = output / f"latency-{theme}.png"
    latency_image.unlink(missing_ok=True)
    fixture.write_text(common + """
    QtObject {
        id: latency
        property real bpm: 120
        property int clockCount: 4
        property real offsetSeconds: 0
        property bool trackAvailable: false
        property string bpmDetectResult: ""
        property string offsetDetectResult: ""
        property int subdivision: 4
        property real sfxVolumePercent: 100
        property bool auditionRunning: false
        function toggleAudition() {}
        function detectBpm() {}
        function detectOffset() {}
    }
    QtObject { id: pages }
    LatencyPage { anchors.fill: parent; latency: latency; pages: pages }
    Timer {
        interval: 600; running: true
        onTriggered: {
            root.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
        }
    }
}
""".replace("OUTPUT", json.dumps(latency_image.as_posix())), encoding="utf-8")
    result = subprocess.run([str(exe), "-translation", str(translation_qm), "-I", str(root / ".deps/ui-reference"), str(fixture)],
                            env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    if result.returncode or not latency_image.is_file():
        raise RuntimeError(result.stdout + result.stderr)
    records["themes"][theme]["latency"] = {"image": latency_image.name,
        "sourceSha256": hashlib.sha256(source_bytes("src/app/ui/latency/LatencyPage.qml")).hexdigest()}
    print(f"Rendered original latency page {theme}: {latency_image.name}", flush=True)

    records["themes"][theme]["preferences"] = {}
    for tab_index, tab in enumerate(["interface", "background", "editor", "performance", "shortcuts"]):
        preference_image = output / f"preferences-{tab}-{theme}.png"
        preference_image.unlink(missing_ok=True)
        fixture.write_text(common.replace("height: 420", "height: 720") + """
    PreferencesModels { id: models; shortcutRows: SHORTCUT_ROWS }
    PreferencesDialog {
        id: preferencesDialog
        preferencesModel: models.preferencesModel
        appBackground: models.appBackground
        shortcuts: models.shortcuts
        preferences: preferences
    }
    function findTabBar(item) {
        if (item.tabs !== undefined && item.selectTab !== undefined) return item
        for (let child of item.children || []) {
            let result = findTabBar(child)
            if (result) return result
        }
        return null
    }
    Timer {
        interval: 100; running: true
        onTriggered: {
            preferencesDialog.open()
            findTabBar(preferencesDialog.body).selectTab(TAB)
            capture.start()
        }
    }
    Timer {
        id: capture; interval: 600
        onTriggered: {
            let surface = preferencesDialog.contentItem.parent
            let origin = preferencesDialog.body.mapToItem(surface, 0, 0)
            console.warn("MIACODE_PREFERENCES_REFERENCE " + JSON.stringify({x: origin.x, y: origin.y, width: preferencesDialog.body.width, height: preferencesDialog.body.height}))
            surface.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
        }
    }
}
""".replace("TAB", str(tab_index)).replace("SHORTCUT_ROWS", json.dumps(shortcut_rows, ensure_ascii=False)).replace("OUTPUT", json.dumps(preference_image.as_posix())), encoding="utf-8")
        result = subprocess.run([str(exe), "-translation", str(translation_qm), "-I", str(root / ".deps/ui-reference"), str(fixture)],
                                env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        if result.returncode or not preference_image.is_file():
            raise RuntimeError(result.stdout + result.stderr)
        records["themes"][theme]["preferences"][tab] = {"image": preference_image.name,
            "sourceSha256": hashlib.sha256(source_bytes("src/app/ui/preferences/PreferencesDialog.qml")).hexdigest()}
        trace = result.stdout + "\n" + result.stderr
        geometry = [line.split("MIACODE_PREFERENCES_REFERENCE ", 1)[1] for line in trace.splitlines() if "MIACODE_PREFERENCES_REFERENCE " in line]
        records["themes"][theme]["preferences"][tab]["bodyBounds"] = json.loads(geometry[-1])
        print(f"Rendered original preferences {tab} {theme}: {preference_image.name}", flush=True)
    records["themes"][theme]["preview-settings"] = {}
    for dialog, sections in [("PreviewSettingsDialog", ["video", "gameplay", "skin"]), ("AudioSettingsDialog", ["audio"])]:
        for tab_index, tab in enumerate(sections):
            settings_image = output / f"{('audio-settings' if tab == 'audio' else 'preview-settings-' + tab)}-{theme}.png"
            settings_image.unlink(missing_ok=True)
            property_binding = "audioSettings: models.audioModel" if tab == "audio" else "previewSettings: models.previewModel"
            tab_selection = "" if tab == "audio" else f"findTabBar(settingsDialog.body).selectTab({tab_index})"
            fixture.write_text(common.replace("height: 420", "height: 900") + """
    PreviewModels { id: models }
    DIALOG { id: settingsDialog; BINDING }
    function findTabBar(item) {
        if (item.tabs !== undefined && item.selectTab !== undefined) return item
        for (let child of item.children || []) { let result = findTabBar(child); if (result) return result }
        return null
    }
    Timer { interval: 100; running: true; onTriggered: { settingsDialog.open(); SELECT; capture.start() } }
    Timer { id: capture; interval: 600; onTriggered: {
        let surface = settingsDialog.contentItem.parent
        let origin = settingsDialog.body.mapToItem(surface, 0, 0)
        console.warn("MIACODE_SETTINGS_REFERENCE " + JSON.stringify({x: origin.x, y: origin.y, width: settingsDialog.body.width, height: settingsDialog.body.height}))
        surface.grabToImage(function(result) { result.saveToFile(OUTPUT); Qt.quit() })
    } }
}
""".replace("DIALOG", dialog).replace("BINDING", property_binding).replace("SELECT", tab_selection).replace("OUTPUT", json.dumps(settings_image.as_posix())), encoding="utf-8")
            result = subprocess.run([str(exe), "-translation", str(translation_qm), "-I", str(root / ".deps/ui-reference"), str(fixture)], env=env,
                                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
            if result.returncode or not settings_image.is_file():
                raise RuntimeError(result.stdout + result.stderr)
            record = {"image": settings_image.name, "sourceSha256": hashlib.sha256(source_bytes(f"src/app/ui/preview/{dialog}.qml")).hexdigest()}
            trace = result.stdout + "\n" + result.stderr
            geometry = [line.split("MIACODE_SETTINGS_REFERENCE ", 1)[1] for line in trace.splitlines() if "MIACODE_SETTINGS_REFERENCE " in line]
            record["bodyBounds"] = json.loads(geometry[-1])
            if tab == "audio":
                records["themes"][theme]["audio-settings"] = record
            else:
                record["appearanceSourceSha256"] = hashlib.sha256(source_bytes("src/app/ui/preview/PreviewAppearancePages.qml")).hexdigest()
                records["themes"][theme]["preview-settings"][tab] = record
            print(f"Rendered original {dialog} {tab} {theme}: {settings_image.name}", flush=True)
(output / "reference.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
