# Q9 — ButtonGroup and IconButton design, with the iOS ControlGroup check

**Branch:** `task/Q9-buttongroup-iconbutton-design` (from `main` at `8a8f005c`) · **Round:** 1 of 1 (design task,
D19) · **Lease:** `Q9-o5zol` (iOS only: `nitro-ui A`, iPhone 17 / iOS 27.0, Metro `8295`)

## Summary

**ControlGroup: GO on iOS 27.0, with three rules.** One `ControlGroup` of three `Button`s in plain content draws as
a connected capsule row: 174 × 31 pt, and the core sizing path's `measureContent()` equals the laid-out box for every
configuration. `.navigation` draws loose borderless buttons. `.menu`, `.compactMenu` and `.palette` collapse to one
menu button. The three rules come from what the group ignores or cannot do:
1. It ignores `.controlSize`, `.tint` and `.buttonStyle`, so `variant`, `size` and `tintColor` do nothing on iOS in a
   connected group.
2. A `Toggle` in the group shows no on state, so a connected group with toggles falls back to bordered toggles
   (question B).
3. It has no overflow: six items measure 396 pt in a 369 pt box and draw outside it. iOS overflow is `ViewThatFits`
   choosing how many items fit, plus a real `Menu` beside the group. A `Menu` *inside* the group draws disabled and
   never opens. The beside-the-group version, with containment, opens.

Only iOS 27.0 was checked: no leasable device runs the installed 26.5 or 27.1 runtimes (question A).

**ButtonGroup (Appendix B)** is items as data with `appearance: 'standard' | 'connected'`, E1's size ladder and
variants, `onPress(id)`, and toggle items on the event-count handshake. Android uses Material's `ButtonGroup` with
`customItem`, because `clickableItem`/`toggleableItem` hard-code filled buttons. Overflow is Material's own indicator. Its menu is `ButtonGroup`'s built-in `DropdownMenu`
holding E2's rows: which items overflowed is private state, so E2's popup cannot replace it. The group is `fillWidth`,
because overflow needs the measure to know the box's width on both platforms.

**`androidIcon` (Appendix C)** resolves a drawable name through React Native's own cached
`ResourceDrawableIdHelper`, loads it once per process into a shared vector, and tints it with the content colour at
`iconSizeFor(height)`. A missing name draws no icon and takes no space, as a missing SF Symbol does on iOS. It lands
first on Button and IconButton, then on Menu/ContextMenu rows and Chip, and is built into ButtonGroup from its start.

**IconButton** is Material's `IconButton` family with `shapes`, XS–XL and narrow/uniform/wide on Android, and
`Button` + `Label(.iconOnly)` with `.controlSize` on iOS. It takes an optional `checked` and requires
`accessibilityLabel`.

**Build plan (Appendix D):** G-A (`androidIcon` + IconButton), then G-B (ButtonGroup, four stop-early checks) in
parallel with G-C (`androidIcon` on Menu rows and Chip, after E3). No spike.

**Owner questions:** how Expo apps ship drawables (C) and the XL size names (D).

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1774 tests / 70 suites | `3bb396299e94` | 2 m 46 s | start 8.0 / med 7.4 / max 9.3 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: device gates are missing on purpose. This is a design task, and the code tree is `main`'s: the
probe was reverted, so only `docs/` changed. The brief asks for `check` only.

## Red proofs

None. No test or gate was added. Every test planned in Appendices B and C names the mutation that has to turn it red.

## Files changed

- `docs/tasks/Q9-buttongroup-iconbutton-design.report.md` (new): this file.
- `docs/tasks/Q9/`: seven probe screenshots, scaled to 603 px wide (half of 3x); the throwaway Swift probe as a diff
  (`controlgroup-probe.swift.diff`, against `ios/components/Button/HybridNitroUiButton.swift`); its screen
  (`Q9Probe.tsx.snippet`); the gate ledger.

## Follow-ups

- Lease: `acquire --platform ios --boot` still printed `reset avd:nitroui_a: pm clear`, so it touched the pair's
  emulator for an iOS-only lease.
- Device pool: every pooled and T3 simulator is iOS 27.0, so no task can check 26.5 or 27.1 (question A).
- Menu/Chip/Button docs: the "`systemImage` is iOS-only" Limits lines go away as G-A and G-C land.
  `docs/components/button.md` says the key keeps `systemImage` "so the two cannot drift apart". G-A puts `androidIcon`
  into the key beside it.
- `ResourceDrawableIdHelper` treats an all-digit name as a resource id. G-A should reject digits-only names in JS
  (dev warning), or a typo'd number resolves to a random drawable.

## Questions for orchestrator

