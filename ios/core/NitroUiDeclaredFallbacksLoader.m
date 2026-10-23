//
//  NitroUiDeclaredFallbacksLoader.m
//  react-native-nitro-ui
//
//  `+load` is the earliest point this library runs at, and `load` cannot be
//  overridden in Swift, so the trigger lives here and calls the Swift table
//  through its `@_cdecl` entry point (`ios/core/NitroUiDeclaredFallbacks.swift`).
//
//  Same pattern as the generated component files, which use `+load` to register
//  their `RCTComponentViewClass` (e.g.
//  `nitrogen/generated/ios/c++/views/HybridNitroUiSwitchComponent.mm:45`).
//  Nothing React-owned is touched here: the call only writes two numbers into
//  the sizing engine, whose shared state initialises on first use.
//

#import <Foundation/Foundation.h>

extern void NitroUiDeclareDeclaredFallbacks(void);

@interface NitroUiDeclaredFallbacksLoader : NSObject
@end

@implementation NitroUiDeclaredFallbacksLoader

+ (void)load {
  NitroUiDeclareDeclaredFallbacks();
}

@end
