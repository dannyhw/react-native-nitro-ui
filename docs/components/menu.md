# Menu

A button that opens a list of actions: SwiftUI `Menu` on iOS, a Material 3
`DropdownMenu` anchored to the trigger on Android. Both are hosted by the core
runtime (`docs/architecture/core.md`), so the menu's presentation, dismissal, press
feedback and row metrics belong to the platform, not to us.

```tsx
import { Menu } from 'react-native-nitro-ui';

<Menu
  title="Actions"
  group={{
    actions: [{ id: 'duplicate', title: 'Duplicate' }],
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
state is native-owned and observed through `onOpen`/`onClose`; there is no imperative
`open()`/`close()` (DECISIONS D29). The trigger is a Button — same `variant`s, same
`size`s, same box — and the items are data, never child views.

## API

| Prop                 | Type                                  | Default    | Maps to                                                              |
| -------------------- | ------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `title`              | `string`                              | required   | The trigger's label — and the default accessibility label.              |
| `group`              | `MenuGroup`                           | required   | The items: `actions` then `sections`, as data.                          |
| `variant`            | `'filled' \| 'tonal' \| 'outlined' \| 'text' \| 'elevated'` | `'filled'` | Button's variants, on the trigger only.                    |
| `size`               | `'small' \| 'medium' \| 'large'`      | `'medium'` | Button's sizes, on the trigger only.                                    |
| `disabled`           | `boolean \| undefined`                | `false`    | Disables the trigger. An open menu closes.                              |
| `systemImage`        | `string \| undefined`                 | —          | **iOS only.** Leading SF Symbol on the trigger.                         |
| `tintColor`          | `ColorValue \| undefined`             | platform   | SwiftUI `.tint()` / the variant's container colour.                     |
| `onSelect`           | `((id: string) => void) \| undefined` | —          | One call per picked row, with that row's `id`.                          |
| `onOpen`             | `(() => void) \| undefined`           | —          | **Android only** today — see [Open and close](#open-and-close).         |
| `onClose`            | `(() => void) \| undefined`           | —          | **Android only** today — see [Open and close](#open-and-close).         |
| `primaryAction`      | `(() => void) \| undefined`           | —          | **iOS only.** Tap runs it; long-press opens the menu.                   |
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
interface MenuAction   { id: string; title: string; disabled?: boolean; destructive?: boolean; systemImage?: string }
interface MenuSubmenu  { id: string; title: string; systemImage?: string; items: MenuAction[] }
interface MenuSection  { id: string; title?: string; items: MenuAction[] }
```

- `actions` draw first, then `sections`. A group may carry both.
- `id` is required on every row, submenu and section. It is what `onSelect` reports and
  what a test presses, so it must be unique within the menu and stable across renders;
  a re-ordered list keeps each row's identity.
- `title` is optional on a section: a section with no title is just a divider.
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
| Control            | `Menu { rows } label: { ButtonLabel }`, `.menuStyle(.button)` (iOS 16+) plus Button's per-variant `.buttonStyle` | `ExposedDropdownMenuBox { NitroUiM3Button(menuAnchor) ; ExposedDropdownMenu { rows } }` |
| Host               | `UIHostingController` inside `NitroSwiftUIHost`                     | `NitroComposeHost<MenuModel>`: `AbstractComposeView`             |
| Containment        | **required** (`needsContainment`) — the menu is the system's presentation | n/a — the popup is the composition's own window            |
| Popup              | SwiftUI's own menu, presented by the system                          | its own `PopupWindow`, anchored to the trigger's own box          |
| Trigger            | Button's label, Button's `.buttonStyle`, `.menuIndicator(.hidden)`    | Button's M3 button (`NitroUiM3Button`), one semantics node        |
| Rows               | `Button`, `Section`, `Divider`, `Menu` inside `Menu`                 | `DropdownMenuItem`, `HorizontalDivider`, a non-interactive header row |
| Submenu            | **nests** — a real second-level menu                                 | renders its items **inline under a divider**                     |
| Section header     | `Section(header:)`                                                   | a non-interactive header row under a divider                     |
| Destructive row    | `Button(role: .destructive)`                                         | Material 3 error colour                                          |
| Test id            | RN's `testID` → `accessibilityIdentifier`                            | `host.tag` (Compose has no test id)                              |
| Recycle            | hosting controller reused                                            | objects reused; composition disposed and rebuilt (`core.md` §6)  |

