cmake_minimum_required(VERSION 3.24)
project(MiaCodeWebGL LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
find_package(Qt6 6.8.3 EXACT REQUIRED COMPONENTS Core Gui Quick Svg ShaderTools)
include(upstream-sources.cmake)
# QSGSimpleTextureNode accepts pixels and normalizes them internally. The
# imported background layer normalizes a second time, stretching one corner
# pixel over the stage. Correct both calls in a generated browser-only copy;
# keep the recorded upstream files byte-identical.
set(stage_media_source "upstream/src/preview/quick_scene/PreviewQuickStageBackgroundLayer.cpp")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/${stage_media_source}" stage_media_browser_source)
foreach(rect IN ITEMS placement.sourceRect innerPlacement.sourceRect)
  set(original_call "setSourceRect(texture->convertToNormalizedSourceRect(${rect}));")
  string(FIND "${stage_media_browser_source}" "${original_call}" call_index)
  if(call_index EQUAL -1)
    message(FATAL_ERROR "MiaCode stage media source changed; review the browser source-rectangle fix")
  endif()
  string(REPLACE "${original_call}" "setSourceRect(${rect});" stage_media_browser_source "${stage_media_browser_source}")
endforeach()
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/browser-stage-background.cpp" "${stage_media_browser_source}")
list(REMOVE_ITEM MIACODE_SOURCES "${stage_media_source}")
list(APPEND MIACODE_SOURCES "${CMAKE_CURRENT_BINARY_DIR}/browser-stage-background.cpp")
# Both parser roots read exactly the same Slide table. Share that immutable
# table in a generated browser-only copy; imported source bytes stay intact.
set(parser_source "upstream/src/core/chart/parser/SimaiNativeParser.cpp")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/${parser_source}" parser_browser_source)
string(REPLACE "\r\n" "\n" parser_browser_source "${parser_browser_source}")
string(FIND "${parser_browser_source}" "const QJsonObject& slideDataRoot()\n" data_root_start)
string(FIND "${parser_browser_source}" "const QJsonObject& slideRuntimeRoot()\n" runtime_root_start)
string(FIND "${parser_browser_source}" "double nativeSlideTrackLengthForAreas(" runtime_root_end)
if(data_root_start LESS 0 OR runtime_root_start LESS data_root_start OR runtime_root_end LESS runtime_root_start)
  message(FATAL_ERROR "MiaCode Slide parser hooks changed; review the shared table adaptation")
endif()
math(EXPR data_root_length "${runtime_root_start} - ${data_root_start}")
math(EXPR runtime_root_length "${runtime_root_end} - ${runtime_root_start}")
string(SUBSTRING "${parser_browser_source}" ${data_root_start} ${data_root_length} data_root_function)
string(SUBSTRING "${parser_browser_source}" ${runtime_root_start} ${runtime_root_length} runtime_root_function)
string(REPLACE "slideDataRoot()" "slideRuntimeRoot()" comparable_root_function "${data_root_function}")
if(NOT comparable_root_function STREQUAL runtime_root_function)
  message(FATAL_ERROR "MiaCode Slide tables no longer have identical loaders; review before sharing")
endif()
string(REPLACE "${runtime_root_function}" "const QJsonObject& slideRuntimeRoot()\n{\n    return slideDataRoot();\n}\n\n" parser_browser_source "${parser_browser_source}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/browser-simai-parser.cpp" "${parser_browser_source}")
list(REMOVE_ITEM MIACODE_SOURCES "${parser_source}")
list(APPEND MIACODE_SOURCES "${CMAKE_CURRENT_BINARY_DIR}/browser-simai-parser.cpp")
qt_add_executable(miacode-preview
  browser-host.cpp
  shims/preview/runtime/PreviewRuntime.h
  ${MIACODE_SOURCES}
  browser-assets.qrc
  upstream/resources/fonts.qrc
  upstream/resources/slide_data.qrc
  upstream/resources/preview_judge_effects.qrc
)
target_include_directories(miacode-preview BEFORE PRIVATE shims upstream/src upstream/src/core/chart/parser)
target_link_libraries(miacode-preview PRIVATE Qt6::Core Qt6::Gui Qt6::Quick Qt6::Svg)
qt_add_shaders(miacode-preview "preview_sprite_shaders"
  GLSL "300es,330"
  PREFIX "/src/preview/quick_scene/shaders"
  BASE "upstream/src/preview/quick_scene/shaders"
  FILES
    upstream/src/preview/quick_scene/shaders/PreviewSpriteMaterial.vert
    upstream/src/preview/quick_scene/shaders/PreviewSpriteMaterial.frag
    upstream/src/preview/quick_scene/shaders/PreviewStageDimMaterial.vert
    upstream/src/preview/quick_scene/shaders/PreviewStageDimMaterial.frag
    upstream/src/preview/quick_scene/shaders/PreviewFireworkMaterial.vert
    upstream/src/preview/quick_scene/shaders/PreviewFireworkMaterial.frag
)
if(EMSCRIPTEN)
  set_target_properties(miacode-preview PROPERTIES
    QT_WASM_EXTRA_EXPORTED_METHODS "ccall,UTF8ToString"
    QT_WASM_MAXIMUM_MEMORY "2147483648"
  )
  target_link_options(miacode-preview PRIVATE
    "-sEXPORTED_FUNCTIONS=_main,_malloc,_free"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMAXIMUM_MEMORY=2147483648"
    "-sENVIRONMENT=web"
    "-sMIN_WEBGL_VERSION=2"
  )
endif()
