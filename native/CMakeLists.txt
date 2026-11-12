cmake_minimum_required(VERSION 3.24)
project(MiaViewWeb LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

set(MIACODE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../vendor/MiaCode"
    CACHE PATH "MiaCode source checkout (local override for development)")
if(NOT EXISTS "${MIACODE_SOURCE_DIR}/cmake/MiaCodePreviewBuild.cmake")
    message(FATAL_ERROR "Initialize vendor/MiaCode and use a revision with the preview-only build entry")
endif()
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/toolchain.json" toolchain)
string(JSON qt_version GET "${toolchain}" qtVersion)
find_package(Qt6 ${qt_version} EXACT REQUIRED COMPONENTS Core Gui Quick QuickEffects Qml ShaderTools Svg)

set(MIACODE_BUILD_APP OFF CACHE BOOL "MiaView consumes preview libraries only" FORCE)
set(MIACODE_PREVIEW_MULTIMEDIA OFF CACHE BOOL "HTMLVideo supplies Web media" FORCE)
add_subdirectory("${MIACODE_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/miacode")

# The desktop libraries register these resource objects automatically. Web
# mounts their binary equivalents before the first use of each feature.
function(externalize_resource target name)
    set(init_target "${target}_resources_1")
    get_target_property(resource_name "${init_target}" _qt_resource_name)
    if(NOT resource_name STREQUAL name)
        message(FATAL_ERROR "Unexpected Qt resource target: ${init_target}")
    endif()
    get_target_property(sources "${target}" SOURCES)
    list(FILTER sources EXCLUDE REGEX "(^|/)qrc_${name}\\.cpp$")
    set_property(TARGET "${target}" PROPERTY SOURCES "${sources}")
    foreach(property INTERFACE_LINK_LIBRARIES INTERFACE_LINK_OPTIONS INTERFACE_SOURCES)
        get_target_property(items "${target}" "${property}")
        if(items)
            list(FILTER items EXCLUDE REGEX "${init_target}")
            set_property(TARGET "${target}" PROPERTY "${property}" "${items}")
        endif()
    endforeach()
endfunction()

externalize_resource(miacode_chart slide_data)
externalize_resource(miacode_scene fonts)
qt_add_binary_resources(web_slides "${MIACODE_SOURCE_DIR}/resources/slide_data.qrc"
    DESTINATION "${CMAKE_CURRENT_BINARY_DIR}/miacode-slides.rcc" OPTIONS --compress 9 --threshold 0)
file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/web-hud.qrc" CONTENT [=[
<RCC><qresource prefix="/fonts">
    <file alias="xiaolai_mono.ttf">@MIACODE_SOURCE_DIR@/assets/fonts/XiaolaiMono-Regular.subset.ttf</file>
</qresource></RCC>
]=] @ONLY)
qt_add_binary_resources(web_hud "${CMAKE_CURRENT_BINARY_DIR}/web-hud.qrc"
    DESTINATION "${CMAKE_CURRENT_BINARY_DIR}/miacode-hud.rcc" OPTIONS --compress 9 --threshold 0)

# Web uses one bundled face for all HUD areas, including debug text.
set(upstream_hud "${MIACODE_SOURCE_DIR}/src/core/scene/PreviewHudState.cpp")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${upstream_hud}")
file(READ "${upstream_hud}" hud_source)
string(FIND "${hud_source}" "QFont previewHudDefaultFontForArea(" hud_font_start)
string(FIND "${hud_source}" "QFont previewHudTimestampFontForArea(" hud_font_end)
if(hud_font_start LESS 0 OR hud_font_end LESS_EQUAL hud_font_start)
    message(FATAL_ERROR "MiaCode HUD font resolver changed; review the Web default font")
endif()
string(SUBSTRING "${hud_source}" 0 "${hud_font_start}" hud_prefix)
string(SUBSTRING "${hud_source}" "${hud_font_end}" -1 hud_suffix)
set(hud_default_font [=[
QFont previewHudDefaultFontForArea(PreviewHudFontArea, int pointSize, QFont::Weight weight)
{
    static QString family;
    if (family.isEmpty()) {
        const auto path = QStringLiteral(":/fonts/xiaolai_mono.ttf");
        if (QFileInfo::exists(path)) {
            family = previewHudFontFamilyForFile(path);
        }
    }
    QFont font(family.isEmpty() ? QStringLiteral("Xiaolai Mono") : family, pointSize, weight);
    font.setStyleHint(QFont::Monospace);
    font.setFixedPitch(true);
    return font;
}

]=])
# Compile the upstream renderer under a private class name, then expose its
# original interface through the Web lifecycle adapter. No dependency files
# are copied into the repository or changed on disk.
get_target_property(preview_sources miacode_preview_quick SOURCES)
list(FILTER preview_sources INCLUDE REGEX "(^|/)PreviewQuickJudgeFireworkLayer\\.cpp$")
list(LENGTH preview_sources firework_source_count)
if(NOT firework_source_count EQUAL 1)
    message(FATAL_ERROR "MiaCode firework source layout changed; review the Web adapter")
