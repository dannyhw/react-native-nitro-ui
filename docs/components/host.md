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

### The other three controls (H2a)

`Slider`, `Progress` and `Button` can be hosted since 0.2.0 (the 0.1.0 Host holds
Switches only). `SegmentedControl`, `Picker` and `DatePicker` follow in 0.3.0 (H2b,
"Popups and dialogs" below), and `Menu` in 0.4.0 (G7a/G7b) — eight controls, which is
everything the library ships, so `UNHOSTABLE_CONTROLS` in `HostChildren.ts` is empty.

H2a re-ran the same plan with them in the host arm, so the four were priced first by one run
(`quick`, ART `speed-profile`, 4 launches, one results file;
`bench/results/e7b7dbf-dirty-android-20261026T135002Z.json`). That machine was **not
quiet — 37 % of its load samples sat over the ceiling**, so the run was indicative and a
quiet re-run was pending. A5 has since run the plan quiet on `maintainer-mac-2`
(`abe68a1`, 8 launches, 0.04 % of samples over the ceiling); its numbers are in
[`A5-quiet-bench-mac2.report.md`](../tasks/A5-quiet-bench-mac2.report.md) and in `README.md`, and
they reproduce this table's shape — `Switch` 0.91x memory / 0.84x UI CPU, `Progress` 0.45x
(`n/v`) and `Button` 0.80x, `Slider` level at 1.02x — and five of the ᴺ flags in the table below
clear (unhosted `Switch` and `Button` UI CPU, unhosted `Button` JS, hosted `Button` JS 0.69x,
hosted `Slider` JS 1.11x). The four unmount cells stay ᴺ — the quiet run is noisy on every hosted
unmount cell too (0.57x / 0.53x / 0.61x / 1.05x) — so the "no unmount claim" below still holds.
One verdict does reverse: unhosted
`Slider`'s mount JS CPU is **1.06x** there against the 0.94x this run read, so the JS column is
above the shared host on `Slider` in both directions, not below it unhosted. The tables below stay
as H2a measured them.
Ratios to `expo-ui-shared-host`, launch-paired; memory from the
N=200 cell, the rest from the N=50 `mount` cell; **ᴺ** = spread over 10 % and no verdict:

| Control              | Mount memory (no Host → +`<Host>`) | Mount UI CPU (no Host → +`<Host>`) | Mount JS CPU (no Host → +`<Host>`) |
| -------------------- | ---------------------------------- | ---------------------------------- | ---------------------------------- |
| `Switch`             | 2.81x → **0.88x**                  | 1.55xᴺ → **0.84x**                 | 0.80x → 1.23x                      |
| `Slider`             | 2.49x → 1.00x                      | 1.62x → **0.86x**                  | 0.94x → 1.07xᴺ                     |
| `Progress` (linear)  | 1.44x → **0.37x**                  | 0.85x → **0.50x**                  | 0.59x → 0.92x                      |
| `Button`             | 2.45x → **0.80x**                  | 1.80xᴺ → **0.87x**                 | 0.64xᴺ → 0.71xᴺ                    |

Read as absolutes from the same run (KiB per instance from the N=200 cell; ms per op for
mount UI-thread CPU from the N=50 `mount` cell):

| Control      | `nitro-ui` no Host   | + `<Host>`               | `expo-ui-shared-host` |
| ------------ | -------------------- | ------------------------ | --------------------- |
| `Switch`     | 144.1 KiB / 9.97 ms  | **45.4 KiB / 5.43 ms**   | 51.1 KiB / 6.54 ms    |
| `Slider`     | 155.0 KiB / 11.93 ms | 62.2 KiB / **6.33 ms**   | 62.3 KiB / 7.16 ms    |
| `Progress`   | 130.6 KiB / 8.55 ms  | **33.3 KiB / 5.00 ms**   | 91.2 KiB / 9.61 ms    |
| `Button`     | 188.7 KiB / 13.85 ms | **61.3 KiB / 7.21 ms**   | 77.1 KiB / 8.37 ms    |

