//
//  HybridBenchProbe.mm
//  nitro-bench-probe
//

#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <os/log.h>
#import <os/signpost.h>

#import <mach/mach.h>
#import <objc/runtime.h>
#import <pthread.h>
#import <time.h>

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unistd.h>

#include "HybridBenchProbe.hpp"

// Objective-C declarations cannot live inside a C++ namespace, so the
// CADisplayLink target that resolves `nextFrameNs()` sits at global scope.

/// Invokes a stored block, because a CADisplayLink needs an ObjC target.
@interface BenchProbeFrameTarget : NSObject
@property (nonatomic, copy, nullable) void (^handler)(CADisplayLink *link);
- (void)fire:(CADisplayLink *)link;
@end

@implementation BenchProbeFrameTarget
- (void)fire:(CADisplayLink *)link {
  if (self.handler != nil) {
    self.handler(link);
  }
}
@end


namespace margelo::nitro::benchprobe {

  // ---------------------------------------------------------------- clock ---

  static inline int64_t BenchProbeRawNs(void) {
    // CLOCK_UPTIME_RAW is the base of CACurrentMediaTime(), so a
    // CADisplayLink.targetTimestamp (seconds) lands on this same scale.
    return static_cast<int64_t>(clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
  }

  /// Captured at image load; every timestamp we report is relative to this.
  static const int64_t kBenchOriginNs = BenchProbeRawNs();

  static inline double BenchProbeNowNs(void) {
    return static_cast<double>(BenchProbeRawNs() - kBenchOriginNs);
  }

  /// `CACurrentMediaTime()`-based seconds -> our ns scale.
  static inline double BenchProbeNsFromMediaTime(NSTimeInterval seconds) {
    return static_cast<double>(static_cast<int64_t>(seconds * 1e9) - kBenchOriginNs);
  }

  // -------------------------------------------------------- mount capture ---

  static std::atomic<int64_t> gLastMountNs{-1};
  static std::atomic<bool> gArmed{false};
  static IMP gOriginalDidMountIMP = nullptr;
  static std::atomic<bool> gMountHookFailed{false};

  /// Trampoline for -[RCTSurfacePresenter mountingManager:didMountComponentsWithRootTag:].
  static void BenchProbeDidMount(id self, SEL _cmd, id mountingManager, NSInteger rootTag) {
    if (gArmed.exchange(false)) {
      gLastMountNs.store(static_cast<int64_t>(BenchProbeRawNs() - kBenchOriginNs));
    }
    if (gOriginalDidMountIMP != nullptr) {
      typedef void (*BenchProbeDidMountIMP)(id, SEL, id, NSInteger);
      reinterpret_cast<BenchProbeDidMountIMP>(gOriginalDidMountIMP)(self, _cmd, mountingManager, rootTag);
    }
  }

  /**
   * Install the mount hook.
   *
   * docs/research/setup-decisions.md SS6 asks for `RCTSurfacePresenterObserver`'s
   * `didMountComponentsWithRootTag:`. That protocol is reached through
   * `-[id<RCTSurfacePresenterStub> addObserver:]`, and the stub is stored as an
   * associated object on the `RCTBridgeProxy` instance - which RN 0.88 does not
   * hand out anywhere (`+[RCTBridge currentBridge]` returns nil in bridgeless).
   * So we hook the one method that fans the notification out to those observers
   * instead: it is the same signal, one level down.
   *
   * If the class or selector ever disappears, we log once and leave
   * `lastMountNs` at -1 so the runner reports "mounted: n/a" instead of
   * producing a wrong number or crashing.
   */
  static void BenchProbeInstallMountHookOnce(void) {
    static std::once_flag once;
    std::call_once(once, []() {
      Class presenter = objc_getClass("RCTSurfacePresenter");
      if (presenter == nil) {
        gMountHookFailed.store(true);
        NSLog(@"NITRO_BENCH mount hook unavailable: class RCTSurfacePresenter not found");
        return;
      }
      SEL selector = sel_registerName("mountingManager:didMountComponentsWithRootTag:");
      Method method = class_getInstanceMethod(presenter, selector);
      if (method == NULL) {
        gMountHookFailed.store(true);
        NSLog(@"NITRO_BENCH mount hook unavailable: -[RCTSurfacePresenter %@] not found",
              NSStringFromSelector(selector));
        return;
      }
      gOriginalDidMountIMP = method_getImplementation(method);
      method_setImplementation(method, reinterpret_cast<IMP>(BenchProbeDidMount));
    });
  }

  // ----------------------------------------------------------- frame waits ---

    // ------------------------------------------------------------- CPU time ---

  /// Mach port of the process' main thread, looked up once.
  static mach_port_t BenchProbeMainThreadPort(void) {
    static mach_port_t cachedPort = MACH_PORT_NULL;
    static std::once_flag once;
    std::call_once(once, []() {
      thread_act_array_t threads = nullptr;
      mach_msg_type_number_t threadCount = 0;
      if (task_threads(mach_task_self(), &threads, &threadCount) != KERN_SUCCESS) {
        return;
      }
      char name[64] = { 0 };
      for (mach_msg_type_number_t index = 0; index < threadCount; index++) {
        pthread_t thread = pthread_from_mach_thread_np(threads[index]);
        if (thread == nullptr) {
          continue;
        }
        name[0] = '\0';
        if (pthread_getname_np(thread, name, sizeof(name)) == 0 &&
            std::string(name) == "com.apple.main-thread") {
          cachedPort = threads[index];
          break;
        }
      }
      if (cachedPort == MACH_PORT_NULL && threadCount > 0) {
        // The main thread is created first; fall back to that assumption.
        cachedPort = threads[0];
      }
      vm_deallocate(mach_task_self(), reinterpret_cast<vm_address_t>(threads),
                    sizeof(thread_t) * threadCount);
    });
    return cachedPort;
  }

  static double BenchProbeCpuNsForThread(mach_port_t threadPort) {
    if (threadPort == MACH_PORT_NULL) {
      return -1.0;
    }
    thread_basic_info_data_t info;
    mach_msg_type_number_t count = THREAD_BASIC_INFO_COUNT;
    kern_return_t result = thread_info(threadPort, THREAD_BASIC_INFO,
                                       reinterpret_cast<thread_info_t>(&info), &count);
    if (result != KERN_SUCCESS) {
      return -1.0;
    }
    // struct time_value is { seconds, microseconds } - not nanoseconds.
    const double userNs = static_cast<double>(info.user_time.seconds) * 1e9 +
                          static_cast<double>(info.user_time.microseconds) * 1e3;
    const double systemNs = static_cast<double>(info.system_time.seconds) * 1e9 +
                            static_cast<double>(info.system_time.microseconds) * 1e3;
    return userNs + systemNs;
  }

  // -------------------------------------------------------------- memory ---

  static double BenchProbePhysFootprintBytes(void) {
    task_vm_info_data_t info;
    mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    kern_return_t result = task_info(mach_task_self(), TASK_VM_INFO,
                                     reinterpret_cast<task_info_t>(&info), &count);
    if (result != KERN_SUCCESS) {
      return -1.0;
    }
    return static_cast<double>(info.phys_footprint);
  }

  // ------------------------------------------------------------- signposts ---

  static os_log_t BenchProbeSignpostLog(void) {
    static os_log_t log = os_log_create("nitro-ui.bench", "pointsOfInterest");
    return log;
  }

  static inline os_signpost_id_t BenchProbeSignpostId(double id) {
    // Signpost identifiers only need to be unique per log, so the bench id is
    // used as the (opaque) pointer value.
    return os_signpost_id_make_with_pointer(
        BenchProbeSignpostLog(),
        reinterpret_cast<const void *>(static_cast<uintptr_t>(id)));
  }

  /// The `-benchPlan <value>` pair the runner launched us with, or "".
  static NSString *BenchProbeLaunchPlan(void) {
    NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
    for (NSUInteger index = 0; index + 1 < arguments.count; index++) {
      if ([arguments[index] isEqualToString:@"-benchPlan"]) {
        return arguments[index + 1];
      }
    }
    return @"";
  }

  // ------------------------------------------------------- HybridObject API ---

  double HybridBenchProbe::now() {
    return BenchProbeNowNs();
  }

  void HybridBenchProbe::armMountObserver() {
    BenchProbeInstallMountHookOnce();
    gLastMountNs.store(-1);
    gArmed.store(true);
  }

  double HybridBenchProbe::getLastMountNs() {
    return static_cast<double>(gLastMountNs.load());
  }

  std::shared_ptr<Promise<double>> HybridBenchProbe::nextFrameNs() {
    auto promise = Promise<double>::create();
    /**
     * Shared between the display-link callback and the safety timer. It has to
     * be a shared_ptr rather than a pointer freed by whoever wins: the timer is
     * still armed when the frame arrives, and dereferencing a freed context
     * there resolves a freed Promise (observed as a mutex abort on main).
     */
    struct FrameContext {
      std::shared_ptr<Promise<double>> promise;
      std::atomic<bool> settled{false};
    };
    auto context = std::make_shared<FrameContext>();
    context->promise = promise;

    dispatch_async(dispatch_get_main_queue(), ^{
      auto settle = [context](double nanoseconds) {
        if (context->settled.exchange(true)) {
          return;
        }
        context->promise->resolve(nanoseconds);
      };

      BenchProbeFrameTarget* target = [[BenchProbeFrameTarget alloc] init];
      __block CADisplayLink* link = nil;
      target.handler = ^(CADisplayLink *sender) {
        const double ns = BenchProbeNsFromMediaTime(sender.targetTimestamp);
        [sender invalidate];
        settle(ns);
      };
      link = [CADisplayLink displayLinkWithTarget:target selector:@selector(fire:)];
      [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];

      // Never let a missed frame (e.g. a suspended app) hang the runner. The
      // context outlives this block either way; see the comment above.
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(2.0 * NSEC_PER_SEC)),
                     dispatch_get_main_queue(), ^{
        if (context->settled.load()) {
          return;
        }
        [link invalidate];
        settle(BenchProbeNowNs());
      });
    });
    return promise;
  }

  double HybridBenchProbe::threadCpuNs(BenchThread thread) {
    switch (thread) {
      case BenchThread::MAIN:
        return BenchProbeCpuNsForThread(BenchProbeMainThreadPort());
      case BenchThread::JS:
        // Sync probe calls run on the calling (JS/Hermes) thread.
        return BenchProbeCpuNsForThread(pthread_mach_thread_np(pthread_self()));
      default:
        return -1.0;
    }
  }

  double HybridBenchProbe::footprintBytes() {
    return BenchProbePhysFootprintBytes();
  }

  void HybridBenchProbe::gc() {
    // No synchronous heap to settle: iOS manages memory with ARC.
  }

  std::string HybridBenchProbe::launchPlan() {
    return std::string(BenchProbeLaunchPlan().UTF8String);
  }

  std::string HybridBenchProbe::writeNdjson(const std::string& contents) {
    NSString *documentsDirectory = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    if (documentsDirectory == nil) {
      throw std::runtime_error("BenchProbe: no Documents directory");
    }
    NSFileManager *fileManager = NSFileManager.defaultManager;
    if (![fileManager fileExistsAtPath:documentsDirectory]) {
      [fileManager createDirectoryAtPath:documentsDirectory
             withIntermediateDirectories:YES
                              attributes:nil
                                   error:nil];
    }
    NSString *path = [documentsDirectory stringByAppendingPathComponent:@"bench.ndjson"];
    NSString *text = [NSString stringWithUTF8String:contents.c_str()];
    NSError *error = nil;
    if (![text writeToFile:path atomically:NO encoding:NSUTF8StringEncoding error:&error]) {
      throw std::runtime_error("BenchProbe: failed writing " + std::string(path.UTF8String) + ": " +
                               std::string(error.localizedDescription.UTF8String));
    }
    return std::string(path.UTF8String);
  }

  void HybridBenchProbe::begin(const std::string& name, double id) {
    // The signpost *name* must be a compile-time constant, so the caller's
    // label travels as the payload instead. Instruments/Perfetto still group
    // begin/end by the signpost id.
    os_signpost_interval_begin(BenchProbeSignpostLog(), BenchProbeSignpostId(id),
                               "nitro-ui.bench", "%s", name.c_str());
  }

  void HybridBenchProbe::end(const std::string& name, double id) {
    os_signpost_interval_end(BenchProbeSignpostLog(), BenchProbeSignpostId(id),
                             "nitro-ui.bench", "%s", name.c_str());
  }

} // namespace margelo::nitro::benchprobe
