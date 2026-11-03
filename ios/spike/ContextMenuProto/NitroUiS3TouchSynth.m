//
//  NitroUiS3TouchSynth.m
//  react-native-nitro-ui
//
//  S3 spike only (Q6 Appendix G, question 8): HarnessUI's private `UITouch` path
//  (`@react-native-harness/ui` 1.6.0, `ios/HarnessUI.mm` `executeTapAtPoint:`),
//  copied step for step, with the press held for `ms` instead of a tap's 50 ms.
//  Reached from Swift by name (`NSClassFromString`), so no header is published.
//

#import <UIKit/UIKit.h>

@interface UITouch (NitroUiS3Synthesis)
- (void)setPhase:(UITouchPhase)phase;
- (void)setTapCount:(NSUInteger)tapCount;
- (void)setIsTap:(BOOL)isTap;
- (void)setTimestamp:(NSTimeInterval)timestamp;
- (void)setWindow:(UIWindow *)window;
- (void)setView:(UIView *)view;
- (void)_setLocationInWindow:(CGPoint)location resetPrevious:(BOOL)reset;
- (void)_setIsFirstTouchForView:(BOOL)first;
- (void)_setTouchIdentifier:(unsigned int)identifier;
@end

@interface UIEvent (NitroUiS3Synthesis)
- (void)_addTouch:(UITouch *)touch forDelayedDelivery:(BOOL)delayed;
- (void)_clearTouches;
- (void)_setTimestamp:(NSTimeInterval)timestamp;
- (void)_setHIDEvent:(void *)event;
@end

@interface UIApplication (NitroUiS3Synthesis)
- (UIEvent *)_touchesEvent;
@end

@interface NitroUiS3TouchSynth : NSObject
@end

@implementation NitroUiS3TouchSynth

static unsigned int nitroUiS3TouchId = 9000;

+ (void)send:(UITouch *)touch phase:(UITouchPhase)phase point:(CGPoint)point
{
  NSTimeInterval timestamp = [[NSProcessInfo processInfo] systemUptime];
  UIEvent *event = [[UIApplication sharedApplication] _touchesEvent];
  [touch setPhase:phase];
  [touch setTimestamp:timestamp];
  [touch _setLocationInWindow:point resetPrevious:(phase == UITouchPhaseBegan)];
  [event _clearTouches];
  [event _addTouch:touch forDelayedDelivery:NO];
  [event _setTimestamp:timestamp];
  [[UIApplication sharedApplication] sendEvent:event];
}

+ (void)holdAt:(NSValue *)value ms:(NSNumber *)ms
{
  CGPoint point = value.CGPointValue;
  UIWindow *window = nil;
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
      continue;
    }
    for (UIWindow *candidate in ((UIWindowScene *)scene).windows) {
      if (candidate.isKeyWindow) {
        window = candidate;
      }
    }
  }
  if (window == nil) {
    return;
  }
  UIView *target = [window hitTest:point withEvent:nil];
  if (target == nil) {
    return;
  }
  UIEvent *event = [[UIApplication sharedApplication] _touchesEvent];
  [event _clearTouches];
  if ([event respondsToSelector:@selector(_setHIDEvent:)]) {
    [event _setHIDEvent:NULL];
  }
  UITouch *touch = [[UITouch alloc] init];
  nitroUiS3TouchId += 1;
  if ([touch respondsToSelector:@selector(_setTouchIdentifier:)]) {
    [touch _setTouchIdentifier:nitroUiS3TouchId];
  }
  [touch setWindow:window];
  [touch setView:target];
  [touch setTapCount:1];
  if ([touch respondsToSelector:@selector(_setIsFirstTouchForView:)]) {
    [touch _setIsFirstTouchForView:YES];
  }
  if ([touch respondsToSelector:@selector(setIsTap:)]) {
    [touch setIsTap:NO];
  }
  [self send:touch phase:UITouchPhaseBegan point:point];
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ms.doubleValue * NSEC_PER_MSEC)),
      dispatch_get_main_queue(), ^{
        [self send:touch phase:UITouchPhaseEnded point:point];
        [[[UIApplication sharedApplication] _touchesEvent] _clearTouches];
      });
}

@end
