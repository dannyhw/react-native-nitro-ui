// `+load` is the earliest point this library runs at and cannot be overridden in Swift, so the
// trigger lives here and calls the Swift table through its `@_cdecl` entry point.

#import <Foundation/Foundation.h>

extern void NitroUiDeclareDeclaredFallbacks(void);

@interface NitroUiDeclaredFallbacksLoader : NSObject
@end

@implementation NitroUiDeclaredFallbacksLoader

+ (void)load {
  NitroUiDeclareDeclaredFallbacks();
}

@end
