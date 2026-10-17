cmake_minimum_required(VERSION 3.24)
project(MiaCodeUiReference LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

set(MIACODE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/MiaCode" CACHE PATH "Pinned source checkout")
set(MIACODE_REFERENCE_ASSETS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../.deps/ui-reference/intro" CACHE PATH "Versioned QML and assets")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../native/toolchain.json" toolchain)
string(JSON qt_version GET "${toolchain}" qtVersion)
find_package(Qt6 ${qt_version} EXACT REQUIRED COMPONENTS Core Gui GuiPrivate Quick Qml QuickControls2 ShaderTools Svg)
set(MIACODE_BUILD_APP OFF CACHE BOOL "Consume the preview libraries" FORCE)
set(MIACODE_PREVIEW_MULTIMEDIA OFF CACHE BOOL "Static reference scenes" FORCE)
add_subdirectory("${MIACODE_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/miacode")

qt_add_executable(miacode-ui-reference main.cpp preview-reference.cpp
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverLayoutModel.cpp"
    "${MIACODE_SOURCE_DIR}/src/export/cover_export/CoverLayoutModel.h")
set(MIACODE_REFERENCE_EDITOR_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../.deps/editor-reference-source" CACHE PATH "Pinned editor appearance source")
set(MIACODE_REFERENCE_SCINTILLA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../.deps/scintilla-reference" CACHE PATH "Pinned ScintillaQuick reference source")
if(EXISTS "${MIACODE_REFERENCE_EDITOR_SOURCE_DIR}/app/ui/editor/ScintillaDslStyler.cpp")
    set(SCINTILLAQUICK_BUILD_TESTS OFF CACHE BOOL "Reference renderer" FORCE)
    set(SCINTILLAQUICK_BUILD_EXAMPLES OFF CACHE BOOL "Reference renderer" FORCE)
    set(SCINTILLAQUICK_BUILD_BENCHMARKS OFF CACHE BOOL "Reference renderer" FORCE)
    add_subdirectory("${MIACODE_REFERENCE_SCINTILLA_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/scintilla")
    target_sources(miacode-ui-reference PRIVATE editor-reference.cpp
        "${MIACODE_REFERENCE_EDITOR_SOURCE_DIR}/app/ui/editor/ScintillaDslStyler.cpp"
        "${MIACODE_REFERENCE_EDITOR_SOURCE_DIR}/app/ui/editor/ScintillaDocumentAdapter.cpp"
        "${MIACODE_REFERENCE_EDITOR_SOURCE_DIR}/editor/BookmarkCommentSyntax.cpp")
    target_include_directories(miacode-ui-reference PRIVATE "${MIACODE_REFERENCE_EDITOR_SOURCE_DIR}")
    target_link_libraries(miacode-ui-reference PRIVATE ScintillaQuick::ScintillaQuick)
    target_compile_definitions(miacode-ui-reference PRIVATE MIACODE_REFERENCE_EDITOR=1)
endif()
target_link_libraries(miacode-ui-reference PRIVATE miacode_preview_quick miacode_preview_quickplugin Qt6::Svg Qt6::QuickControls2)
set(timeline_sources
    TimelineNoteAssets TimelineQuickModel TimelineQuickModelIndexing
    TimelineQuickModelParser TimelineQuickModelSnapshot TimelineSceneState TimelineSceneStateBuilder)
foreach(name IN LISTS timeline_sources)
    target_sources(miacode-ui-reference PRIVATE "${MIACODE_SOURCE_DIR}/src/timeline/${name}.cpp")
endforeach()
set(timeline_quick_sources
    TimelineQuickGridLayer TimelineQuickGridLinesLayer TimelineQuickHeaderLayer
    TimelineQuickItem TimelineQuickLayerUtils TimelineQuickNotesLayer
    TimelineQuickOverlayLayer TimelineQuickStateBridge TimelineQuickTextureCache TimelineQuickWaveformLayer)
foreach(name IN LISTS timeline_quick_sources)
    target_sources(miacode-ui-reference PRIVATE "${MIACODE_SOURCE_DIR}/src/timeline/quick/${name}.cpp")
endforeach()
target_sources(miacode-ui-reference PRIVATE "${MIACODE_SOURCE_DIR}/src/audio/WaveformCache.cpp")
target_link_libraries(miacode-ui-reference PRIVATE miacode_analysis miacode_base Qt6::GuiPrivate)
if(WIN32)
    target_link_libraries(miacode-ui-reference PRIVATE d3d11 dxgi)
endif()
file(GLOB_RECURSE intro_assets CONFIGURE_DEPENDS "${MIACODE_REFERENCE_ASSETS_DIR}/*")
qt_add_resources(miacode-ui-reference "reference_intro"
    PREFIX "/intro" BASE "${MIACODE_REFERENCE_ASSETS_DIR}" FILES ${intro_assets})
qt_add_resources(miacode-ui-reference "reference_icons"
    PREFIX "/icons" BASE "${MIACODE_REFERENCE_ASSETS_DIR}/../icons"
    FILES "${MIACODE_REFERENCE_ASSETS_DIR}/../icons/app-original.png")
