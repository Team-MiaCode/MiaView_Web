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

configure_file(browser-assets.qrc.in browser-assets.qrc @ONLY)
qt_add_executable(miacode-preview browser-host.cpp
    "${CMAKE_CURRENT_BINARY_DIR}/browser-assets.qrc")
target_link_libraries(miacode-preview PRIVATE miacode_preview_quick Qt6::Svg)

if(EMSCRIPTEN)
    set_target_properties(miacode-preview PROPERTIES
        QT_WASM_EXTRA_EXPORTED_METHODS "ccall,UTF8ToString,HEAPU8"
        QT_WASM_MAXIMUM_MEMORY "2147483648")
    target_link_options(miacode-preview PRIVATE
        "-sEXPORTED_FUNCTIONS=_main,_malloc,_free"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sMAXIMUM_MEMORY=2147483648"
        "-sENVIRONMENT=web"
        "-sMIN_WEBGL_VERSION=2")
endif()
