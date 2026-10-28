# Q3 — The three intermittent tests (read-only research, 2026-10-27)

From `docs/tasks/FOLLOWUPS.md:61` and `docs/tasks/X3-component-registry.report.md:205-211,268-293`.
Read-only round: the patches are proposals, nothing was run. All three are **test/suite bugs** — no
product defect among them — and all three are one shape: *a wait a wrong answer can satisfy*. (About 1,500
words of prose; the rest is the three patches, which are the deliverable.)

## 1. iOS `Picker.harness.tsx` — "asks a wheel the box question after a variant change"

`wheel=0.00x0.00`: four reds at load 35.6–57.2, green at 3.3, 37/37 standalone (`X3 …report.md:268,281`).

**Cause (test).** A variant change is a remount — `src/components/Picker/Picker.tsx:290,348`
(`const variantKey = nativeVariant`, `key={variantKey}`) — so the wheel is a new native view, and
`waitForRemeasure` (`example/__tests__/Picker.harness.tsx:238-255`) is not safe across one. `measured()`
(`:180-182`) answers `0x0` in three states that all mean "not done": the new host has not measured
(`measureContent()` is the host cache, 0 when empty,
`ios/components/Picker/HybridNitroUiPicker.swift:532-538`); the old host was dropped (`drop()` nils
`_contentSize`, `ios/core/NitroSwiftUIHost.swift:327-338`) while the map still points at it, `hybridRef`
firing only on the new view's first props batch
(`nitrogen/generated/ios/c++/views/HybridNitroUiPickerComponent.mm:186-195`); or no handle at all
(`afterEach` clears `handles`, `:399-404`). Zero then *ends* the wait — `sameSize(0x0, asMenu)` is false
(`:157-164`) — and `expect(Math.abs(asWheel.width - BOX.width) < 1)` (`:1712`) compares the box with
nothing. Sibling `waitForMeasured` already refuses zero (`:258-266`); `waitForRemeasure` never learned it,
and only these two variant tests remount. The engine can't launder a 0 report
(`cpp/NitroUiSizingEngine.cpp:505`).

**Patch** — a wait only the live mount can answer (the `wheel`→`menu` twin at `:1750-1762` too):

```tsx
// after waitForMeasured (:266)
+async function waitForFreshMeasure(testId: string, stale: PickerHandle | undefined,
+                                   what: string, timeoutMs = 12000) {
+  return await pollUntil(() => {
+    const handle = handles.get(testId);
+    if (handle == null || handle === stale) return null;  // only the live mount may answer
+    const size = handle.measureContent();
+    return size.width > 0 && size.height > 0 ? size : null; // 0x0 is absence, never a verdict
+  }, () => new Error(`"${testId}" (${what}) never measured on its new mount - `
+    + `measureContent() says ${describeSize(measured(testId))}, box `
+    + `${describeSize(sizeOf(testId))}.`), timeoutMs);
+}
// :1701, having captured `const stale = handles.get('var-w')` before the rerender at :1691
-    const asWheel = await waitForRemeasure('var-w', asMenu, 'a wheel, which fills the box');
+    const asWheel = await waitForFreshMeasure('var-w', stale, 'the wheel after the remount');
```

**Red.** (a) The load-bearing one: restore the old predicate (`size != null && !sameSize(size, previous)`)
plus `await sleep(0)` after the rerender → red at `wheel=0.00x0.00`, the historical signature on demand
instead of at load 40. (b) `host.wantsContentSize = false` (`:279`) — nothing measures: red either way, so
what is claimed is the *message*, which now names the mount that never measured rather than a box
compared with 0×0. (c) Delete `drop()`'s cache clear (`NitroSwiftUIHost.swift:333`): the replaced mount
answers for the new one — already red on the box line, so the handle check earns a red on the line that
means it.

**Deterministic.** Load isn't what's fixed, so don't prove it there: 20 × `gate.mjs harness:ios:Picker`,
20 × full `harness:ios`, 20 × at the busiest tolerated load — 0/60 red, and `0.00x0.00` never in a log.

## 2. Android `HostPopups.harness.tsx` — hosted DatePicker "comes down with its row…"

`expected 1 to be 0` at load 5.3 and 6.7; green at 6.1, 24/24 alone, 37/37 with `DatePicker`, 48/48 with
`HostControls` (`X3 …report.md:274-276,287`).