## Open and close

Nothing in the props controls whether the menu is open, and `Menu` has no value to be
out of sync with. The menu opens on a trigger press and closes on a pick, an outside
tap, the back gesture, or a `disabled` that arrives while it is open.

| Event         | Fires                                                            | iOS | Android |
| ------------- | ------------------------------------------------------------------ | ------- | --------- |
| `onSelect`    | once per picked row, with that row's `id`                            | yes     | yes       |
| `onOpen`      | when the menu opens                                                 | no      | yes       |
| `onClose`     | when the menu closes, whichever way it closed                        | no      | yes       |
| `primaryAction` | on a trigger press while the menu is closed                          | yes     | no        |

`onOpen`/`onClose` are Android-only in this release, and that is a platform limit
rather than a choice: SwiftUI's `Menu` keeps its own open state, and the iPhoneOS 27.0
SDK gives it no expansion binding — `isExpanded:` exists on `Section`,
`DisclosureGroup` and table rows, not on `Menu`. Our `UIHostingController` therefore
never learns that the system presented the menu, which is the same thing `Picker`
already reports (`docs/components/picker.md`: `-1` for every popup field, never a `0`
that reads as "checked"). The Android popup is our own window, so it can be witnessed:
`onOpen` and `onClose` fire once each per open, including dismissal by outside tap,
back gesture, a pick, or `disabled` arriving while open. **A pick fires `onClose`
before `onSelect`** — the popup closes first, then the choice is reported — so a
listener never sees an open that was never closed. `docs/tasks/Q1-menu-design.md` §5
words the same rule as "never for a pick"; the reading taken here is that what to
refuse is an *unpaired* open, and the pair plus its order is asserted on-device
(`Menu.harness.tsx`, "reports the open and the close"). Whether a pick should fire
`onClose` at all, and in which order, is an open owner decision
(`docs/tasks/G7a-menu.review.md` decision 3).

`primaryAction` is iOS-only (DECISIONS D29) and follows the native idiom: with it set,
a tap runs it and a long-press opens the menu; without it, a tap opens the menu.
Android always opens on tap and never calls it. Setting it is a change of behaviour,
not only of looks, so the wrapper sends a flag rather than an optional function and the
two platforms' triggers differ accordingly.

`disabled` while open closes the menu, as `Picker` and `DatePicker` do
(`docs/components/host.md`): a control that cannot be pressed should not leave its own
window on screen over the rest of the app.

## Inside a `Host`

`Menu` is hostable: inside `<Host>` it is composed by the Host's own composition
(`docs/components/host.md`). Android is where this matters, because there the menu is
the composition's own window and the Host has to keep it honest:

| Situation                                          | Result                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| The Host, or the Menu, is **moved by layout** while open | The menu closes. A window that cannot follow its anchor would sit over the wrong control. A scroll is not a layout move, so an open menu survives one. |
| The Host is dropped or recycled while open           | The composition is disposed, which closes the window.                  |
| iOS                                                | A Host is a passthrough, so the menu is the ordinary system presentation. |

The Android popup hangs off the **trigger's** box, not the composition's. That is a
deliberate departure from `docs/tasks/Q1-menu-design.md` §3, which asks for a
`Modifier.clickable` trigger beside a plain `DropdownMenu`: a plain `DropdownMenu` composes
a `Popup` whose position provider is handed the composition's own view as its anchor, so
the list opens under that view — the control's box while the control owns the
composition, and the whole Host rectangle when it does not. `ExposedDropdownMenuBox` with
`menuAnchor` is the anchor that keeps the list under its own button in both cases, which is
what `Menu` is for; `exposedDropdownSize()` is deliberately not used, because it sizes the
list to the anchor and a menu's list is as wide as its items need. The anchor still reports
through `onGloballyPositioned`, so the witness's `anchor=` rect is the trigger's box in
composition space, and dismissal on a layout move is H2b's, unchanged.

