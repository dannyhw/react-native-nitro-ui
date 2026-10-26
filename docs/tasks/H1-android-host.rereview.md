# H1 — Android `<Host>` (Switch) · re-review of fix round 1 (D19)

Branch `task/H1-android-host` @ `db1c738`. The fix round is `0689f41..db1c738`. I reviewed the branch's own commits (`e31899a`, `f790f76`, `d2e884b`, `68a660b`, `d1c9f14`, `f6962d6`, `efa9a16`, `6a130ea`, `f780554`, `db1c738`) and not main's side of the merge `dc0693c`.

I checked them against:
- the brief;
- the round-0 review;
- the report's "Fix round 1" section;
- D17, D19, D23 (with its outcome) and D24;
- `sizing.md` §10 and `host.md`;
- RN 0.88's `SurfaceMountingManager.kt` and `FabricMountingManager.cpp` in `node_modules`.

What I ran (no device, simulator, emulator or bench):
- `bun run typecheck`: exit 0.
- `bun run lint`: exit 0.
- `bunx jest`: 15 suites, **226/226**, which matches the report.
- `node bench/tools/arm-ratios.mjs --arm=nitro-ui-host` and `--arm=nitro-ui` on `bench/results/68a660b-android-20261026T095335Z.json`.

## Verdict: **MERGE WITH FOLLOW-UPS**

- Both must-fix defects are fixed in the code, and the fixes hold up on reading.
- The S items are fixed or reasonably documented.
- I found no regression for controls outside a Host.
- What is left is wrong numbers and wording in the docs, one dev-time warning problem that H1's code causes (F2), and test gaps.
- None of it is a defect with a user-facing failure that would justify spending the last D19 round.

## Round-0 findings: status

| Finding | Status | Notes |
| --- | --- | --- |
| **M1** Host leak on unmount | **Fixed** | See §1. |
| **M2** native Host composes any control | **Fixed** | See §2. |
| S1 "`GONE`" claim false | **Fixed**, with a caveat (F8) | `applyHostedVisibility` became `applyHostedDrawFlag` (`setWillNotDraw` only). D24, `sizing.md` §10, `host.md`, the KDoc, the harness comments and `real-input` were all rewritten. The remaining "always `0 × 0`" wording over-claims; see F8. |
| S2 `display: 'none'` ignored | **Fixed** | See §3. One test gap (F10). |
| S3 padding / inert styles | **Fixed** | `NitroUiHostViewManager.setPadding` forwards the padding; the harness pair shows the shift and an unchanged box. The inert list is in D24, `host.md`, `sizing.md` and the dev warning. Two small inaccuracies: F5 and F6. |
| S4 `onLayout` in release | **Fixed** | `Host.tsx:168`, `__DEV__ ? onLayout : props.onLayout`. |
| S5 logcat only | **Fixed** | Debuggable build emits `NitroUiHostUnhostableChild` → `console.error` (`HostChildren.ts:128-143`). Covered by `hostReport.test.tsx` and by three harness reports. The message names the class but not the `testID`/`nativeID` the review suggested (minor). |
| S6 tests that proved nothing | **Fixed** | JS write: press, then `write-0:false`. Disabled: re-enable, then `off-0:true`. Add step: `list-d` appended and swept in order. New `many single-child <Host>s` churn gate. `real-input` hosted-label order check between the RN siblings. |
| S7 stale docs | **Mostly fixed** | Residue in F1, F3, F4 and F9. |
| S8 `testID` → zero box | **Documented** | `host.md` "Finding a hosted control from a test"; `testTag` left as a follow-up. See F8 for when the box is *not* zero. |
| N1 `''` | Fixed | `HostChildren.ts:200-210`. |
| N2 empty-children warning | Fixed | `Children.toArray(...).length > 0`. |
| N3 RN Switch naming | Fixed | Now `react-native's <Switch>`. |
| N4 per-child observer and pre-draw | Deferred (follow-up 7) | Reasonable: it is only a cost. See §6. |
| N5 `key(child)` and recycling | Deferred (follow-up 8) | Follow-up 8's wording is wrong; see F11. |
| N6 `pointerEvents` | Documented | |
| Q1 nested Host | Answered | Refused on both sides. |
| Q2 unmount after M1 | Answered | **0.78x (16 %)** in the re-run, up from 0.25x, as the review predicted. |

