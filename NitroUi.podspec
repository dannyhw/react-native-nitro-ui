require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroUi"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/dannyhw/react-native-nitro-ui.git", :tag => "v#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
    "cpp/**/*.{hpp,cpp}",
  ]

  # Only the header-only core utilities are public: Swift reaches them through
  # C++ interop (`margelo.nitro.nitroui.NitroUiPerf`), which needs the header to
  # be in the module map. Same pattern as the generated spec headers, and enough
  # to keep our own C++ implementations (`cpp/*.hpp`) internal.
  s.public_header_files = ["cpp/core/**/*.hpp"]

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'

  load 'nitrogen/generated/ios/NitroUi+autolinking.rb'
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
