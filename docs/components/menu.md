# Menu

A button that opens a list of actions: SwiftUI `Menu` on iOS, a Material 3
Expressive menu (`DropdownMenuPopup` and its groups) anchored to the trigger on
Android. Give it a `primaryAction` and the trigger grows that platform's own answer to
"one control, two jobs": iOS keeps one button where a tap acts and a long-press opens,
Android draws Material 3's split button, half action and half list. Both are hosted by the core
runtime (`docs/architecture/core.md`), so the menu's presentation, dismissal, press
feedback and row metrics belong to the platform, not to us.

```tsx
import { Menu } from 'react-native-nitro-ui';

<Menu
  title="Actions"
  group={{
    actions: [
      { id: 'duplicate', title: 'Duplicate', subtitle: 'Keeps the original' },
      { id: 'pin', title: 'Pinned', checked: pinned },
    ],
    sections: [
      {
        id: 'dangerous',
        title: 'Dangerous',
        items: [{ id: 'delete', title: 'Delete', destructive: true }],
      },
    ],
  }}
  onSelect={(id) => run(id)}
/>;
```

`Menu` is `Button`'s sibling, not `Picker`'s: a menu has **no value**, so there is no
controlled prop and no event-count handshake (`docs/architecture/core.md` §12). Open
state is native-owned and observed through `onOpen`/`onClose` — on Android; iOS never
fires either one (DECISIONS D32) — and there is no imperative `open()`/`close()`
(DECISIONS D29). The trigger is a Button — same `variant`s, same `size`s, same box — and
the items are data, never child views.

## API