**Cause (test).** The last line demands a *process-wide* counter be exactly 0
(`example/__tests__/HostPopups.harness.tsx:1221-1235`). `DatePickerModel.livePresentations`
(`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt:263`) rises in the dialog's
`DisposableEffect` and falls when that composition dies (`:1121-1124`); `readReport()` reports it live
(`:430-433`) — deliberately, a dropped mount cannot report its own leak (`:257-262`). `toBe(0)` therefore
asserts every DatePicker in the process, and the file is built on that shared count with each gate closing
its own window (`:1041-1043`, `:1083-1087`), so a leftover is charged to whichever gate reads next. The
likeliest mechanism is not a leak: `cleanup()` only nulls React's element
(`@react-native-harness/runtime/src/render/cleanup.ts:3-7`), so a previous test's unmount — and the
dialog's UI-thread `onDispose` with it — can still be in flight when the next gate reads. That fits the
ledger: 1 to be 0 at load 5.3 and 6.7, green at 6.1 — a disposal that lost a race, not a starved machine.
X3's "snapshot first" is not enough: an unread leftover never decrements, so a naive snapshot hides a real
leak.

**Patch (i)** — the one demonstrable leak-*creator* in the file. `sweepOrder` closes only the popups it
*saw* up (`:1488-1490`), but a dialog that composes "a frame later" (`:979`) after the last band's read
enters nobody's `opened` and stands for the rest of the process — including against this file's own
witness (`:1698-1703`). `closePopup` is already a no-op for a row that never opened (`:1521-1533`):

```tsx
-      for (const id of opened) {
+      for (const id of popupIds) {  // close what was pressed near, not what was noticed up
         await closePopup(id);       // `opened` still answers what the sweep proved to open
```

**Patch (ii)** — assert a delta against a baseline the gate *earns*, so a window it didn't open says so:

```tsx
+async function liveDateBaseline(handle: DatePickerHandle): Promise<number> {
+  if (parseDateReport(handle.nuiTestStateReport()).livePresentations === 0) return 0;
+  // Present-and-close (disabling is the app-side close). A leftover never comes down, so this
+  // fails naming the count it sticks at: somebody else's window, not this gate's.
+  handle.nuiTestPresent();
+  await waitForDate(handle, (r) => r.presented);
+  log.setDateDisabled?.(true);
+  await waitForDate(handle, (r) => !r.presented);
+  log.setDateDisabled?.(false);
+  return (await waitForDate(handle, (r) => r.livePresentations === 0, 20000)).livePresentations;
+}
// "comes down with its row" (:1189-1236): `=== 1` -> `=== live0 + 1` (:1193, :1210, :1216, :1226)
// and `toBe(0)` -> `toBe(live0)` (:1202, :1235), after taking `live0` from the helper above
```

Same delta at the other fresh-mount readers (`:1176-1186`, `:1244-1253` per mode, `:1698-1703`).
`DatePicker.harness.tsx` already has this shape and doesn't name it: it *polls* the count
(`waitForLivePresentations`, `:252-266`), which is how it leaves `page-dialog` open at `:863` and reads
the same counter safely at `:1044` and `:1352`. HostPopups asserts where its sibling polls.

**Red.** (a) `NitroComposeHost.drop()` skipping `disposeComposition()`
(`android/…/core/NitroComposeHost.kt:637`): baseline earns 0, the drop leaves the window composed, last
line reads `live0 + 1` — this gate's own fault, caught. (b) Revert the decrement
(`HybridNitroUiDatePicker.kt:1123`): now fails one line earlier, in the baseline — the same fault named
where it can be seen. (c) Seed a stuck dialog this gate never opens, three builds: unpatched → red on the
last line (wrong blame); patched with `live0` hard-coded to 0 → identical red, which is what the baseline
buys; proposed → red in `liveDateBaseline`, naming the leftover. (d) For (i), a witness mutation —
`popupIsUp` false once `offset > 250`: with `opened` the window survives and the *next* case goes red on
its leak witness (the inter-case poisoning (i) removes); with `popupIds` it comes down.

**Deterministic.** Order is the variable: 20 × `harness:android:DatePicker:HostPopups`, 20 ×
`harness:android:HostControls:HostPopups`, 5 × full `harness:android`, 0 red. For the ordering half, make
the race visible rather than waited for: a temporary case that presents and returns without closing, run
immediately before this gate in the same process — before the patch the gate inherits a false leak, after
it the baseline refuses and names the window.

## 3. iOS real input — `testRealInputSwitch`

**Correction to the brief.** The failure on record is the **first** tap, not the second: X6 quotes
`("off") is not equal to ("on") - one real tap should flip the Switch`
(`X6-build-speed.report.md:277`), which is tap 1's message (`RealInputTests.swift:142-146`); no report on
main quotes tap 2 (`:155-159`), and T15's transcript shows it passing
(`docs/tasks/T15-real-input.report.md:75`). Both taps need the fix, and both are safe to retry.

