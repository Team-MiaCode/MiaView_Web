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
find_package(Qt6 ${qt_version} EXACT REQUIRED COMPONENTS Core Gui Quick Qml ShaderTools Svg)

set(MIACODE_BUILD_APP OFF CACHE BOOL "MiaView consumes preview libraries only" FORCE)
set(MIACODE_PREVIEW_MULTIMEDIA OFF CACHE BOOL "HTMLVideo supplies Web media" FORCE)
add_subdirectory("${MIACODE_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/miacode")

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
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/upstream-firework-layer.h" "${upstream_firework_interface}")
set_property(SOURCE "${upstream_firework_source}" TARGET_DIRECTORY miacode_preview_quick
    APPEND PROPERTY COMPILE_DEFINITIONS
    PreviewQuickJudgeFireworkLayer=MiaViewUpstreamJudgeFireworkLayer)
target_include_directories(miacode_preview_quick PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_sources(miacode_preview_quick PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/firework-layer.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/firework-layer.h")

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

configure_file(browser-assets.qrc.in browser-assets.qrc @ONLY)
qt_add_executable(miacode-preview browser-host.cpp cover-scene.cpp cover-scene.h timeline-bridge.cpp timeline-bridge.h document-bridge.cpp document-bridge.h
    "${MIACODE_SOURCE_DIR}/src/app/services/ChartWorkspace.cpp"
    "${MIACODE_SOURCE_DIR}/src/app/services/ChartWorkspace.h"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverLayoutModel.cpp"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverLayoutModel.h"
    "${CMAKE_CURRENT_BINARY_DIR}/browser-assets.qrc")
target_link_libraries(miacode-preview PRIVATE miacode_preview_quick miacode_preview_quickplugin miaview_timeline Qt6::Svg)
file(GLOB_RECURSE intro_assets CONFIGURE_DEPENDS
    "${MIACODE_SOURCE_DIR}/src/intro/qml/*"
    "${MIACODE_SOURCE_DIR}/src/intro/assets/*"
    "${MIACODE_SOURCE_DIR}/src/intro/templates/*")
qt_add_resources(miacode-preview "web_intro"
    PREFIX "/intro" BASE "${MIACODE_SOURCE_DIR}/src/intro" FILES ${intro_assets})
qt_add_resources(miacode-preview "web_cover_icon" PREFIX "/icons"
    BASE "${MIACODE_SOURCE_DIR}/resources/icons" FILES "${MIACODE_SOURCE_DIR}/resources/icons/app-original.png")
qt_import_qml_plugins(miacode-preview)

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