## 1. M1: fixed

- **The override.** `HybridNitroUiHost.kt:56-58` overrides `onDropView() { host.drop() }`, and `NitroUiHostViewManager.onDropViewInstance` calls it before `super`. `drop()` is the B1 body, unchanged:
  - `disposeComposition()`;
  - `unarmCompositionStrategy()`, which installs `DisposeWithTheHost` and so runs the previous strategy's uninstaller, removing the `LifecycleRegistry` observer;
  - removal of both `PreDrawWatch`es;
  - release of the sizing instance.
- **Idempotent.** Every step is a no-op the second time: dispose on no composition, re-set of a no-op strategy, `null` watches, `NO_INSTANCE`.
- **Drop order does not matter.**
  - Host first: its composition goes away. Each child's own `onDropView` still unarms the child's observer (N4), and `model.onChange = null` is harmless.
  - Children first: the Host's composition briefly holds `key(child)` groups whose `onChange` is `null`, so a tap in that window is a no-op. The Host's drop then disposes everything.
  - `super.onDropViewInstance` clears the hierarchy listener, so a removal after the drop cannot bump a dead composition.
- **The gate.** `MountChurn.harness.tsx:433-481` churns 200 single-child Hosts per cycle × 3 cycles. It gates the post-GC floor slope `(last − first)/(n−1) < 2 MiB`, with corrections = 0 and a witness that the Host has a real height and the child is `0 × 0`.
  - The logic is sound. Without the override, every Host stays reachable through `activity → LifecycleRegistry → observer → ComposeContent → Host`, and its slot table holds its child. That is at least 200 × B1's ~42 KiB, about 8 MiB, so the report's **10.98 MiB/cycle** red is plausible and far above the bound. I could not re-run it.
  - One inconsistency: the test's own KDoc (`MountChurn.harness.tsx:425-428`) says the red run "climbs by ~2 MiB per cycle", which would sit *on* the threshold (F7).

## 2. M2: fixed

- **The allowlist is applied everywhere the Host composes.** `HostedChildren` (`NitroUiHost.kt:223-232`) is the only composing loop, and it requires `child is NitroComposeHost<*> && child.isHostable && !child.isHiddenByReact`.
  - `isHostable` is `false` on the base class (`NitroComposeHost.kt:384`) and `true` only on `SwitchHost` (`HybridNitroUiSwitch.kt:239`).
  - `NitroUiHostView` inherits `false`.
  - Every control's Fabric view *is* its `NitroComposeHost` (no wrapper views), so there is no back door.
- **A refused control draws nothing and is left in a sane state.** `isHostedByParent` is parent-based, not allowlist-based. So a refused `Picker` still:
  - declines `onMeasure`, `onLayout` and `runPendingMeasure`;
  - has `shouldCreateCompositionOnAttachedToWindow = false`.

  It builds no composition, draws nothing, reports nothing, and is composed by nobody. If it later leaves the Host it composes as usual. Its armed observer (N4) is removed by its own drop.
- **The error reaches JS.** `reportUncomposableChild` runs from the hierarchy listener for every non-hostable child (`NitroUiHost.kt:104-108`): `Log.w` plus a device event. JS subscribes in dev on Android and calls `console.error`.
  - The Host's own `ComposeContent` is added in the base `init`, before the listener is installed, so it is never reported.
- **A nested Host is refused on both sides.**
  - JS: `children.type === Host` throws `nestedHostError` on both platforms (`host.test.tsx:128`, `:144`).
  - Native: the inner Host is non-hostable, so it is not composed. It is also hosted-by-parent, so it builds no composition of its own. Its Switches have the inner Host as parent, so they do not self-compose either. Nothing is drawn and "another <Host>" is reported.
- **The wrapping shapes are tested.**
  - `Host.harness.tsx:1029-1090` covers `memo`, `forwardRef` and a plain user component: three `0 × 0` boxes, no hit in the Host's box, three JS reports naming Picker.
  - `:1092-1131` covers a Host behind `memo`.
  - Jest covers the JS half and the walk-every-control table.

## 3. S2: `display: 'none'` round trip

