require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  # Must equal `iosModuleName` in nitro.json - the generated Swift umbrella
  # includes "<PodName>-Swift.h" and says so explicitly.
  s.name         = "BenchProbe"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/dannyhw/react-native-nitro-ui"
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/dannyhw/react-native-nitro-ui.git", :branch => "task/T02-bench" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
    "cpp/**/*.{hpp,cpp}",
  ]

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'

  # The generated `BenchProbeAutolinking.mm` does `#include "HybridBenchProbe.hpp"`,
  # and the pod's own `ios/` directory is not on the include path by default once
  # the pod is built as a static library. Set this BEFORE loading the nitrogen
  # autolinking script - it merges into `pod_target_xcconfig` and would otherwise
  # not know about our headers.
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/ios" "${PODS_TARGET_SRCROOT}/cpp"',
  }

  load 'nitrogen/generated/ios/BenchProbe+autolinking.rb'
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
