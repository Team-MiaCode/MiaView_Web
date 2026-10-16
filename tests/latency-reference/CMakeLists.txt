cmake_minimum_required(VERSION 3.24)
project(MiaViewLatencyReference LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
find_package(Qt6 6.11.1 EXACT REQUIRED COMPONENTS Core)
set(MIACODE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/MiaCode" CACHE PATH "Pinned source checkout")
add_executable(miaview-latency-reference main.cpp
    "${MIACODE_SOURCE_DIR}/src/app/runtime/latency/LatencyAnalysis.cpp"
    "${MIACODE_SOURCE_DIR}/src/audio/bass/OfflineAudioDecoder.cpp"
    "${MIACODE_SOURCE_DIR}/src/audio/bass/PreviewBassDeviceLease.cpp")
target_include_directories(miaview-latency-reference PRIVATE
    "${MIACODE_SOURCE_DIR}/src" "${MIACODE_SOURCE_DIR}/third_party/bass/include")
target_link_libraries(miaview-latency-reference PRIVATE Qt6::Core)
if(WIN32)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(ARM64|arm64|aarch64)$")
        set(bass_arch winarm64)
    else()
        set(bass_arch win64)
    endif()
    target_link_libraries(miaview-latency-reference PRIVATE "${MIACODE_SOURCE_DIR}/third_party/bass/lib/${bass_arch}/bass.lib")
    set(bass_runtime "${MIACODE_SOURCE_DIR}/third_party/bass/bin/${bass_arch}/bass.dll"
        "${MIACODE_SOURCE_DIR}/third_party/bass/bin/${bass_arch}/bassflac.dll")
elseif(APPLE)
    set(bass_directory "${MIACODE_SOURCE_DIR}/third_party/bass/lib/macos/universal")
    target_link_libraries(miaview-latency-reference PRIVATE "${bass_directory}/libbass.dylib")
    set(bass_runtime "${bass_directory}/libbass.dylib" "${bass_directory}/libbassflac.dylib")
else()
    set(bass_directory "${MIACODE_SOURCE_DIR}/third_party/bass/lib/linux/${CMAKE_SYSTEM_PROCESSOR}")
    target_link_libraries(miaview-latency-reference PRIVATE "${bass_directory}/libbass.so")
    set(bass_runtime "${bass_directory}/libbass.so" "${bass_directory}/libbassflac.so")
endif()
add_custom_command(TARGET miaview-latency-reference POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${bass_runtime} "$<TARGET_FILE_DIR:miaview-latency-reference>")