**Cause (suite; external trigger).** A synthesised HID tap is dropped at any load — `FOLLOWUPS.md:58,60`,
and X6 saw it twice in four full runs plus once in three single-control runs at load 3.5–4.7 on a tree
that also went 10/10 (`:270-303,369`). `RealInputTests.swift:131-160` taps, then asserts the echo:
`readUntil` (`:1555-1575`) waits for the *value* and nothing waits for the *tap*, so a lost delivery is
reported as a control that refuses. The suite learned this once, in `picker` — `tapUntilEcho`
(`:1727-1752`) retries "because pressing blind once cost a red run whose only symptom was a Picker that
survived", and that check has not flaked since. It can't be reused verbatim: its echo exists *because of*
the press, while `switch-controlled-value` is on screen from the first render
(`example/src/SwitchScreen.tsx:107-113`), so existence alone passes untouched.

**Patch** — tap until the *value* arrives; if it never does, name both readings:

```swift
+private func tapUntilValue(_ id: String, echo: String, expected: String, as what: String,
+                           waitingFor: String, attempts: Int = 3) throws -> String {
+  var shown = ""
+  for attempt in 1...attempts {
+    try required(id, as: what).centre.tap()
+    let until = Date().addingTimeInterval(3)
+    while Date() < until {
+      let node = app.descendants(matching: .any)[echo].firstMatch  // not read(): it XCTFails
+      shown = node.exists ? (node.label.isEmpty ? ((node.value as? String) ?? "") : node.label) : ""
+      if shown == expected { return shown }
+      Thread.sleep(forTimeInterval: 0.2)
+    }
+    print("real-input (ios): \(waitingFor): tap \(attempt)/\(attempts) left \(echo)=\(shown)")
+  }
+  dumpHierarchy("\(attempts) taps on \(id) raised no change")
+  XCTFail("\(waitingFor): \(attempts) real taps left \(echo) at \(shown) - either the taps were "
+    + "never delivered (FOLLOWUPS.md:58) or the control ignores a real touch; the dump says which. "
+    + "One delivered tap was enough to pass, so this is not a control that answers sometimes.")
+  throw RealInputCheckAborted(identifier: id)
+}
// testRealInputSwitch (:141 and :154), testRealInputHostedSwitch (:180 and :189):
+    XCTAssertEqual(try tapUntilValue("switch-controlled", echo: Echo.switchValue, expected: "on",
+      as: "the controlled Switch", waitingFor: "the first real tap"), "on", "…")
```

Each flip is idempotent under a delivered tap and unreachable without one, and an attempt only happens
while the value has *not* moved — so a retry cannot manufacture the result. Keep `host-events-count == 2`
in `hosted-switch` (`example/src/HostScreen.tsx:249-256`): a dropped tap emits nothing, so it still counts
exactly the taps that travelled. Same design for `scripts/real-input/android.mjs:132-160` (its `switch`
taps blind twice too) and for `date-picker`, X6's other drop.

**Red.** The proofs come as a pair, or a retry is just a road to green. (a) Swallow the Toggle's binding
setter body — `ios/components/Switch/HybridNitroUiSwitch.swift:53-55`, the `user()` write, the `send()`
and the `onChange` call — for the first call
only, which is precisely a dropped tap's fingerprint inside the app: no `displayed` write, no event, the
echo unmoved. Before the patch, red at `("off") is not equal to ("on")`; after, green on the retry. (b)
Same mutation, every call: red even with retries — which is what keeps (a) from being a test that waits
its way to green. (c) Under (b), assert the failure text names both readings: before the patch a dropped
tap and a dead control are one failure, after they are two.

**Deterministic.** The loss can't be removed, only stopped from being misreported, so prove a rate:
30 × `gate.mjs real-input:ios --control switch` and 30 × `real-input:android --control switch` spread over
day and night, plus 3 full `real-input:ios`; expect ≈0 red (three attempts per tap against X6's 2/4 + 1/3),
and keep the `tap 2/3 left switch-controlled-value at off` lines visible — a green that needed a retry is
not the same information as a green that didn't.

## Follow-ups

- `waitForRemeasure`'s zero hole is copied into `Button.harness.tsx:205` and
  `SegmentedControl.harness.tsx:217`; neither remounts today, so it is latent — audit, don't fix here.
- `scripts/real-input/ios.mjs` should surface `tapUntilValue`'s retry lines in its report table, so
  "green on the fourth try" becomes evidence rather than prose.
- X3's other two observations are the same family, not this task's: `HostControls` timing out at load 129,
  and the harness starting an emulator when KVM/HVF is unavailable.

## Questions for orchestrator

None blocking. One judgement call: patch 2(ii) turns a misplaced blame into a *refusal* when a window is
genuinely stuck — right for a leak gate, but a real Android leak would then surface as `liveDateBaseline`
failing rather than as this gate's own assertion.
