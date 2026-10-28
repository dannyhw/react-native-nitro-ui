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

  /**
   * Absolute D1 timestamps (docs/DECISIONS.md D1). No process-load origin: an
   * absolute CLOCK_UPTIME_RAW value only reaches 2^53 ns after ~104 days awake,
   * and the offset made probe stamps uncomparable with `NitroUiCore.now()` and
   * the perf marks T10 emits, which share this clock.
   */
  static inline double BenchProbeNowNs(void) {
    return static_cast<double>(BenchProbeRawNs());
  }

  static inline double BenchProbeNsFromHostSeconds(NSTimeInterval seconds) {
    return static_cast<double>(static_cast<int64_t>(seconds * 1e9));
  }

  /**
   * The ceiling on waiting for a presenting frame, in seconds.
   *
   * This is a backstop for a process that never gets a frame (suspended, or a window
   * that is not on screen), **not** the wait the runner asked for - that is the
   * `timeoutMs` of `awaitPresented`, which resolves the same promise first through the
   * same once-guard. It has to be well above any timeout the runner can ask for,
   * because a backstop that fires earlier than the requested wait *becomes* the
   * timeout: every long wait would be answered `-1` at the ceiling and the diagnostic
   * A4 added (`presentedTimeout=` on the launch plan) would measure nothing but this
   * number. Kept finite so a stalled launch still ends: the plan parser caps a
   * requested timeout below this (see `BENCH_DEFAULT_TIMEOUTS` in
   * `bench/src/plan.ts`).
   *
   * 90 s is iOS's own number. Android's is 2 s, unchanged from before A4, because the
   * longer wait A4 measured here is scoped to iOS (review M1).
   */
  static constexpr double kBenchPresentationCeilingSeconds = 90.0;

  /**
   * How long the **pacing** frame wait (`nextFrameNs`) waits before giving up and
   * reporting "now". Pacing only, so a slow frame here costs nothing but a slightly short
   * gap between iterations - which is why it stays at 2 s on both platforms while the
   * measured ceiling above does not (Android's `FRAME_TIMEOUT_MS` is the same idea).
   */
  static constexpr double kBenchPacingFrameCeilingSeconds = 2.0;

  // ------------------------------------------------ transaction capture ---

  /**
   * One armed mounting transaction.
   *
   * The mount hook and the display link both run on the main queue (RN asserts
   * `RCTAssertMainQueue()` around `didMountComponentsWithRootTag:`), while
   * `armMountObserver`/`awaitMount`/`awaitPresented` are called from the JS
   * thread - hence the mutex. As in `nextFrameNs`, every promise is resolved
   * exactly once through an `exchange` guard and is only ever reached through a
   * `shared_ptr`, so a losing race can never resolve a freed promise.
   */
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
  /// The safety timer below is a **ceiling, not the wait the runner asked for**: the
  /// binding timeout is the one `awaitPresented(timeoutMs)` arms, and it resolves this
  /// same promise exactly once through the same guard. It has to be a ceiling because
  /// the runner can ask for longer than any fixed number (A4: `presentedTimeout=` on
  /// the launch plan, to tell "this arm never draws" from "this arm draws slower than
  /// we wait"); a 2 s backstop here would answer `-1` first and every long wait would
  /// silently measure 2 s. It exists only so an app that never gets a frame (a
  /// suspended process) cannot hang the runner.
  ///
  /// `capture` is taken **by value on purpose**: both blocks below outlive this
  /// call, and a block that captures a reference parameter captures the referent,
  /// not an owning reference - which segfaults in `capture->mutex` when the
  /// display link fires after the mount hook has returned. Passing by value makes
  /// each block copy-construct its own `shared_ptr`, so the capture cannot die
  /// under either the display link or the fallback timer.
  static void BenchProbeArmPresentation(std::shared_ptr<BenchMountCapture> capture) {
    // Main queue, in the same turn as the mount: a good moment to name the main
    // thread for threadCpuNs('main').
    BenchProbeCaptureMainThreadPort();
    __block CADisplayLink* link = nil;
    BenchProbeFrameTarget* target = [[BenchProbeFrameTarget alloc] init];
    target.handler = ^(CADisplayLink *sender) {
      // `targetTimestamp`, not `timestamp`: a link armed inside a mounting
      // transaction fires during *that* frame's update sequence, so `timestamp`
      // is the start of the frame the commit is happening in - measured on
      // device it lands ~0.67 ms BEFORE the JS commit, i.e. a negative latency
      // that cannot be compared or ratioed. `targetTimestamp` is the start of
      // the next frame, the earliest moment content committed in this turn can
      // be on screen, which is the same "frame boundary at or after the commit"
      // the Android side reports (intended vsync + total duration). It is still
      // one refresh period quantised, and it is still a frame stamp, not a
      // duration.
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
    // hanging the runner. The capture is a shared_ptr, so this block is safe to
    // fire after the display link won.
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

  /**
   * Install the mount hook.
   *
   * docs/research/setup-decisions.md SS6 asks for `RCTSurfacePresenterObserver`'s
   * `didMountComponentsWithRootTag:`. That protocol is reached through
   * `-[id<RCTSurfacePresenterStub> addObserver:]`, and the stub is stored as an
   * associated object on the `RCTBridgeProxy` instance - which RN 0.88 does not
   * hand out anywhere (`+[RCTBridge currentBridge]` returns nil in bridgeless).
   * So we hook the one method that fans the notification out to those observers
   * instead: it is the same signal, one level down, on the main queue.
   *
   * If the class or selector ever disappears, we log once and leave every await
   * resolving -1, so the runner reports "mounted: n/a" instead of producing a
   * wrong number or crashing.
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

  /**
   * Attach a promise to an already-armed capture, or answer `-1` when there is
   * nothing to wait for (no arm, or a failed hook).
   *
   * `*haveStamp`/`stamp` are read under the capture's mutex so a mount that
   * landed while JS was still getting here resolves immediately.
   */
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

  /**
   * The process' main thread mach port, cached.
   *
   * The main thread's `pthread_getname_np` is usually the empty string, and
   * `pthread_main_thread_np()` is not part of the iOS SDK, so there is no
   * supported way to name it from another thread. Instead every main-thread
   * call site of the probe (the mount turn and `nextFrameNs`) records
   * `mach_thread_self()` the first time it runs - which is always before the
   * runner samples CPU, because a CPU sample is only taken around an operation
   * that mounts. If a sample somehow comes first, the fallback names the first
   * thread of the process; the main thread is created before any other.
   */
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

      // Never let a missed frame (e.g. a suspended app) hang the runner. The
      // context outlives this block either way; see the comment above.
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
