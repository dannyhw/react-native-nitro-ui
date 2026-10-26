# Host

A container that renders its nitro-ui children into **one** native composition
instead of one per control. On Android that means one Compose `Composition`, one
`AndroidComposeView` and one `LayoutNode` tree for the whole batch; outside a Host
every control brings its own.

It is **opt-in**, and Android-only: on iOS `<Host>` is a documented passthrough `View`,
so the same JSX renders normally there and an app gets one tree to reason about, not
two (D23). That is settled, not provisional — an iOS Host was built and measured: it
won on memory (0.92× the unhosted Switch) but lost on mount UI CPU (1.40×) and unmount
UI CPU (6.27×), so it was not shipped (`docs/DECISIONS.md`, D23 and its outcome). The
passthrough is the design.

```tsx
import { Host, Switch } from 'react-native-nitro-ui';

<Host style={{ height: 20 * 48 }}>
  {rows.map((row) => (
    <Switch key={row.id} value={row.on} onValueChange={row.toggle} />
  ))}
</Host>;
```

## When to use it

When a screen mounts a batch of the same control at once and the mount is what
costs: a settings list, a table of rows, a filter panel. That is where the win is —
measured with Switches (memory at N=200, the rest at N=50), `quick` plan, ART
`speed-profile`, on the API 35 Pixel 9 emulator the bench baselines use — every number
below is the launch-paired ratio to `expo-ui-shared-host` from one run (measurement
details: `docs/tasks/H1-android-host.report.md`):

|                                  | `nitro-ui` (no Host) | `expo-ui-shared-host` | `nitro-ui` + `<Host>` |
| -------------------------------- | -------------------- | --------------------- | --------------------- |
| Mount memory                     | 2.75x                | 1.00x                 | **0.86x**             |
| Mount UI-thread CPU per op       | 1.39x                | 1.00x                 | **0.87x**             |
| Mount wall time (`mounted`)      | 1.13x                | 1.00x                 | **0.97x**             |
| Mount `presented`                | 1.01x                | 1.00x                 | **0.99x**             |
| Mount JS CPU per op              | 0.73x                | 1.00x                 | 1.18x                 |
| Unmount UI-thread CPU per op     | 1.31x                | 1.00x                 | **0.78x**             |

An earlier prototype of the same container measured 0.87x memory and 0.80x mount UI
CPU, so the shape reproduces. The unmount figure is 0.78x with a 16% launch spread, so
read it as a number rather than a verdict.

What it pays with is the JS thread: a hosted control is still a React Native node
**and** a child of somebody else's composition, so the JS column goes the other way —
1.18x the shared host, where the unhosted control is *below* it at 0.73x. (Runs of
near-identical code have put it between 1.10x and 1.26x, so read it as roughly 1.2x.)
That cost is why `Host` is a component an app chooses
for a dense list, and not what every container does by default.

## API

`HostProps extends ViewProps` — it is a container, so it takes layout props like any
other view and nothing else. No `count`, no `renderItem`, no per-child options: those
would make it a second list component.

| Prop       | Type                    | Notes                                                            |
| ---------- | ----------------------- | --------------------------------------------------------------- |
| `children` | `ReactNode`             | Hosted controls only — see "What a Host cannot hold".             |
| `style`    | `ViewStyle`             | Its `height` is the box the content is drawn into (see Sizing).   |
| `testID`   | `string \| undefined`   | Lands on the container, as usual. Hosted *children* keep theirs, but see the caveat under "Finding a hosted control" — on Android their box is `0 × 0`. |
| `onLayout` | callback                | Chained: the caller's handler runs first, then the dev-only warning. Attaching `onLayout` at all is a dev-only cost — a release build passes yours, or none. |

## What a Host cannot hold

Each of these follows from who owns the pixels, and each is a refusal in development
rather than a screen that draws half of itself:

- **Anything that is not a hosted control.** Only `Switch` is hosted today. One of our
  other controls, an RN view (`View`, `Text`, `ScrollView`, `Image`, …), a third-party
  native view, plain text as a direct child, or another `<Host>` throws in dev — on
  **both** platforms, so the rule is not learned later on the platform that was not
  tested.