Four things that table says, stated at the size they were measured:

- **The Host wins on memory on all four,** and by a lot on the cheap-to-draw ones: a hosted
  `Progress` bar is 33.3 KiB against the shared host's 91.2 KiB. `Slider` is the exception
  worth naming: hosting it takes it from 2.49x to **1.00x**, i.e. level with the shared
  host rather than under it, because `@expo/ui`'s shared-host Slider is itself heavy in
  this run (62.3 KiB against a bare RN `Slider`'s 14.8 KiB). Same arm shape as the
  others, worse denominator.
- **The UI-thread win is on all four** (0.50x–0.87x), and unhosted `Progress` is already
  below the shared host there (0.85x), so a `Progress` inside a Host is the one case where
  both halves of the comparison are wins rather than one of each.
- **The JS column is roughly flat, not uniformly worse.** `Switch` pays the H1 tax
  (0.80x → 1.23x, within spread). `Progress` lands near parity (0.92x, within spread).
  `Slider` (1.07x) and `Button` (0.71x) are both ᴺ in this run, so neither gets a
  verdict: the honest summary is that the JS tax seen on `Switch` was not measured on the
  other three, not that they avoid it. A5's quiet run settles both flags: hosted `Slider`
  1.07x → **1.11x**, hosted `Button` 0.71x → **0.69x**. And `Slider`'s unhosted side moves
  too, the one verdict that reverses: **1.06x** there against the 0.94x this run read, so a
  hosted `Slider` pays the JS tax from above parity, not from below it.
- **No unmount claim.** All four unmount UI CPU cells are ᴺ (launch spreads of 21 % to
  40 %), so this run says nothing about hosting and unmounting beyond H1's `Switch` row.
- **Nothing here was measured on a quiet machine.** That run's load samples: 459 of them,
  median 5.51, 170 over the ceiling of 7 (37 %, against a 10 % bar for `quiet`), so this
  run is same-run paired readings and nothing else — it mints no baseline. Its `update`
  cells are mixed: several sit within spread (`update` UI CPU 0.84x, `update.slider` UI CPU
  0.70x), several are ᴺ, and none of them is used for a claim here. The `mount` cells
  still agree with H1's quiet run on the `Switch` row (0.88x/0.84x against 0.86x/0.87x),
  which is the check that says the run is readable rather than sound.

## API

`HostProps extends ViewProps` — it is a container, so it takes layout props like any
other view and nothing else. No `count`, no `renderItem`, no per-child options: those
would make it a second list component.

| Prop       | Type                    | Notes                                                            |
| ---------- | ----------------------- | --------------------------------------------------------------- |
| `children` | `ReactNode`             | Hosted controls only — see "What a Host cannot hold".             |
| `style`    | `ViewStyle`             | Its `height` is the box the content is drawn into (see Sizing).   |
| `testID`   | `string \| undefined`   | Lands on the container, as usual. Hosted *children* keep theirs, but see the caveat under "Finding a hosted control" — on Android their box is the engine's frame, never the drawing's (`0 × 0` at mount). |
| `onLayout` | callback                | Chained: the caller's handler runs first, then the dev-only warning. Attaching `onLayout` at all is a dev-only cost — a release build passes yours, or none. |

## What a Host cannot hold

Each of these follows from who owns the pixels, and each is a refusal in development
rather than a screen that draws half of itself:

- **Anything that is not a hosted control.** Eight controls are hosted: `Switch`
  (H1); `Slider`, `Progress` and `Button` (H2a); `SegmentedControl`, `Picker` and
  `DatePicker` (H2b); and `Menu` (G7a/G7b), which is every control this library
  ships. What is left to refuse
  is therefore not a control at all: one of our other components if a future one is not
  hosted, an RN view (`View`, `Text`, `ScrollView`, `Image`, `Modal`, …), a third-party
  native view, plain text as a direct child, or another `<Host>`. Each of those throws in
  dev — on **both** platforms, so the rule is not learned later on the platform that was
  not tested.
- **The rule is enforced twice, because the two sides see different trees.** JavaScript
  refuses what it can *name*. It cannot see through a component, so a `<Row>` that
  renders a `View` arrives at the native Host looking like a direct child, and there
  the allowlist decides: `NitroComposeHost.isHostable` is `false` on the base class and
  `true` on those eight hosts only, so an RN view, one of our other controls, or a
  `<Host>` behind a wrapper is **not** composed. In a debuggable build that refusal is not only a log line — the Host
  reports it to JavaScript, where it becomes a `console.error` in Metro and LogBox that
  names the child's class. In a release build it draws nothing and says nothing, so a
  child outside the allowlist must stay outside the `<Host>`.
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
- **No React Native `Modal`**, and no other RN view that owns a window of its own. A
  hosted control that presents a popup or a dialog is a different thing and is supported:
  what a Host owns is the rectangle, and the window a child opens belongs to the
  composition inside it — see "Popups and dialogs" below. What is refused is a *sibling*
  window, owned by RN rather than by the composition, whose pixels this container would
  never see.
- **No per-child size.** A `width`, `height` or `alignSelf` on a hosted child moves the
  frame React Native computes, not the drawing (Sizing below). What the drawing is
  comes from the control's own sizing rule and the Host's box: `Slider`, a linear
  `Progress` and a `wheel` `Picker` take the Host's inner width, and `Button`, `Switch`,
  a circular `Progress`, `SegmentedControl`, a `menu` `Picker` and `DatePicker` take
  their own size at the column's leading edge.
- **Only some of a Host's own styles reach the drawing.** `width`, `height` and `flex`
  size the box, `alignSelf` moves that box inside the Host's parent, and `padding` and
  `borderWidth` inset it. The `Column` starts inside either
  one, as in any other container — `borderWidth` because Fabric reports border and
  padding as one `layoutMetrics.contentInsets` and the Host view manager forwards
  `setPadding`, so `borderWidth: 2` moves the drawing in by 2 dp. What it does *not* do
  is draw a border: a Host paints nothing of its own, and that is the trap — the box
  shrinks as if it had. What does not cross at all is `gap` / `rowGap` / `columnGap`,
  `flexDirection`, `alignItems`, `alignContent`, `justifyContent` and `pointerEvents`:
  Compose arranges the rows (one column, no gaps) and Compose takes the touches, while
  React Native's Yoga still honours each of them in the *box*. That is the other trap:
  `gap: 8` over ten children buys 72 dp of height and no space between rows, and
  `flexDirection: 'row'` buys a one-row-tall box around a stack of rows. Dev builds warn
  about each of them once per instance. Say how tall the Host is, and stack it in a
  column. `alignSelf` is on neither list, and not because of anything about the children:
  the warning reads the **Host's own** `style`, and a Host's `alignSelf` positions the Host
  inside *its* parent, which moves the box — and the drawing is inside the box.
  `<Host style={{ alignSelf: 'stretch' }}>` does exactly what it looks like, so warning
  about it was a false claim and H2a took it off the list (H1 review F5/F6). A *child's*
  `alignSelf` is still decorative, which is the "No per-child size" rule above, not an
  arrangement style.

Components are transparent in both directions. React flattens them out of the native
tree, so a wrapper that renders a `Switch` **is** a direct child of the Host and is
hosted — wrapping a control in your own component does not opt it out. The flip side is
the rule: a `Switch` inside an RN `View` inside a Host is not hosted, because the `View`
is the direct child, and a `View` is what the check refuses.

## Popups and dialogs

**Three** of the eight hosted controls present something outside their own box: a
`Picker` opens an `ExposedDropdownMenu`, a `DatePicker` on Android opens a dialog in
each of its `compact` modes, and a `Menu` opens its list — `ExposedDropdownMenuBox`
with `menuAnchor`, so the list is positioned against the trigger rather than against
whatever the container happens to be (`docs/components/menu.md`, "Inside a `Host`").
A `SegmentedControl` presents nothing and owns no window of
any kind — it is hostable because it draws itself, which is the question a Host asks, and
a real tap on one is gated as though it were not (`example/__tests__/HostPopups.harness.tsx`
and the `hosted-segmented` real-input case both check that it opens no window).

Those three windows are **the Host composition's own**: a Compose popup opened from inside
an `AndroidComposeView` is attached to that view, which is the same thing that happens
when the same control opens a menu in a composition of its own, and the same thing Expo
UI's shared host does. That is a fact about Compose, not a workaround added for Hosts —
and it is what makes *disposal* the thing that takes a window down. What the shared
anchor does not give you for free is where the anchor is: React Native's frame for a
hosted child is `0 × 0`, so an open menu's anchor is read out of the drawing
(`noteCompositionOrigin`) and its box watched from the nearest React-Native-placed
ancestor (`placedViewOf` and its `OnLayoutChangeListener`), and an open menu is taken
down by `dropOpenMenu` when that box moves out from under it. That much is engineered,
for hosted and unhosted controls alike, in `Picker` by its model, and in `Menu` by its own
`noteCompositionOrigin` and `dropOpenMenu` and the shared `placedViewOf` — and the row
about a layout move below is what it
does to a user:

| Situation | What a hosted popup does |
| --------- | ------------------------ |
| The Host is scrolled, or sits nowhere near the top of the screen | The menu opens under the box the **Host drew**, wherever on the screen that is, because that is the anchor node's position. React Native's frame for the child is never consulted — it is decorative (Sizing below), and anchoring to it would put the menu over the wrong row. Measured on a real scroll by `hosted-picker` in `scripts/real-input` (both platforms, which opens the menu after scrolling the Host's screen); the geometry of it is `example/__tests__/HostPopups.harness.tsx`, "anchors under the box the Host drew, and follows it when it moves". |
| The Host, or the row, is **moved by layout** while a menu is open | The menu closes. The window cannot follow a row that is no longer where it opened — a stale window over the wrong control is the bug — so a layout move is dismissal, the same answer the control gives when a scrolling ancestor carries an anchor away. Note this is not a scroll: scrolling changes neither the layout nor the anchor's box, and an open menu stays open across one. The same rule now applies to an **unhosted** `Picker` whose React Native view is moved (`docs/components/picker.md`). Measured: the same harness file, "anchors under the box the Host drew, and follows it when it moves" — the gate that witnesses `dropOpenMenu`. |
| Outside tap, the back gesture, or a row | Each closes it, exactly as unhosted, and the controlled handshake still decides whether the row is accepted. A refused choice still closes the menu and leaves the value where React kept it — measured for the control itself in `docs/components/picker.md`; the hosted gates show a pick closing the menu and the handshake holding, and the refusal path is the same code with a different answer from the app. |
| The options change while it is open | The open menu relays the new rows; the chosen index is whatever the list now says. |
| The control is disabled while its window is up | The window closes. A control that answers nothing cannot own a live dialog. |
| The child is removed, reordered, or the Host is dropped (`onDropView`) while a window is open | Nothing is left behind. The window belongs to the composition that opened it, so when that composition goes — including `onDropView`, which disposes it — the window goes with it. Measured, including the case where a reorder moves the row under an open menu: the menu comes down rather than floating over the wrong control. |
| A **neighbour** row leaves the Host while a window is open | The row above it is re-framed, which is a layout move, so that popup closes too: a hosted menu whose row moved reads `expanded=0;live=0`, and a hosted dialog reads the same. What does not move does not close anything — a sibling's own identity changing, with every other row where it was, leaves an open dialog open. Measured in `example/__tests__/HostPopups.harness.tsx`, "comes down with its row, and leaves nothing when the Host is dropped". |
| Two popup owners in one Host | They open one after the other and neither stays stuck: the second one's window does not inherit the first one's state, and after both have been through, no window is left. |
| TalkBack / VoiceOver | The rows are reachable while the menu is open, and the current choice is marked selected. On iOS a Host is a passthrough, so it is the ordinary `Picker` tree (`docs/components/picker.md`). |

The `DatePicker`'s dialog is the same rule in a different widget: the dialog is composed
from the model's own `presented` state inside the host composition (`docs/components/date-picker.md`),
so a hosted field opens a dialog that follows a value React writes while it is up, closes
when the field is disabled, and leaves nothing when the Host is dropped mid-dialog. Its
own OK, Cancel and Back buttons close it the same way there as anywhere else — those
presses land in another window, so they are gated with real taps in `hosted-date-picker`
(`scripts/real-input`), not from the harness. Three teardowns the flag has to follow rather
than survive: taking the child out of the Host's list, `display: 'none'` on it — which
composes no child at all — and its row being moved by layout, a neighbour row leaving
among them. The dialog follows its row, exactly as the menu above does; a dialog that
stayed up over a row that had moved was the alternative, and it is what the first cut of
this release did. The
`time` and `datetime` modes present dialogs too, and are gated as well as `date`.

Two G5 follow-ups live on that path and were fixed here rather than recorded: a dialog
left open did not follow a programmatic value, and disabling a field while its dialog was
up left the dialog live. Both are gated
(`example/__tests__/HostPopups.harness.tsx`, "follows a value React writes while the
dialog is open (G5)" and "closes when the control is disabled while the dialog is open
(G5)").

`Menu` is the third window. Its list is a Compose popup like `Picker`'s, anchored the
same way — `ExposedDropdownMenuBox` with `menuAnchor` on the trigger, so the box that
matters is the button the Host drew, read out of the drawing rather than from React
Native's `0 × 0` frame; `exposedDropdownSize()` is deliberately not used, because a menu's
list is as wide as its items need. G7b tried to reproduce the mis-anchoring that anchor
exists to prevent, four ways, and none of them moved the popup on this Material version
(1.4.0), so `menuAnchor` stays as Material's documented way to say "against *this*
control" and what the harness proves is the bound: the gap between the trigger's box and
the popup's window stays under 48 px, and a mutant that moves the window for certain
(`DropdownMenu(offset = DpOffset(0.dp, 64.dp))`) turns that red. The layout-move and
teardown dismissals above are measured for a hosted Menu too
(`example/__tests__/Menu.harness.tsx`, "opens under its own button, and follows it when the
Host moves", "comes down when its hosted child leaves the Host", "takes its window down
when its button moves inside the Host"). What differs from `Picker` is that a Menu has no
value, so the controlled handshake is not in play: a pick reports `onSelect` and then
`onClose` (DECISIONS D32). On iOS a Host is a passthrough and SwiftUI keeps the
presentation to itself, so that witness answers `-1` for every field but its row count.

What is still refused is a **React Native** `Modal` child, or any other RN view that owns
a window: that window is a sibling of the Host's, not a child of its composition, so the
Host would own a rectangle and nothing would own the pixels. If a future control cannot
be hosted, the refusal stays loud in development — a throw from the JS check, and a
`console.error` from the native one in a debuggable build — never a control that draws
half of itself.

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
| A hosted child's own Android view                                | found by `testID`; **`0 × 0` at mount**, its Yoga frame after any later pass over it — and never the drawn rect |
| A Host with `padding: 32` vs the same Host with none              | the drawing starts **32 dp later**; the box is the same                |
| A hosted child with `display: 'none'` vs shown                    | the hidden row draws and answers **nothing**; the shown one answers both |

### What each control draws inside the box (H2a)

The Host gives every child the same *constraint* — the Host's inner width — and the
control's own sizing policy (D24) decides what to do with it. That is the whole rule, and
it is the same rule the control follows when it measures itself for Yoga:

| Control                            | Policy     | Drawn inside a Host                                                        | Aimed at (Android)                    |
| ---------------------------------- | ---------- | -------------------------------------------------------------------------- | ------------------------------------- |
| `Slider`                           | fillWidth  | the Host's inner width × its own height                                     | the drawn track, by label             |
| `Progress` linear                  | fillWidth  | the Host's inner width × the bar's thickness                                | nothing to press — read the tree      |
| `Progress` circular                | intrinsic  | its own square, at the column's leading edge                                | nothing to press — read the tree      |
| `Switch`                           | intrinsic  | its own box (52 × 32 dp of drawing), at the leading edge                    | the drawn switch, by label            |
| `Button`                           | intrinsic  | the width its title needs × its scale's height, at the leading edge         | the drawn button, by label            |

Three measurements make that table rather than a claim (`example/__tests__/HostControls.harness.tsx`,
and `hosted-mixed` in `scripts/real-input/` for the tree the two `Progress` variants are read from):

- **A hosted `Slider` is stretched by the Host, not by its own style.** The same child with
  `width: 60` answers `0…100` differently in a 260 dp Host and a 100 dp one, because the
  value a tap produces is a fraction of the width Compose laid the track out at — and in
  a 260 dp Host a tap 240 dp along answers 90+. A child with no style at all answers the
  same value at the same offset: its frame was never in the calculation.
- **A hosted `Button` is not.** Two Buttons in one 260 dp Host, one titled `Go` and one
  `Roll back the release`: both start answering at the leading edge, the long title
  answers everything the short one does and more, and neither answers 250 dp across.
  `width: 220, height: 120` on the child changes none of it.
- **The `Progress` pair coexists** — a bar that fills and an indicator that does not, in
  one composition, both drawing what JS writes; the accessibility tree reports the bar as
  wide as a `Slider` in the same Host and the indicator as a small square.

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

- **One labelled node per hosted control, from Compose.** Each hosted child — Switch,
  Slider, either Progress variant, Button, SegmentedControl, Picker, DatePicker —
  publishes a `android.view.View` whose
  `content-desc` is its `accessibilityLabel`, the same `Modifier.semantics {
  contentDescription }` as unhosted. Attribute for attribute (`class`, `content-desc`,
  `enabled`, `focusable`, `clickable`, `checkable`, `checked`) a hosted node and the
  same control unhosted are identical, and a mixed Host of five children publishes five
  nodes, in mount order (`hosted-mixed`).
- **No node from the React Native side.** A hosted child's own Android view is laid out
  at `0 × 0` when it mounts (Sizing above), which is not visible-to-user, so it
  contributes no accessibility node and nothing reads out a control twice: three hosted
  children, three labelled nodes; 24, twenty-four. (What it is *not* is `GONE`: Fabric
  re-asserts `VISIBLE` on that view on every layout pass, which is why the measure gate
  rather than a visibility flag is the mechanism. A child that is re-framed later does get
  a real rect — see "Finding a hosted control" — and whether *that* view then publishes a
  node of its own is not measured, which is one more reason to address hosted controls by
  label and not by box.)
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
id, so `queryByTestId` finds it. **What it returns is never where the control is drawn**,
and it is not one stable answer:

- **At mount: `0 × 0` at the Host's origin.** A view that declines to measure gets no
  frame, so the id resolves to nothing a tool can aim at.
- **After any later layout pass over that child: its Yoga frame.** F8, measured
  (`example/__tests__/Host.harness.tsx`, `lays a re-framed hosted child at its Yoga
  frame, not its drawing (F8)`): a hosted child whose own `style` goes from 120 × 44 to
  160 × 60 then reads `[160, 60, 0, 48]` — the engine's box, in the row Yoga put it in —
  while the drawing answers at exactly the same offsets as before. A child *added* to a
  Host later reads the same way (measured `[52, 48, 0, 96]` for a third row), and so does
  one whose row moved because a sibling above it was re-framed; a sibling growing
  *outside* the Host moves nothing.

So a hosted child's box is sometimes nothing and sometimes a plausible rectangle drawn
around something else — 108 dp of box around a 52 × 32 switch. Detox, Maestro and Appium
tap the centre of the view that carries the id, so `tap(by.id('wifi'))` inside a Host taps
nothing, the middle of an empty box, or the row beside it.

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
