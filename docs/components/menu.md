# Menu

A button that opens a list of actions: SwiftUI `Menu` on iOS, a Material 3 Expressive menu
(`DropdownMenuPopup` and its groups) anchored to the trigger on Android. With a `primaryAction`
the trigger does two jobs: iOS keeps one button where a tap acts and a long-press opens, Android
draws Material 3's split button, half action and half list. The menu's presentation, dismissal,
press feedback and row metrics belong to the platform.

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

A menu has no value, so there is no controlled prop and no event count. Open state is owned by
native and observed through `onOpen` and `onClose`, which fire on Android only. There is no
imperative `open()` or `close()`. The trigger is a `Button`, with the same `variant`s, `size`s and
box, and the items are data, never child views.

## API

| Prop                 | Type                                                        | Default    | Maps to                                                                                                                              |
| -------------------- | ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `title`              | `string`                                                    | required   | The trigger's label, and the default accessibility label.                                                                            |
| `group`              | `MenuGroup`                                                 | required   | The items: `actions` then `sections`, as data.                                                                                       |
| `variant`            | `'filled' \| 'tonal' \| 'outlined' \| 'text' \| 'elevated'` | `'filled'` | Button's variants, on the trigger only.                                                                                              |
| `size`               | `'small' \| 'medium' \| 'large' \| 'xlarge' \| 'xxlarge'`   | `'medium'` | Button's five sizes, on the trigger only.                                                                                            |
| `disabled`           | `boolean \| undefined`                                      | `false`    | Disables the trigger. On Android an open menu closes; see [Open and close](#open-and-close).                                         |
| `systemImage`        | `string \| undefined`                                       | —          | iOS only. Leading SF Symbol on the trigger.                                                                                          |
| `androidIcon`        | `AndroidIconProp \| undefined`                              | —          | Android only. Leading glyph on the trigger: a `require`'d `.xml` or a drawable name. [The trigger's glyph](#the-triggers-glyph).     |
| `tintColor`          | `ColorValue \| undefined`                                   | platform   | SwiftUI `.tint()` / the variant's container colour.                                                                                  |
| `onSelect`           | `((id: string) => void) \| undefined`                       | —          | One call per picked row, with that row's `id`; on a pick it fires before `onClose`.                                                  |
| `onOpen`             | `(() => void) \| undefined`                                 | —          | Android only; iOS never fires it. [Open and close](#open-and-close).                                                                 |
| `onClose`            | `(() => void) \| undefined`                                 | —          | Android only; iOS never fires it. [Open and close](#open-and-close).                                                                 |
| `primaryAction`      | `(() => void) \| undefined`                                 | —          | A second job for the trigger: iOS taps run it and long-press opens; Android draws a split button. [Primary action](#primary-action). |
| `style`              | `ViewStyle`                                                 | —          | Overrides the measured box (see Sizing).                                                                                             |
| `testID`             | `string \| undefined`                                       | —          | iOS: RN's `accessibilityIdentifier`. Android: the host `View.tag`.                                                                   |
| `accessibilityLabel` | `string \| undefined`                                       | —          | Names the trigger; the rows keep their own names.                                                                                    |
| `hybridRef`          | `(view: handle) => void`                                    | —          | Internal. Read-only handle for this repo's harness and benchmarks.                                                                   |
| `nuiPerfId`          | `number \| null \| undefined`                               | `null`     | Internal. Instance id for perf marks; `null` disables marks.                                                                         |

A Menu sizes itself, so the wrapper's base style is `alignSelf: 'flex-start'`: the control takes
its own box, not the parent's width, unless `style` asks for one.

### The group

```ts
interface MenuGroup {
  actions?: (MenuAction | MenuSubmenu)[];
  sections?: MenuSection[];
}
interface MenuAction {
  id: string;
  title: string;
  disabled?: boolean;
  destructive?: boolean;
  systemImage?: string;
  androidIcon?: AndroidIconProp;
  subtitle?: string | null;
  checked?: boolean | null;
}
interface MenuSubmenu {
  id: string;
  title: string;
  systemImage?: string;
  items: MenuAction[];
}
interface MenuSection {
  id: string;
  title?: string;
  items: MenuAction[];
}
```

- `actions` draw first, then `sections`. A group may carry both.
- `id` is required on every row, submenu and section. It is what `onSelect` reports and what a
  test presses, so it must be unique within the menu and stable across renders.
- `title` is optional on a section. A section with no title is a group of rows with no header.
- `subtitle` is a second, smaller line under a row's title: iOS `UIAction.subtitle`, Android the
  row's supporting text. `null`, `''` or absent draws none.
- `checked` makes a row checkable: `true` draws it checked, `false` unchecked, `null` or absent
  is a plain row. iOS makes the row a menu `Toggle`; Android a `CheckableDropdownMenuItem`, which
  draws a checked row selected with a leading check and announces it as a checkbox. Picking a
  checkable row reports its `id` through `onSelect` like any other row and toggles nothing
  locally: flip your own state in `onSelect` and send the new `checked`.
- `androidIcon` puts a leading glyph beside a row's title, on Android only. It takes the same two
  forms as `Button`'s prop. A submenu's own row has no such prop. See
  [The rows' glyphs](#the-rows-glyphs).
- A submenu holds actions only. Depth stops at one level.
- An empty `group` renders a trigger that opens nothing.

The wrapper flattens the nested `group` into one ordered array of typed structs (`NitroUiMenuRow`,
with `parentId` naming the parent row). The array keeps its identity until the menu it describes
changes, so an inline `group={{ actions: [...] }}` costs one string build per render and no
re-conversion.

## Platform mapping

| Concept         | iOS                                                                                                              | Android                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control         | `Menu { rows } label: { ButtonLabel }`, `.menuStyle(.button)` (iOS 16+) plus Button's per-variant `.buttonStyle` | `Box { NitroUiM3Button ; DropdownMenuPopup(rememberDropdownMenuPopupPositionProvider(Below)) { groups } }` (Material 3 Expressive)                                                |
| Host            | `UIHostingController` inside `NitroSwiftUIHost`                                                                  | `NitroComposeHost<MenuModel>`: `AbstractComposeView`                                                                                                                              |
| Containment     | required (`needsContainment`): the menu is the system's presentation                                             | n/a: the popup is the composition's own window                                                                                                                                    |
| Popup           | SwiftUI's own menu, presented by the system                                                                      | its own `PopupWindow`, anchored to the trigger's own box                                                                                                                          |
| Trigger         | Button's label, Button's `.buttonStyle`, `.menuIndicator(.hidden)`                                               | Button's Material 3 button (`NitroUiM3Button`), one semantics node                                                                                                                |
| Trigger glyph   | `systemImage` → `Image(systemName:)`, `androidIcon` accepted and ignored                                         | `androidIcon` → the same icon slot `Button` draws; on the leading half of a split trigger                                                                                         |
| Rows            | `Button`, `Toggle` (a `checked` row), `Section`, `Menu` inside `Menu`                                            | `DropdownMenuItem(shape = MenuDefaults.itemShape(…))`, `CheckableDropdownMenuItem` (a `checked` row)                                                                              |
| Groups          | a `Section` is an inline `UIMenu`, set off by UIKit's separator                                                  | each section, each submenu and each run of top-level actions is a `DropdownMenuGroup`, spaced by `MenuDefaults.GroupSpacing` and shaped by `MenuDefaults.groupShape`; no dividers |
| Submenu         | nests: a real second-level menu                                                                                  | renders its items inline, as a group titled with the submenu's title                                                                                                              |
| Section header  | `Section(header:)`; an untitled section is `Section` with no header                                              | `MenuDefaults.DropdownMenuGroupLabel`, a heading; none when untitled                                                                                                              |
| Subtitle        | a second `Text` in the row's label → `UIAction.subtitle`                                                         | `supportingText`                                                                                                                                                                  |
| Row glyph       | `systemImage` → `Image(systemName:)`, `androidIcon` accepted and ignored                                         | `androidIcon` → Material's `MenuDefaults.LeadingIconSize` slot, in the row's own content colour                                                                                   |
| Checked         | `Toggle` → `UIAction.state` `.on` / `.off`                                                                       | `CheckableDropdownMenuItem(checked)`: selected container and leading check, `Role.Checkbox` + `selected`                                                                          |
| Primary action  | the other `Menu` init: tap runs it, long-press opens                                                             | `SplitButtonLayout(leadingButton, trailingButton)`: the leading half runs it, the trailing half (`SplitButtonDefaults.*TrailingButton(checked = open)`) opens the list            |
| Destructive row | `Button(role: .destructive)`                                                                                     | Material 3 error colour                                                                                                                                                           |
| Test id         | RN's `testID` → `accessibilityIdentifier`                                                                        | `host.tag` (Compose has no test id)                                                                                                                                               |
| Recycle         | hosting controller reused                                                                                        | objects reused; composition disposed and rebuilt                                                                                                                                  |

## Open and close

No prop controls whether the menu is open. It opens on a trigger press and closes on a pick, an
outside tap, the back gesture, or, on Android only, a `disabled` that arrives while it is open.

| Event           | Fires                                                                                                    | iOS   | Android |
| --------------- | -------------------------------------------------------------------------------------------------------- | ----- | ------- |
| `onSelect`      | once per picked row, with that row's `id`; on a pick it fires before `onClose`                           | yes   | yes     |
| `onOpen`        | when the menu opens                                                                                      | never | yes     |
| `onClose`       | when the menu closes, whichever way it closed                                                            | never | yes     |
| `primaryAction` | iOS: a trigger press while the menu is closed. Android: a press on the leading half of the split trigger | yes   | yes     |

`onOpen` and `onClose` are Android-only because of a platform limit: SwiftUI's `Menu` keeps its
own open state and the iOS SDK gives it no expansion binding (`isExpanded:` exists on `Section`,
`DisclosureGroup` and table rows, not on `Menu`), so the hosting controller never learns that the
system presented the menu. The Android popup is the library's own window: `onOpen` and `onClose`
fire once each per open, including dismissal by outside tap, back gesture, a pick, or `disabled`
arriving while open. A pick fires `onSelect` first and `onClose` after it, so a listener that acts
on the pick never runs while the menu is still up.

`primaryAction` never opens the list; see [Primary action](#primary-action).

`disabled` while open closes the menu on Android, as it does for `Picker` and `DatePicker`: a
control that cannot be pressed does not leave its window over the rest of the app. On iOS SwiftUI
owns the presentation, `.disabled(true)` on a `Menu` is not documented to dismiss an open one,
and nothing signals that one is open, so an open iOS menu may stay on screen over a disabled
trigger.

## Primary action

`primaryAction` gives the trigger a default action beside the list. Each platform draws it in its
own idiom:

|                           | iOS                                                     | Android                                                                                                             |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Trigger                   | unchanged: one button, the same box                     | Material 3's split button: two containers, wider than the plain trigger                                             |
| Runs `primaryAction`      | a tap, while the menu is closed                         | a press on the leading half, which shows `title`                                                                    |
| Opens the list            | a long-press                                            | a press on the trailing half, which shows a chevron                                                                 |
| Open state on the control | not observable                                          | the trailing half's `checked` state, so its inner corner stays morphed while the list is up                         |
| Screen reader             | the one trigger, named by `accessibilityLabel`/`title`  | two stops: a button named by the title, then a button named "More options" that says expanded/collapsed and toggles |
| `disabled`                | disables the trigger; an open menu is SwiftUI's to keep | disables both halves, and an open list closes                                                                       |

On Android the trailing half toggles the list for a finger and for TalkBack alike. A finger goes
through Material's checked button; TalkBack's click action lands on the half's own semantics,
which asks `MenuModel.applyListAction` for the same transition
(`MenuModelTest.theListActionTogglesLikeAPressDoes`).

Two rules hold on both platforms: a press that runs `primaryAction` never opens the list and
never fires `onOpen`, and it is refused while `disabled` is set. `onOpen` and `onClose` still
pair up exactly once per open.

Android's variant mapping. Material has four split-button sets and Menu has five trigger
variants, so one variant has no set of its own:

| `variant`  | Split button drawn                                                   |
| ---------- | -------------------------------------------------------------------- |
| `filled`   | `SplitButtonDefaults.{LeadingButton,TrailingButton}`                 |
| `tonal`    | `SplitButtonDefaults.{TonalLeadingButton,TonalTrailingButton}`       |
| `outlined` | `SplitButtonDefaults.{OutlinedLeadingButton,OutlinedTrailingButton}` |
| `elevated` | `SplitButtonDefaults.{ElevatedLeadingButton,ElevatedTrailingButton}` |
| `text`     | the outlined pair                                                    |

A split button is two containers and the text variant has none, so a `variant="text"` Menu with
a `primaryAction` gains a container and a hairline.

Sizes. The split trigger reads Material's own split-button values per size:

| Split button input                                              | Read at                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `SplitButtonDefaults.leadingButtonShapesFor` / `…Trailing…`     | `ButtonScale.layoutHeight`: the box actually drawn, never below the 48 dp touch target |
| `SplitButtonDefaults.{leading,trailing}ButtonContentPaddingFor` | `ButtonScale.height`                                                                   |
| `SplitButtonDefaults.trailingButtonIconSizeFor` (the chevron)   | `ButtonScale.height`                                                                   |
| the label's type size                                           | Button's `buttonLabelStyle(scale)`                                                     |
| the halves' height floor                                        | `heightIn(min = ButtonScale.layoutHeight)` on the layout                               |

The height floor is enforced on the layout because Material turns the minimum interactive size
off inside the halves. Without it both halves would rest at the container height (40 dp at
`small` and `medium`) inside a 48 dp box, shorter than the plain trigger.

The chevron is Google's Material Symbols `keyboard_arrow_down`, shipped unchanged as the
`nitroui_keyboard_arrow_down` drawable (`scripts/icons/fetch-material-symbols.mjs`). It turns
half a turn while the list is up, on `MaterialTheme.motionScheme`'s effects spec.

`primaryAction` is part of Menu's sizing key, because on Android the second container makes the
box wider; see [Sizing](#sizing).

## The trigger's glyph

`androidIcon` is `Button`'s prop on this trigger. The file format, where Material Symbols come
from, the `@expo/material-symbols` option, the drawable-name form and the failure table are in
[button.md](button.md), "Android icons". What is specific to Menu:

- iOS never draws it. `systemImage` is the iOS glyph; `androidIcon` is accepted, stored and never
  painted, so a Menu with an `androidIcon` and one without are the same box on iOS.
- The plain trigger puts it in the slot Material's `Button` uses, with the same sizes, painter
  and `hasStartIcon` padding, because `Menu`'s trigger and `Button` are one composition
  (`NitroUiM3Button`). A glyph that cannot be resolved reserves nothing.
- A split trigger puts it on the leading half, beside the label; the trailing half stays the
  chevron. The glyph is the same size as the plain trigger's at that `size`. The half's padding
  is Material's `leadingButtonContentPaddingFor`, which has no `hasStartIcon` form, so the
  control grows by the glyph plus its spacing.
- All five `size` values reach the trigger.

The boxes are the ones `Button` measures for the same configuration, because it is the same
composition.

## The rows' glyphs

`MenuAction.androidIcon` takes the same two forms, `require('./icons/share.xml')` or `"share"`,
and everything in [button.md](button.md), "Android icons" applies to it. What is specific to a
row:

- iOS never draws it. A row's glyph on iOS is `systemImage`; `androidIcon` is carried in the row
  struct and never painted. Name both to get a glyph on both platforms, with no
  `Platform.select`.
- On Android a row with a glyph is a `DropdownMenuItem` with a `leadingIcon`. The size, colour,
  gap to the title and group insets are Material's. The size is `MenuDefaults.LeadingIconSize`,
  20 dp, not the 24 dp of an icon elsewhere.
- The colour is the row's own content colour, so a glyph on a disabled row is dimmed the way its
  title is.
- A checked row's check takes the slot. Material puts a `CheckableDropdownMenuItem`'s leading
  check where the glyph would be, so the menu is one width whether the row is checked or not and
  a checked row shows the check, not the glyph.
- A glyph that cannot be resolved reserves nothing. An unknown resource name, a file that fails
  to load and "no icon" all reach `leadingIcon` as `null`, so the menu is exactly the menu with
  no icons. In development the wrapper warns once per name, as `Button` does.
- A submenu's label takes no glyph on either platform. Android flattens a submenu into a group
  whose label is a `DropdownMenuGroupLabel` and iOS draws a `UIMenu` title; neither has a leading
  slot, so `MenuSubmenu` has no `androidIcon`. A row inside a submenu takes the prop like any
  other action.
- Row glyphs travel in the rows array and are not part of the sizing key: a row does not change
  the trigger's box.

## Inside a `Host`

`Menu` is hostable: inside `<Host>` it is composed by the Host's own composition
([host.md](host.md)).

| Situation                                            | Result                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Host, or the Menu, is moved by layout while open | The menu closes. A window that cannot follow its anchor would sit over the wrong control. A scroll is not a layout move, so an open menu survives one. |
| The Host is dropped or recycled while open           | The composition is disposed, which closes the window.                                                                                                  |
| iOS                                                  | A Host is a passthrough, so the menu is the ordinary system presentation.                                                                              |

The Android popup is anchored to the trigger's box, not the composition's. `DropdownMenuPopup` is
placed by a position provider
(`MenuDefaults.rememberDropdownMenuPopupPositionProvider(MenuAnchorPosition.Below)`) against the
layout it is composed in, and the trigger and the popup share one `Box` whose only measured child
is the trigger. The popup's width is Material's own content sizing: no narrower than a row's
112 dp floor, and no wider than a row's 280 dp cap plus its 4 dp inset on each side; a group
label carries the same cap. The list stays aligned with the trigger's start edge.

## Sizing

The policy is `intrinsic` and the box is the trigger's: `group` never changes it. The sizing key
is Button's with one field added, `variant|size|action|systemImage|androidIcon|title`, where
`action` is `'action'` when `primaryAction` is set and `'plain'` when it is not. `disabled` and
`tintColor` repaint without resizing. `group` is not in the key, because the items live in a
popup. `action` is in it because on Android a split button is two containers and a gap, so it is
wider than the single button and the two cannot share a cached size. iOS ignores the field: there
`primaryAction` changes a gesture, not a box.

### Measured

One Menu per configuration, `title="Variant"` at `medium` for the variants and `title="Sized"` at
`filled` for the sizes. iPhone 17 / iOS 27 in pt, an API 35 emulator at 420 dpi in dp:

| Configuration              | iOS           | Android        |
| -------------------------- | ------------- | -------------- |
| `filled`                   | 77.33 × 34.33 | 76.57 × 48.00  |
| `tonal`                    | 77.33 × 34.33 | 76.57 × 48.00  |
| `outlined`                 | 77.33 × 34.33 | 76.57 × 48.00  |
| `elevated`                 | 77.33 × 34.33 | 76.57 × 48.00  |
| `text`                     | 53.33 × 20.33 | 68.95 × 48.00  |
| `small`                    | 58.00 × 28.00 | 58.67 × 48.00  |
| `large`                    | 82.00 × 50.33 | 88.76 × 56.00  |
| `filled` + `primaryAction` | 79.67 × 34.33 | 124.95 × 48.00 |

The last row uses `title="Publish"`, so it is not comparable with the rows above. The same
fixture without the prop measures 79.67 × 34.33 on iOS and 78.86 × 48.00 on Android: iOS is one
box either way, and Android's split trigger is 46.09 dp wider (a second container, Material's gap
and the chevron).

The heights are Button's: iOS 28.0 / 34.3 / 50.3 and Android 48.0 / 48.0 / 56.0
([button.md](button.md)). The trigger is Button's label with Button's chrome, and the widths
differ only because the titles differ. Android's `text` is narrower than the other four because
Material's text button carries less horizontal padding. On iOS the four boxed variants share one
box because SwiftUI's `.bordered` and `.borderedProminent` give the same box; `text` is
`.borderless`, so it is a text box. iOS applies the per-variant `.buttonStyle` explicitly,
because `.menuStyle(.button)` alone leaves the label's button style automatic and the trigger
would measure as the title's text box.

The declared fallback is one pair per component: `74 × 38` pt
(`ios/components/Menu/HybridNitroUiMenu.swift`) and `75.1 × 52` dp
(`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiMenu.kt`). It is Button-sized and
deliberately not any measured size, so a sizing test can tell a correction that never arrived.

## Recycling and cleanup

`Menu` implements `RecyclableView`. On Android the recycle reset clears `expanded` before the
rows and the trigger, so a reused control cannot reopen with the previous instance's menu. iOS
has no open state to clear, so its reset covers the title, the rows and the flags.
`onDropView` drops the callbacks and, on Android, disposes the composition, which closes the
window.

## Accessibility

The trigger is one accessibility element named by `accessibilityLabel`, falling back to `title`.
`accessibilityLabel` is applied only when set, so an unset label does not shadow the title. On
Android the trigger is a single node built with `clearAndSetSemantics` (`contentDescription`,
`SemanticsProperties.Text`, `stateDescription`, `role = Role.DropdownList`,
`onClick`/`disabled()`). On iOS the name comes from the SwiftUI `.accessibilityLabel` on the
hosted control.

The popup's rows are the platform's own elements and are not re-labelled. A disabled row refuses
a pick on both platforms. In the Android accessibility tree the rows are `TextView`s that all
report `enabled="true"`, a disabled one included.

Not covered by an automated test: that a destructive row is announced as such on iOS, the order
rows are announced in, and what TalkBack says about a disabled row.

## Limits

- `onOpen` and `onClose` are Android-only. Do not build app state on them if iOS has to agree;
  use `onSelect`.
- A `disabled` that arrives while the menu is open closes it on Android only. An iOS menu can
  stay on screen over a disabled trigger.
- No submenus on Android. A submenu's items appear inline as a group, in place.
- `systemImage` is iOS-only on the trigger and the rows, and `androidIcon` is Android-only. A
  Menu with a glyph on both platforms passes both props.
- `primaryAction` is drawn differently on each platform: iOS keeps one button and a gesture per
  job; Android draws two containers and is wider.
- The menu's look is the platform's. Beyond `tintColor` there is no row styling and no way to
  place the popup. Button's `.buttonStyle` does not reach an iOS menu's rows: they are plain
  system rows.
- One submenu level, and no nesting of sections.
- A checkable row is not drawn destructive on iOS. SwiftUI's `Toggle` takes no role, so
  `destructive` on a row with a `checked` is ignored there; Android still draws it in the error
  colour.
- An unchecked row reads the same as a plain one on iOS. UIKit gives a toggle that is off and a
  plain action the same `.off` state; on Android a `checked: false` row is announced as an
  unchecked checkbox.
- No `ref` forwarding, and `aria-label`/`aria-disabled` are not translated.