endif()
list(GET preview_sources 0 upstream_firework_source)
get_target_property(preview_source_dir miacode_preview_quick SOURCE_DIR)
get_filename_component(upstream_firework_source "${upstream_firework_source}"
    ABSOLUTE BASE_DIR "${preview_source_dir}")
get_filename_component(upstream_firework_dir "${upstream_firework_source}" DIRECTORY)
set(upstream_firework_header "${upstream_firework_dir}/PreviewQuickJudgeFireworkLayer.h")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${upstream_firework_header}")
file(READ "${upstream_firework_header}" upstream_firework_interface)
string(REPLACE "PreviewQuickJudgeFireworkLayer" "MiaViewUpstreamJudgeFireworkLayer"
    upstream_firework_interface "${upstream_firework_interface}")
file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/upstream-firework-layer.h" CONTENT "${upstream_firework_interface}" @ONLY)
set_property(SOURCE "${upstream_firework_source}" TARGET_DIRECTORY miacode_preview_quick
    APPEND PROPERTY COMPILE_DEFINITIONS
    PreviewQuickJudgeFireworkLayer=MiaViewUpstreamJudgeFireworkLayer)
target_include_directories(miacode_preview_quick PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_sources(miacode_preview_quick PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/firework-layer.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/firework-layer.h")

# Compile the default font override and cache operations with the shared lookup.
set(hud_cache_helpers [=[
void webReleaseHudFont(const QString& path)
{
    auto& cache = hudFontCache();
    const QMutexLocker lock(&cache.mutex);
    const auto entry = cache.fonts.take(QFileInfo(path).absoluteFilePath());
    if (entry.fontId >= 0) QFontDatabase::removeApplicationFont(entry.fontId);
}

int webHudFontCacheEntries()
{
    auto& cache = hudFontCache();
    const QMutexLocker lock(&cache.mutex);
    return static_cast<int>(cache.fonts.size());
}
]=])
file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/web-hud-state.cpp"
    CONTENT "${hud_prefix}${hud_default_font}${hud_suffix}\n${hud_cache_helpers}" @ONLY)
set_property(SOURCE "${upstream_hud}" TARGET_DIRECTORY miacode_scene PROPERTY HEADER_FILE_ONLY ON)
target_sources(miacode_scene PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/web-hud-state.cpp")

add_library(miaview_timeline STATIC
    "${MIACODE_SOURCE_DIR}/src/timeline/TimelineNoteAssets.cpp"
    "${MIACODE_SOURCE_DIR}/src/timeline/TimelineQuickModel.cpp"
    "${MIACODE_SOURCE_DIR}/src/timeline/TimelineQuickModelIndexing.cpp"
    "${MIACODE_SOURCE_DIR}/src/timeline/TimelineQuickModelParser.cpp"
    "${MIACODE_SOURCE_DIR}/src/timeline/TimelineQuickModelSnapshot.cpp"
    "${MIACODE_SOURCE_DIR}/src/timeline/TimelineSceneState.cpp"
    "${MIACODE_SOURCE_DIR}/src/timeline/TimelineSceneStateBuilder.cpp"
    "${MIACODE_SOURCE_DIR}/src/audio/WaveformCache.cpp")
target_link_libraries(miaview_timeline PUBLIC miacode_analysis miacode_base Qt6::Gui)
add_library(miaview_editor STATIC
    "${MIACODE_SOURCE_DIR}/src/editor/SimaiTextEditPolicy.cpp"
    "${MIACODE_SOURCE_DIR}/src/editor/SimaiCompletionCatalog.cpp"
    "${MIACODE_SOURCE_DIR}/src/editor/TouchPadAuthoringEdit.cpp"
    "${MIACODE_SOURCE_DIR}/src/editor/BookmarkCommentSyntax.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/ui/editor/EditorController.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/ui/editor/EditorController.h")
target_link_libraries(miaview_editor PUBLIC miacode_chart Qt6::Core)

configure_file(browser-assets.qrc.in browser-assets.qrc @ONLY)
qt_add_binary_resources(web_skins "${CMAKE_CURRENT_BINARY_DIR}/browser-assets.qrc"
    DESTINATION "${CMAKE_CURRENT_BINARY_DIR}/miacode-skins.rcc")
qt_add_executable(miacode-preview browser-host.cpp runtime-resources.cpp cover-scene.cpp cover-scene.h timeline-bridge.cpp timeline-bridge.h document-bridge.cpp document-bridge.h
    editor-bridge.cpp editor-bridge.h
    touch-bridge.cpp touch-bridge.h
    latency-bridge.cpp latency-bridge.h
    preferences-bridge.cpp preferences-bridge.h
    appearance-bridge.cpp appearance-bridge.h
    export-bridge.cpp export-bridge.h
    "${MIACODE_SOURCE_DIR}/src/export/video_export/VideoExportAudioRenderPlan.cpp"
    "${MIACODE_SOURCE_DIR}/src/export/video_export/FontLibrary.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/ui/preferences/AppBackgroundSettings.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/runtime/latency/LatencyAnalysis.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/runtime/latency/LatencyTestChartBuilder.cpp"
    "${MIACODE_SOURCE_DIR}/src/audio/PreviewAudioSettings.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/services/Id3TagReader.cpp"
    "${MIACODE_SOURCE_DIR}/src/common/InputShortcutGesture.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/services/ChartWorkspace.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/services/ChartWorkspace.h"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverFramePlaybackController.cpp"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverFramePlaybackController.h"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverLayoutModel.cpp"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverCompositionState.cpp"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverCompositeRenderer.cpp"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverLayoutModel.h")
qt_add_resources(miacode-preview "web_outline"
    PREFIX "/assets/background" BASE "${MIACODE_SOURCE_DIR}/assets/background"
    FILES "${MIACODE_SOURCE_DIR}/assets/background/outline_line.png")
# QML in the export pack is outside the executable's import scan.
target_link_libraries(miacode-preview PRIVATE miacode_preview_quick miacode_preview_quickplugin
    miaview_timeline miaview_editor Qt6::Svg Qt6::effectsplugin Qt6::quickwindow)
qt_add_executable(miacode-analysis analysis-host.cpp runtime-resources.cpp)
target_link_libraries(miacode-analysis PRIVATE miacode_analysis Qt6::Core)
set_target_properties(miacode-analysis PROPERTIES
    QT_WASM_EXPORT_NAME "createAnalysisModule"
    QT_WASM_EXTRA_EXPORTED_METHODS "ccall,UTF8ToString,HEAPU8"
    QT_WASM_INITIAL_MEMORY "32MB"
    QT_WASM_MAXIMUM_MEMORY "1073741824")
target_link_options(miacode-analysis PRIVATE
    "-sEXPORT_ES6=1" "-sENVIRONMENT=worker" "-sALLOW_MEMORY_GROWTH=1"
    "-sEXPORTED_FUNCTIONS=_main,_malloc,_free")
file(GLOB_RECURSE intro_assets RELATIVE "${MIACODE_SOURCE_DIR}/src/intro" CONFIGURE_DEPENDS
    "${MIACODE_SOURCE_DIR}/src/intro/qml/*"
    "${MIACODE_SOURCE_DIR}/src/intro/assets/*"
    "${MIACODE_SOURCE_DIR}/src/intro/templates/*")
set(export_qrc "<RCC><qresource prefix=\"/intro\">\n")
foreach(asset IN LISTS intro_assets)
    string(APPEND export_qrc "  <file alias=\"${asset}\">${MIACODE_SOURCE_DIR}/src/intro/${asset}</file>\n")
endforeach()
string(APPEND export_qrc "</qresource><qresource prefix=\"/icons\">\n"
    "  <file alias=\"app-original.png\">${MIACODE_SOURCE_DIR}/resources/icons/app-original.png</file>\n"
    "</qresource></RCC>\n")
file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/web-export.qrc" CONTENT "${export_qrc}" @ONLY)
qt_add_binary_resources(web_export "${CMAKE_CURRENT_BINARY_DIR}/web-export.qrc"
    DESTINATION "${CMAKE_CURRENT_BINARY_DIR}/miacode-export.rcc" OPTIONS --compress 9 --threshold 0)
qt_add_shaders(miacode-preview "web_intro_shaders"
    PREFIX "/" BASE "${MIACODE_SOURCE_DIR}"
    FILES "${MIACODE_SOURCE_DIR}/src/intro/shaders/bg_texture.frag")
qt_import_qml_plugins(miacode-preview)
qt_import_plugins(miacode-preview INCLUDE_BY_TYPE imageformats
    Qt6::QGifPlugin Qt6::QJpegPlugin Qt6::QICOPlugin Qt6::QSvgPlugin Qt6::QWebpPlugin)

if(EMSCRIPTEN)
    set_target_properties(miacode-preview PROPERTIES
        QT_WASM_EXTRA_EXPORTED_METHODS "ccall,UTF8ToString,HEAPU8"
        QT_WASM_INITIAL_MEMORY "64MB"
        QT_WASM_MAXIMUM_MEMORY "2147483648")
    target_link_options(miacode-preview PRIVATE
        "-sEXPORTED_FUNCTIONS=_main,_malloc,_free"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sMAXIMUM_MEMORY=2147483648"
        "-sENVIRONMENT=web"
        "-sMIN_WEBGL_VERSION=2")
endif()
