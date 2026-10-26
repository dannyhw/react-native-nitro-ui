# T13 — Shared Compose owner services (`ComposeViewContext`) spike: report

**Branch:** `task/T13-compose-view-context` · **Device:** AVD `nitroui_t02` (`emulator-5572`, adb
server 5042, Metro 8294) · **Platform:** Android only (D13).

## Summary

The question in the brief — *what does `ComposeViewContext` really share between Compose views, and
can our host adopt it to move Android memory and UI CPU toward D15?* — has an answer that changes the
shape of the task:

- **What it shares** (verified in the 1.11.4 sources, not from memory): one `ComposeViewContext` owns
  the accessibility manager, URI handler, clipboard + clipboard manager, font loader, font-family
  resolver, view configuration, image/resource caches, the configuration `State`, the shared
  `LayoutNodeDrawScope`, the `CanvasHolder`, `WindowInfo`, haptics, and the three owners. Each
  `AndroidComposeView` reads all of those from its context (`AndroidComposeView.android.kt:333,387,559,568,625,713,722,879,889,916`).
  What stays per control regardless: the `Composition` and slot table, the `AndroidComposeView`
  itself with its `LayoutNode` root, semantics, accessibility delegate and view tree.
- **We already have it.** Compose shares contexts *by itself*: `AbstractComposeView` resolves the
  context at `findViewTreeComposeViewRoot()` and caches it there, and in an RN app that walk climbs
  out of every nitro-ui host to one view per window. In the measured release build, **50 controls
  resolve one context** with nothing of ours involved (the new `compose contexts` marks column, and the
  new harness gate for the debug build). The per-owner services are therefore already amortised per
  window in the shipped library, and the ~134 KiB per control T12 §P2f attributed partly to them is not
  them — measured, not argued, in [Measurements](#measurements).
- **So the arm has nothing to win.** The prototype (one context per window, created by us and passed
  through `createComposition(ComposeViewContext)`) is correct — Modal, recycling, D17 sizing,
  accessibility and the whole on-device suite are green with it on — but measured against the default
  build it is the same cost in every column (mount UI CPU ratio 1.70/2.03x vs 2.05/1.85/2.06x, memory
  ratio 2.41/2.55x vs 2.40/2.43/2.44x), because it shares a set that is already shared. The opposite
  arm is what shows the stakes: giving each control its own context costs 2.85/2.92x mount UI CPU and
  **still costs no memory** (126.3/138.1 KiB vs 123.2–125.1 KiB), which retires T12 §P2f's guess that
  per-control owner services were part of the 2.4x memory gap.

**Recommendation: keep it off and do not ship it as a feature.** See [Recommendation](#recommendation).

## What the API actually is (Compose UI 1.11.4)

Read from `ui-android-1.11.4-sources.jar`, the version `compose-bom:2026.06.01` (D8) resolves:
extracted to `/tmp/t13-src/ui`. Line numbers below are from those sources.

| Fact | Where |
| --- | --- |
| `ComposeViewContext(view, compositionContext, lifecycleOwner, savedStateRegistryOwner, viewModelStoreOwner)` is public and `@ExperimentalComposeViewContextApi`; the owner arguments default to the view-tree lookups and **throw `IllegalStateException`** if the view has no `LifecycleOwner`/`SavedStateRegistryOwner`. | `ComposeViewContext.android.kt:80-140` |
| The services it owns: `imageVectorCache`, `resourceIdCache`, `currentConfiguration`, `configuration` (`MutableState<Configuration>`), `accessibilityManager`, `uriHandler`, `clipboardManager`, `clipboard`, `fontLoader`, `fontFamilyResolver`, `hapticFeedback`, `viewConfiguration`, `sharedDrawScope`, `windowInfo`, `canvasHolder`. | `ComposeViewContext.android.kt:142-247` |
| A context built from a view whose tree already carries one **reuses those objects** when `matchesContext` (same `Context` on the anchor view); `windowInfo` is always fresh, `hapticFeedback` only shared for the same view. | `ComposeViewContext.android.kt:92,142-241` |
| `viewCount` + `incrementViewCount`/`decrementViewCount`: observation (`registerComponentCallbacks`, a window-focus listener, the container-size hook) starts with the first attached view using the context and stops with the last. | `ComposeViewContext.android.kt:249-345` |
| `AndroidComposeView` takes all the services from the context, and calls `incrementViewCount`/`decrementViewCount` on attach/detach; `disposeComposition()` calls `removeConnectionToComposeViewContext()`, so a disposed composition decrements. | `AndroidComposeView.android.kt:269-916,2349,2484`, `ComposeView.android.kt:421-424` |
| `AbstractComposeView.createComposition(ComposeViewContext)` is public, requires `composeViewContext.view.isAttachedToWindow`, then composes with it. | `ComposeView.android.kt:277-285` |
| Without it, the context comes from `findViewTreeComposeViewRoot()`: the walk is gated by `AndroidComposeUiFlags.isSharedComposeViewContextEnabled` (default **true**), stops at `min(depth-to-lifecycle-owner-tag, depth-to-saved-state-owner-tag)` — where `findDepthToTag` returns the *highest* ancestor carrying the *same* tag value — returns the first ancestor that already holds a context, and avoids the `DecorView`. The context is cached on that view as a `WeakReference` tag. | `ComposeView.android.kt:349-377,667-700,703-727,760-766` |
| `onAttachedToWindow` **posts** `attachedToWindow()` to the front of the handler queue when the composition does not exist yet, so Compose creates it *after the attach finishes* — for the ViewOverlay case. | `ComposeView.android.kt:436-470` |

Two consequences that decided this task:

1. **In an RN app the automatic walk succeeds.** Nothing in RN's view tree sets
   `view_tree_lifecycle_owner` / `view_tree_saved_state_registry_owner`, so `findDepthToTag` returns
   `Int.MAX_VALUE` for both, the walk climbs to the top of the window, and every control in that window
   gets one context. `NitroComposeHost` only sets those tags as a *fallback*, when
   `findViewTreeLifecycleOwner()` returns null (`NitroComposeHost.kt:365-370`) — which does not happen
   against a `ReactActivity`, because the owner lookup falls back to the Activity in the view's
   `Context`. Measured: 6 controls → 1 distinct context, flag off.
2. **The walk is more robust than it looks, which narrows what the flag is for.** The draft of this
   report claimed that anything tagging the tree per control — including our own fallback tags — cuts
   the walk to depth 0. That is wrong, and it was wrong in the interesting direction:
   `findDepthToTag` (`ComposeView.android.kt:712-731`) walks the *whole* tree, remembers the first tag
   value it meets, keeps updating `foundDepth` while later views carry **the same object**, and only
   stops where a *different* owner instance appears. Our fallback tags carry the Activity's owner — the
   same instance the ancestors carry — so they do not cut the walk at all. Measured: building with
   `setViewTreeLifecycleOwner`/`setViewTreeSavedStateRegistryOwner` applied **unconditionally** in
   `NitroComposeHost.kt:366,369` (instead of only as a fallback) leaves the whole suite green,
   17/17, and the sharing gate still counts one context for six controls. What does cut it is a *distinct
   owner instance* per control — a nested activity/dialog boundary, or a library that hands each view its
   own owner — and that is the case the gate guards, at the cost of one perf mark.

## Design of the prototype

`android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiComposeContexts.kt` (new): one
`ComposeViewContext` per **window**, anchored on the highest attached ancestor of the control that
reads the same `Resources` instance — for a control in the activity's window that is RN's own root
view, for a control in an RN `Modal` it is inside the dialog, which is what keeps it per window.
Entries are weak on both ends (`WeakKey` anchor, `WeakReference` context, pruned on every lookup), so
a collected anchor or a context nothing is using becomes a miss that the next attach rebuilds, and a
live window's services outlive the call that made them. Owners come from the anchor when it has them
and from the host's Activity otherwise. Every line that touches
`@ExperimentalComposeViewContextApi` — `ComposeViewContext`, `createComposition(ComposeViewContext)`,
`findViewTreeComposeViewContext` — is inside that file.

`NitroComposeHost` (`ComposeContent`) then only differs in mode `shared`:
`shouldCreateCompositionOnAttachedToWindow = false` and the composition is created from
`onAttachedToWindow` with the window's context, falling back to plain `createComposition()` whenever no
anchor can be found. `false` means "compose it yourself, exactly as today", and with the arms off
this view does not create a composition at all, so the default mode is byte-for-byte the shipped
behaviour - including Compose's deferred `ViewOverlay` attach (see
[A second pass](#a-second-pass-over-the-arm-and-two-claims-it-corrected)).

**One deliberate difference from Compose:** Compose defers creation to a posted runnable; ours creates
synchronously inside `onAttachedToWindow`, one line after `super`. The stated reason for Compose's
deferral is a `ViewOverlay` during a transition, which an RN host is not in; it is nonetheless a
behavioural difference from the default path and is listed under risks.

Three arms, chosen at compile time in `android/build.gradle` and read back through `BuildConfig`:

| `-PnitroUiComposeContextMode=` | Default | Effect |
| --- | --- | --- |
| `auto` | yes | Nothing of ours. `AbstractComposeView` resolves contexts as Compose ships them. |
| `shared` | | Every control asks `NitroUiComposeContexts` for its window's context and composes with it. |
| `perControl` | | Every control is handed its own context — what a window that shares nothing costs, and the condition the sharing gate fails on. |

`perControl` is not a shortcut: Compose's own switch for that state,
`AndroidComposeUiFlags.isSharedComposeViewContextEnabled = false`, does not exist in the builds that
matter. It is a mutable `@JvmField`, so writing it from library code survives debug but a minified
release dies in `<clinit>` with `NoClassDefFoundError` (R8 folds the reads, deletes the class, leaves
the store pointing at nothing), and the documented `-assumevalues` rule reaches the app's R8
configuration and changes nothing. Both were measured on this task (`nitro-ui-bench` release, Compose UI
1.11.4) — see the `fix(android)` commit. An explicit context is honoured whichever way Compose feels
about sharing, so the mode means the same thing in debug and in release, which is the only way the arms
are measurable at all.

A third change makes sharing *visible*: a `composeContext` perf mark whose `instanceId` is the
identity of the context a composition resolved (0 for none), plumbed through
`cpp/core/NitroUiPerf.hpp:54`, `NitroUiPerf.kt:20` and `src/NitroUiCore.nitro.ts:7`. N controls that
share report one identity N times; N identities means sharing broke. Nothing else in the library can
see this — it shows up only as memory and mount cost — which is why the gate is worth keeping even if
the flag never ships.

## Proving the gates, and one claim this report had wrong

Every gate here was shown red before it was trusted. Three builds, three results:

| Build | Expected | Measured |
| --- | --- | --- |
| `auto` (default) | green | **17/17** Switch, **18/18** Sizing |
| `-PnitroUiComposeContextMode=shared` | green | **17/17** Switch, **18/18** Sizing |
| `-PnitroUiComposeContextMode=perControl` | both context gates red | **2 failed, 15 passed** — `shares one set of Compose owner services between instances` (`expected [161925393, 83502065, 22310609, …(3)] to have a length of 1 but got 6`) and `gives a Modal its own set of Compose owner services` (7 identities where 2 are allowed) |
| `shared` + anchor rule ignored (`NitroUiComposeContexts.kt:209` → `if (true)`) | Modal gate red, sharing gate green | **1 failed, 16 passed** — `expected [217861836, +0] to not include +0` |
| `auto` + owners tagged unconditionally (`NitroComposeHost.kt:366,369`) | sharing gate red | **17/17 green** — see below |

The `perControl` arm is the honest red for the sharing gate: it is not a mock, it is the same library
handing each control its own services, which is precisely the state the gate exists to catch. It fails
the *other* fourteen tests' subject not at all, which is also worth knowing: nothing else in the
harness notices whether owner services are shared.

The anchor mutation makes the Modal control compose with the activity window's context. It goes red on
the `not.toContain(0)` assertion rather than the count: `identityOf` reports `0` for "I was asked for a
context and cannot account for what the composition got", which is the honest reading of a control that
was handed a context anchored in another window. A wrong-window context cannot pass the gate either way.

**The claim that turned out wrong** is in [What the API actually
is](#what-the-api-actually-is-compose-ui-1114) above: tagging every host with the view tree owners does
*not* cut Compose's sharing walk, because `findDepthToTag` compares owner *instances*, not the presence
of a tag. The last row of the table is that experiment, and it says the automatic path is robust to the
regression this task was opened to protect against.

## Correctness with the arm on

Mode `shared` runs the whole Android suite green: Modal hosting and sizing, taps at both ends, the
controlled-value round trips, recycling (`survives mounting and unmounting repeatedly`), the cold-batch
and correction tests (D17), configuration changes, and the 40-instance stress mount. `perControl` is
green on everything except the two gates that describe its own state.

Accessibility is the service most worth doubting in a shared context — `AndroidAccessibilityManager` is
one of the objects the context owns, and each control has its own `AndroidComposeView` and semantics
owner. Measured below: [a11y](#accessibility-tree-with-one-context-per-window).

## Risks, if `shared` were ever shipped

| Risk | What it costs | How we would find out |
| --- | --- | --- |
| `@ExperimentalComposeViewContextApi` changes shape under a BOM bump (D8 pins `compose-bom:2026.06.01`) | Compile error, not a runtime surprise: the constructor, `createComposition(ComposeViewContext)` and `findViewTreeComposeViewContext` are named in exactly one file (`NitroUiComposeContexts.kt`), so a bump fails `:android:compileDebugKotlin` in CI rather than in a consumer's app | The build. Nothing else to detect |
| Compose changes *which* services a context owns, or starts putting per-view state in it | Wrong behaviour across every control in a window at once (e.g. an accessibility manager shared across two windows) | The suite: the two context gates plus Modal hosting, a11y-dependent tap tests and the 40-instance mount |
| Our anchor is a view we do not own (RN's root), and `ComposeViewContext` observes it (component callbacks, window focus, container size) | A window whose anchor view is detached before the last control stops using it. Mitigated by construction: the anchor is required to be attached at creation, entries are weak on both ends, and Compose's own `viewCount` keeps the context alive while any control is attached | It would be a crash in `incrementViewCount`/`configuration`, i.e. loud, in the recycling test and in the Modal test |
| Composition created synchronously inside `onAttachedToWindow` instead of Compose's posted runnable, in the `shared` arm | A host that is a `ViewOverlay` child during a transition. An RN host is not one; the harness would catch a regression in attach ordering as a sizing/mount failure. The default arm no longer has this difference at all | Suite |
| Two arms drifting: an arm nobody runs in CI stops compiling or starts lying | Dead code with a live-looking name | `auto` is the default and is what CI builds; `shared`/`perControl` are covered by the `bun bench` arm recipe in this report, and the perControl arm is exercised by the gates being red on it |

The bigger risk is the one this spike found: **the flag protects a state we are not in.** Compose's
automatic sharing already covers RN's view tree, measured in the release build at N=50 (`compose
contexts: 1`). Shipping an explicit context would add a maintained, experimental-API-shaped surface to
reproduce what `AbstractComposeView` does for free — and a context we create is a context whose
lifecycle we own, which today we do not.

## Recommendation

**Keep the arm off; do not ship it as a feature. Keep the diagnostic and the gates.**

- The premise of the brief — that per-control owner services are a cost we pay and could share away —
  does not hold in an RN app: `AbstractComposeView` resolves one context per window by itself
  ([measurements](#measurements)). `shared` is therefore measured as *the same cost*, not a saving, and
  it does not move Android memory or UI CPU toward D15.
- What T12 §P2f attributed to "per-control owner services" is really the per-control `Composition`,
  slot table, `AndroidComposeView` and its `LayoutNode`/semantics/a11y tree. That is the
  one-host-per-window conversation (T12 §P2f as rewritten after F6), not this one.
- **Keep** `NitroUiComposeContexts` + the `composeContext` perf mark + the two gates: they are the only
  thing that makes this invisible property visible and testable, and they are the tripwire if a Compose
  bump or a host app ever stops the automatic sharing. Cost: one file, one perf mark, two harness tests.
- Keep `-PnitroUiComposeContextMode` as a build-time arm for whoever measures this next, documented as
  internal and unsupported, defaulting to `auto`. It is not a public API and is not in the API report.
- If a future release bump does stop the sharing, the path is one line of policy in
  `NitroUiComposeContexts` — flip the default mode — not a redesign.

## Measurements

AVD `nitroui_t02`, release bench build, ART `speed-profile` on every run (`ART: attempt 1 … ->
speed-profile`), `--plan quick`, 4 launches, `nitro-ui` against `expo-ui-shared-host` in the same
launch-paired pass (`bench/tools/arm-ratios.mjs`). One machine, one other agent's emulator and builds
on it, so load average is recorded per run and the machine moved under the runs: **absolute times vary
by up to 3.5× between runs of the same arm**, which is why the comparisons below are (a) within-run
launch-paired ratios and (b) two samples per arm, `auto` sampled three times.

`compose contexts` is the new marks column: distinct `ComposeViewContext` identities reported by 50
controls in a measured release build.

| Arm | Run | load 1/5 | ART | mount presented | mount UI CPU | memory KiB/inst | contexts @N=50 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auto` (default) | 091147Z | 5.5 / 7.6 | speed-profile | 128.22 ms · 1.78x | 39.50 ms · 2.05x | 125.1 · 2.44x | 1 |
| `auto` (default) | 093127Z | 6.9 / 7.3 | speed-profile | 32.63 ms · 1.01x | 11.27 ms · 1.85x | 124.4 · 2.40x | 1 |
| `auto` (default) | 094659Z | 4.8 / 6.5 | speed-profile | 151.99 ms · 2.51x | 45.34 ms · 2.06x | 123.2 · 2.43x | — |
| `shared` | 092009Z | 5.2 / 6.9 | speed-profile | 71.45 ms · 1.41x | 27.81 ms · 1.70x | 136.6 · 2.55x | 1 |
| `shared` | 093706Z | 7.5 / 8.6 *(busy)* | speed-profile | 107.39 ms · 1.72x | 40.81 ms · 2.03x | 123.6 · 2.41x | — |
| `perControl` | 092532Z | 5.2 / 6.6 | speed-profile | 141.52 ms · **2.39x** | 62.37 ms · **2.85x** | 126.3 · 2.42x | **50** |
| `perControl` | 094226Z | 4.6 / 7.1 | speed-profile | 147.12 ms · **2.30x** | 63.67 ms · **2.92x** | 138.1 · 2.67x | — |

(`x` = launch-paired ratio to `expo-ui-shared-host` in the same run.)

Which columns survive this machine: the **mount UI CPU** and **memory** ratios repeat across samples of
one arm (auto 2.05 / 1.85 / 2.06 and 2.44 / 2.40 / 2.43; shared 1.70 / 2.03 and 2.55 / 2.41; perControl
2.85 / 2.92 and 2.42 / 2.67), while `presented` — a frame stamp, so it counts queueing — swings from
1.01x to 2.51x for the same arm and cannot carry a conclusion here.

### What this says

1. **We already share.** `auto` — the shipped library, nothing of ours — resolves **one** context for 50
   controls in a release build. `shared` also resolves one. There is no sharing left to buy, and the two
   arms are indistinguishable in every column, which is the expected result if the arm reproduces what
   Compose does by itself.
2. **The per-owner services are not the D15 memory gap.** Handing all 50 controls their own context
   (`perControl`, verified: 50 identities in the marks run) moves per-instance heap by *nothing worth
   the name*: 126.3 and 138.1 KiB against `auto`'s 123.2–125.1 KiB, and the memory ratio to the shared
   host is 2.40–2.67x in every one of the seven runs. The high readings (136–138 KiB) are a heap-timing
   state that visits every arm — `auto`'s first run contains a 136.6 KiB launch of its own — and the
   quietest run in the set (`auto` 094659Z: 122.4–124.5 KiB across four launches) is the default build.
   T12 §P2f's ~134 KiB per control is the `Composition`, slot table, `AndroidComposeView`, `LayoutNode`
   and semantics tree — it is not owner services, and this is the measurement that says so.
3. **Not sharing is genuinely expensive on the UI thread, and we are not paying it.** `perControl` is
   the only arm that separates from the pack, in both samples: mount UI CPU 62–64 ms vs 28–41 ms
   (`shared`) and 11–40 ms (`auto`), i.e. ~0.5 ms per control to build a font loader, an accessibility
   manager, a configuration observer and a window-info object per control. The arm exists to bound the
   prize: **the whole value of context sharing is the value we already receive for free**, and a context
   we create ourselves cannot beat the one Compose caches per window.
4. **`update presented` is parity everywhere** (0.95–1.17x), as in T12, and no arm changes it.
5. Against D15 the verdict is unchanged from T12: mount UI CPU ~1.85–2.06x and memory ~2.4x are misses,
   `update presented` is parity. The mode does not move either of them. If `shared` ever *did* move
   them, the direction of the two `shared` samples (1.70x / 2.03x UI CPU against `auto`'s 2.05 / 1.85 /
   2.06) is small enough to be the arm doing nothing at all, which is what the mechanism predicts.

Absolute medians for the two `auto` samples and the two `shared` samples are in each results file
(`bench/results/ba52be3-dirty-android-20261023T09*Z.json`), which now also record the Gradle properties
the artifact was built with, so each file names its own arm.

### Machine noise, stated plainly

The same arm measured three times differed by 4.7× in absolute `presented` (32.63, 128.22 and 151.99 ms
for `auto`) with `quiet: yes` on all three, because another agent's builds and a second emulator share
this laptop.
Only two claims above are load-sensitive, and both are conclusions of *no difference*, which noise
cannot manufacture in one direction across two samples each. The `perControl` CPU gap is the one number
whose *size* should not be quoted to two decimals; its *sign* reproduced exactly.

## Accessibility tree with one context per window

`AndroidAccessibilityManager` is one of the objects a shared context owns, so this is the service worth
doubting. Method: launch the release bench app straight into `update:nitro-ui:50` (which leaves 50
controls mounted), then `uiautomator dump` and compare the node trees arm to arm.

| Arm | Nodes | Tree |
| --- | --- | --- |
| `shared` | 55 | reference |
| `perControl` | 55 | byte-identical to `shared` |
| `auto` | 55 | byte-identical |

Every mounted control appears with the same bounds and class in all three (the three files are
byte-identical); the a11y tree does not care which context the owner services came from.

One thing this method could *not* see: no node in any dump carries `checkable`, and it still does not
after `settings put secure touch_exploration_enabled 1` — uiautomator does not appear to materialise
Compose's semantics in this setup, so the dumps prove the tree is *unchanged* by the mode and nothing
about `Role.Switch` reaching an assistive client. T10 verified the `toggleable(Role.Switch)` node
(`docs/tasks/T10-core-switch.review.md:133,210`, `docs/architecture/core.md:154`) by its own means; a
real TalkBack/Espresso check of the three arms is the way to close that last gap, and it is a
follow-up, not a T13 finding.

## A second pass over the arm, and two claims it corrected

Re-reading the kept source against the Compose sources before handing this in found three things
worth a fix, none of which changes the recommendation:

1. **The default arm was not quite the shipped path.** `NitroComposeHost.onAttachedToWindow` called
   `createComposition()` whenever the composition did not exist after `super`, which in mode `auto`
   (the default) is a dead call in the case that matters and a *deviation* in the one case it does
   not: `AbstractComposeView` deliberately defers creation to a posted runnable when the view is in a
   `ViewOverlay` (`ComposeView.android.kt:436-448`), and creating it there would be exactly what that
   deferral exists to avoid. In an RN window the deferral never fires - `contentChild.parent` is
   non-null, so `attachedToWindow()` runs synchronously inside `super` and the composition already
   exists by the time the old guard is reached, which is why every measurement above is unaffected -
   but "the default mode is byte-for-byte the shipped behaviour" is only worth saying if the code
   holds it in the odd case too. The call is now guarded by `NitroUiComposeContexts.isEnabled`
   (`NitroComposeHost.kt`), so with the arms off this view never creates its own composition. No
   measurement changes; the claim now simply holds.
2. **The mechanism in the kept source's KDoc was the wrong one.** `NitroUiComposeContexts` and the
   sharing gate's comment both said Compose's walk "is cut short at the depth where the two owner tags
   are, which is where `NitroComposeHost` puts its fallback tags" - the draft claim this task measured
   and disproved ([above](#proving-the-gates-and-one-claim-this-report-had-wrong)). It survived into
   the source where it would mislead the next reader about what the gate guards, so both now say what
   `findDepthToTag` actually does: stop at a *different* owner instance, not at a tag.
3. **The `Lifetime` section named the wrong identity test** (`Context`, where `findAnchor` compares
   `Resources`) - now consistent with the code and with the Modal gate.

Nothing here moves a number: the three arms were re-run on the device after the change (table below),
and `perControl` still fails exactly the two gates and nothing else.

| Suite | `auto` (default) | `shared` | `perControl` |
| --- | --- | --- | --- |
| `Switch.harness` | **17/17** | **17/17** | **2 failed, 15 passed** - the two context gates |
| `Sizing.harness` | **18/18** | **18/18** | not run (this arm changes owner services, not sizing) |

Run at this commit on `nitroui_t02` with the same commands as below; the sharing gate passing under
`auto` is the post-change confirmation that one context is still what 6 controls resolve.

## Gate results

| Command | Result |
| --- | --- |
| `bun run check` | **green** — typecheck, bench typecheck, lint, format, jest, `test:native` (ASan), `perf:renders`, nitrogen drift, autolinking drift, `prepare`, api-extractor, publint, manifest. First run caught a real miss: `manifest:check` refused to publish `NitroUiComposeContexts.kt` until `etc/package-files.txt` recorded it. |
| `bunx react-native-harness --harnessRunner android Switch.harness` (auto) | **17/17**, 19.2 s |
| `bunx react-native-harness --harnessRunner android Sizing.harness` (auto) | **18/18**, 37.2 s |
| same two suites, `-PnitroUiComposeContextMode=shared` | **17/17** and **18/18** |
| same suite, `-PnitroUiComposeContextMode=perControl` | **2 failed, 15 passed** — the two context gates, as intended |
| same suite, `shared` + anchor rule broken | **1 failed, 16 passed** — the Modal gate, as intended |
| `bun bench --platform android --plan quick --only nitro-ui,expo-ui-shared-host` × 7 | all `speed-profile`, tables above |
| `bun bench … --perf-marks` × 4 | contexts 1 / 1 / 50 for `auto` / `shared` / `perControl` |
| `node bench/tools/arm-ratios.mjs bench/results/<run>.json` | paired ratios above |

All device work was on AVD `nitroui_t02` (`emulator-5572`, private adb server on 5042, Metro 8294), as
assigned. `emulator-5560` and the other task's device were never addressed; the device
this task used was started by this task and is shut down at the end of it.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiComposeContexts.kt` (new) — the arm, and
  the only place the experimental API is named.
- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt` — composition path per mode,
  plus the `composeContext` mark.
- `android/build.gradle`, `NitroUiPackage.kt` — `-PnitroUiComposeContextMode`, validated, default `auto`.
- `cpp/core/NitroUiPerf.hpp`, `android/.../NitroUiPerf.kt`, `cpp/HybridNitroUiCore.cpp`,
  `src/NitroUiCore.nitro.ts` — the third perf mark (`composeContext`). No new public API members: the
  mark travels in the existing `instanceId` field, which is why the API report is unchanged.
- `example/__tests__/Switch.harness.tsx` — the two gates.
- `bench/src/{runner,types}.ts`, `scripts/bench/{lib,render,build,run}.mjs` — `composeContexts` in a
  marks run, `BENCH_GRADLE_PROPS` with a stamp so an arm cannot measure another arm's APK, and the arm
  recorded in each results file.
- `docs/tasks/T13-compose-view-context.report.md` — this file.

## Follow-ups

1. **T12 §P2f's attribution should be corrected** with measurement 2 above: per-control owner services
   are ~0 KiB of the ~130 KiB per control, so the structural cost is the composition + view tree, and
   the only lever left is the one-host-per-window conversation (which F6 already framed as an API
   change).
2. Confirm with a real a11y client (TalkBack or Espresso/`AccessibilityNodeInfo` assertions) that the
   `toggleable(Role.Switch)` node T10 verified survives a shared context. uiautomator could not see it
   in any arm, so this task only proved the dumped tree is unchanged.
3. If a Compose BOM bump ever breaks `@ExperimentalComposeViewContextApi` shape, the fix is local to
   `NitroUiComposeContexts.kt`; if instead the *automatic* sharing stops working, the gates go red and
   flipping the default mode is a one-line change.

## Questions for orchestrator

None blocking. One for the record, with my answer already taken:

- **Keep the arm in the tree, or delete it?** I kept it (see Recommendation): it is the only way to
  measure "what if services were not shared", it is how the gates were shown to fail, and its default
  is the shipped behaviour. If you would rather have the file gone, the pieces worth keeping anyway are
  the `composeContext` mark and the two harness gates — say the word and I will land that split instead.