- **The rule is enforced twice, because the two sides see different trees.** JavaScript
  refuses what it can *name*. It cannot see through a component, so a `<Row>` that
  renders a `Picker` arrives at the native Host looking like a direct child, and there
  the allowlist decides: `NitroComposeHost.isHostable` is `false` for every control and
  `true` only for `Switch`, so a `Picker`, a `Slider`, or a `<Host>` behind a wrapper is
  **not** composed. In a debuggable build that refusal is not only a log line — the Host
  reports it to JavaScript, where it becomes a `console.error` in Metro and LogBox that
  names the child's class. In a release build it draws nothing and says nothing, so a
  control outside the allowlist must stay outside the `<Host>`.
- **No nesting.** A `<Host>` cannot hold another `<Host>`. The inner one would become a
  row of the outer one's column: measuring nothing, drawing a composition of its own,
  and answering to no box. Put Hosts side by side, each with its own height.
- **No interleaving.** RN cannot put an RN view between two hosted controls, or beside
  one: RN hands the Host one rectangle and everything inside it is Compose's.
- **No RN scrolling, clipping or transforming of the children.** A `ScrollView` around a
  Host moves the Host's whole rectangle. RN cannot scroll the content *inside* it, clip
  part of it (`removeClippedSubviews`) or transform one child. A list that virtualises
  has to add and remove whole children; the Host recomposes its block when the set
  changes.
- **No `Modal`**, or anything else that owns a window.
- **No per-child size.** A `width`, `height` or `alignSelf` on a hosted child moves the
  frame React Native computes, not the drawing (Sizing below).
- **Only some of a Host's own styles reach the drawing.** `width`, `height` and `flex`
  size the box, and `padding` insets it — the `Column` starts inside the padding, as in
  any other container. `gap`, `flexDirection`, `alignItems`, `justifyContent`,
  `borderWidth` and `pointerEvents` do **not**: Compose arranges the rows (one column,
  no gaps), a Host draws no border, and touches go to Compose rather than to React
  Native's hit testing. Yoga still honours each of them in the *box*, which is the trap
  a host can fall into: `gap: 8` over ten children buys 72 dp of height and no space
  between rows, and `flexDirection: 'row'` buys a one-row-tall box around a stack of
  rows. Dev builds warn about each of them once per instance. Say how tall the Host is,
  and stack it in a column.

Components are transparent in both directions. React flattens them out of the native
tree, so a wrapper that renders a `Switch` **is** a direct child of the Host and is
hosted — wrapping a control in your own component does not opt it out. The flip side is
the rule: a `Switch` inside an RN `View` inside a Host is not hosted, because the `View`
is the direct child, and a `View` is what the check refuses.

## Sizing (D24)

The rule in one breath: a hosted control never measures its content and never reports
to the sizing engine, while its React Native frame still exists, is still the engine's
answer, still feeds the Host's box, and is purely decorative. The Host places its
children itself: one Compose `Column`, in mount order, at the Host's width, from the
**top-leading edge**, clipped to the Host's box — which is the Host's own `style` or,
with no `height`, the sum of its children's engine boxes.

`docs/architecture/sizing.md` §10 has the reasoning; these are the measurements behind
it, from `example/__tests__/Host.harness.tsx`:

| Measured                                                       | Result                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Host `{width: 260, height: 140}` with 288 of children          | box is **260 × 140**; `onLayout` reports the same                  |
| Host `{width: 260}`, children `height: 24` (Compose draws 144) | height is **72** — the sum of the children's engine boxes          |
| Host with children `height: 96` vs the same Host with `20`     | **identical** presses at identical offsets                         |
| Host `{width: 300, height: 60}` vs `{height: 240}`, same rows   | the short one clips its lower rows; neither centres them           |
| Child `width: '100%'` + `alignSelf: 'stretch'` vs nothing       | hit-testable at the **same** x offsets                             |
| Eight hosted Switches on an invalidated cache                   | reports **0**, cache entries **0**, corrections **0**              |
| The same eight unhosted                                          | reports **16**, cache entries **1**                                 |
| Measure calls, hosted vs unhosted                                | **8 and 8** — Yoga still asks, and the engine still answers         |
| A hosted child's own Android view                                | found by `testID`, and **0 × 0**: it declines to measure, and is laid out at nothing |
| A Host with `padding: 32` vs the same Host with none              | the drawing starts **32 dp later**; the box is the same                |
| A hosted child with `display: 'none'` vs shown                    | the hidden row draws and answers **nothing**; the shown one answers both |

