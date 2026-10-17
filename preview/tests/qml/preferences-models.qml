import QtQuick

Item {
    id: models
    property var shortcutRows: []
    property alias preferencesModel: preferencesModel
    property alias appBackground: appBackground
    property alias shortcuts: shortcuts
    QtObject {
        id: preferencesModel
        property var languageOptions: [{value: "system", label: "跟随系统"}, {value: "en", label: "English"}, {value: "zh", label: "简体中文"}, {value: "ja", label: "日本語"}]
        property string languageToken: "zh"
        property var themeModeOptions: [{value: "system", label: "跟随系统"}, {value: "light", label: "浅色"}, {value: "dark", label: "深色"}]
        property string themeModeToken: "dark"
        property var themePaletteOptions: [{value: "dark", label: "深色"}, {value: "light", label: "浅色"}, {value: "legacy", label: "经典深色"}, {value: "legacy_light", label: "经典浅色"}]
        property string lightThemeToken: "light"
        property string darkThemeToken: "dark"
        property bool previewOnLeft: false
        property bool blurMaterialsEnabled: true
        property int editorFontSize: 14
        property int editorFontSizeMinimum: 8
        property int editorFontSizeMaximum: 28
        property var lineSpacingOptions: [{value: 1, label: "1 倍"}, {value: 1.5, label: "1.5 倍"}, {value: 2, label: "2 倍"}, {value: 3, label: "3 倍"}, {value: 5, label: "5 倍"}]
        property real editorLineSpacing: 1
        property int editorInputHandlingMode: 1
        property bool editorAutoWrap: false
        property bool editorAutoCompletion: true
        property bool editorScrollPastEnd: true
        property bool editorSelectionBeatDisplay: true
        property bool videoDecodePrefersSoftware: false
        property var canvasFrameRateOptions: [{value: 3, label: "显示器刷新率"}, {value: 0, label: "30 FPS"}, {value: 1, label: "60 FPS"}, {value: 2, label: "120 FPS"}]
        property var appFrameRateOptions: canvasFrameRateOptions
        property int canvasFrameRateMode: 1
        property int stageMediaFrameRateMode: 1
        property int timelineFrameRateMode: 1
    }
    QtObject {
        id: appBackground
        property bool enabled: false
        property string imagePath: ""
        property bool imageReadable: false
        property string errorMessage: ""
        property real opacity: 0.5
        property int panelAlpha: 220
        property int blur: 0
        property string sizeMode: "cover"
        property string position: "center"
        function chooseImage() {}
        function clearImage() {}
    }
    QtObject {
        id: shortcuts
        function editableShortcuts() {
            return models.shortcutRows
        }
        function sequenceTextFromKeyEvent(event) { return "" }
        function setShortcutText(id, value) {}
        function resetShortcut(id) {}
        function resetAllShortcuts() {}
    }
}
