# H1 — Android `<Host>` (Switch) · review (D19: the one full review)

Branch `task/H1-android-host` @ `0689f41`, 14 commits on `main`'s `915e73c`. I reviewed `git diff main...` against:

- the brief (`docs/tasks/H1-android-host.md`);
- AGENTS.md, D15, D17, D19, D23 (including its T17 outcome on main) and the new D24;
- `sizing.md`, the T16 spike report, and the B1 and C1 reviews;
- RN 0.88's Fabric sources in `node_modules/react-native` (`SurfaceMountingManager.kt`, `FabricMountingManager.cpp`, `YogaLayoutableShadowNode.cpp`, `ViewManager.java`);
- `@react-native-harness/ui`'s Android `queryByTestId`.

I re-derived the report's ratio tables from the results file it cites, using `bench/tools/arm-ratios.mjs --arm=…` on `bench/results/94e3fad-android-20261026T073843Z.json`. No device, simulator, emulator, Metro, harness or bench was run.

## Verdict: **FIX ROUND**

What is good, and verified:

- **Unhosted controls are untouched.** Every hosted-mode branch in `NitroComposeHost` hangs off `isHostedByParent` (`parent is NitroUiHostView`):
  - the `onMeasure`, `onLayout` and `runPendingMeasure` early returns;
  - the dispose in `ComposeContent.onAttachedToWindow`;
  - `shouldCreateCompositionOnAttachedToWindow`, which is `true` exactly as `AbstractComposeView`'s default;
  - `applyHostedVisibility`, which is a no-op while `hiddenByHost` is false;
  - `centersContent`, which defaults to `true`.

  B1's `drop()`, `strategyArmed` and `PreDrawWatch` code is unchanged, and so is C1's over-wide placement. The Host itself is never `unbounded`, so C1 never runs for it. A control that is not inside a Host does what it did on `main`.
- **Child indexing is sound.** The Host's own `ComposeContent` is added in `init`, so it starts at index 0. Fabric only ever inserts at an index no larger than its own child count, which keeps `ComposeContent` last. So `removeViewAt` never hits RN's tag-mismatch path, and `ComposeContent` is on top for touch.
- **The child list is observed through a version counter.** The hierarchy listener plus `hostedVersion` is the right seam. Rendering each child under `key(child)` keeps recomposition per child, and a reorder moves `remember` state with the view.
- **The numbers in the report match the file.** `arm-ratios.mjs` on the cited file gives:
  - mount JS CPU/op 1.26x(3%), UI CPU/op 0.81x(3%), `mounted` 0.98x, memory 0.85x(1%) against `expo-ui-shared-host`;
  - 0.32x memory and 1.62x JS against `nitro-ui`.

  README, `host.md` and the report agree with each other. The odd one out is the `HostProps` doc comment (S7).
- **Cheap gates pass.** `bun run typecheck` exits 0, and jest `host`, `hostLayoutWarning` and `viewConfigs` pass 26/26.

Two native defects need fixing first: **M1**, the Host leaks on every unmount, and **M2**, the native Host composes any nitro-ui control. Both are Kotlin changes, so per D19 the fix round needs a re-review. After those come two of the brief's requirements the tests do not actually hold (S6) and a run of stale or false doc claims (S1, S7).

## Must-fix