- **A. iOS versions for ControlGroup (orchestrator).** Only iOS 27.0 was checkable. 26.5 and 27.1 are installed but
  no pooled device runs them, and no runtime from 15.1 (RN 0.88's floor) to 25 is installed.
  - Options:
    - (a) add a 26.5 and a 27.1 simulator to `~/.nitro-ui/devices.json`, and have G-B screenshot the group on both
      before building;
    - (b) also install an iOS 17 or 18 runtime for one look at the pre-Liquid-Glass drawing;
    - (c) ship on the 27.0 check alone, with the docs saying the look is the system's.
  - **Recommend (a).** It is cheap and covers what users run now. (b) only if the owner wants iOS 15–18 seen: the API
    exists since iOS 15, and the fallbacks (no labelled group before iOS 16, no `ViewThatFits` overflow before 16) are
    already in the design.
- **B. Toggle items in an iOS connected group (orchestrator).** `ControlGroup` draws no on state (measured:
  `controlgroup-ios27.0-p2-text.png`, the `toggle`/`toggletext` rows).
  - Options:
    - (a) a connected group with any toggle item draws on iOS as the standard row of `Toggle(.button)`s, which shows
      the state, and the docs say so;
    - (b) keep `ControlGroup` and show the state by swapping the item's symbol to `checkmark`;
    - (c) toggle items are Android-only.
  - **Recommend (a).** It uses real controls only (D38 item 1) and is the look Chip's filter kind already has.
- **C. How an Expo app ships drawables (owner: PLAN principle 3 says "no config plugin").** Bare RN puts files in
  `android/app/src/main/res/drawable/`. Expo's prebuild regenerates `android/`, so files put there are lost.
  - Options:
    - (a) an **optional** config plugin, `react-native-nitro-ui/plugin` with `{ androidIcons: './assets/android-icons' }`,
      which copies `*.xml` into `res/drawable/` (and writes a shrinker keep file). Installing the library still needs
      no plugin;
    - (b) a docs recipe only: the app writes its own small `withDangerousMod` plugin;
    - (c) also accept `androidIcon={require('./star.xml')}` through Metro and parse the XML vector at runtime, as
      `@expo/ui`'s `Icon` does: no plugin, but an in-library vector parser and an asynchronous first frame.
  - **Recommend (a) now and (c) only if asked.** (a) keeps resolution synchronous, so first measures are exact, and the
    drawables compiled and validated by aapt.
- **D. Names for the L and XL rungs (owner: an API convention Button shares).** E1 mapped Button's `small`/`medium`/
  `large` to XS/S/M. IconButton needs XS–XL (32/40/56/96/136 dp).
  - Options:
    - (a) extend the shared ladder with `'xlarge'` (L, 96) and `'xxlarge'` (XL, 136), for IconButton now and Button
      later;
    - (b) IconButton alone takes Material's names (`extraSmall`…`extraLarge`);
    - (c) IconButton v1 ships XS/S/M only.
  - **Recommend (a).** The same `size` gives the same height on Button, IconButton and ButtonGroup, so a mixed row
    lines up.
- **Decisions already taken in the designs** (the orchestrator can override any; none needs the owner):
  - ButtonGroup is always `fillWidth` (B4);
  - default `appearance` is `'standard'`, Material's default (B1);
  - toggle items use the handshake over the checked set, not Menu's no-handshake `checked` (B1);
  - Android uses `customItem` for every item (B2);
  - the overflow menu is `ButtonGroup`'s own `DropdownMenu` with E2's rows (B3);
  - IconButton variants are named after Material's (`standard`, not Button's `text`) (C4).

---

## Appendix A — The iOS ControlGroup check

**Method.** For this check only, `ButtonContent` (`ios/components/Button/HybridNitroUiButton.swift`) drew a probe
view whenever `title` started with `__CG:`. Each probe was therefore measured by `NitroSwiftUIHost`'s own path: an
`intrinsic` policy, `sizeThatFits` with the unbounded proposal, and the engine's correction. The JS screen printed
`measureContent()` and the laid-out `onLayout` box. The diff and the screen are in `docs/tasks/Q9/`. Both were
reverted before `check`, and nothing in them is on this branch's code tree.
- Device: lease `Q9-o5zol`, iPhone 17, **iOS 27.0** (24A434), Xcode 27 with the iOS 27.1 SDK.
- iOS 26.5 and 27.1 not checked (question A).
- Availability, from the 27.1 SDK's `SwiftUI.swiftinterface`:
  - `ControlGroup` and `.automatic`/`.navigation` are iOS 15.0;
  - `ControlGroup(content:label:)` is **iOS 16.0** (the first probe build failed on it at the 15.1 deployment
    target);
  - `.menu`/`.compactMenu` are iOS 16.4;
  - `.palette` is iOS 17.0.

