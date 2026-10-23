cmake_minimum_required(VERSION 3.13)
project(nitroui)

set(PACKAGE_NAME nitroui)
set(CMAKE_CXX_STANDARD 20)

# Hand-written C++ implementations of our HybridObjects (the headers are also
# picked up by the podspec on iOS). Keep this list in sync with cpp/.
set(NITRO_UI_CPP_SOURCES
        ../cpp/HybridNitroUiCore.cpp
        ../cpp/NitroUiSizingEngine.cpp
)

# Define C++ library and add all sources
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
        src/main/cpp/NitroUiSizingJni.cpp
        ${NITRO_UI_CPP_SOURCES}
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/nitroui+autolinking.cmake)

# Set up local includes
include_directories("src/main/cpp" "../cpp")

find_library(LOG_LIB log)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android # <-- Android core
)