Two consequences worth stating plainly:

- **A Host that ends up 0 tall draws nothing.** It cannot grow: nothing inside it
  reports a size. Dev builds warn once per instance from the Host's own `onLayout`,
  which Fabric does send at height 0 — the harness measures the sibling below it
  instead, so the rule does not depend on the Host reporting anything about itself.
- **D17 does not apply to a hosted control.** There is no measurement that could arrive
  a frame late, so there is nothing for the first-frame rule to govern. Unhosted
  controls are unchanged, and every case in `sizing.md` §3–§7 still runs for them.

## Accessibility


What a Host changes about accessibility is *who publishes the node*, and that is
invisible from the outside. Dumped on an API 35 emulator (Android 15, 420 dpi) while the
Host screen showed three hosted Switches and a batch of 24:

- **One labelled node per hosted control, from Compose.** Each hosted `Switch`
  publishes a `android.view.View` whose `content-desc` is its `accessibilityLabel` —
  the same `Modifier.semantics { contentDescription }` as unhosted. Attribute for
  attribute (`class`, `content-desc`, `enabled`, `focusable`, `clickable`,
  `checkable`, `checked`) a hosted node and an unhosted Switch node are identical.
- **No node from the React Native side.** A hosted child's own Android view is laid out
  at `0 × 0` (Sizing above), which is not visible-to-user, so it contributes no
  accessibility node and nothing reads out a control twice: three hosted children, three
  labelled nodes; 24, twenty-four. (What it is *not* is `GONE`: Fabric re-asserts
  `VISIBLE` on that view on every layout pass, which is why the measure gate rather than
  a visibility flag is the mechanism.)
- **Reading order is mount order.** The labelled nodes sit between the RN text above
  the Host and the RN text below it, in the order the children were given, so the
  batch is read where it is — not after the whole screen.
- **The rect is the box that is drawn.** A hosted Switch reports 137 × 84 px — the
  52 × 32 dp Compose switch, not RN's frame, which is laid out at nothing. That is why
  `scripts/real-input/` can find `Hosted switch 0` by content description at
  `42,856 → 179,940` and toggle it with `adb shell input tap`: for a hosted control
  the focused rect, the drawn rect and the hit rect are one rect.
- **The Host's own box is not an accessibility element.** It has no label and no role,
  so it is not a focus stop and does not swallow its children. As everywhere in the
  library: style the box, do not re-role it (`docs/architecture/core.md` §3).
- **Off-screen children report an empty rect.** In a batch of 24 the 20 that fit the
  viewport reported bounds; the rest reported `[0,0][0,0]` until scrolled into view,
  where they reported real ones. Nothing virtualises the a11y tree, so a screen reader
  can reach every hosted control — but the whole set is in the tree at once, which is
  the same thing a Host does to composition.

### Finding a hosted control from a test

`testID` survives hosting: the child's Android view still exists and still carries the
id, so `queryByTestId` finds it. What it returns is **`0 × 0` at the Host's origin**,
because that is where RN lays a view that declines to measure (that is what the harness
measures at mount; whether a later layout pass can move it to its Yoga frame is not
pinned down yet — either way it is not where the Switch is drawn). Detox, Maestro and
Appium tap the centre of the view that carries the id, so `tap(by.id('wifi'))` inside a
Host taps nothing, or the row above.

Inside a Host, find hosted controls by **`accessibilityLabel`** — the label is published
by the Compose node, whose rect is the drawn one, which is what
`scripts/real-input/android.mjs` does for `Hosted switch 0`. Carrying `testID` into
Compose (`Modifier.testTag` with `testTagsAsResourceId`) would put a `resource-id` on the
drawn rect too; it is a follow-up, not today's behaviour.

What a Host does **not** change is the Android Switch's toggle state as a screen reader
sees it. The same dumps reported `checkable=false`, `checked=false` on the labelled node,
hosted and unhosted alike, which would mean TalkBack reads the label and says nothing
about on or off; that has not been confirmed with TalkBack yet (see
`docs/components/switch.md`). Either way it is a `Switch` item, and a Host neither adds
nor loses it. On iOS a Host is a passthrough, so the iOS a11y tree is exactly what
`docs/components/switch.md` describes.
