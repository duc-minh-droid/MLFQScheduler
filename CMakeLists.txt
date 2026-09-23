cmake_minimum_required(VERSION 3.16)
project(MultiLevelFeedbackQueue CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_executable(mlfq main.cpp CPU.cpp Process.cpp Scheduler.cpp)
if(MSVC)
  target_compile_options(mlfq PRIVATE /W4)
else()
  target_compile_options(mlfq PRIVATE -Wall -Wextra)
endif()
if(MINGW)
  # static runtime: avoids picking up a different libstdc++ DLL from PATH
  target_link_options(mlfq PRIVATE -static)
endif()
