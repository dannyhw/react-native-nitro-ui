# Re-review (fix round 1): B1, Android mount OOM

Branch `task/B1-android-mount-oom`, `e0efb23..56f81d9` (native fix `d15ad28`). Scope per D19: only the fix round.

## Verdict: MERGE

M1 and M2 are both fixed correctly. The touched code breaks nothing I could find. There are no new must-fixes,
and the items below are non-blocking.

## Gate result

- `bun run check` in the B1 worktree at `56f81d9`: **PASS** (RC 0, through package-files and README examples).
  `git status` was empty afterwards and HEAD is unchanged.
- No device gates were re-run (read-only review).
- No gate was weakened. The `MountChurn.harness.tsx` diff only touches comments: `CYCLES = 3` and
  `MAX_FLOOR_GROWTH_MIB_PER_CYCLE = 2` are unchanged.

## M1: verified

`armCompositionStrategy()` has one call site, `NitroComposeHost.kt:484`. It is guarded by `strategyArmed`
(`:388`), and `unarmCompositionStrategy()` (`:416-419`, called only from `drop()`) clears that flag. `init` and
`prepareForRecycle()` no longer arm anything.

Bytecode check, Compose UI 1.11.4 (`ui-android/1.11.4/.../ui.aar`):

- `setViewCompositionStrategy` runs the previous uninstaller, then `installFor(this)`. It has no attach or
  composition precondition.
- `installForLifecycle` throws on DESTROYED, otherwise calls `addObserver`. The guard at `:398` covers the
  throw.
- `AbstractComposeView.attachedToWindow()` is what calls `ensureCompositionCreated()`.

Platform source check: `ViewGroup.dispatchAttachedToWindow` (android-36.1 `ViewGroup.java:3515-3526`) calls the
parent's `onAttachedToWindow` (via `View.dispatchAttachedToWindow`) and only then the children. So arming
anywhere in the host's `onAttachedToWindow` happens before the child creates its composition. The default
`DisposeOnDetachedFromWindowOrReleasedFromPool` installed by the constructor sits on the view itself until that
point, and the first arm uninstalls it.

| Path | Result |
| --- | --- |
| First attach | Armed before the child's attach, before the composition exists. Correct. |
| Detach / re-attach without drop (Modal, reparenting, screens push/pop, `removeClippedSubviews`) | `strategyArmed` short-circuits, so there is one observer and the composition survives. Correct. |
| Recycle (drop, then `prepareForRecycle`, then pool, then reuse, then attach) | Drop unarms. The pooled host holds nothing in the `LifecycleRegistry`. Reuse means an insert, which means an attach, which arms. Correct. |
| Pool emptied silently (`trimMemory` / `onSurfaceStopped`) | The host has no registration, so nothing leaks. Correct. (Untestable with the flag off, and the report says so.) |
| Drop while attached | Dispose, then unarm. A later detach is a no-op. Correct. (N5's "measured after drop" path is pre-existing and filed.) |
| Drop while detached | Same. Correct. |
| Never attached | Never armed. Drop swaps out the constructor default, whose listeners are held by the view. Nothing external. Correct. |
| Activity DESTROYED at attach | Not armed, so no `installFor` throw. The default (first mount) or `DisposeWithTheHost` (after a drop) stays, and `drop()` disposes. Correct. |
| Activity destroyed while armed, then re-attach | Flag set, so no re-install and no throw. Correct. |
| No `LifecycleOwner` | Same as before the round. |

There is no double install: arming is idempotent through the flag, and unarming is idempotent by construction.
Everything runs on the main thread (attach and Fabric mount), which `LifecycleRegistry` requires.

## M2: verified

Checked against android-36.1 sources:

- `View.getViewTreeObserver()` (`View.java:27669-27677`) returns the window's `AttachInfo.mTreeObserver` while
  attached and the view's floating observer otherwise.
- The window observer is created once per `AttachInfo` (`View.java:32839`) and is never killed. Only a floating
  observer is killed, when it is merged at attach (`View.java:23282-23284`, `ViewTreeObserver.java:497`).

Both registrations happen while the host is attached:

- `watchForFirstFrame` runs after `super.onAttachedToWindow()`.
- `scheduleSizingFlush` is reached from a Compose measure, which the host only allows while attached.

So the captured observer is the window's, and it stays alive. Removing from it after a detach now works, which is
the exact scenario in the review.

- **No listener survives drop:** `drop()` (`:365-369`) removes both and clears `firstFrameWatchRegistered`, and
  `releaseSizingInstance()` clears `flushScheduled`. Flags and listeners stay in step.
- **Nothing is removed too early:** the first-frame listener still stays registered while
  `hasPendingReports()`. Each listener only removes itself from inside its own `onPreDraw`, as before. `drop()`
  marks the end of the mount.
- **Dead observer:** handled. If the captured observer is dead, `unregisterPreDraw` falls back to the current
  observer when the host is attached (a merge copied the listener there), otherwise it returns. Removal during
  `dispatchOnPreDraw` is safe because the listener list is a `CopyOnWriteArray`.
- **Threads:** main thread only (Fabric mount, attach and pre-draw).

## Tests and claims

- **Honest:**
  - The recycle path is not covered (the flag is off, and a flag-on heap floor would measure pooling).
  - M2 has no red-first route from JS.
  - The only call site of `NitroUiSizing.flush()` is `:731`, so the sizing gates do exercise the new flush
    removal path.
- **One claim does not match the committed code:** the report says "3200 removal attempts … two per listener:
  its own unregistration and drop()'s". After a self-unregistration the field is `null`, so `drop()`'s
  `unregisterPreDraw(null)` returns before it compares any observer. The instrumentation has been reverted, so
  this cannot be checked. Restate it or drop it.

## Docs

`core.md` §6, the §6 checklist and §Pitfalls now describe attach-time arming, drop-time unarming, and the
pre-draw listeners correctly. All §6 line refs (`:355-372`, `:316-330`, `:475-501`, `:387-403`, `:416-419`,
`:1023-1025`, `:433-450`, `:590-637`, `:716-753`, `:274-283`) match `56f81d9`. Both Compose versions are named.

## New must-fix

None.

## Non-blocking (one line each)

- N-a: `NitroComposeHost.kt:477-478` and `core.md:271-272` say the child's attach "is dispatched by `super`".
  It is dispatched by `ViewGroup.dispatchAttachedToWindow` after this method returns, as `:491-492` already says.
  The behaviour is unaffected.
- N-b: `NitroComposeHost.kt:430-431,448`: `ViewTreeObserver` does not throw for a listener it does not hold. It
  throws only when the observer is dead (`ViewTreeObserver.java:720-726,1030-1035`). Both branches guarantee a
  live observer, so the `catch` cannot be reached. It is harmless, but the comment is wrong.
- N-c: residual best-effort gap.
  - Sequence: a flush listener is registered while detached (on the floating observer), then merged at attach,
    then the host detaches again before any pre-draw, then it is dropped. The listener stays on the window.
  - At that point the listener still unregisters itself through the field rather than by its own identity
    (`this`), so it could take the next mount's watch with it.
  - Practically unreachable. If wanted: re-capture any dead `watch.observer` in `onAttachedToWindow`, and remove
    `this` when `watch?.listener !== this`.
- N-d: `core.md` line refs outside §6 (`:140-170`, `:207-214`, `:248-262`, `:278-332`, `:386-402`, `:107-109`,
  `:339-362`) are stale. This predates the round (they are identical at `e0efb23`).
- N-e: the report's "3200 removal attempts / two per listener" arithmetic (see Tests and claims).
