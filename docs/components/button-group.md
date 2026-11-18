# ButtonGroup

A row of commands, such as _Copy | Paste | Share_, optionally with independent toggles, such as
_Bold | Italic | Underline_. Items that do not fit move into an overflow menu.

On Android it is Material 3's `ButtonGroup`, including its overflow indicator. On iOS it is a row
of bordered buttons, or SwiftUI's `ControlGroup` for the connected look. It has no single
selected value: to pick one of a few options use [SegmentedControl](segmented-control.md); see
[ButtonGroup or SegmentedControl?](#buttongroup-or-segmentedcontrol).

```tsx
import { ButtonGroup } from 'react-native-nitro-ui';

<ButtonGroup
  items={[
    {
      id: 'copy',
      title: 'Copy',
      systemImage: 'doc.on.doc',
      androidIcon: 'copy_24px',
    },
    {
      id: 'cut',
      title: 'Cut',
      systemImage: 'scissors',
      androidIcon: 'cut_24px',
    },
    {
      id: 'paste',
      title: 'Paste',
      systemImage: 'doc.on.clipboard',
      androidIcon: 'paste_24px',
    },
  ]}
  appearance="connected"
  onPress={(id) => run(id)}
/>;
```

## API

| Prop                         | Type                                                         | Default       | Notes                                                                                          |
| ---------------------------- | ------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------- |
| `items`                      | `ButtonGroupItem[]`                                          | —             | The row, in render order. `[]` draws nothing.                                                  |
| `appearance`                 | `'standard' \| 'connected'`                                  | `'standard'`  | Connected corners, or a gap between each item.                                                 |
| `variant`                    | `ButtonVariant`                                              | `'filled'`    | `Button`'s five variants. Ignored by iOS `connected`.                                          |
| `size`                       | `'small' \| 'medium' \| 'large' \| …`                        | `'medium'`    | `Button`'s sizes. Ignored by iOS `connected`.                                                  |
| `labelStyle`                 | `'automatic' \| 'titleOnly' \| 'iconOnly' \| 'titleAndIcon'` | `'automatic'` | What each item draws. See [the table](#what-each-platform-draws).                              |
| `disabled`                   | `boolean`                                                    | `false`       | No item is reachable and no event fires.                                                       |
| `tintColor`                  | `ColorValue`                                                 | platform      | The variant's container / SwiftUI `.tint()`. Ignored by iOS `connected`.                       |
| `onPress`                    | `(id: string) => void`                                       | —             | One call per tap on an action item, from the row or from the menu.                             |
| `onCheckedChange`            | `(id: string, checked: boolean) => void`                     | —             | A toggle item's change, through the event count.                                               |
| `overflowAccessibilityLabel` | `string`                                                     | platform      | Names the overflow control. iOS draws `'More'`; Android leaves Material's own localised label. |
| `accessibilityLabel`         | `string`                                                     | —             | The group's own name. Unset leaves each item to speak for itself.                              |
| `testID`                     | `string`                                                     | —             | Forwarded to the native view.                                                                  |
| `style`                      | `StyleProp<ViewStyle>`                                       | —             | Applied over the control's own `alignSelf: 'stretch'`.                                         |

### `items[]`

| Field            | Type               | Default | Notes                                                                                 |
| ---------------- | ------------------ | ------- | ------------------------------------------------------------------------------------- |
| `id`             | `string`           | —       | What `onPress` and `onCheckedChange` report. Must be unique.                          |
| `title`          | `string`           | —       | Drawn, read by a screen reader, and the text of the overflow row.                     |
| `systemImage`    | `string \| null`   | `null`  | SF Symbol. iOS only. A name that does not resolve draws nothing.                      |
| `androidIcon`    | `string \| number` | `null`  | Vector drawable; see [Button's `androidIcon`](button.md#android-icons). Android only. |
| `disabled`       | `boolean`          | `false` | This one item. Draws disabled, reports nothing.                                       |
| `toggle`         | `boolean`          | `false` | A toggle, not an action.                                                              |
| `checked`        | `boolean \| null`  | `null`  | `true`/`false` → controlled for this item. `null` → uncontrolled.                     |
| `defaultChecked` | `boolean`          | `false` | Seed for an uncontrolled item. Applied once.                                          |

Each item is controlled or uncontrolled on its own, so a group can hold a controlled toggle, an
uncontrolled one and plain actions at the same time. Only an item with `checked` follows a write
from React.

```tsx
export function Toolbar() {
  const [spellcheck, setSpellcheck] = useState(true);

  return (
    <ButtonGroup
      items={[
        { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc' },
        // Controlled: this render decides what is drawn.
        {
          id: 'spellcheck',
          title: 'Spellcheck',
          toggle: true,
          checked: spellcheck,
        },
        // Uncontrolled: native owns it after the first render.
        { id: 'bold', title: 'Bold', toggle: true, defaultChecked: true },
      ]}
      onCheckedChange={(id, checked) => {
        if (id === 'spellcheck') setSpellcheck(checked);
      }}
      onPress={(id) => copy()}
    />
  );
}
```

`defaultChecked` is a first-render value. It is applied once per id, so a re-render cannot undo a
tap.

## What each platform draws

| Prop          | Android                                                      | iOS `standard`                                    | iOS `connected`                |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------- | ------------------------------ |
| `appearance`  | 12 dp apart, each item its own corners · 2 dp joined         | an 8 pt row of bordered controls · `ControlGroup` |                                |
| `variant`     | `NitroUiM3Button` / `NitroUiM3ToggleButton`, one per variant | `ButtonStyle` per variant, toggle or action item  | ignored                        |
| `size`        | `Button`'s sizes, floored at Material's 48 dp target         | `.controlSize`                                    | ignored (31 pt at every size)  |
| `tintColor`   | the variant's container, and the checked container           | `.tint()`, on a toggle item only while checked    | ignored                        |
| `labelStyle`  | icon and title; `automatic` = both                           | `automatic` = icon and title                      | `automatic` = icons only       |
| `systemImage` | ignored                                                      | `Label`'s glyph                                   | `Label`'s glyph, usually alone |
| `androidIcon` | `Icon` at the size's icon size, and again in the overflow row | ignored                                           | ignored                        |
| overflow      | Material's indicator + Material's group menu                 | a `Menu` beside the row                           | the same                       |
| `disabled`    | `enabled = false` on each item and its menu row              | `.disabled`                                       | `.disabled`                    |

`ControlGroup` ignores `.controlSize`, `.tint` and `.buttonStyle`: the same three-item row
measures 174.00 × 31.00 pt at every size, with every tint and with three different button styles.
A connected iOS group therefore takes its look from `ControlGroup`.

On Android a `text` toggle is drawn as the outlined toggle, because Material has no text toggle
button; every other variant has its own toggle button, and each shows its checked state in its own
way.

On iOS `variant` maps to the same `ButtonStyle` table as [Button](button.md), for a toggle item as
for an action item: `filled` and `elevated` to `.borderedProminent`, `tonal` and `outlined` to
`.bordered`, `text` to `.borderless`. Unlike `Button`, a group does not stroke a hairline for
`outlined`. A toggle keeps that style in both of its states, so it sits with the action item beside
it; what changes with the state is the colour, not the shape.

| `variant`       | iOS action item        | iOS toggle item, checked | iOS toggle item, unchecked |
| --------------- | ---------------------- | ------------------------ | -------------------------- |
| `filled`        | `.borderedProminent`   | the same, in `tintColor` | a grey capsule             |
| `elevated`      | the same               | the same                 | a grey capsule             |
| `tonal`         | `.bordered`            | the same, tinted label   | the same, grey label       |
| `outlined`      | the same               | the same                 | the same                   |
| `text`          | `.borderless`          | the same, tinted label   | the same, grey label       |

The unchecked item is drawn with the system's own neutral colours — a grey capsule where the style
is a filled one, the secondary label colour where the style colours its label — so an unchecked
item is the same shape as a checked one without its colour. A `text` toggle shows its state that
way too: a tinted label against a grey one, with nothing drawn behind either.

### A connected iOS group with toggles

A `Toggle` inside `ControlGroup` draws no on state: checked and unchecked are the same pixels. A
connected iOS group whose items include a toggle therefore draws the standard row, separate toggles
in the group's `variant` that each show their state, on iOS only. The props and events are the
same. Android keeps its connected toggles, because Material's `ToggleButton` has a checked
container.

For the connected look on iOS and toggles, put the toggles in their own `standard` group.

## Sizing

`ButtonGroup` is `fillWidth`: its width is the box's, and its height is its own. Overflow can
only be decided at the width the row actually gets.

The declared height is the `medium` row: 48 dp on Android, Material's minimum interactive height,
and 34.4 pt on iOS (`34.33 pt`, rounded up so a cold first frame is never short). A connected iOS
group is 31 pt, cached after one measurement. `checked`, `disabled` and `tintColor` repaint and do
not resize; `appearance`, `variant`, `size`, `labelStyle` and the items are the size
configuration, so adding an item is a new configuration and a tap is not.

## Overflow

Items that do not fit move into a menu. Which ones is decided by the box: six items that
overflow at 220 pt can be a full row across the screen.

- Android uses Material's own overflow: the ellipsis indicator, and `ButtonGroup`'s built-in
  `DropdownMenu` for the rows. Which items overflowed is private to Material
  (`ButtonGroupOverflowState`), and the menu is Material's, not [Menu](menu.md)'s: a plain
  Material dropdown with this library's row style, following `MaterialExpressiveTheme`.
- iOS has no built-in overflow. The row is a `ViewThatFits` over "all items", then "n−1 items
  plus a `Menu`", and so on down to one item plus the menu, so the most items that fit are
  shown. The `Menu` sits beside the group: inside a `ControlGroup` its segment draws disabled and
  never opens.
- A tap on an overflow row is the same event as a tap on the row: `onPress(id)`, or the toggle's
  change. `disabled` arriving while the menu is open closes it, and so does a recycle.
- On iOS 15 there is no `ViewThatFits`, so every item is drawn and the row clips to its box.
  Nothing moves into a menu there.

### What an overflow row draws

An overflowed item is drawn as one row of the same menu [Menu](menu.md) uses, by the same code.

- Android draws the item's title and, when it has an `androidIcon`, that glyph in the row's leading
  slot: Material's leading-icon size, in the colour Material gives a row's glyph. An item with no
  `androidIcon` draws no glyph and keeps no space for one, so its title starts at the plain leading
  edge; a row with a glyph indents its title by the slot, exactly as a `Menu` row with an icon does.
- `labelStyle="titleOnly"` costs the rows their glyphs, as it costs the items in the row theirs.
- On a toggle item the row is checked or unchecked, and while it is checked Material's check takes
  the leading slot in place of the glyph.
- iOS draws the title alone: neither `systemImage` nor a glyph reaches a row of its `Menu`.

`overflowAccessibilityLabel` names the overflow control on both platforms. Without it the
platforms differ:

- iOS uses `'More'`, because the ellipsis it draws has nothing to read.
- Android adds nothing. Material's indicator already carries the localised content description
  "More options", and a second description on the same node would be read after the first.
- With the prop set, Android replaces Material's description with yours (`clearAndSetSemantics`).

Changing the label after mount updates the indicator on Android.

## Accessibility

| What              | VoiceOver (iOS)                            | TalkBack (Android)                                             |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------- |
| An action item    | "Copy, button"                             | "Copy, button"                                                 |
| An icon-only item | still named by its `title`                 | `contentDescription` on the item, glyph itself silent          |
| A toggle item     | `Toggle(…).toggleStyle(.button)`           | checkbox role with a checked state                             |
| The overflow      | `'More'` (or your label)                   | Material's own "More options", or your label, plus its tooltip |
| The group         | one container holding one element per item | one traversal group, items still reachable inside it           |

These are read from the accessibility tree by the tests, not from a screen reader's speech. What
VoiceOver says about a toggle inside a `ControlGroup` is not verified.

`accessibilityLabel` names the group. Leave it unset for a row of commands, where each item
speaks for itself; set it when the row is one choice among several.

## ButtonGroup or SegmentedControl?

`SegmentedControl` picks one of a few options. It always has exactly one selected, its value is
an index, and it is announced as a radio group. Use it to switch a view or a filter:
_List | Grid | Board_.

`ButtonGroup` is a row of commands, such as _Copy | Paste | Share_, optionally with independent
toggles such as _Bold | Italic | Underline_. It has no single value, items can carry icons, and
extra items move into an overflow menu when the row runs out of room.

On iOS a connected `ButtonGroup` and a `SegmentedControl` share a look. The selection thumb is
the difference, and so is what VoiceOver says.

## Which iOS versions this was checked on

The connected appearance depends on how SwiftUI bridges `ControlGroup`. The rows below are the
group's own rect in the running example app, so they land on the device's 1/3-pt pixel grid:

| Runtime  | Device     | `connected` row                   | `standard` row |
| -------- | ---------- | --------------------------------- | -------------- |
| iOS 27.1 | iPhone Duo | 31.00 pt — a `UISegmentedControl` | 34.67 pt       |
| iOS 27.0 | iPhone Air | 31.00 pt — a `UISegmentedControl` | 34.67 pt       |
| iOS 26.5 | iPhone 17  | 31.00 pt — a `UISegmentedControl` | 34.67 pt       |

A connected group is a `ControlGroup`, which SwiftUI bridges to `UISegmentedControl`, and it
draws 31.00 pt, 3.67 pt shorter than the standard row. The 220 pt overflow box reads the same on
all three: 220 × 64.33, with the segment it composes 105.67 × 31.00. That a connected group
ignores `variant`, `size` and `tintColor` and draws no on state for a `Toggle` is measured on iOS
27.0.

Every other number on this page is measured on iOS 27.0. The clipping on iOS 15 is read from the
code, not measured on a 15.x simulator.

The code has one version condition, an `#available(iOS 16)` that picks the overflowing row over
the clipped one. A connected group is the same `ControlGroup` path on every runtime above.

## Limits

- A connected iOS group ignores `variant`, `size` and `tintColor`, and draws the standard row as
  soon as one item is a toggle.
- `systemImage` on Android and `androidIcon` on iOS are ignored, so an item that wants a glyph on
  both names both.
- iOS overflow needs iOS 16; on iOS 15 the row clips.
- The overflow menu is Material's button-group menu on Android, not `Menu`'s popup.
- Not hostable: a `<Host>` refuses a `ButtonGroup`.
- An item's `title` is one line. A row is never wrapped.