## Sizing

`intrinsic`, and the box is the trigger's: `group` never changes it. The sizing key is
Button's — `variant|size|systemImage|title` — for the same reason (`docs/components/button.md`).
`disabled` and `tintColor` repaint; `group` is deliberately not in the key, because the
items live in a popup and free-form text in a key fragments the cache.

### Measured

`example/__tests__/Menu.harness.tsx` renders one Menu per configuration with a poisoned
size cache — `title="Variant"` at `medium` for the variants, `title="Sized"` at `filled`
for the sizes. iPhone 17 / iOS 27 in pt, an API 35 emulator at 420 dpi in dp:

| Configuration |           iOS |     Android |
| ------------- | --------------- | --------------- |
| `filled`      | 77.33 × 34.33 | 92.57 × 48.00 |
| `tonal`       | 77.33 × 34.33 | 92.57 × 48.00 |
| `outlined`    | 77.33 × 34.33 | 92.57 × 48.00 |
| `elevated`    | 77.33 × 34.33 | 92.57 × 48.00 |
| `text`        | 53.33 × 20.33 | 68.95 × 48.00 |
| `small`       | 58.00 × 28.00 | 57.90 × 48.00 |
| `large`       | 82.00 × 50.33 | 108.57 × 50.29 |

The heights are Button's three heights — iOS 28.0 / 34.3 / 50.3 and Android 48.0 / 48.0 /
50.3 (`docs/components/button.md`) — which is the claim being checked: the trigger is
Button's label with Button's chrome, and the widths differ only because these fixtures
carry other titles. Android's `text` is narrower than the other four because Material's
text button carries less horizontal padding, which is what Button does there too. On iOS
the four boxed variants collapse to one pair because SwiftUI's `.bordered` and
`.borderedProminent` give the same box; `text` is `.borderless`, so it is a text box.

Getting those numbers needed one fix: `.menuStyle(.button)` makes the label a button but
leaves that button's *style* the automatic one, and the trigger measured 53.33 × 20.33 —
the title's text box — for every variant. iOS now applies the same per-variant
`.buttonStyle` Button picks (`ios/components/Menu/HybridNitroUiMenu.swift`).

**The fallback.** One pair per component, Button-sized and deliberately not any fixture's
measured size, because a fallback equal to the answer hides a correction that never
arrived (`docs/tasks/X4-conformance.md`): `74 × 38` pt
(`ios/components/Menu/HybridNitroUiMenu.swift`) and `118 × 52` dp
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

While the menu is open the rows are reachable and speak their own titles; a destructive
row is announced as such on iOS, and a disabled row is not focusable. The popup's rows
are the platform's own elements — we do not re-label them.

## Limits

- **`onOpen`/`onClose` are Android-only** in this release, for the SDK reason above. Do
  not build app state on them if iOS has to agree; use `onSelect`.
- **No submenus on Android.** A submenu's items appear inline under a divider, in place.
  Ask for a submenu only where that is acceptable, and expect a flat list there — the
  same kind of documented split as `Picker`'s iOS-only `wheel`.
- **`systemImage` is iOS-only** on both the trigger and the rows, as it is on `Button`.
- **`primaryAction` is iOS-only**, and changes what a tap does there.
- The menu is the platform's, so its look is the platform's. Beyond `tintColor` there is
  no row styling, no per-row icon on Android, and no way to place the popup.
- Whether Button's `.buttonStyle` reaches an iOS menu's **rows** is unverified here.
  `docs/tasks/G2-button.report.md` measured that the harness's synthesised `UITouch` is
  rejected by SwiftUI's `Button` gesture environment "in all four styles this control
  uses", and that an `agent-device` HID-level tap changed no app state at all; this
  task's iOS runs likewise never got a `Menu` open (the events test delivers a press and
  asserts the `-1` answer instead). So the trigger's box is measured and the open list is
  not. It is on G7b's real-input list, and if the rows turn out to carry button chrome the
  fix is one `.buttonStyle(.plain)` on the row content.
- One submenu level, and no nesting of sections. No checkmarks, no per-row state —
  a menu reports a pick and forgets it, which is the point of having no value.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