| Prop                 | Type                                  | Default    | Maps to                                                              |
| -------------------- | ------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `title`              | `string`                              | required   | The trigger's label — and the default accessibility label.              |
| `group`              | `MenuGroup`                           | required   | The items: `actions` then `sections`, as data.                          |
| `variant`            | `'filled' \| 'tonal' \| 'outlined' \| 'text' \| 'elevated'` | `'filled'` | Button's variants, on the trigger only.                    |
| `size`               | `'small' \| 'medium' \| 'large'`      | `'medium'` | Button's sizes, on the trigger only.                                    |
| `disabled`           | `boolean \| undefined`                | `false`    | Disables the trigger. An open menu closes — Android; see [Open and close](#open-and-close). |
| `systemImage`        | `string \| undefined`                 | —          | **iOS only.** Leading SF Symbol on the trigger.                         |
| `tintColor`          | `ColorValue \| undefined`             | platform   | SwiftUI `.tint()` / the variant's container colour.                     |
| `onSelect`           | `((id: string) => void) \| undefined` | —          | One call per picked row, with that row's `id`; on a pick it fires **before** `onClose`. |
| `onOpen`             | `(() => void) \| undefined`           | —          | **Android only** — iOS never fires it: [Open and close](#open-and-close). |
| `onClose`            | `(() => void) \| undefined`           | —          | **Android only** — iOS never fires it: [Open and close](#open-and-close). |
| `primaryAction`      | `(() => void) \| undefined`           | —          | A second job for the trigger: iOS taps run it and long-press opens; Android draws a split button. [Primary action](#primary-action). |
| `style`              | `ViewStyle`                           | —          | Overrides the measured box (see Sizing).                                |
| `testID`             | `string \| undefined`                 | —          | iOS: RN's `accessibilityIdentifier`. Android: the host `View.tag`.      |
| `accessibilityLabel` | `string \| undefined`                 | —          | Names the trigger; the rows keep their own names.                       |
| `hybridRef`          | `(view: handle) => void`              | —          | **Internal.** Read-only handle for this repo's harness and benchmarks.  |
| `nuiPerfId`          | `number \| null \| undefined`         | `null`     | **Internal.** Instance id for perf marks; `null` disables marks.        |

`style` is `Button`'s: because a Menu sizes itself, the wrapper starts from
`alignSelf: 'flex-start'` so the control takes its own box rather than the parent's
width unless the app asks for one.

### The group

```ts
interface MenuGroup    { actions?: (MenuAction | MenuSubmenu)[]; sections?: MenuSection[] }
interface MenuAction   { id: string; title: string; disabled?: boolean; destructive?: boolean; systemImage?: string;
                         subtitle?: string | null; checked?: boolean | null }
interface MenuSubmenu  { id: string; title: string; systemImage?: string; items: MenuAction[] }
interface MenuSection  { id: string; title?: string; items: MenuAction[] }
```

- `actions` draw first, then `sections`. A group may carry both.
- `id` is required on every row, submenu and section. It is what `onSelect` reports and
  what a test presses, so it must be unique within the menu and stable across renders;
  a re-ordered list keeps each row's identity.
- `title` is optional on a section: a section with no title is its rows as a group of
  their own, with no header (iOS draws it as a `Section` with no header — see G9 below;
  Android as a Material group with no label).
- `subtitle` is a second, smaller line under a row's title: iOS `UIAction.subtitle`
  (a second `Text` in the row's label), Android the row's supporting text. `null`,
  `''` or absent draws none.
- `checked` makes a row checkable: `true` draws it checked, `false` unchecked, `null`
  or absent is a plain row. iOS makes the row a menu `Toggle` (`UIAction.state`, the
  leading check); Android a `CheckableDropdownMenuItem`, which draws a checked row
  selected with a leading check and announces it as a checkbox. **The menu still has
  no value**: picking a checkable row reports its `id` through `onSelect`, exactly like
  any other row, and the check is whatever the app sends next — flip your own state in
  `onSelect`. Nothing is toggled locally.
- A submenu holds actions only. Depth stops at one level — the public type cannot
  express a submenu inside a submenu, and the wrapper has nothing to normalise into.
- An empty `group` renders a trigger that opens nothing.

The wrapper flattens the nested `group` into one ordered array of typed structs
(`NitroUiMenuRow`, with `parentId` naming the parent row) and hands native an **array
identity that only changes when the menu it describes changes** — a caller who writes
`group={{ actions: [...] }}` inline pays one string build per render instead of a
re-conversion of the struct array (`docs/research/nitro-patterns.md`).

## Platform mapping

| Concept            | iOS                                                              | Android                                                     |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Control            | `Menu { rows } label: { ButtonLabel }`, `.menuStyle(.button)` (iOS 16+) plus Button's per-variant `.buttonStyle` | `Box { NitroUiM3Button ; DropdownMenuPopup(rememberDropdownMenuPopupPositionProvider(Below)) { groups } }` (Material 3 Expressive) |
| Host               | `UIHostingController` inside `NitroSwiftUIHost`                     | `NitroComposeHost<MenuModel>`: `AbstractComposeView`             |
| Containment        | **required** (`needsContainment`) — the menu is the system's presentation | n/a — the popup is the composition's own window            |
| Popup              | SwiftUI's own menu, presented by the system                          | its own `PopupWindow`, anchored to the trigger's own box          |
| Trigger            | Button's label, Button's `.buttonStyle`, `.menuIndicator(.hidden)`    | Button's M3 button (`NitroUiM3Button`), one semantics node        |
| Rows               | `Button`, `Toggle` (a `checked` row), `Section`, `Menu` inside `Menu` | `DropdownMenuItem(shape = MenuDefaults.itemShape(…))`, `CheckableDropdownMenuItem` (a `checked` row) |
| Groups             | a `Section` is an inline `UIMenu`, set off by UIKit's separator      | each section, each submenu and each run of top-level actions is a `DropdownMenuGroup`, spaced by `MenuDefaults.GroupSpacing` and shaped by `MenuDefaults.groupShape` — no dividers |
| Submenu            | **nests** — a real second-level menu                                 | renders its items **inline, as a group** titled with the submenu's title |
| Section header     | `Section(header:)`; an untitled section is `Section` with **no** header | `MenuDefaults.DropdownMenuGroupLabel`, a heading; none when untitled |
| Subtitle           | a second `Text` in the row's label → `UIAction.subtitle`              | `supportingText`                                                  |
| Checked            | `Toggle` → `UIAction.state` `.on` / `.off`                            | `CheckableDropdownMenuItem(checked)`: selected container and leading check, `Role.Checkbox` + `selected` |
| Primary action     | the other `Menu` init — tap runs it, `primaryAction` long-press opens | `SplitButtonLayout(leadingButton, trailingButton)`: the leading half runs it, the trailing half (`SplitButtonDefaults.*TrailingButton(checked = open)`) opens the list |
| Destructive row    | `Button(role: .destructive)`                                         | Material 3 error colour                                          |
| Test id            | RN's `testID` → `accessibilityIdentifier`                            | `host.tag` (Compose has no test id)                              |
| Recycle            | hosting controller reused                                            | objects reused; composition disposed and rebuilt (`core.md` §6)  |

## Open and close

Nothing in the props controls whether the menu is open, and `Menu` has no value to be
out of sync with. The menu opens on a trigger press and closes on a pick, an outside
tap, the back gesture, or a `disabled` that arrives while it is open — the last of
these on Android only, for the reason given below.

| Event         | Fires                                                            | iOS | Android |
| ------------- | ------------------------------------------------------------------ | ------- | --------- |
| `onSelect`    | once per picked row, with that row's `id`; on a pick it fires before `onClose` | yes | yes |
| `onOpen`      | when the menu opens                                                 | never   | yes       |
| `onClose`     | when the menu closes, whichever way it closed                        | never   | yes       |
| `primaryAction` | iOS: a trigger press while the menu is closed. Android: a press on the leading half of the split trigger | yes     | yes       |

`onOpen`/`onClose` are Android-only, and that is a platform limit rather than a choice:
SwiftUI's `Menu` keeps its own open state, and the iPhoneOS 27.0 SDK gives it no
expansion binding — `isExpanded:` exists on `Section`, `DisclosureGroup` and table rows,
not on `Menu`. Our `UIHostingController` therefore never learns that the system presented
the menu, which is the same thing `Picker` already reports (`docs/components/picker.md`:
`-1` for every popup field, never a `0` that reads as "checked"). iOS never fires either
one (DECISIONS D32). The Android popup is our own window, so it can be witnessed:
`onOpen` and `onClose` fire once each per open, including dismissal by outside tap, back
gesture, a pick, or `disabled` arriving while open. **A pick fires `onSelect` first and
`onClose` after it** — the choice is reported, then the window comes down — so a listener
that acts on the pick never does so while the menu is still up, and never sees an open
that was never closed (DECISIONS D32). `docs/tasks/Q1-menu-design.md` §5 worded the pair
as "never for a pick"; D32 supersedes that, and the pair plus its order is asserted
on-device (`Menu.harness.tsx`, "opens once, closes once, and pairs every open with a
close") and off-device (`android/src/test/java/com/margelo/nitro/nitroui/MenuModelTest.kt`).

`primaryAction` is reported by whichever half of the control is asked to act, and it
never opens the list — see [Primary action](#primary-action).

`disabled` while open closes the menu on Android, as `Picker` and `DatePicker` do
(`docs/components/host.md`): a control that cannot be pressed should not leave its own
window on screen over the rest of the app. The popup is our window there, so we can
close it and report it. **On iOS this is neither enforced nor observable** — SwiftUI
owns the presentation, `.disabled(true)` on a `Menu` is not documented to dismiss one
that is open, and we get no signal that one is open to act on. Nothing checks that an
iOS menu goes away when it is disabled while open, and nothing would notice if it did
not. DECISIONS D32 accepts that as a platform limit, so read DECISIONS D29's rule as
Android-side.

## Primary action

A control with both a default action and a list is a real thing in both toolkits, and
neither copies the other. `primaryAction` asks for it; each platform answers in its own
idiom (DECISIONS D29, which shipped this iOS-only, and E3, which added Android):

|                       | iOS                                                                       | Android                                                                                     |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Trigger               | unchanged: one button, the same box                                            | Material 3's split button: two containers, wider than the plain trigger                        |
| Runs `primaryAction`  | a tap, while the menu is closed                                              | a press on the leading half, which shows `title`                                               |
| Opens the list        | a long-press                                                                 | a press on the trailing half, which shows a chevron                                            |
| Open state on the control | not observable (D32)                                                     | the trailing half's `checked` state, so its inner corner stays morphed while the list is up    |
| Screen reader         | the one trigger, named by `accessibilityLabel`/`title`                       | two stops: a button named by the title, then a button named "More options" that says expanded/collapsed |
| `disabled`            | disables the trigger; an open menu is SwiftUI's to keep (D32)                 | disables **both** halves, and an open list closes                                              |

Two rules hold on both platforms, so an app does not have to branch: a press that runs
`primaryAction` never opens the list and never fires `onOpen`, and it is refused while
`disabled` is set. `onOpen`/`onClose` still pair up exactly once per open, whoever
caused it.

**Android's variant mapping.** Material has four split-button sets and Menu has five
trigger variants, so one variant has no set of its own:

| `variant`    | Split button drawn                                                          |
| ------------ | ---------------------------------------------------------------------------- |
| `filled`     | `SplitButtonDefaults.{LeadingButton,TrailingButton}`                           |
| `tonal`      | `SplitButtonDefaults.{TonalLeadingButton,TonalTrailingButton}`                  |
| `outlined`   | `SplitButtonDefaults.{OutlinedLeadingButton,OutlinedTrailingButton}`            |
| `elevated`   | `SplitButtonDefaults.{ElevatedLeadingButton,ElevatedTrailingButton}`            |
| `text`       | the **outlined** pair                                                          |

`text` is the documented odd one: a split button is two containers, and the text variant
has none to split, so a `variant="text"` Menu that grows a `primaryAction` gains a
container and a hairline. That is more honest than silently drawing the filled set, and
it is what `MenuSplitVariant` stands for rather than a `when` inside the composable.

**Sizes.** The split trigger reads Material's own split-button ladders where they exist
and E1's rung everywhere they agree:

| Split button input                                            | Read at                       |
| ------------------------------------------------------------- | ------------------------------- |
| `SplitButtonDefaults.leadingButtonShapesFor` / `…Trailing…`     | `ButtonScale.layoutHeight` — the box actually drawn, never below the 48 dp touch target |
| `SplitButtonDefaults.{leading,trailing}ButtonContentPaddingFor` | `ButtonScale.height`            |
| `SplitButtonDefaults.trailingButtonIconSizeFor` (the chevron)   | `ButtonScale.height`            |
| the label's type size                                            | Button's `buttonLabelStyle(scale)` |
| the halves' height floor                                         | `heightIn(min = ButtonScale.layoutHeight)` on the layout |

That last row is why the two look like one control. Material turns the minimum
interactive component size *off* inside the halves and tells the caller to "enforce it on
the parent instead"; its own parent's version only grows the outer box, so left alone
both halves would rest at the rung's container height — 40 dp at `small` and `medium` —
inside a 48 dp box, and a split trigger would sit shorter than the plain trigger it
replaced. The floor is therefore enforced on the layout, at the same number E1's ladder
uses.

The chevron is drawn, not imported: it is the geometry of Material's
`Icons.Filled.ExpandMore` written out as an inline `ImageVector`, the same choice
`ChipLeadingCheck` and `MenuRows.kt` record — the library bundles no icon set (D40 item
2). It turns half a turn while the list is up, on `MaterialTheme.motionScheme`'s own
effects spec rather than a duration written here.

**Setting it is a size statement.** `primaryAction` is in Menu's sizing key, as
`action`/`plain`, because on Android the second container really does make the box
wider — see [Sizing](#sizing).

## Inside a `Host`

`Menu` is hostable: inside `<Host>` it is composed by the Host's own composition
(`docs/components/host.md`). Android is where this matters, because there the menu is
the composition's own window and the Host has to keep it honest:

| Situation                                          | Result                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| The Host, or the Menu, is **moved by layout** while open | The menu closes. A window that cannot follow its anchor would sit over the wrong control. A scroll is not a layout move, so an open menu survives one. |
| The Host is dropped or recycled while open           | The composition is disposed, which closes the window.                  |
| iOS                                                | A Host is a passthrough, so the menu is the ordinary system presentation. |

The Android popup hangs off the **trigger's** box, not the composition's. Since E2 the
popup is Material 3 Expressive's `DropdownMenuPopup`, which is placed by a position
provider (`MenuDefaults.rememberDropdownMenuPopupPositionProvider(MenuAnchorPosition.Below)`)
against the layout it is composed in — and the trigger and the popup share one `Box` whose
only measured child is the trigger, so that layout *is* the trigger's box. Until E2 the
same job was `ExposedDropdownMenuBox` with `menuAnchor` (G7b), which Expressive does not
use for a menu. The popup's width is Material's own content sizing: no narrower than a
row's 112 dp floor, and no wider than a row's 280 dp cap plus its 4 dp inset on each side;
a group label (`DropdownMenuGroupLabel`) carries the same cap. The list stays aligned with
the trigger's start edge, so it opens under its trigger in either direction. The anchor
still reports through `onGloballyPositioned`, so the witness's `anchor=` rect is the
trigger's box in composition space, and dismissal on a layout move is H2b's, unchanged.

The failure mode the anchor is here to prevent — a plain `DropdownMenu` opening its list
under the whole Host rectangle instead of under the button — is **Material's documented
behaviour, not something this repo has observed**. G7b round 1 tried to reproduce it four
ways inside a `<Host>` (the anchor dropped inside the box, a `clickable` + `DropdownMenu`,
that pair inside a `fillMaxSize` Box, and this list offset 300 dp) and the hosted test read
the popup at the trigger in every case; round 1 did not record how that last offset was
applied, which is why the fix round ran a mutant that moves the window for certain: a plain
`DropdownMenu(offset = DpOffset(0.dp, 64.dp))`. That one moved the popup's window from 16 px
below the anchor's bottom to 168 px, and `Menu.harness.tsx`'s `gap < 48` went red — so the
guard is proven able to catch a moved popup, and the sentence above stays the reason for the
*API* choice rather than an observed failure (`docs/tasks/G7b-menu-finish.report.md`).

## Sizing

`intrinsic`, and the box is the trigger's: `group` never changes it. The sizing key is
Button's with one field added — `variant|size|action|systemImage|title`, where `action`
is `'action'` when `primaryAction` is set and `'plain'` when it is not — for the same
reason (`docs/components/button.md`). `disabled` and `tintColor` repaint; `group` is
deliberately not in the key, because the items live in a popup and free-form text in a
key fragments the cache. `action` is in it because on Android it chooses the *layout*: a
split button is two containers and a gap, so it is wider than the single button it
replaces, and the two configurations cannot share a cache entry. iOS ignores the field —
its `primaryAction` changes a gesture, not a box — and pays one extra cache entry per
`(variant, size, systemImage, title)` pair for the simpler key.

### Measured

`example/__tests__/Menu.harness.tsx` renders one Menu per configuration with a poisoned
size cache — `title="Variant"` at `medium` for the variants, `title="Sized"` at `filled`
for the sizes. iPhone 17 / iOS 27 in pt, an API 35 emulator at 420 dpi in dp:

| Configuration |           iOS |     Android |
| ------------- | --------------- | --------------- |
| `filled`      | 77.33 × 34.33 | 76.57 × 48.00 |
| `tonal`       | 77.33 × 34.33 | 76.57 × 48.00 |
| `outlined`    | 77.33 × 34.33 | 76.57 × 48.00 |
| `elevated`    | 77.33 × 34.33 | 76.57 × 48.00 |
| `text`        | 53.33 × 20.33 | 68.95 × 48.00 |
| `small`       | 58.00 × 28.00 | 58.67 × 48.00 |
| `large`       | 82.00 × 50.33 | 88.76 × 56.00 |
| `filled` + `primaryAction` | 77.33 × 34.33 | SPLIT_ANDROID_SIZE |

The last row is E3's configuration: `title="Publish"` is its own fixture, so it is not
comparable with the rows above, and the claim in it is the *pair* of columns. iOS answers
the same box as `filled` with no `primaryAction`, because the prop is a gesture there and
no layout; Android is wider than the plain trigger of the same title, which is the whole
reason `action` is a field of the sizing key. `Menu.harness.tsx` ("earns its own box,
which is not the plain trigger's") poisons both entries and compares the two boxes, so a
key that lost the field goes red on whichever configuration mounted second.

The heights are Button's three heights — iOS 28.0 / 34.3 / 50.3 and Android 48.0 / 48.0 /
56.0 (`docs/components/button.md`) — which is the claim being checked: the trigger is
Button's label with Button's chrome, and the widths differ only because these fixtures
carry other titles. Android's `text` is narrower than the other four because Material's
text button carries less horizontal padding, which is what Button does there too. On iOS
the four boxed variants collapse to one pair because SwiftUI's `.bordered` and
`.borderedProminent` give the same box; `text` is `.borderless`, so it is a text box.

Only the Android column moved since this table was first taken, and it moved with
`docs/components/button.md`: the trigger *is* the shared `NitroUiM3Button`, so E1's size
ladder — Material's own `contentPaddingFor`/`textStyleFor`/`shapesFor` per rung instead
of hand-rolled padding — took 16 dp off the four boxed variants (92.57 → 76.57), took
19.8 off `large` and gave it the M token's 56 dp instead of 50.29, and left `text` at
68.95 because that rung's padding was already Material's. `small` gained 0.77
(57.90 → 58.67) from the XS rung's label style. The iOS column was not re-measured and
does not need it: the only iOS file that pass touched is
`ios/components/Button/HybridNitroUiButton.swift`, and this trigger is E2's own SwiftUI,
which applies `.buttonStyle(.bordered)`/`.borderedProminent`/`.borderless` directly and
never reaches that file.

Getting those numbers needed one fix: `.menuStyle(.button)` makes the label a button but
leaves that button's *style* the automatic one, and the trigger measured 53.33 × 20.33 —
the title's text box — for every variant. iOS now applies the same per-variant
`.buttonStyle` Button picks (`ios/components/Menu/HybridNitroUiMenu.swift`).

**The fallback.** One pair per component, Button-sized and deliberately not any fixture's
measured size, because a fallback equal to the answer hides a correction that never
arrived (`docs/tasks/X4-conformance.md`): `74 × 38` pt
(`ios/components/Menu/HybridNitroUiMenu.swift`) and `75.1 × 52` dp
(`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiMenu.kt`). Each sizing row
above is poisoned first, so the test asserts the box is neither the planted size nor this
pair.

## Recycling and cleanup

`RecyclableView`: on Android a recycle's `reset()` clears `expanded` before the rows and
the trigger, so a reused control cannot reopen with the previous instance's menu. iOS has
no open state of ours to clear — the system owns the presentation — so its reset covers
the title, the rows and the flags only.
`onDropView` drops the callbacks and — on Android — disposes the composition, which is
what closes the window (Q1 §5). A menu left open across a drop is the leak this catches.

## Accessibility

The trigger is one a11y element named by `accessibilityLabel`, falling back to `title`;
`accessibilityLabel` is applied only when set, so an unset label does not shadow the
title. On Android the trigger carries a single node built with `clearAndSetSemantics`
(`contentDescription`, `SemanticsProperties.Text`, `stateDescription`,
`role = Role.DropdownList`, `onClick`/`disabled()`), which is what makes
`uiautomator dump` report one named node instead of a named one beside a nameless one
(the G6 lesson, applied as it was applied to `Picker`).

What this release can show, per platform:

- **iOS** — the harness' a11y walk finds an element named `accessibilityLabel` at the
  trigger's box, and that is asserted (`example/__tests__/Menu.harness.tsx`). Two
  measurements say how far that reaches. Deleting the SwiftUI `.accessibilityLabel` from
  the trigger leaves the query answering: the element it lands on is the one React Native
  makes for the view, and RN puts `accessibilityLabel` on the component view itself, so
  the assertion holds that the prop reaches React Native's component view at the
  trigger's box, not the name VoiceOver reads. That view is not an accessibility element,
  so the name a reader gets comes from the SwiftUI modifier, and the harness cannot see
  that (a reading of the harness' UIKit-only query). What does see it is the real-input
  case: `testRealInputMenu` reads the *hosted* control's node out of the XCUITest tree —
  after asserting its identifier differs from the React Native wrapper's, so reading the
  wrapper cannot pass — and pins its name to `accessibilityLabel`. Removing
  `.accessibilityLabel` from `MenuContent.body` makes that run red with
  `("Actions") is not equal to ("Real-input menu")`: the control falls back to its own
  title, which is exactly what a VoiceOver user would hear. A `title` fallback is not
  observable through the harness at all: a trigger with no `accessibilityLabel` answers no
  node for its title on iOS, and on Android the query answers `null` for every Compose
  control.
- **Android** — the label reaching the control is what is asserted, and nothing more:
  Compose publishes `SemanticsNode`s rather than Views, so the harness' View walk answers
  `null` however correct the component is (`example/__tests__/Slider.harness.tsx`
  documents that asymmetry with its measurements). Reading the semantics tree is
  `uiautomator dump`, which is the harness' `realInput` mode, and G7b's.

What real input has since seen (G7b), and what it still has not. A real finger tap does
open both presentations, so the paragraph below is no longer the whole story:

- **iOS** (`testRealInputMenu`, XCUITest) — the tap opens the presentation, the three rows
  are in the tree while it is up, a pick reports `onSelect` alone, and the row the group
  disables reports nothing while its enabled twin, pressed the same way, does. The same run
  writes a screenshot that settles one styling question: the trigger's `.buttonStyle` does
  not follow the rows into the list (three plain system rows under a tinted capsule), so
  nothing had to be added to the row content.
- **Android** (`CHECKS.menu`, `uiautomator dump`) — the tap opens one popup window, all
  three rows are in its tree as `TextView`s, a pick closes it, and the echo proves the
  order `onOpen`, `onSelect`, `onClose` (D32). The disabled row refuses the pick, and the
  dump says why that is not an announcement: all three rows, that one included, report
  `enabled="true"`. Behaviour and announcement are separate questions here; the announcement
  is filed in `docs/tasks/FOLLOWUPS.md` rather than guessed at.

Still a **reading**, not a measurement: that a destructive row is announced as such on iOS,
that rows are announced in a particular order, and what TalkBack says aloud about a disabled
row. The popup's rows are the platform's own elements — we do not re-label them — so hearing
that list with VoiceOver and TalkBack remains a human pass.

## Limits

- **`onOpen`/`onClose` are Android-only** — iOS never fires either one, for the SDK
  reason above (DECISIONS D32). Do not build app state on them if iOS has to agree; use
  `onSelect`.
- **A `disabled` that arrives while the menu is open closes it on Android only.** On
  iOS it is neither enforced nor observable, for the same SDK reason — so an iOS menu
  can stay on screen over a disabled trigger (D32 accepts this as a platform limit). Do
  not rely on it going away.
- **No submenus on Android.** A submenu's items appear inline as a group, in place.
  Ask for a submenu only where that is acceptable, and expect a flat list there — the
  same kind of documented split as `Picker`'s iOS-only `wheel`.
- **`systemImage` is iOS-only** on both the trigger and the rows, as it is on `Button`.
- **`primaryAction` is drawn differently on each platform, and it is a size statement on
  one of them.** iOS keeps one button and a gesture per job; Android draws two containers
  and is wider for it. Neither fires `onOpen` from the action half.
- The menu is the platform's, so its look is the platform's. Beyond `tintColor` there is
  no row styling, no per-row icon on Android, and no way to place the popup.
- Button's `.buttonStyle` does **not** reach an iOS menu's rows — measured, no longer open. G7b's
  real-input case (`testRealInputMenu`) opens the menu with a real finger press and writes a
  screenshot mid-presentation: three plain system rows under a tinted capsule, so the trigger's
  chrome stops at the trigger and no `.buttonStyle(.plain)` was needed on the row content. (What
  G2 measured still holds for the *harness*: its synthesised `UITouch` never opened a `Menu` in any
  style, which is why this answer came from XCUITest rather than from a harness test.)
- An untitled section must have **no** header on iOS, not an empty-looking one: G9 found that
  a `Section` whose header was `Divider()` is built by SwiftUI as an inline `UIMenu` with no
  children, so every row of an untitled group was missing on iOS. `Menu.harness.tsx`'s "draws
  every row of an untitled group" reads the `UIMenu` UIKit actually built (through the
  test-only `nuiTestMenuProbe`, which opens the menu with `performPrimaryAction()` and closes
  it) and holds the rows and their roles (`G9-ios-menu-untitled-group.report.md`).
- One submenu level, and no nesting of sections. A `checked` row draws the check the
  app sent and reports a pick like any row; the menu keeps no per-row state of its own,
  which is the point of having no value.
- **A checkable row is not drawn destructive on iOS.** SwiftUI's `Toggle` takes no
  role, so `destructive` on a row with a `checked` is ignored there; Android still
  draws it in the error colour.
- **An unchecked row reads the same as a plain one on iOS.** UIKit gives a toggle that
  is off and a plain action the same `.off` state; on Android a `checked: false` row is
  announced as an unchecked checkbox.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
