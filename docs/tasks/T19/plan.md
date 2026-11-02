# T19 — measurement plan (working notes, not the report)

Lease `T19-18jd1` · sim `3AE7EE8D-543D-445D-BC4A-C7A6CDFF5646` · `emulator-5570` · adb server 5041 · Metro 8293.
G10 holds pair-a. Never touch `emulator-5560`; always `-s emulator-5570`.

## State after the merge (verified, this tree `d9f95b10a6a9`)

- `check` green; `harness:ios:TextFieldSpike` 9/9; `harness:android:TextFieldSpike` 9/9.
- `real-input:android` spike controls 4/4 (reject-rate ≥47.4 keys/s, RN 10/10; maxLength; coexist; typing).
- Both example apps build; Android `assembleRelease` + iOS Debug build green.

## Oracle probes (measured, not assumed)

- `adb shell input text 'a😀b'` → `NullPointerException … null array`. Non-ASCII is **not injectable** on
  Android's accepted oracle. `%sc0de` passes through literally (not a unicode escape).
- XCUITest `typeText` cannot send non-ASCII either (T18b). So "an emoji typed at the `maxLength` boundary"
  needs a new hook on both platforms → its own line, and the cap's *unit* is measured on the write path instead.
- Android IMEs on this image: Gboard + voice only (`ime list -a -s`). No composition-capable IME to select.
- `-g AppleKeyboards` now carries `Japanese-Hiragana` on the leased simulator: to be confirmed on screen.
  A kana keyboard turns ASCII `typeText` into **real marked text**, which is the only accepted-oracle route
  to an open composition on iOS.

## The go/no-go items and how each gets answered

1. **iOS latency, in-app, release, alternating.** T18b's raw number is `commit − injector-send`, so XCUITest's
   300–600 ms is inside both arms and *compresses* the ratio (a lower bound). Fix: stamp **arrival inside the
   app** — a `UIWindow` subclass overriding `sendEvent(_:)` records `UIPressesEvent.phase == .began` per key.
   `typeText` synthesises hardware-key events, so both arms' keys pass through that one window. Latency becomes
   `JS commit stamp − arrival stamp of the same key`, both from the app's clock, injector cost outside the
   measurement. Relayed to JS through the spike's own cached-string pattern (lock-guarded, no main hop),
   rendered into each arm's echo line, index-paired with the commits. Release simulator build for both arms.
2. **Android latency, alternating.** Interleave arms **per keystroke** (S,R,S,R…) rather than arm-then-arm, so
   arm order and any drift within a run cannot separate the arms; report first-half/second-half per arm.
3. **N=200 retention ~30 MiB.** `Debug.getMemoryInfo().usedBytes` is ART's managed heap; a hosted field's
   memory is mostly *native*. Split managed vs native (`getNativeHeapAllocatedSize`) in the example's probe,
   run 3 mount/drop cycles (does the floor converge or climb?), and run the same shape on a shipped control
   (Switch) in the same process as the control arm. That separates prototype / host / measurement artefact.
4. **P1 (3 of 10 iOS runs) + arm-B focus flakiness — one candidate mechanism, testable.**
   The spike freezes its iOS arm inside the `iosImplementation` **prop setter**, guarded by
   `next != requested`, and `prepareForRecycle()` clears both fields. iOS Fabric pools every recyclable view
   unconditionally (F6, new since the spike). A recycled instance whose previous mount asked for the *same*
   arm therefore hits the setter's early return with `frozenImplementation == nil` and never freezes:
   mirror says `impl=swiftui`, `live=0`, and `focus()` answers `focus:no-binding`. That is P1's exact failure
   line and arm-B's focus flake, with one cause, and it only became reachable once recycling landed.
   Test: run P1 ~10× filtered; read the host's `lifetimeReport()` (`drops=`/`recycles=`) on the failing
   instance; force the recycled-same-arm case in the harness; then show it green by freezing at
   `afterUpdate()` instead of in the setter (proof of mechanism on the prototype only).
5. **iOS reject "one key short".** T18b's check compared a *cumulative* counter with a per-burst expectation,
   so the warm-up key hid one loss. Take a before-burst reading, and add the attribution the review wants:
   the same burst into a spike field that *accepts* edits. Accepting-10 + frozen-9 ⇒ the reject path
   (product); accepting-9 too ⇒ the injector (oracle).
6. **Composition + emoji.** Write the composition probe: a field whose JS side schedules
   `nuiTestApplyWrite` ~200 ms after a user edit, so a write lands *while* an IME session is open, without a
   tap (a tap would move focus and close it). `lastWrite=composing` is the guard's answer; the mirror's
   `composing=` is the witness. iOS with the kana keyboard = a real marked-text session. Android: report what
   `composing=` does under Gboard, and name the missing hook if it never opens.
7. **X4 rules 1, 3, 4 on the prototype.** Rule 3: assert the declared fallback (44) differs from the measured
   height, and is registered before the first measure. Rule 4: a recycle-reset scenario in the spike harness
   (mount with text/placeholder/maxLength, unmount, remount, assert no old state and `recycles >= 1`) — the
   same seam item 4 needs. Rule 1: run the real-input a11y rule's own predicate over the spike's dump on both
   platforms (prototype-only table rows, this branch only).

## Order of work

A. Item 4 + rule 4 (one spike method + one harness scenario + 10× P1) → one device round on both platforms.
B. Item 3 (memory split + cycles + Switch control arm).
C. Item 5 (reject attribution, both platforms).
D. Item 1 (arrival stamps + release plumbing), Item 2 (interleaving).
E. Item 6 (composition probe; kana keyboard), Item 7 rule 1.

Every number load-stamped from the gate ledger's own `load1` fields; arms compared only within a run.