| Probe (items Day/Week/Month) | Draws as | `measureContent()` = box (pt) | Shot |
| --- | --- | --- | --- |
| `.automatic`, text | **connected capsule row**, grey track, label-coloured titles; no selection | 174.00 × 31.00 | `controlgroup-ios27.0-text.png` |
| `.automatic`, `Label`s | connected row, **icons only** (titles dropped) | 116.33 × 31.00 | `…-label.png` |
| `.automatic`, `.iconOnly` | the same as `Label`s | 116.33 × 31.00 | `…-icon.png` |
| `.navigation` | three loose borderless (tinted) buttons, not connected | 137.33 × 20.33 (text) | `…-text.png` |
| `.menu` / `.compactMenu` / `.palette` | one "Range" menu button: the group's label | 76.00 × 20.33 | `…-text.png` |
| three `Button`s `.bordered` in an `HStack(spacing: 8)` (the fallback) | three separate capsules | 209.33 × 34.33 | `…-text.png` |
| `Picker(.segmented)`, for comparison | the segmented control: the same track, plus a selection thumb | 174.00 × 31.00 | `…-text.png` |
| `.automatic` + `.controlSize(.small/.large/.extraLarge)` | **unchanged** | 174.00 × 31.00 each | `…-p2-text.png` |
| `.automatic` + `.tint(.red)`, + `.buttonStyle(.borderedProminent)` | **unchanged** | 174.00 × 31.00 | `…-p2-text.png` |
| `.automatic`, one item `.disabled(true)` | that item greyed, the others live | 174.00 × 31.00 | `…-p2-text.png` |
| `.automatic`, three `Toggle(.button)`s, the first on | **no on state drawn** (on and off look identical) | 96.00 × 31.00 (icons), 171.00 × 31.00 (text) | `…-p2-text.png` |
| `.automatic` in `.frame(width: 300)` | stretches; items share the width evenly | 300.00 × 31.00 | `…-p2-text.png` |
| `.automatic`, six items | measures 396.00 × 31.00; **box 369.00** (Yoga clamps it); draws outside the box on both sides | 396 ≠ 369 | `…-overflow.png` |
| `ViewThatFits` over (6) / (4 + more) / (3 + more) / (2 + more), at 300 pt, `Menu` **inside** the group | picks 3 + `•••`; the `Menu` segment is **disabled** (accessibility says so, a tap does nothing, with containment too) | 300.00 × 31.00 | `…-overflow.png` |
| the same, `Menu` **beside** the group in an `HStack` | picks 3 + "••• More"; the `Menu` **opens**, listing Quarter/Year/All time (host `needsContainment = true`) | 300.00 × 31.00 | `…-overflow-open.png` |

Accessibility, read from the simulator's tree:
- The group is one container with the segmented-control trait, holding one `button` per item, each labelled with its
  title even when only the icon is drawn.
- The toggles inside it read as plain `button`s. Whether VoiceOver announces their on state was not checked, because
  the agent's tree does not show the trait.

**Verdict.** **GO** for `ControlGroup` as iOS's `appearance: 'connected'` on iOS 27.0, with the three rules in the
summary (no variant/size/tint, toggles fall back, overflow through `ViewThatFits` + `Menu` beside the group). The
standard appearance is a row of bordered `Button`s on every iOS version, so D38 item 1's fallback is that appearance,
not a failure path.

## Appendix B — ButtonGroup

### B1. Public API

```ts
export interface ButtonGroupItem {
  id: string;                         // reported by onPress / onCheckedChange; unique (dev warning otherwise)
  title: string;                      // required: label, VoiceOver/TalkBack name, overflow-row text
  systemImage?: string | null;        // iOS SF Symbol
  androidIcon?: string | null;        // Android drawable name (Appendix C)
  disabled?: boolean;                 // per item
  toggle?: boolean;                   // a toggle item (default false: an action)
  checked?: boolean | null;           // toggle: controlled when boolean, uncontrolled when null/absent
  defaultChecked?: boolean;           // toggle: seed for an uncontrolled item
}

export interface ButtonGroupProps extends ViewProps {
  items: ButtonGroupItem[];
  appearance?: 'standard' | 'connected';       // default 'standard'
  variant?: ButtonVariant;                     // E1's five; default 'filled' (what Material's own group items draw); Android + iOS standard
  size?: ButtonSize;                           // E1's ladder: small/medium/large = XS/S/M; default 'medium'
  labelStyle?: 'automatic' | 'titleOnly' | 'iconOnly' | 'titleAndIcon'; // default 'automatic'
  disabled?: boolean;
  tintColor?: ColorValue;                      // Android + iOS standard; ignored by iOS connected (measured)
  onPress?: (id: string) => void;              // action items, from the row or the overflow menu
  onCheckedChange?: (id: string, checked: boolean) => void; // toggle items
  overflowAccessibilityLabel?: string;         // iOS "More" button's label; Android uses Material's string
  accessibilityLabel?: string;                 // the group's label
  testID?: string;
}
```

