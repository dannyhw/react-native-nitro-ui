cmake_minimum_required(VERSION 3.13)
project(benchprobe)

set(PACKAGE_NAME benchprobe)
set(CMAKE_CXX_STANDARD 20)

# The iOS implementation lives in ios/ (ObjC++) and is not built here; on
# Android BenchProbe is Kotlin, so the only C++ source is the JNI adapter and
# whatever nitrogen generates.
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/benchprobe+autolinking.cmake)

include_directories("src/main/cpp")

find_library(LOG_LIB log)

target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android # <-- Android core
)