### M1 — `HybridNitroUiHost` never calls `host.drop()`: every Host unmount leaks the Host and its composition for the life of the activity (B1's shape)

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiHost.kt:23-38` has no `override fun onDropView()`. `HybridView.onDropView()` is a no-op (`react-native-nitro-modules/.../HybridView.kt:35`). Every other Hybrid in this library overrides it to call `host.drop()`; see `HybridNitroUiSwitch.kt:486-488`.

`NitroUiHostViewManager.onDropViewInstance` calls `holder.hybridView.onDropView()`, so nothing runs. Meanwhile `NitroUiHostView` is a `NitroComposeHost`, so its `onAttachedToWindow` armed `DisposeOnLifecycleDestroyed(activity)` and built a real composition. That leaves exactly the strong path that `NitroComposeHost.drop()`'s own KDoc describes:

`activity → LifecycleRegistry → observer → ComposeContent → Host`

It holds the Host's `AndroidComposeView`, its composition, the `hostedVersion` state, and whatever the last-composed slot table still references through `key(child)`. A Host unmounted before its first frame also leaves its first-frame `PreDrawWatch` on the window's observer.

**Scenario.** A settings screen wraps its 20 Switches in a `<Host>`. Every visit to that screen leaks one Host, about B1's ~42 KiB per composition host plus whatever the slot table still references, until the activity dies. In a single-activity RN app the activity lives as long as the process.

**Why no gate saw it.**
- **The churn gate is too coarse.** The hosted cycle in `MountChurn.harness.tsx` mounts **one** Host per cycle and gates at `MAX_FLOOR_GROWTH_MIB_PER_CYCLE = 2`, so a leak of one Host per cycle is two orders of magnitude below what it can see.
- **The bench shows it as a win.** `nitro-ui-host` unmount UI CPU is **0.15 ms, 0.25x** the shared host. That is consistent with a Host that never disposes its composition at unmount, so the figure is flattered by the bug.

**Fix.**
- In `HybridNitroUiHost`, add `override fun onDropView() { host.drop() }`.
- Add a churn gate that can see a per-Host leak: for example, 200 Hosts holding one Switch each per cycle (about 8 MiB per cycle if it regresses), or a test-only counter of armed strategies. Prove it red with the override deleted.
- Re-read the unmount column after the fix; expect it to rise.

### M2 — The native Host composes **any** nitro-ui control, so a non-Switch control behind a wrapper is hosted silently

`android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiHost.kt:114` and `:179`. `reportUncomposableChild` returns early for `child is NitroComposeHost<*>`, and `HostedChildren` composes every `NitroComposeHost<*>`. The only "Switch only" rule lives in JS (`HostChildren.ts:45`), and it only sees direct element types. The report says, and `HostChildren.ts:121-129` documents, that anything JS cannot see through goes to the native Host, "which composes it if what it renders is a hostable control". But natively, every control counts as hostable.

**Scenario.**
```tsx
const Row = () => <Picker options={opts} />; // or memo(Slider), forwardRef(DatePicker)…
<Host style={{ height: 96 }}><Row /></Host>
```
- JS passes: `Row` is an unknown component.
- Native composes the Picker inside the Host's `Column`: no error, no log, no measurement, and `GONE`/declined measure on its own view.

The brief (item 1) requires that "a non-Switch nitro-ui child … must fail loudly in dev … not render silently wrong". This is the silent path. Nothing was measured for these controls inside a Host:
- Progress's two-policy remount;
- Slider's `fillWidth` inside a wrap-width `Column`;
- DatePicker's dialog;
- Picker's `holdSizingReports`.

The same path composes a nested `<Host>` (report follow-up 4): `Host` is in neither JS table, so even a *direct* nested Host passes JS.

**Fix.**
- Put an allowlist on the native side. For example, add `internal open val isHostable: Boolean get() = false` to `NitroComposeHost`, overridden to `true` only by `SwitchHost`; `NitroUiHostView` is not hostable.
- `HostedChildren` skips anything that is not hostable. `reportUncomposableChild` reports it by class, and in a debuggable build that report should be loud (see S5).
- In JS, add `Host` to `UNHOSTABLE_CONTROLS`, or decide (Q3) that nesting is supported and test it.
- Harness: `<Host><Wrapped Picker/></Host>` draws nothing and logs.

## Should-fix

### S1 — "The hosted child's view is `GONE`" is not what the device is in; Fabric sets it back to `VISIBLE` on every layout

`NitroComposeHost.kt:371-397` sets `GONE` once, at attach. RN 0.88's `SurfaceMountingManager.updateLayout` ends with this (`node_modules/react-native/ReactAndroid/.../SurfaceMountingManager.kt:862-866`):

```kotlin
val visibility = if (displayType == 0) View.INVISIBLE else View.VISIBLE
if (viewToUpdate.visibility != visibility) viewToUpdate.visibility = visibility
```

`FabricMountingManager.cpp` queues the layout item for a freshly inserted view *after* the insert, and every later frame change (reorder, style) emits another one. So a hosted child spends its life `VISIBLE`, with `hiddenByHost` still `true`.

The `0 × 0` the harness reads is evidence of that, not of `GONE`:
- `queryByTestId` reads `view.width` (`ViewQueryHelper`, `UIHelperImpl.kt`).
- A `GONE` child is skipped by `FrameLayout.layoutChildren` and would keep Fabric's `w × h` frame.
- A `VISIBLE` child is re-laid by the Host's `FrameLayout` at its declined measure of 0 × 0.

Functionally this is mostly harmless:
- `ComposeContent` stays last, so it gets touches first.
- A 0 × 0 node is not visible-to-user, so TalkBack and `uiautomator` skip it.

But several statements rest on `GONE`, and they are not true as written:
- `NitroComposeHost.kt:371-385`, "leaves the accessibility tree", "outside the touch path";
- D24's third bullet;
- `sizing.md` §10;
- `host.md:110` and `:133-135`;
- the harness comments at `Host.harness.tsx:141` and `:443`;
- `MountChurn`'s witness comment.

The "only reverts what it set, so `display:none` survives" reasoning is also built on this model.

**Fix.** Pick one:
- Keep the hosted view out of layout for real, by holding visibility in an override (for example, `setVisibility` coerces to `GONE` while `isHostedByParent`, and remembers what RN asked for so S2 can honour it).
- Or drop the visibility juggling, rely on the measure gate (which is what actually produces 0 × 0), and rewrite the docs to say "laid out at 0 × 0 inside the Host".

### S2 — `display: 'none'` on a hosted child is ignored on Android: it is still drawn and tappable

`NitroUiHost.kt:174-183` composes every `NitroComposeHost` child regardless of its visibility. Fabric expresses `display: 'none'` as `INVISIBLE` (see S1) and Yoga gives the node no box.

**Scenario.** `<Host><Switch style={{ display: hidden ? 'none' : 'flex' }} /></Host>`. On iOS (passthrough) the Switch disappears. On Android it is still in the `Column`, and the content-sized Host is now one row shorter than what it draws, so the last row is clipped.

**Fix.** Make `HostedChildren` skip children that RN asked to be `INVISIBLE`, and bump `hostedVersion` when a hosted child's RN-requested visibility changes. This needs S1's "remember what RN asked for". Add a harness pair: display none vs. shown.

### S3 — `padding`, `borderWidth`, `gap`, `flexDirection`, `alignItems` and `justifyContent` on a Host size the box but do not reach the drawing

`NitroUiHostViewManager` does not override `setPadding`, and `ViewManager.setPadding` is a no-op (`ViewManager.java:460`). The `Column` is placed at `(0,0)` (`NitroComposeHost.kt:1441-1448`). Yoga, meanwhile, includes padding, border and gaps in the content-sized Host height, and lays children in a row if `flexDirection: 'row'`.

**Scenario.** `<Host style={{ padding: 16 }}>` draws its Switches flush to the top-left corner, with 32 dp of dead space at the bottom. `gap: 8` over 10 children makes the Host 72 dp taller than its content. `flexDirection: 'row'` makes it one row tall, so every row but the first is clipped.

D24 and `host.md` define the box as "its own `style` plus its children's boxes" but never say which `ViewStyle` props are inert.

**Fix.**
- Honour padding: override `setPadding` in `NitroUiHostViewManager` to call `view.setPadding(...)`. `FrameLayout` then insets the `MATCH_PARENT` `ComposeContent`.
- Document `gap` and the flex/align props of children as not applying inside a Host.
- Optionally warn in dev when `flexDirection` is not `column`.

### S4 — `Host` always subscribes to `onLayout`, in production too, for a dev-only warning

`Host.tsx:128-161`: the wrapper always passes its own `onLayout`, and it returns early only in `!__DEV__`. Fabric then emits a layout event to JS for every relayout of every Host in release builds, even when the app passed no `onLayout`.

This is a JS-thread cost, and JS is the one axis the Host loses on: 1.26x, against the spike's 1.10x. The report attributes the regression to unknown bookkeeping (follow-up 1), and this is a concrete candidate.

**Fix.** `onLayout={__DEV__ ? onLayout : props.onLayout}`, so release builds attach the caller's handler or none. Then re-check the JS column.

### S5 — A wrapped RN view inside a Host only reaches logcat, and is named by its Java class

`NitroUiHost.kt:113-126`. `<Host><MyRow/></Host>`, where `MyRow` returns `<View>…</View>` (or `Animated.View`, or a third-party view), renders nothing on Android and works on iOS. The only signal is a `Log.w` saying "cannot compose a ReactViewGroup".

That does not meet the brief's "fail loudly in dev (clear error naming the child)". No JS developer watching Metro sees it.

**Fix.** In a debuggable build, surface it where RN developers look: for example, `ReactSoftExceptionLogger.logSoftException`, or route it through the React context's JS exception handler so it shows in LogBox. Include the child's `nativeID` or `testID` when present. Update `host.md:65-70` and D24 to say what the developer actually sees.

### S6 — Three of the brief's correctness cases are not actually held by the new tests

The report says "every new assertion was shown to fail when the behaviour it guards is removed". These were not:

- **"takes a JS write with no touch at all"** (`Host.harness.tsx:359-376`) only asserts `handles[id].value`. That getter returns `model.state.js`, the last JS prop (`HybridNitroUiSwitch.kt:324-327`), not what is displayed. It passes even if the Host's composition never recomposed the child; the test comment's "the handle is what says so" is wrong. **Fix:** after the write, press the first control and assert the request was `write-0:false`, as the reject test already does with its second-press oracle.
- **"keeps a disabled hosted Switch disabled"** (`:405-418`) asserts that a press answers `null`. A Host that drew nothing at all passes it too. **Fix:** re-render with `disabled={false}` and assert the same press now answers `off-0`.
- **"follows children that are added, removed and reordered"** (`:378-403`) never adds a child after mount: `['c','a']` and then `['a']` are a reorder plus removals. The brief names add, remove and reorder. **Fix:** add a step such as `setIds(['list-a', 'list-d'])` and press `d`'s row, or prepend `d` and press the first row.
- **The hosted churn cycle cannot see a Host-sized leak.** See M1.
- **No automated check of TalkBack order or per-child labels.** Brief item 3 asks for them; `host.md:121-151` is a manual dump. **Fix:** add a real-input or uiautomator assertion that the labelled hosted nodes sit between the RN siblings in order. `scripts/real-input/android.mjs` already finds `Hosted switch 0` by content description.

### S7 — Stale and false documentation

- **The iOS passthrough is now permanent.** T17's outcome is on main: "H3 is not built; `<Host>` is Android-only with an iOS passthrough". These still say "while T17 runs" or "still a spike":
  - `host.md:8-10`;
  - `Host.tsx:146-151`;
  - D24's last bullet ("while the iOS Host is still a spike (D23)");
  - `HostScreen.tsx:22`;
  - `ios/components/Host/HybridNitroUiHost.swift` header ("If a Host is ever built for iOS, this is where it goes");
  - the `ARM_SCOPES` comment in `scripts/bench/lib.mjs` ("T17 spikes an iOS one");
  - the report's Summary and Question 1.
- **`HostProps` doc comment** (`Host.tsx:30-35`) still quotes T16's 0.87x / 0.80x / 2.75x / 1.50x / 1.10x. The shipped numbers are 0.85x / 0.81x / 2.68x / 1.38x / 1.26x, and README and `host.md` use them. `sizing.md` §10 also leads with T16's 2.75x → 0.87x.
- **Spike leftovers:**
  - `src/index.ts:32-34`: "Exported on the spike branch … whether it ships is the report's recommendation";
  - `Host.nitro.ts:31`: "@internal Not app API in v0.1";
  - `App.tsx:71`: "T16 spike only … (iOS is not built on this branch)";
  - the bench `implementations/index.ts` comment: "Not gated (it is not the shipping arm)".
- **`host.md:114-116` is false twice.** "RN does not send `onLayout` for a view it laid out at zero, so the dev warning also fires from the parent's box":
  - Fabric's first layout always differs from `EmptyLayoutMetrics` (size −1 × −1, `LayoutMetrics.h:98`), and `YogaLayoutableShadowNode.cpp:772` adds the node to `affectedNodes`, so `onLayout` does fire at height 0;
  - there is no parent-box code.

  The same false premise sits in the harness comment at `Host.harness.tsx:793`.
- **`host.md:58`** says "the dev warning below runs before the caller's handler". `Host.tsx:129` calls the caller first.
- **The report's Files-changed list** says the iOS Swift "still enforces the same child rule". The Swift class is never instantiated; the rule is JS (`HostChildren.ts`).
- **`measureContent()` on a hosted Switch** returns `0 × 0`, or a stale pre-hosting size if the control moved into a Host (`HybridNitroUiSwitch.kt:497-500`). D24 should say so, because it is public API.
- **Rebase.** D24 is appended after D23 in a file that main has since extended with the D23 outcome, so rebase and keep D24 after that entry.

### S8 — `testID` on a hosted child resolves to a 0 × 0 view, which breaks testID-driven E2E taps

The harness can *find* a hosted child, which is what the brief asked for. But Detox, Maestro and Appium tap the centre of the view that carries the `testID`. On Android that view is now 0 × 0 at the Host's origin, so `tap(by.id('wifi'))` lands on nothing, or on row 0. `host.md`'s `testID` row (`:57`) talks only about the Host's own `testID`.

**Fix.** At minimum, document it: "inside a Host, find hosted controls by `accessibilityLabel`", which is what `scripts/real-input` does. Better: carry `testID` into the Compose node (`Modifier.testTag`, with `testTagsAsResourceId` on the Host's root), so that `resource-id` lands on the drawn rect.

## Nits

- **N1 — empty-string false positive.** `HostChildren.ts:153-154` throws for `''`. React renders `''` as nothing, so `{label && <Switch/>}` with `label = ''` throws inside a Host where a `View` would not complain. Treat `''` like `null`.
- **N2 — warning on a Host with no real children.** `Host.tsx:134`, `children != null`, warns for `<Host>{show && <Switch/>}</Host>` with `show = false`, or for `[]`. Use `Children.toArray(children).length > 0`.
- **N3 — confusing refusal for RN's Switch.** Refusing RN's `Switch` produces "Child 0 … is `<Switch>` … replace it with a control it renders (Switch)". Name it `react-native's <Switch>`.
- **N4 — wasted per-child work at mount.** Hosted children still arm a `DisposeOnLifecycleDestroyed` observer on the activity, and register a first-frame pre-draw listener at attach (`NitroComposeHost.kt:703`, `:722`), for a composition they never build. That is 200 registrations and 200 removals per batch of 200. Skip both while `isHostedByParent`; the attach after a move out of a Host arms as usual.
- **N5 — `key(child)` and recycling.** `key(child)` is keyed by `View` identity. That is right for Switch, which is not a `RecyclableView`. When a recyclable control is hosted, a remove and re-add of the same pooled view before the Host recomposes would keep the old mount's `remember` state; key on the Fabric tag, or reset on recycle.
- **N6 — `pointerEvents`.** `pointerEvents` on a Host is ignored: `FrameLayout` is not a `ReactPointerEventsView`, and Compose input is native. Document it with the other inert props (S3).

## Questions for the orchestrator

1. **Nested Host.** Refuse it (my recommendation, and it falls out of M2) or support it? Today it composes silently.
2. **What is `nitro-ui-host` unmount UI CPU after M1?** Today's 0.25x is not a number to quote until the Host disposes its composition.
