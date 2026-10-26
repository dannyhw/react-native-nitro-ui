# Host

A container that renders its nitro-ui children into **one** native composition
instead of one per control. On Android that means one Compose `Composition`, one
`AndroidComposeView` and one `LayoutNode` tree for the whole batch; outside a Host
every control brings its own.

It is **opt-in**, and Android-only for now: on iOS `<Host>` is a documented
passthrough `View` while the iOS spike (T17) runs, so the same JSX renders normally
there and an app gets one tree to reason about, not two (D23).

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
measured at N=200 Switches, `quick` plan, ART `speed-profile`:

|                                | `nitro-ui` (no Host) | `expo-ui-shared-host` | `nitro-ui` + `<Host>` |
| ------------------------------ | -------------------- | --------------------- | --------------------- |
| Mount memory                   | 2.75x                | 1.00x                 | **0.87x**             |
| Mount UI-thread CPU per op     | 1.50x                | 1.00x                 | **0.80x**             |

(Host numbers are T16's spike, `docs/tasks/T16-host-spike.report.md`; H1 re-measures
them in `docs/tasks/H1-android-host.report.md`.)

What it pays with is the JS thread: a hosted control is still a React Native node
**and** a child of somebody else's composition (T16: 1.10x mount JS CPU per op against
the same shared host). That cost is why `Host` is a component an app chooses, and not
what every list does by default.

## API

`HostProps extends ViewProps` — it is a container, so it takes layout props like any
other view and nothing else. No `count`, no `renderItem`, no per-child options: those
would make it a second list component.

| Prop       | Type                    | Notes                                                            |
| ---------- | ----------------------- | --------------------------------------------------------------- |
| `children` | `ReactNode`             | Hosted controls only — see "What a Host cannot hold".             |
| `style`    | `ViewStyle`             | Its `height` is the box the content is drawn into (see Sizing).   |
| `testID`   | `string \| undefined`   | Lands on the container, as usual.                                 |
| `onLayout` | callback                | Chained: the dev warning below runs before the caller's handler.  |

## What a Host cannot hold

Each of these follows from who owns the pixels, and each is a refusal in development
rather than a screen that draws half of itself:

- **Anything that is not a hosted control.** Only `Switch` is hosted today. One of our
  other controls, an RN view (`View`, `Text`, `ScrollView`, `Image`, …), a third-party
  native view, or plain text as a direct child throws in dev — on **both** platforms, so
  the rule is not learned later on the platform that was not tested. A component the
  check cannot see through is passed to the native Host, which composes it when what it
  renders is a control and logs a warning in a debuggable build when it cannot.
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
| A hosted child's own Android view                                | found by `testID`, and **0 × 0**: it is `GONE` while the Host draws it |

Two consequences worth stating plainly:

- **A Host that ends up 0 tall draws nothing.** It cannot grow: nothing inside it
  reports a size. RN does not send `onLayout` for a view it laid out at zero, so the
  dev warning also fires from the parent's box — one warning per instance, in dev.
- **D17 does not apply to a hosted control.** There is no measurement that could arrive
  a frame late, so there is nothing for the first-frame rule to govern. Unhosted
  controls are unchanged, and every case in `sizing.md` §3–§7 still runs for them.

## Accessibility


What a Host changes about accessibility is *who publishes the node*, and that is
invisible from the outside. Dumped on `nitroui_t01` (Android 15, 420 dpi) while the
Host screen showed three hosted Switches and a batch of 24:

- **One labelled node per hosted control, from Compose.** Each hosted `Switch`
  publishes a `android.view.View` whose `content-desc` is its `accessibilityLabel` —
  the same `Modifier.semantics { contentDescription }` as unhosted. Attribute for
  attribute (`class`, `content-desc`, `enabled`, `focusable`, `clickable`,
  `checkable`, `checked`) a hosted node and an unhosted Switch node are identical.
- **No node from the React Native side.** A hosted child's own Android view is `GONE`
  (Sizing above), so it contributes no accessibility node and nothing reads out a
  control twice: three hosted children, three labelled nodes; 24, twenty-four.
- **Reading order is mount order.** The labelled nodes sit between the RN text above
  the Host and the RN text below it, in the order the children were given, so the
  batch is read where it is — not after the whole screen.
- **The rect is the box that is drawn.** A hosted Switch reports 137 × 84 px — the
  52 × 32 dp Compose switch, not RN's frame, which is `GONE`. That is why
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

What a Host does **not** fix is the library's existing gap: our Android control
publishes no toggle role or state — `checkable=false`, `checked=false`, hosted and
unhosted alike — so TalkBack reads the label and says nothing about on or off. That is
a `Switch` item, tracked with the other semantics work, and a Host neither adds nor
loses it. On iOS a Host is a passthrough, so the iOS a11y tree is exactly what
`docs/components/switch.md` describes.
