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
| Control            | `Menu { rows } label: { ButtonLabel }`, `.menuStyle(.button)` (iOS 16+) | `Box { trigger; DropdownMenu(expanded, onDismissRequest) { rows } }` |
| Host               | `UIHostingController` inside `NitroSwiftUIHost`                     | `NitroComposeHost<MenuModel>`: `AbstractComposeView`             |
| Containment        | **required** (`needsContainment`) — the menu is the system's presentation | n/a — the popup is the composition's own window            |
| Popup              | SwiftUI's own menu, presented by the system                          | its own `PopupWindow`, anchored under the trigger                |
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
back gesture, a pick, or `disabled` arriving while open.

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

## Sizing

`intrinsic`, and the box is the trigger's: `group` never changes it. The sizing key is
Button's — `variant|size|systemImage|title` — for the same reason (`docs/components/button.md`).
`disabled` and `tintColor` repaint; `group` is deliberately not in the key, because the
items live in a popup and free-form text in a key fragments the cache.

## Recycling and cleanup

`RecyclableView`: a recycle resets the open state first, then the rows, then the
trigger, so a reused control cannot reopen with the previous instance's menu.
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
- One submenu level, and no nesting of sections. No checkmarks, no per-row state —
  a menu reports a pick and forgets it, which is the point of having no value.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
