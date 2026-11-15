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
// CADisplayLink targets that resolve frame promises sit at global scope.

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
    // CLOCK_UPTIME_RAW is the base of CACurrentMediaTime() and of
    // CADisplayLink.timestamp, so those land on this scale unconverted.
    return static_cast<int64_t>(clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
  }

  /// Absolute, with no process-start origin, so stamps compare with the library's
  /// perf marks on the same clock. A double holds it exactly for ~104 days awake.
  static inline double BenchProbeNowNs(void) {
    return static_cast<double>(BenchProbeRawNs());
  }

  static inline double BenchProbeNsFromHostSeconds(NSTimeInterval seconds) {
    return static_cast<double>(static_cast<int64_t>(seconds * 1e9));
  }

  /// Backstop for a process that never gets a frame, in seconds. It must stay above
  /// any `timeoutMs` the runner can pass to `awaitPresented` (the plan parser caps
  /// those below this), or it would fire first and become the timeout.
  static constexpr double kBenchPresentationCeilingSeconds = 90.0;

  /// How long `nextFrameNs` waits for a frame before reporting "now". It only paces
  /// iterations, so it can be short.
  static constexpr double kBenchPacingFrameCeilingSeconds = 2.0;

  // ------------------------------------------------ transaction capture ---

  /// One armed mounting transaction. The mount hook and the display link run on the
  /// main queue while the arm and await calls come from the JS thread, hence the
  /// mutex. Each promise resolves exactly once and is only reached via `shared_ptr`.
  struct BenchMountCapture {
    std::mutex mutex;
    bool haveMount = false;
    int64_t mountNs = -1;
    bool havePresented = false;
    int64_t presentedNs = -1;
    bool mountResolved = false;
    bool presentedResolved = false;
    std::shared_ptr<Promise<double>> mountPromise;
    std::shared_ptr<Promise<double>> presentedPromise;
  };

  static std::mutex gCaptureMutex;
  static std::shared_ptr<BenchMountCapture> gCapture;
  static std::atomic<int64_t> gLastMountNs{-1};
  static std::atomic<int64_t> gLastPresentedNs{-1};
  static IMP gOriginalDidMountIMP = nullptr;
  static std::atomic<bool> gMountHookFailed{false};

  /// Resolves one of the capture's promises if it exists and has not fired.
  template <bool Presented>
  static void BenchProbeResolveCapture(const std::shared_ptr<BenchMountCapture>& capture) {
    if (capture == nullptr) {
      return;
    }
    std::shared_ptr<Promise<double>> promise;
    double value = -1;
    {
      std::lock_guard<std::mutex> lock(capture->mutex);
      bool& resolved = Presented ? capture->presentedResolved : capture->mountResolved;
      if (resolved) {
        return;
      }
      resolved = true;
      promise = Presented ? capture->presentedPromise : capture->mountPromise;
      value = static_cast<double>(Presented ? capture->presentedNs : capture->mountNs);
    }
    if (promise != nullptr) {
      promise->resolve(value);
    }
  }

  /// Defined below with the CPU helpers; used by the main-queue callbacks here.
  static void BenchProbeCaptureMainThreadPort(void);

  /// Arm the one-shot frame capture for the transaction we just mounted.
  /// Must run on the main queue, in the same turn as the mount.
  ///
  /// `capture` is taken by value on purpose: both blocks below outlive this call,
  /// and a block that captures a reference parameter does not own the referent.
  static void BenchProbeArmPresentation(std::shared_ptr<BenchMountCapture> capture) {
    BenchProbeCaptureMainThreadPort();
    __block CADisplayLink* link = nil;
    BenchProbeFrameTarget* target = [[BenchProbeFrameTarget alloc] init];
    target.handler = ^(CADisplayLink *sender) {
      // `targetTimestamp`, not `timestamp`: a link armed inside a mounting
      // transaction fires during that frame, so `timestamp` is the start of the
      // frame the commit happens in and lands before the commit. `targetTimestamp`
      // is the next frame, the earliest the committed content can be on screen.
      const double ns = BenchProbeNsFromHostSeconds(sender.targetTimestamp);
      [sender invalidate];
      bool armTimeout = false;
      {
        std::lock_guard<std::mutex> lock(capture->mutex);
        if (!capture->havePresented) {
          capture->havePresented = true;
          capture->presentedNs = static_cast<int64_t>(ns);
          armTimeout = true;
        }
      }
      gLastPresentedNs.store(static_cast<int64_t>(ns));
      if (armTimeout) {
        BenchProbeResolveCapture<true>(capture);
      }
    };
    link = [CADisplayLink displayLinkWithTarget:target selector:@selector(fire:)];
    [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];

    // A suspended app never gives the frame: report "no signal" rather than
    // hanging the runner.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(kBenchPresentationCeilingSeconds * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      bool armTimeout = false;
      {
        std::lock_guard<std::mutex> lock(capture->mutex);
        if (!capture->havePresented) {
          capture->havePresented = true; // -1 stays; "no signal" is a real answer
          armTimeout = true;
        }
      }
      [link invalidate];
      if (armTimeout) {
        BenchProbeResolveCapture<true>(capture);
      }
    });
  }

  /// Trampoline for -[RCTSurfacePresenter mountingManager:didMountComponentsWithRootTag:].
  static void BenchProbeDidMount(id self, SEL _cmd, id mountingManager, NSInteger rootTag) {
    std::shared_ptr<BenchMountCapture> capture;
    int64_t stamp = -1;
    {
      std::lock_guard<std::mutex> lock(gCaptureMutex);
      capture = gCapture;
      if (capture != nullptr) {
        std::lock_guard<std::mutex> captureLock(capture->mutex);
        if (!capture->haveMount) {
          capture->haveMount = true;
          capture->mountNs = BenchProbeRawNs();
        }
        // Read the stamp under the lock: the display link can publish it from
        // this same queue while we are still resolving the mount promise.
        stamp = capture->mountNs;
      }
    }
    if (capture != nullptr) {
      gLastMountNs.store(stamp);
      BenchProbeResolveCapture<false>(capture);
      BenchProbeArmPresentation(capture);
    }
    if (gOriginalDidMountIMP != nullptr) {
      typedef void (*BenchProbeDidMountIMP)(id, SEL, id, NSInteger);
      reinterpret_cast<BenchProbeDidMountIMP>(gOriginalDidMountIMP)(self, _cmd, mountingManager, rootTag);
    }
  }

  /// Installs the mount hook. Bridgeless React Native gives no way to reach the
  /// surface presenter to register an observer, so this swizzles the method that
  /// fans the mount notification out to observers. If the class or selector is
  /// missing, it logs once and every await resolves -1.
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

  /// Attaches a promise to an already-armed capture, or answers `-1` when there is
  /// nothing to wait for (no arm, or a failed hook).
  template <bool Presented>
  static std::shared_ptr<Promise<double>> BenchProbeAwaitStamp(double timeoutMs) {
    auto promise = Promise<double>::create();
    std::shared_ptr<BenchMountCapture> capture;
    {
      std::lock_guard<std::mutex> lock(gCaptureMutex);
      capture = gCapture;
    }
    if (capture == nullptr || gMountHookFailed.load()) {
      promise->resolve(-1);
      return promise;
    }
    {
      std::lock_guard<std::mutex> lock(capture->mutex);
      bool& have = Presented ? capture->havePresented : capture->haveMount;
      int64_t& stamp = Presented ? capture->presentedNs : capture->mountNs;
      if (have) {
        promise->resolve(static_cast<double>(stamp));
        return promise;
      }
      if (Presented) {
        capture->presentedPromise = promise;
      } else {
        capture->mountPromise = promise;
      }
    }
    const int64_t nanoseconds = static_cast<int64_t>(timeoutMs * NSEC_PER_MSEC);
    auto settled = std::make_shared<std::atomic<bool>>(false);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, nanoseconds),
                   dispatch_get_main_queue(), ^{
      if (settled->exchange(true)) {
        return;
      }
      bool giveUp = false;
      {
        std::lock_guard<std::mutex> lock(capture->mutex);
        bool& have = Presented ? capture->havePresented : capture->haveMount;
        if (!have) {
          have = true; // timeout: -1 is the answer for this transaction
          giveUp = true;
        }
      }
      if (giveUp) {
        BenchProbeResolveCapture<Presented>(capture);
      }
    });
    return promise;
  }

  // ----------------------------------------------------------- frame waits ---

  // ------------------------------------------------------------- CPU time ---

  /// The main thread's mach port, cached. iOS has no supported way to name the main
  /// thread from another thread, so the probe's main-thread call sites record
  /// `mach_thread_self()` the first time they run. If a CPU sample comes first,
  /// the fallback is the process's first thread, which is the main thread.
  static std::atomic<mach_port_t> gMainThreadPort{MACH_PORT_NULL};

  /// Call from a site known to be on the main thread. The cache owns the send
  /// right it takes, for the life of the process.
  static void BenchProbeCaptureMainThreadPort(void) {
    if (gMainThreadPort.load(std::memory_order_relaxed) != MACH_PORT_NULL) {
      return;
    }
    if (!NSThread.isMainThread) {
      return;
    }
    const mach_port_t port = mach_thread_self();
    mach_port_t expected = MACH_PORT_NULL;
    if (!gMainThreadPort.compare_exchange_strong(expected, port)) {
      // Lost the race against another main-thread site; drop our extra right.
      mach_port_deallocate(mach_task_self(), port);
    }
  }

  static mach_port_t BenchProbeMainThreadPort(void) {
    mach_port_t cached = gMainThreadPort.load(std::memory_order_relaxed);
    if (cached != MACH_PORT_NULL) {
      return cached;
    }
    thread_act_array_t threads = nullptr;
    mach_msg_type_number_t threadCount = 0;
    if (task_threads(mach_task_self(), &threads, &threadCount) != KERN_SUCCESS) {
      return MACH_PORT_NULL;
    }
    if (threadCount > 0) {
      cached = threads[0];
      gMainThreadPort.store(cached, std::memory_order_relaxed);
    }
    // Every entry is a send right this call owns: keep the cached one, release
    // the rest, then free the array itself.
    for (mach_msg_type_number_t index = 0; index < threadCount; index++) {
      if (threads[index] != cached) {
        mach_port_deallocate(mach_task_self(), threads[index]);
      }
    }
    vm_deallocate(mach_task_self(), reinterpret_cast<vm_address_t>(threads),
                  sizeof(thread_act_t) * threadCount);
    return cached;
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
                                     reinterpret_cast<thread_info_t>(&info), &count);
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
    auto capture = std::make_shared<BenchMountCapture>();
    if (gMountHookFailed.load()) {
      // Nothing will ever call the capture: mark it answered so an `await`
      // resolves -1 instead of waiting out its timeout per iteration.
      capture->haveMount = true;
      capture->havePresented = true;
    }
    std::lock_guard<std::mutex> lock(gCaptureMutex);
    gCapture = capture;
  }

  double HybridBenchProbe::getLastMountNs() {
    return static_cast<double>(gLastMountNs.load());
  }

  double HybridBenchProbe::getLastPresentedNs() {
    return static_cast<double>(gLastPresentedNs.load());
  }

  std::shared_ptr<Promise<double>> HybridBenchProbe::awaitMount(double timeoutMs) {
    return BenchProbeAwaitStamp<false>(timeoutMs);
  }

  std::shared_ptr<Promise<double>> HybridBenchProbe::awaitPresented(double timeoutMs) {
    return BenchProbeAwaitStamp<true>(timeoutMs);
  }

  std::shared_ptr<Promise<double>> HybridBenchProbe::nextFrameNs() {
    auto promise = Promise<double>::create();
    // Shared between the display-link callback and the safety timer: the timer is
    // still armed when the frame arrives, so neither side may free the context.
    struct FrameContext {
      std::shared_ptr<Promise<double>> promise;
      std::atomic<bool> settled{false};
    };
    auto context = std::make_shared<FrameContext>();
    context->promise = promise;

    dispatch_async(dispatch_get_main_queue(), ^{
      BenchProbeCaptureMainThreadPort();
      auto settle = [context](double nanoseconds) {
        if (context->settled.exchange(true)) {
          return;
        }
        context->promise->resolve(nanoseconds);
      };

      BenchProbeFrameTarget* target = [[BenchProbeFrameTarget alloc] init];
      __block CADisplayLink* link = nil;
      target.handler = ^(CADisplayLink *sender) {
        const double ns = BenchProbeNsFromHostSeconds(sender.timestamp);
        [sender invalidate];
        settle(ns);
      };
      link = [CADisplayLink displayLinkWithTarget:target selector:@selector(fire:)];
      [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];

      // Never let a missed frame (e.g. a suspended app) hang the runner.
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(kBenchPacingFrameCeilingSeconds * NSEC_PER_SEC)),
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

  double HybridBenchProbe::nativeHeapBytes() {
    // `phys_footprint` (above) already attributes the native heap to the process.
    return -1.0;
  }

  double HybridBenchProbe::javaHeapBytes() {
    return -1.0;
  }

  void HybridBenchProbe::gc() {
    // No synchronous heap to settle: iOS manages memory with ARC. The JS side
    // calls `globalThis.gc?.()` so Hermes collects when the build allows it.
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
