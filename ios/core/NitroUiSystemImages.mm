// UIKit answers for the device: a name it has no symbol for draws nothing.

#import <UIKit/UIKit.h>

#include "NitroUiSystemImages.hpp"

#include <dispatch/dispatch.h>

namespace margelo::nitro::nitroui {

  void NitroUiUnresolvedSystemImages(std::vector<std::string> names,
                                     std::function<void(std::vector<std::string>&&)> onDone) {
    dispatch_async(dispatch_get_main_queue(), ^{
      std::vector<std::string> unresolved;
      for (const std::string& name: names) {
        NSString* symbolName = [NSString stringWithUTF8String:name.c_str()];
        if (symbolName == nil || [UIImage systemImageNamed:symbolName] == nil) {
          unresolved.push_back(name);
        }
      }
      onDone(std::move(unresolved));
    });
  }

} // namespace margelo::nitro::nitroui