- **The hide reaches the Host.** Fabric sets `INVISIBLE` for `displayType == 0`, but only when the view's visibility differs (`SurfaceMountingManager.kt:862-866`). The override records it, and only a real change notifies the parent Host, which bumps `hostedVersion` and sends apply notifications. That is the same path as an add. On first mount the order is: insert (bump), then `updateLayout` → `INVISIBLE` (bump), so a child hidden at mount is never drawn.
- **State and handshake survive the round trip.** When the child is hidden, its `key(child)` group leaves the composition. Only Compose-local state is lost (M3 thumb and interaction source). Everything that matters lives on the model:
  - `displayed`;
  - the event-count handshake (`state.user` / `reconcile`);
  - `enabled`, label and tint.

  JS writes while hidden still land on the model, and `afterUpdate`'s reconcile does not depend on a composition. The re-entered group reads the current model, so it comes back showing the right value with the handshake intact. The harness shows the hidden-at-mount → shown direction, including a press on the re-shown row reaching JS (F10 has the gaps).
- **No effect outside a Host.** `setVisibility` records the value and calls `super`. The notify is gated on `isHostedByParent`. Nothing else in the library writes `visibility` now, since round 1's `GONE` writes are gone.

## 4. Regressions in `NitroComposeHost` for unhosted controls: none found

- **`isHostable`.** Only `NitroUiHostView` reads it.
- **`setPadding` forwarding.** It is on `NitroUiHostViewManager` only. The generated managers still use the base no-op. For the Host, `FrameLayout` insets the `MATCH_PARENT` `ComposeContent`.
- **Visibility.** It is purely additive off the Host path, as described in §3. `applyHostedDrawFlag` is a no-op unless `isHostedByParent`. It never clears `willNotDraw` on the way out, as in round 0, but that is harmless: `PFLAG_SKIP_DRAW` is not set when a background exists, and a `FrameLayout` defaults to `WILL_NOT_DRAW` anyway.
- **B1.** `drop()`, `armCompositionStrategy`, `unarmCompositionStrategy`, `strategyArmed`, `unregisterPreDraw`, `watchForFirstFrame` and `PreDrawWatch` are byte-identical apart from comments (checked in `git diff 0689f41..db1c738`).
- **C1.** `NitroUiOverWidePlacement` and `noteOverWideContent` are untouched. The Host has `wantsContentSize = false`, so it is never `unbounded`.

## 5. Docs vs the results file

`arm-ratios.mjs --arm=nitro-ui-host` on `68a660b-…095335Z.json` (4 launches, `quiet yes`, load samples median 2.96, 4.3 % over 7) gives, against `expo-ui-shared-host`:

| Metric | Ratio (spread) |
| --- | --- |
| memory | 0.86x (1 %), 44.5 KiB |
| mount UI CPU | 0.87x (2 %) |
| mount JS CPU | 1.18x (4 %) |
| mounted | 0.97x (5 %) |
| presented | 0.99x |
| unmount UI CPU | 0.78x (16 %) |

The `nitro-ui-host` column in README, `host.md`, `HostProps` and the report matches.

**F1 (wrong number) — "2.63x unhosted memory" is the ratio to `rn-core`, not to the shared host.** `--arm=nitro-ui` on the same file gives memory 143.5 KiB:

| Against | Ratio (spread) |
| --- | --- |
| `rn-core` | **2.63x** (0 %) |
| `expo-ui-shared-host` | **2.75x** (1 %) |

The report's own tables (`report.md:17`, `:103`, `:122`) say 2.75x. The 2.63x figure appears in:
- `README.md:273`;
- `docs/components/host.md:35`, the "nitro-ui (no Host)" column of a table headed "launch-paired ratio to `expo-ui-shared-host`";
- `src/components/Host/Host.tsx:34`;
- `docs/architecture/sizing.md:514`, which says "H1's run: 2.63x → 0.86x … T16's spike measured 2.75x".

Fix: replace 2.63x with 2.75x in all four. In `sizing.md`, H1's run and T16's spike then agree at 2.75x. The other unhosted cells are right: 1.39x, 1.13x, 0.73x, 1.31x.

**D24 text** is accurate to the code, with these exceptions:
- F6 (`borderWidth`);
- F8 ("laid out at `0 × 0`" is not guaranteed after a post-mount layout);
- "(D23 and its outcome below)" in the last bullet; the outcome is *above* D24 (F9).

