# V3 — G8's iOS gates on maintainer-mac-1

**Branch:** `task/V3-g8-ios-gates` (from `task/G8-android-visual-fixes` at `8c4d2fd`) · **Lease:** `V3-ce6rx` (iPhone 17, iOS 27.0)

Verification only; code tree `aecd47415e31` (iOS half `27f5037989f7`).

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `harness:ios` | **PASS** | 233 tests / 16 suites | `aecd47415e31` (ios tree) | 3 m 47 s | start 16.1 / med 5.5 / max 16.7 |
| `real-input:ios` | **FAIL** | — | `aecd47415e31` (ios tree) | 11 m 48 s | start 3.0 / med 4.3 / max 6.7 |
| `real-input:ios:--control:switch` | **PASS** | — | `aecd47415e31` (ios tree) | 3 m 17 s | start 4.0 / med 3.9 / max 4.5 |

`harness:ios`: 231 passed, 2 skipped; `Menu` 19/19. `real-input:ios` failed twice (run 1 load max 18.0), 14/14 controls and 13/14 auxiliary each.

**Failure, `a11y:switch`:** `"Controlled switch" is announced by the element at (325, 217.33, 61, 28) while the control is drawn at (108.33, 72.44, 20.33, 9.33)`. The wrapper's box read at exactly ⅓ scale.

**Classification: environment/timing, not G8.** G8 adds no iOS native code, only Android-gated JSX. Afterwards, on the same simulator, G9's passing tree (`control-g9-tree.jsonl`) and this tree both read the true box and passed 14/14 auxiliary.

## Follow-ups

- `a11y:switch` grades a single anchor-frame read; one at ⅓ scale fails it intermittently.