- **The wire.** As Menu's rows do, the items go to native as one typed struct array: `NitroUiButtonGroupItem
  { id, title, systemImage: string|null, androidIcon: string|null, disabled, toggle }`. It carries no AnyMap and no
  JSON, and every field is always sent (nitro#1184).
- **The value.** The checked state goes as a separate controlled value: `checkedIds: string[] | null` plus
  `mostRecentEventCount`, on the event-count handshake (core.md §4).
  - Native owns the displayed set and flips a toggle at once.
  - Native emits `(id, checked, eventCount)`.
  - JS refusing it (the next render's `checked` unchanged) snaps it back.
  - Items whose `checked` is `null` are uncontrolled. Native keeps their state, seeded once from `defaultChecked`.
    The wrapper sends `checkedIds` built from the controlled items only, plus a `controlledIds` list, so native knows
    which ones a JS write may move.
  - Why not Menu's model (no local toggle, the app sends the next `checked`): a ButtonGroup toggle is a value the user
    edits in place, like Chip's filter. A JS round trip before the state paints is the latency the handshake exists
    to remove.
- **Single selection is not ButtonGroup's job.** "Pick one" is SegmentedControl (B8). A group of toggles is
  independent toggles, with checkbox semantics on Android (Material's `ToggleButton` role).
- **`labelStyle: 'automatic'`** is each platform's own default:
  - iOS connected: icons only, whenever an item has an icon (measured);
  - iOS standard and Android: icon and title.

  Whether `ControlGroup` honours an explicit `.labelStyle(.titleAndIcon)` is check 2 of the build (D3).

### B2. Android mapping (material3 1.5.0-beta02)

`ButtonGroup(overflowIndicator, modifier, expandedRatio = ButtonGroupDefaults.ExpandedRatio (0.15),
horizontalArrangement, verticalAlignment) { customItem(buttonGroupContent, menuContent) … }`. It is stable and
needs no opt-in.
- **Why `customItem`.** `clickableItem(onClick, label, icon, weight, enabled)` always composes a filled `Button`, and
  `toggleableItem(checked, label, onCheckedChange, icon, weight, enabled)` always composes a filled `ToggleButton`
  (bytecode: their only button calls are `ButtonKt.Button` / `ToggleButtonKt`). Neither takes colours or shapes, so
  neither can carry `variant`, `size`, `tintColor` or the connected corners.
- **`buttonGroupContent`.** An action item is `NitroUiM3Button` (E1), extended with the icon slot from Appendix C. A
  toggle item is a new `NitroUiM3ToggleButton` over the `ToggleButton` family for the variant (`ToggleButton`,
  `TonalToggleButton`, `OutlinedToggleButton`, `ElevatedToggleButton`; `text` → outlined, documented). Both take
  `Modifier.animateWidth(interactionSource)` from `ButtonGroupScope`, so a press widens the item and squeezes its
  neighbours, as Material's own items do.
- **Spacing and corners.**
  - `standard`: `spacedBy(12.dp)` (`ButtonGroupSmallTokens.BetweenSpace`, the value of
    `ButtonGroupDefaults.HorizontalArrangement`). Each item has its own round/press-morph `buttonShapes` (E1).
  - `connected`: `spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)` (2 dp). Items take
    `connectedLeading/Middle/TrailingButtonShapes()` with no arguments, E1 fix round 1's lesson. A one-item group
    takes the lone shapes, as SegmentedControl's `loneSegmentShapes` does.
- **`menuContent`.** An action is E2's `MenuRow` (`android/src/main/java/com/margelo/nitro/nitroui/MenuRows.kt`): a
  `DropdownMenuItem` with the item's icon as `leadingIcon`, with `onClick = { report(id); menuState.dismiss() }`. A
  toggle is `CheckableDropdownMenuItem`.
- **Tint.** `tintColor` goes to the variant's container (and, for a toggle, the checked container), through E1's
  `ButtonColorsCache`.
- **Disabled.** `disabled` and `item.disabled` reach `enabled` on the item and its menu row.

| Prop | Android | iOS standard | iOS connected |
| --- | --- | --- | --- |
| `items[].title` | `Text` in the item; overflow-row text | `Button`/`Toggle` label | `Button` label (dropped when an icon is present) |
| `systemImage` | ignored | `Label(_, systemImage:)` | `Label` (icons only) |
| `androidIcon` | `Icon` at `iconSizeFor(h)` | ignored | ignored |
| `toggle` / `checked` | `ToggleButton` family | `Toggle(.button)` | **falls back to the standard row** (question B) |
| `appearance` | 12 dp spaced vs 2 dp connected shapes | `HStack(spacing: 8)` of bordered buttons | `ControlGroup` |
| `variant` | the five buttons / toggles | Button's style table (`docs/components/button.md`) | **none** (measured) |
| `size` | E1's `ButtonScale` tokens | `.controlSize` | **none** (measured 31 pt at every size) |
| `tintColor` | variant container | `.tint` | **none** (measured) |
| overflow | `ButtonGroupDefaults.OverflowIndicator` + `DropdownMenu` | `ViewThatFits` + `Menu` beside | the same |
| `disabled` | `enabled = false` | `.disabled` | `.disabled` (measured: greyed per item) |

### B3. Overflow

- **Android.** `overflowIndicator = { state -> ButtonGroupDefaults.OverflowIndicator(state, enabled = !disabled) }`.
  It is Material's filled icon button with its internal `MoreVert` glyph and a tooltip, so no icon has to ship.
  - When it is tapped, `ButtonGroup` itself opens a `DropdownMenu` (bytecode: `DropdownMenu-IlH_yew` in
    `ButtonGroupKt`) and puts each overflowed item's `menuContent` in it.
  - The container is therefore Material's plain dropdown, not E2's `DropdownMenuPopup` + groups, while the rows are
    E2's. This is unavoidable without reimplementing `ButtonGroup`: which items overflowed lives in
    `ButtonGroupOverflowState`, which is private.
  - The docs say the overflow menu is Material's button-group menu. Check 3 (D3) photographs it under the Expressive
    theme.
- **iOS.** `ViewThatFits(in: .horizontal)` (iOS 16) over n candidates: all items, then for k = n−1 … 1 the first k
  items plus a `Menu` holding the rest.
  - The `Menu` sits **beside** the `ControlGroup` (or the standard row). Inside the group it draws disabled
    (Appendix A).
  - Its label is `Label(overflowAccessibilityLabel ?? "More", systemImage: "ellipsis")`, and its rows are the same
    `Button`/`Toggle` rows Menu draws.
  - The host sets `needsContainment = true`, Menu's rule (`ios/core/NitroSwiftUIHost.swift`).
  - On iOS 15.x there is no `ViewThatFits`, so every item is drawn and clipped to the box (`.clipped()`). That is
    documented, and better than drawing outside it as the six-item probe did.
- **Both.** A tap on an overflow row reports `onPress(id)` (or toggles, through the handshake) and closes the menu.
  `disabled` while the menu is open closes it (D29's rule, gated). So do a recycle and a drop.

### B4. Sizing

- **`fillWidth`, always.** Overflow is decided by the width the group is given, so the measure must be asked at the
  box's width (sizing.md's `fillWidth` contract): Android's `NitroUiMeasuredRoot` gives `maxWidth = box`, and iOS's
  proposal is the box's width. An `intrinsic` group would be measured unbounded, so it would never overflow, and Yoga
  would then clamp it into a narrower box that it draws outside of (measured: 396 vs 369).
  - Because the box is the parent's, the base style is `alignSelf: 'stretch'`.
  - The items sit at their own widths, from the start (`Arrangement.Start` / `.frame(maxWidth: .infinity, alignment:
    .leading)`), so a group that fits looks content-sized. Give it a `width` to make it narrower.
- **The height is the measured number.** iOS connected: 31 pt (iOS 27.0, any size). iOS standard: 34.33 pt at
  `medium`, as bordered buttons. Android: the rung's laid-out height, 48 / 48 / 56 dp (E1).
- **Key.** `appearance|variant|size|labelStyle|count|` and then per item `toggle,title,systemImage,androidIcon`, every
  free-form field escaped the way Button's key is (`src/components/Button/Button.tsx`). `checked`, `disabled` and
  `tintColor` repaint. The width is not in the key: a `fillWidth` entry files only the height.
- **Declared fallback.** The default configuration: iOS 34.4 pt, rounded up from the standard row's 34.33. Android 48
  dp. A connected iOS group is a cold configuration once, with one correction (D17). The conformance rule asserts it
  against a poisoned fallback.

### B5. Accessibility

| Item kind | VoiceOver (iOS) | TalkBack (Android) |
| --- | --- | --- |
| action, title | "Week, button" (measured: one `button` per item) | "Week, button" (M3 `Button`) |
| action, icon only | the item's `title`: `Label(title, …)` keeps it (measured: "Day" on an icon-only item) | `Icon(contentDescription = null)` + `semantics { contentDescription = title }` on the button |
| toggle | iOS standard: `Toggle(.button)`, the selected trait *(reading; not checked here)* | `Role.Checkbox` + `ToggleableState` (Material's `ToggleButton`; right for independent toggles) |
| overflow | the "More" `Menu` button (`overflowAccessibilityLabel`) | Material's localized overflow label + tooltip |
| group | `accessibilityLabel` on the `ControlGroup`/row container (segmented-control trait in connected) | `semantics { contentDescription; isTraversalGroup = true }` on the row |

No hard-coded English except the iOS "More" default, which the prop overrides. The owner skips hands-on screen-reader
passes, so the harness reads the semantics tree (Android) and the accessibility elements (iOS), and the docs say what
was not heard.

### B6. Recycling and drop

The reset clears:
- items, the checked set, `controlledIds`, both event counts, the seeded flag, and `onPress`/`onCheckedChange`;
- the iOS `ViewThatFits` choice, which is derived and needs nothing;
- the overflow menu: open → closed, with no `onPress`.

On Android the composition is disposed before reuse (core.md §6). The cached drawable vectors are process-wide and
survive the reset on purpose (C1).

### B7. Test plan (each test is shown red first)

| Test | Platform | Red proof (mutation → what goes red) |
| --- | --- | --- |
| key: each per-item field and order moves `nuiSizingKey`; an escaped `|` cannot forge a field | Jest | drop `androidIcon` from the key → two configurations share one key |
| height = measurement after cold mount, from a **poisoned** fallback (height 99) | harness, both | skip the correction push → box stays 99 |
| six items in a 220-wide box: the witness reports visible < 6 and an overflow control; widen to full width: 6 visible, no overflow control | harness, both | iOS: drop `ViewThatFits` (draw all) → visible = 6 and drawn width > box; Android: an `intrinsic` policy → visible = 6 |
| `onPress(id)` exactly once per tap, for a row item and for an overflow row | harness + real-input, both | report the index instead of the id → `expected '2' to be 'week'` |
| toggle: a tap flips at once; refused by JS → snaps back (tap-twice oracle) | harness + real-input, both | drop the `jsEvents >= nativeEvents` gate → second tap reports `true` again |
| uncontrolled toggle seeded once from `defaultChecked`, then ignored | harness | apply `defaultChecked` every batch → a re-render reverts the user's toggle |
| `disabled` group and `item.disabled`: no events, from row or menu | harness | ignore `item.disabled` in `menuContent` → an event fires |
| `disabled` while the overflow menu is open closes it (D29) | harness, both | remove the close → `events:close` missing |
| recycle: a remount shows no previous items, checked state or open menu | harness, both | skip clearing the checked set → previous `checked` drawn |
| semantics: Android action/toggle roles, icon-only `contentDescription = title`; iOS element labels | harness, both | drop the `contentDescription` → `expected null to be 'Day'` |
| conformance: the fallback against the measured default (not coinciding) | conformance | set the fallback to the measured value → the poisoned-fallback rule is vacuous, and the gate says so |

**Bench.** `mount.buttongroup` at N = 1/50/200 and a props update, against `rn-core`'s floor (a `View` of three
`Pressable`s) and SegmentedControl. `@expo/ui` 58 has no ButtonGroup.

### B8. ButtonGroup or SegmentedControl? (the docs paragraph)

> **SegmentedControl** picks **one** of a few options. It always has exactly one selected, its value is an index, and
> it is announced as a radio group. Use it to switch a view or a filter: *List | Grid | Board*.
> **ButtonGroup** is a row of **commands**, such as *Copy | Paste | Share*, optionally with independent toggles such
> as *Bold | Italic | Underline*. It has no single value, and items can carry icons. Extra items move into an overflow
> menu when the row runs out of room.
> On iOS a connected ButtonGroup and a SegmentedControl share a look (Apple draws both on the same track). The
> selection thumb is the difference, and so is what VoiceOver says.

## Appendix C — `androidIcon` and IconButton

### C1. Resolving the drawable

- **The name.** `androidIcon` is a resource name in the app's `res/drawable*`, for example `ic_share` or
  `share_24px`. The name is normalised (lower-cased, `-` → `_`) and looked up with
  `com.facebook.react.views.imagehelper.ResourceDrawableIdHelper.getResourceDrawableId(context, name)`. That is React
  Native's own helper: `Image` uses it for local drawables, and it caches the id per name, misses included, under a
  lock. So the library writes no `getIdentifier` call of its own, and the lookup works across build variants the same
  way RN's does.
- **Loading.** It happens once per (name, theme epoch), in `afterUpdate()` on the main thread and never in
  composition.
  - A vector drawable becomes `ImageVector.vectorResource(theme, resources, id)`; a bitmap becomes `ImageBitmap`.
  - The result goes into a process-wide cache (core.md "Shared objects"), as Chip's check glyph does, because a hosted
    control is its own composition and `remember` cannot share across instances.
  - Anything else (a `layer-list`, a `selector`, an adaptive icon) is treated as missing, since `painterResource`
    would throw on it.
- **Missing or unsupported.** No icon is drawn, no slot is reserved and no padding changes, so the control is exactly
  its no-icon self, as iOS treats an unresolved SF Symbol (`ButtonModel.systemImage`). It logs one `Log.w` per name
  per process, and the JS wrapper warns in development for a name that cannot be a resource name (empty, all digits,
  or with characters outside `[a-z0-9_]` after normalising).
- **Tint.** `Icon(vector, contentDescription = null, modifier = Modifier.size(iconSizeFor(height)))` takes
  `LocalContentColor`, which is the button's content colour. It follows the variant, `enabled`, `checked` and
  `tintColor`. A multicolour drawable draws in one colour, documented. Untinted icons are a v2 option.
- **Size.**
  - Button: `ButtonDefaults.iconSizeFor(scale.height)` and `iconSpacingFor(scale.height)`, with
    `contentPaddingFor(height, hasStartIcon = true)`.
  - IconButton: `IconButtonDefaults.{extraSmall…extraLarge}IconSize` = 20/24/24/32/40 dp.
  - Menu rows: Material's 24 dp leading icon.
  - Chip: `FilterChipDefaults.IconSize`, 18 dp.
- **Sizing key.** `androidIcon` joins `systemImage` in every key that already holds `systemImage`. A missing icon and
  no icon measure the same and then share a size, which is correct.

### C2. Where it applies, in order

1. **Button**, as the leading icon. With it come **Menu's trigger**, which is `NitroUiM3Button`, and **IconButton**
   (G-A).
2. **ButtonGroup items**, from the first build (G-B).
3. **Menu and ContextMenu rows**: `MenuRow`'s `leadingIcon` and the `NitroUiMenuRow` struct gain `androidIcon:
   string | null`. Also **SplitButton**'s leading half once E3 has merged, and **Chip**: an assist chip's leading
   icon, or a filter chip's while unselected, where the check takes the slot when selected, through the
   always-present leading slot (`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiChip.kt`). All of this
   is G-C, after E3, because it shares Menu's files.

SegmentedControl's options stay strings, and Picker has no icons, so neither changes.

### C3. How an app ships the drawable (the user-facing docs section)

> ### Android icons
>
> iOS draws `systemImage` from SF Symbols. Android has no system icon set, so you ship the icons you use and name
> them with `androidIcon`:
>
> ```tsx
> <Button title="Share" systemImage="square.and.arrow.up" androidIcon="share" onPress={share} />
> ```
>
> 1. Download the icon as an **Android vector drawable**, for example from Material Symbols (Google Fonts → Icons →
>    pick one → *Android*). You get an `.xml` file.
> 2. **Bare React Native:** put it in `android/app/src/main/res/drawable/`, named in lower case with underscores
>    (`share.xml`), then rebuild the app. JS reloads cannot add resources.
>    **Expo (prebuild / CNG):** *(depends on question C. With option (a):)* put the files in a folder such as
>    `assets/android-icons/` and add `["react-native-nitro-ui/plugin", { "androidIcons": "./assets/android-icons" }]`
>    to `app.json`'s `plugins`. Prebuild copies them into `res/drawable/`. Expo Go cannot load them, so use a
>    development build.
> 3. `androidIcon` is the file name without `.xml`. The icon is tinted to the control's text colour and sized by the
>    control, so any 24 dp vector works.
>
> A name that is not found draws no icon and leaves the control as if `androidIcon` were not set. A warning is logged
> (`adb logcat -s NitroUi`). If your release build shrinks resources (`shrinkResources true`, or Expo's
> `enableShrinkResourcesInReleaseBuilds`), keep the icons. The shrinker cannot see names that come from JavaScript:
>
> ```xml
> <!-- android/app/src/main/res/raw/keep.xml -->
> <resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@drawable/share,@drawable/bold" />
> ```

### C4. IconButton

```ts
export interface IconButtonProps extends ViewProps {
  accessibilityLabel: string;            // REQUIRED: the only name the control has (dev warning when empty)
  systemImage: string;                   // iOS symbol
  androidIcon: string;                   // Android drawable name
  onPress?: () => void;
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined'; // default 'standard' (Material's names)
  size?: 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'; // question D; default 'medium' (S, 40 dp)
  width?: 'narrow' | 'uniform' | 'wide'; // Android only; default 'uniform'
  shape?: ButtonShape | null;            // 'round' | 'square', as Button
  checked?: boolean | null;              // present → a toggle icon button, on the handshake
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  tintColor?: ColorValue;
  testID?: string;
}
```

- **Android.**
  - The component per variant: `IconButton` / `FilledIconButton` / `FilledTonalIconButton` / `OutlinedIconButton`.
    With `checked`, it is the matching `…IconToggleButton(checked, onCheckedChange, shapes, …)`. Every one takes the
    `shapes` overload.
  - Shapes: `IconButtonDefaults.shapes(shape, pressedShape)`, with the per-size `…RoundShape`/`…SquareShape` and
    `…PressedShape`. A toggle takes `toggleableShapes(shape, pressedShape, checkedShape)` with the
    `…SelectedRoundShape`/`…SelectedSquareShape`.
  - Size: `Modifier.size(IconButtonDefaults.{extraSmall…extraLarge}ContainerSize(widthOption))` with
    `IconButtonWidthOption.Narrow/Uniform/Wide`. Containers in dp, from the beta02 tokens (icon + 2 × leading space):

    | Rung | Height | Narrow | Uniform | Wide | Icon |
    | --- | --- | --- | --- | --- | --- |
    | XS (`small`) | 32 | 28 | 32 | 40 | 20 |
    | S (`medium`) | 40 | 32 | 40 | 52 | 24 |
    | M (`large`) | 56 | 48 | 56 | 72 | 24 |
    | L (`xlarge`) | 96 | 64 | 96 | 128 | 32 |
    | XL (`xxlarge`) | 136 | 104 | 136 | 184 | 40 |

  - Material keeps the 48 dp minimum interactive size around the smaller rungs *(reading: to measure)*, so the
    laid-out box is max(container, 48) and Button's ladder behaves the same way.
  - Colours come from `IconButtonDefaults.*IconButtonColors()` / `*IconToggleButtonColors()`, cached per scheme like
    Button's.
- **iOS.**
  - `Button(action:) { Label(accessibilityLabel, systemImage: systemImage) }.labelStyle(.iconOnly)`. With `checked`,
    it is a `Toggle(isOn:) { Label(…) }.toggleStyle(.button)`, Chip's filter control.
  - Variant: `standard` → `.borderless`; `filled` → `.borderedProminent`; `tonal` → `.bordered`; `outlined` →
    `.bordered` plus Button's hairline.
  - Shape: `round` → `.buttonBorderShape(.circle)` (iOS 17; `.capsule` before it); `square` →
    `.roundedRectangle(radius: 8)`.
  - Size: `.controlSize` `.mini`/`.small`/`.regular`/`.large`/`.extraLarge` (iOS 17; `.large` before it). `width`
    has no counterpart and is ignored (documented).
- **Sizing.** `intrinsic`.
  - Key: `variant|size|width|systemImage` on iOS. SF Symbols differ in width, so the symbol is in the key. Android's
    size is fixed per (size, width), and `androidIcon` stays in the key only so the platforms read the same key.
  - Declared fallback: Android 48 × 48 dp (S, uniform), which is exact. iOS is measured on 27.0 by G-A.
  - 0 corrections for the default configuration.
- **Accessibility.**
  - iOS: `Label`'s title is the element's name. A toggle carries the button trait plus the selected state.
  - Android: `semantics { contentDescription = accessibilityLabel }` on the button. A toggle reads `Role.Checkbox`
    and its state through Material's toggleable semantics.
  - `title` does not exist on IconButton, which is why `accessibilityLabel` is required in the type.
- **Tests (each shown red first).**

  | Test | Red proof |
  | --- | --- |
  | box = measure from a poisoned fallback, per size × width (Android) | drop `width` from the key → `narrow` reuses the `uniform` size |
  | the label is read by the a11y tree on both platforms | drop the `contentDescription` → `null` |
  | toggle handshake, tap-twice oracle | drop the event-count gate |
  | missing `androidIcon` → same box as `androidIcon=""`, and no crash | let `painterResource` throw → the harness crashes |
  | a drawn icon on Android uses the content colour (pixel probe at the icon centre, disabled vs enabled) | tint with a constant → the probe colours match |
  | recycle resets `checked` and the cached icon reference | skip the reset → previous icon drawn |
  | the example app ships a test vector drawable named `nitroui_test_star` (and a `layer-list` for the unsupported case) | — |

  **Bench.** `mount.iconbutton`, against an RN `Pressable` + `Image` and `@expo/ui`'s Compose `IconButton`.

## Appendix D — Build order and split

| Task | Scope | Depends on | Machine / parallel |
| --- | --- | --- | --- |
| **G-A** `androidIcon` + IconButton | the shared Kotlin icon resolver/cache (C1); `androidIcon` on Button (+ Menu's trigger through `NitroUiM3Button`); the new IconButton on both platforms; the docs section (C3); test drawables in the example app; question C's plugin if (a) | questions C and D answered | A, now |
| **G-B** ButtonGroup | Appendix B, both platforms, built with `androidIcon` from the start | G-A merged (it edits `NitroUiM3Button` too); question B | A, after G-A |
| **G-C** `androidIcon` on Menu/ContextMenu rows, SplitButton, Chip | C2 item 3 | G-A merged; E3 merged (it is in Menu's files now) | B, in parallel with G-B |

G-B and G-C share no files: `MenuRows.kt` is only read by G-B, and the `ButtonGroup` → `DropdownMenu` rows reuse
`MenuRow` unchanged. E3 is in flight on Menu, which is why G-C waits for it.

**No separate spike.** G-B starts with four checks that can stop it early, as Q7's builds did:
1. **iOS look on 26.5 and 27.1** (question A): the Appendix A probe re-run there, from `docs/tasks/Q9/`.
2. **`labelStyle` inside `ControlGroup`:** does `.labelStyle(.titleAndIcon)` keep titles in a connected group? If not,
   `titleAndIcon` on iOS connected is documented as icons-only.
3. **Material's overflow `DropdownMenu` in our hosts:** it opens anchored to the indicator, inside a plain host and
   inside an Android `<Host>` (H2b's popup rules), under `MaterialExpressiveTheme`. Photograph it.
4. **`ButtonGroup` under `NitroUiMeasuredRoot`:** a `fillWidth` measure at the box width gives a stable height and
   overflow count with no second `measure()` per pass. `ButtonGroupMeasurePolicy` uses intrinsics. Check also that
   `animateWidth`'s press does not re-measure the host (the box must not move on press).

## Appendix E — Method notes

- The material3 facts come from `material3-android` 1.5.0-beta02's `classes.jar` in the Gradle cache, read with
  `javap`.
  - Parameter names come from the Compose source-information strings.
  - Item composables come from the `invokestatic` targets in `ClickableButtonGroupItem` / `ToggleableButtonGroupItem`.
  - Token values come from the `ldc2_w` constants in the `tokens` classes.
- `@expo/ui` 58's Android `Icon` and its `ImageLoader` were read in `node_modules` (no code run): Metro asset, then
  `res/raw`/HTTP, then its own vector-XML parser. That is the source of question C's option (c).
- React Native's `ResourceDrawableIdHelper` was read in `node_modules/react-native` (the RN 0.88 tree this repo
  builds).