## 6. N4: cost only, no misbehaviour

A hosted child still does three things for a composition it never builds:
- arms `DisposeOnLifecycleDestroyed` on its `ComposeContent`;
- sets the owners;
- registers a first-frame `PreDrawWatch`.

None of them can build a composition:
- The strategy only ever *disposes*.
- The pre-draw listener only marks `KIND_FIRST_FRAME` and calls `recordDrawnSize`. That call is a trace entry gated on `traceEnabled_` (`NitroUiSizingEngine.cpp:855-861`), so the cost is one "drew 0 × 0" trace event per hosted child when tracing is on.
- Every measure route declines while hosted: the Host's `FrameLayout` measure, Fabric's `measure`, and `runPendingMeasure`.
- On a detach/re-attach under the Host, `ComposeContent.onAttachedToWindow` only disposes.

Nothing leaks: the child's own `onDropView → drop()` removes both registrations, the same as for an unhosted control. It is a cost (200 add/remove pairs per batch), and it is correctly listed as follow-up 7.

## New findings

None of these is must-fix.

### F2 — should-fix — `HostChildren.ts` fires two RN deprecation warnings in every consuming app

`src/components/Host/HostChildren.ts:79-99` builds `UNHOSTABLE_RN_VIEWS` at module scope, including `ImageBackground` (`:83`) and `SafeAreaView` (`:90`). In RN 0.88 both are `index.js` getters that call `warnOnce` (`node_modules/react-native/index.js:71`, `:127`).

So evaluating the module logs "ImageBackground is deprecated…" and "SafeAreaView has been deprecated…". Jest shows both on every suite that imports `Host`. The table also runs in release, even though only dev uses it.

- **Scenario.** An app imports `Host` from `react-native-nitro-ui` and gets two yellow LogBox deprecation warnings about components it never used, blamed on its own code.
- **Misattributed in the report.** Follow-up 6 calls this "`SafeAreaView` deprecation warnings in the example app, unrelated to H1". The code has been H1's since round 0 (`42dd621`).
- **Fix.** Drop those two rows; the native report already catches whatever they render. Or match deprecated components without touching the getters. Also build the table lazily inside the `__DEV__` branch.

### F3 — nit — bench comment says the `nitro-ui-host` arm "is gated"; it is not

- `bench/src/implementations/index.ts:58-62` was rewritten in `68a660b` to say "This arm … is gated".
- But `scripts/bench/lib.mjs:72` is `GATED_IMPLEMENTATIONS = ['nitro-ui']`.
- And `lib.mjs:87-88` still reads "T16 spike … A reference arm … never gated".

The brief does not ask for it to be gated. **Fix:** say "reported, not gated" in both places, and drop "T16 spike".

### F4 — nit — `host.md:10-11` misstates T17's result

`host.md` says T17's iOS Host was "losing on memory while giving back most of the win on unmount CPU". D23's outcome is the opposite on memory:
- memory **0.92x / 0.75x** of nitro-ui, a win;
- mount UI CPU **1.40x**, a loss;
- unmount UI CPU **6.27x**, a loss.

`Host.tsx:175-180` and the Swift header state it correctly. **Fix:** "memory was lower, but mount UI CPU 1.40x and unmount UI CPU 6.27x".

### F5 — nit — the dev style warning flags `alignSelf` and `alignContent`, which are not inert

`Host.tsx:203-212` includes `'alignSelf'`. A Host's own `alignSelf` places and sizes *its box* in its parent, and that box is what Compose draws into. So `<Host style={{ alignSelf: 'stretch', height: 96 }}>` warns that it "does not reach what it draws", which is false.

`host.md`, D24 and `sizing.md` do not list `alignSelf`, so code and docs disagree. **Fix:** remove `alignSelf`. Keep `alignContent` only if it is documented.

### F6 — nit — `borderWidth` *does* inset the drawing

Fabric's padding mount item sends `layoutMetrics.contentInsets`, which is border plus padding (`FabricMountingManager.cpp:533-543`, `:687`, `:772`). So with the new `setPadding` override, `borderWidth: 2` moves the `Column` in by 2 dp; the Host just draws no border.

