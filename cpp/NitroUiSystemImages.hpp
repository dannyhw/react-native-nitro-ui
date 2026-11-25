// The platform's own answer to "can this device draw this SF Symbol name".
// SF Symbol availability belongs to the OS version, so only the running device knows.

#pragma once

#include <functional>
#include <string>
#include <vector>

#if defined(__APPLE__)

namespace margelo::nitro::nitroui {

  /**
   * Asks UIKit which of `names` resolves to no symbol on this device, and calls
   * `onDone` once with those names. UIKit looks a symbol up on the main thread,
   * so this never runs on the caller's thread and `onDone` runs on the main
   * queue, never on the caller's or on a JS thread. `onDone` always runs - a
   * name that cannot even be named to UIKit counts as unresolved, never as a
   * lost answer.
   */
  void NitroUiUnresolvedSystemImages(std::vector<std::string> names,
                                     std::function<void(std::vector<std::string>&&)> onDone);

} // namespace margelo::nitro::nitroui

#endif
