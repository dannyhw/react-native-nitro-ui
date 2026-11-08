# ButtonGroup

A row of **commands** — *Copy | Paste | Share* — optionally with independent
toggles — *Bold | Italic | Underline* — that moves the items it cannot fit into an
overflow menu.

On Android it is Material 3's `ButtonGroup`, overflow indicator and all. On iOS it is
a row of bordered buttons, or SwiftUI's `ControlGroup` when you ask for the connected
look. It has no single selected value: if you want *one of* a few options, that is
[SegmentedControl](segmented-control.md), and
[the section at the bottom](#buttongroup-or-segmentedcontrol) says how to tell the two
apart.

```tsx
import { ButtonGroup } from 'react-native-nitro-ui';

<ButtonGroup
  items={[
    { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc', androidIcon: 'copy_24px' },
    { id: 'cut', title: 'Cut', systemImage: 'scissors', androidIcon: 'cut_24px' },
    { id: 'paste', title: 'Paste', systemImage: 'doc.on.clipboard', androidIcon: 'paste_24px' },
  ]}
  appearance="connected"
  onPress={(id) => run(id)}
/>;
```

## API

| Prop                       | Type                                          | Default      | Notes                                                                       |
| -------------------------- | --------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `items`                    | `ButtonGroupItem[]`                           | —            | The row, in render order. `[]` draws nothing.                                |
| `appearance`               | `'standard' \| 'connected'`                   | `'standard'` | Connected corners, or a gap between each item.                               |
| `variant`                  | `ButtonVariant`                               | `'filled'`   | The five shared variants. **Not iOS `connected`.**                           |
| `size`                     | `'small' \| 'medium' \| 'large' \| …`         | `'medium'`   | The shared ladder. **Not iOS `connected`.**                                  |
| `labelStyle`               | `'automatic' \| 'titleOnly' \| 'iconOnly' \| 'titleAndIcon'` | `'automatic'` | What each item draws. See [the table](#what-each-platform-draws).       |
| `disabled`                 | `boolean`                                     | `false`      | No item is reachable and no event fires.                                     |
| `tintColor`                | `ColorValue`                                  | platform     | The variant's container / SwiftUI `.tint()`. **Not iOS `connected`.**        |
| `onPress`                  | `(id: string) => void`                        | —            | One call per tap on an action item, from the row or from the menu.           |
| `onCheckedChange`          | `(id: string, checked: boolean) => void`      | —            | A toggle item's change, on the event-count handshake.                        |
| `overflowAccessibilityLabel` | `string`                                    | `'More'`     | The name of the overflow control, on both platforms.                         |
| `accessibilityLabel`       | `string`                                      | —            | The group's own name. Unset leaves each item to speak for itself.            |
| `testID`                   | `string`                                      | —            | Forwarded to the native view.                                                |
| `style`                    | `StyleProp<ViewStyle>`                        | —            | Applied over the control's own `alignSelf: 'stretch'`.                        |

### `items[]`

| Field           | Type                    | Default   | Notes                                                             |
| --------------- | ----------------------- | --------- | ----------------------------------------------------------------- |
| `id`            | `string`                | —         | What `onPress` and `onCheckedChange` report. Must be unique.       |
| `title`         | `string`                | —         | Drawn, read by a screen reader, and the text of the overflow row.  |
| `systemImage`   | `string \| null`        | `null`    | SF Symbol. **iOS only.** A name that does not resolve draws nothing. |
| `androidIcon`   | `string \| number`      | `null`    | Vector drawable — see [Button's `androidIcon`](button.md#icons). **Android only.** |
| `disabled`      | `boolean`               | `false`   | This one item. Draws disabled, reports nothing.                    |
| `toggle`        | `boolean`               | `false`   | A toggle rather than an action.                                    |
| `checked`       | `boolean \| null`       | `null`    | `true`/`false` → controlled for this item. `null` → uncontrolled.   |
| `defaultChecked`| `boolean`               | `false`   | Seed for an uncontrolled item. Applied once.                        |

Each item decides its own controlled-ness, so a group can hold a controlled toggle, an
uncontrolled one and two plain actions at the same time. An item with `checked` is the
only kind a write can move; the others keep whatever the user gave them.

```tsx
export function Toolbar() {
  const [spellcheck, setSpellcheck] = useState(true);

  return (
    <ButtonGroup
      items={[
        { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc' },
        // Controlled: this render decides what is drawn.
        { id: 'spellcheck', title: 'Spellcheck', toggle: true, checked: spellcheck },
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

`defaultChecked` is a **first-render** value. It is applied once per id and then
forgotten, so a re-render cannot undo the tap that just happened.

## What each platform draws

| Prop           | Android                                                    | iOS `standard`                                  | iOS `connected`                     |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| `appearance`   | 12 dp apart, each item its own corners · 2 dp joined        | an 8 pt row of bordered controls · `ControlGroup` |                                     |
| `variant`      | `NitroUiM3Button` / `NitroUiM3ToggleButton`, one per variant | `ButtonStyle` per variant (see below)             | **ignored**                         |
| `size`         | E1's ladder, floored at Material's 48 dp target              | `.controlSize`                                    | **ignored** (31 pt at every rung)   |
| `tintColor`    | the variant's container, and the checked container            | `.tint()`                                         | **ignored**                         |
| `labelStyle`   | icon and title; `automatic` = both                            | `automatic` = icon **and** title                  | `automatic` = **icons only**        |
| `systemImage`  | ignored                                                      | `Label`'s glyph                                   | `Label`'s glyph, usually alone      |
| `androidIcon`  | `Icon` at the rung's icon size                               | ignored                                           | ignored                             |
| overflow       | Material's indicator + Material's group menu                 | a `Menu` beside the row                           | the same                            |
| `disabled`     | `enabled = false` on each item and its menu row               | `.disabled`                                       | `.disabled`                         |

Three of those rows are measured, not documented from Apple's prose. `ControlGroup`
ignores `.controlSize`, `.tint` and `.buttonStyle`: the same three-item probe row
measured 174.00 × 31.00 pt at every size, with every tint and with three different
button styles. Rather than fake a `variant` that cannot be drawn, a connected iOS group
takes its look from `ControlGroup` and says so.

`variant` maps to the same iOS `ButtonStyle` table as [Button](button.md) — `filled` and
`elevated` to `.borderedProminent`, `tonal` and `outlined` to `.bordered`, `text` to
`.borderless` — with one difference: a group does not stroke a hairline for `outlined`,
because a row of stroked capsules reads as four borders where one button reads as one
outline. `text` toggles land on the outlined toggle for the same reason there is no text
toggle to draw.

### A connected iOS group with toggles

`ControlGroup` draws no on state: three `Toggle(…).toggleStyle(.button)`s inside one
look identical whether they are on or off (measured). A connected iOS group whose items
include a toggle therefore draws the **standard** row — separate bordered toggles, each
with a state to show — on iOS only. Same props, same events, a row that tells the truth.
Android keeps its connected toggles, because Material's `ToggleButton` has a checked
container.

If you want the connected look on iOS *and* toggles, put the toggles in their own
`standard` group.

## Sizing

`ButtonGroup` is `fillWidth`: **its width is the box's**, and its height is its own. That
is not a preference — overflow can only be decided at the width the row actually gets, so
an intrinsically measured row would measure itself unbounded, decide nothing overflowed,
and draw outside a box Yoga had already clamped.

The height is the `medium` rung's row: **48 dp** on Android, which is Material's own
minimum interactive height, and **34.4 pt** on iOS (`34.33 pt`, rounded up so a cold first
frame is never short). A connected iOS group is 31 pt — a colder configuration, cached
after one measurement. `checked`, `disabled` and `tintColor` repaint and do not resize;
`appearance`, `variant`, `size`, `labelStyle` and the items themselves are the size
configuration, so a fifth item is a new configuration and a fifth *tap* is not.

## Overflow

Items that do not fit move into a menu, and which ones do is decided by the box — the
same six items that overflow at 220 pt are a full row across the screen.

- **Android** uses Material's own overflow: the ellipsis indicator, and `ButtonGroup`'s
  built-in `DropdownMenu` for the rows. Which items overflowed is private state
  (`ButtonGroupOverflowState`), and the menu is Material's, not [Menu](menu.md)'s —
  which means it is a plain Material dropdown carrying this library's row style, and it
  follows `MaterialExpressiveTheme`.
- **iOS** has no overflow to borrow. The row is a `ViewThatFits` over "all items", then
  "n−1 items plus a `Menu`", and so on down to one item plus the menu, so what you get is
  the most items that fit rather than the fewest. The `Menu` sits **beside** the group:
  inside a `ControlGroup` its segment draws disabled and never opens (measured, with
  containment and without).
- A tap on an overflow row is the same event as a tap on the row: `onPress(id)`, or the
  toggle handshake. `disabled` arriving while the menu is open closes it, and so does a
  recycle.
- On **iOS 15** there is no `ViewThatFits`, so every item is drawn and the row clips to
  its box. Nothing overflows and nothing moves into a menu there.

`overflowAccessibilityLabel` names the control on both platforms. Android could have left
it to Material — which draws an ellipsis with no description at all — so the library
labels it `'More'` itself unless you say otherwise. The person who needs the menu most is
the one who cannot find it.

## Accessibility

| What              | VoiceOver (iOS)                                    | TalkBack (Android)                                     |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------ |
| An action item    | "Copy, button"                                     | "Copy, button"                                          |
| An icon-only item | still named by its `title`                          | `contentDescription` on the item, glyph itself silent   |
| A toggle item     | `Toggle(…).toggleStyle(.button)`                    | checkbox role with a checked state                      |
| The overflow      | `'More'` (or your label)                            | `'More'` (or your label), plus Material's tooltip       |
| The group         | one container holding one element per item          | one traversal group, items still reachable inside it    |

The names are read from the tree, not listened to: the harness reads Compose semantics
nodes on Android, and iOS's hosting view answers nothing to an in-process probe, so the
iOS labels come from the XCUITest pass over the running app. That pass is what
`real-input:ios` runs; nobody has confirmed aloud what VoiceOver says about a toggle
inside a `ControlGroup`, which is another reason that configuration falls back.

`accessibilityLabel` names the group. Leave it unset and each item simply speaks for
itself, which is almost always right for a row of commands — the group's name is for when
the row is one choice among several.

## ButtonGroup or SegmentedControl?

**SegmentedControl** picks **one** of a few options. It always has exactly one selected,
its value is an index, and it is announced as a radio group. Use it to switch a view or a
filter: *List | Grid | Board*.

**ButtonGroup** is a row of **commands**, such as *Copy | Paste | Share*, optionally with
independent toggles such as *Bold | Italic | Underline*. It has no single value, items can
carry icons, and extra items move into an overflow menu when the row runs out of room.

On iOS a connected `ButtonGroup` and a `SegmentedControl` share a look — Apple draws both
on the same track. The selection thumb is the difference, and so is what VoiceOver says.

## Which iOS versions this was checked on

The connected appearance depends on a control Apple has changed before, so it was probed
rather than assumed:

- **iOS 27.0** (iPhone 17 simulator, Xcode 27) — every measurement in this page, including
  the three `ControlGroup` rules above, taken during the design task that produced it.
- **iOS 26.5** — the same probe, on the current shipping release. The connected row is the
  same control at the same 31 pt, and it keeps ignoring size, tint and variant.
- **iOS 15.1** is the deployment target. There is no `ViewThatFits` there, so the row
  clips instead of overflowing; the rest of the control — the row, the toggles, the
  handshake — is the same code.

Behaviour this page claims on iOS 26.5 is the probe's; the harness and real-input suites run
on the pool's iOS 27.0 device, which is why the numbers quoted above are 27.0's.

## Limits

- A connected iOS group ignores `variant`, `size` and `tintColor`, and draws the standard
  row as soon as one item is a toggle. Both are Apple's doing and are measured above.
- `systemImage` on Android and `androidIcon` on iOS are ignored, so an item that wants a
  glyph on both names both.
- iOS overflow needs iOS 16; on iOS 15 the row clips.
- The overflow menu is Material's button-group menu on Android, not `Menu`'s popup: which
  items overflowed is private to `ButtonGroup`, so the rows are this library's but the
  container is Material's.
- An item's `title` is one line. A row is never wrapped.