D24, `host.md:99-108`, `sizing.md` and the warning say `borderWidth` "does not reach the drawing". **Fix:** say "insets like padding but draws no border", and drop it from the warning list or reword the warning.

### F7 — nit — the churn gate's KDoc contradicts its own red proof

`MountChurn.harness.tsx:425-428` says that without the override "the floors climb by ~2 MiB per cycle here". The report says **10.98 MiB/cycle**, and the header comment predicts about 8 MiB. At 2 MiB the gate would sit on its own 2 MiB bound.

**Fix:** state the measured red value, so nobody later "tunes" the threshold against the wrong number.

### F8 — low, unverified on device — "a hosted child's view is laid out at `0 × 0`" holds at mount, but probably not after a later layout

`SurfaceMountingManager.updateLayout` calls `measure(EXACTLY w, h)` and then `viewToUpdate.layout(x, y, x+w, y+h)` at the **Yoga frame** (`SurfaceMountingManager.kt:829-860`, since `needsCustomLayoutForChildren()` is `false`). `View.layout` ignores the declined 0 × 0 measured size.

What actually puts the child at 0 × 0 is the Host's own `FrameLayout.layoutChildren`, through the Host's `measureNow` or `onLayout`. That runs at mount, after the attach. It does not run for a child added or re-framed later while the Host's own frame is unchanged. Example: `list-d` in the add/reorder case, where the test asserts only `not.toBeNull()`.

The KDoc at `NitroComposeHost.kt:418-430` contradicts itself: "laying it out at its RN frame", then "the child is laid out at `0 × 0`".

- **Functional impact: none I can construct.**
  - The child's `ComposeContent` is never measured, so it draws nothing.
  - `ComposeContent` is last, so it gets native touches first.
  - The empty `FrameLayout` is not important for accessibility.
- **What is affected.** `queryByTestId` and E2E `testID` boxes are sometimes `0 × 0` and sometimes the Yoga row. That makes S8's caveat and D24's "what anything reading real view bounds reports" not always true.
- **Fix.**
  - Cheapest: assert `boxOf('list-d')` in the add step and see.
  - If it is not `0 × 0`, either reword the docs to say "at mount", or return `true` from `NitroUiHostViewManager.needsCustomLayoutForChildren()` so that only the Host lays its children out. Check what that does to a refused RN view first.

  A related question for the orchestrator: a refused *RN* view behind a wrapper is probably drawn at its Fabric frame under the Compose layer, not "not drawn" as the native message says. The new `console.error` makes this loud in dev either way.

### F9 — nit — leftover wording

- `HybridNitroUiHost.kt:8`, "The Host component (T16 spike)".
- `NitroUiHost.kt:33`, "(T16 spike - …)".
- `lib.mjs:87`; see F3.
- D24's "(D23 and its outcome below)"; it is above.
- Follow-up 1 still quotes round 1's 1.26x JS figure, without pointing at the fix round's 1.18x.

### F10 — test gap (follow-up) — S2 covers only one direction

`does not draw a hosted child RN hid with display: none` starts hidden and shows the child. It does not cover:
- shown → hidden after mount, where a drawn row has to leave the composition;
- a JS `value` write while hidden, followed by a check that the re-shown row displays it, and that its next press asks for the opposite value.

The code path is the same, and the model-held state makes me expect both to pass, but the brief's handshake claim is only shown for an untouched row.

### F11 — nit — follow-up 8 (N5) has the premise backwards

`HybridNitroUiSwitch` already implements `RecyclableView` (`HybridNitroUiSwitch.kt:274`), so N5 applies to Switch itself, not to "a future control", once an app turns on `enableViewRecycling()`. It is still minor:
- the flag is off by default;
- `prepareForRecycle` resets the model;
- a reused `key(child)` group could carry over only M3's internal animation and interaction state.

Reword the follow-up.

## Summary of what should follow the merge

1. Fix F1's number (2.63x → 2.75x) in README, `host.md`, `Host.tsx` and `sizing.md`.
2. F2: remove `ImageBackground` and `SafeAreaView` from the module-scope table, or build it lazily in dev only.
3. Doc and wording: F3–F7, F9, F11.
4. F8: one assertion on `list-d`'s box, then settle the docs or switch to `needsCustomLayoutForChildren`.
5. F10: two harness cases for `display: none`.
