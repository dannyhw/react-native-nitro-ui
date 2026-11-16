# The real-input gate (Android)

Real touches, delivered by [e2e](https://github.com/e2e-inc/e2e) through
`@e2e-dev/mobile` (agent-device) and by `adb input`, asserted only against what the
app draws and what the screen reader is told. One command, one exit code, one ledger
line:

```sh
node scripts/gate.mjs real-input:android         # every control
node scripts/gate.mjs real-input:android -- --control slider
```

`--control` narrows both phases; it never narrows what counts as a pass. A run is
red if the e2e process fails, if any test fails, if any phase-2 check fails, or if
the accessibility sweep produced no case.

`scripts/real-input/android.mjs` owns the device, the stamped APK, Metro and the
private agent-device daemon. Nothing in `example/e2e` runs `adb input` or `am` to
deliver a test's touch, and nothing here asks a model what to do next: `agent.act`
and `agent.assert` are not used, because a gate that depends on a model is not a
gate. `retries` is 0 — a flaky check is fixed or reported, never retried green.

## The two phases

**Phase 1** is this directory: one `<control-id>.e2e.ts` per row of
`scripts/real-input/controls.mjs`, a real touch per control and the assertions that
only a delivered touch can make. The driver's own node map carries no `clickable`,
`checkable` or `scrollable`, and it refuses a swipe whose path leaves the view it
started inside, so a lot of reading has to wait for phase 2.

**Phase 2** runs after the last test has reported, with the daemon stopped:
`uiautomator dump` dies while the driver's session holds the device's one
accessibility connection. Two passes, in this order:

- `scripts/real-input/a11y-sweep-device.mjs` walks the `A11Y_CONTROLS` table and
  grades the tree a reader sees, one case per control, on every run, filtered or
  not. The rule is `scripts/real-input/a11y-sweep.mjs`. A run that produces no
  sweep is red.
- `scripts/real-input/android-tree-checks.mjs` then drives the device itself —
  `input tap`, `input motionevent`, `uiautomator dump` — at the leased serial only,
  one check per control id in `TREE_CHECK_IDS`, each navigating to its own screen.
  These are the checks that read a control's state off the node a finger lands on,
  count popup windows, hold a finger down, or roll a wheel.

A phase-2 failure lands on the same summary line as a test failure, named
`<control> (tree)`.

## What the suite asserts

The class of bug no in-app test can see: that a touch the operating system
delivered reached the hosted Compose control. The harness drives controls through
the library's own hooks and has never proved the
InputDispatcher → window → React Native → Compose path. Beyond that, only what a
device can see and `example/__tests__` cannot:

1. **Hit-testing and gesture arbitration.** `slider.e2e.ts` and
   `hosted-slider.e2e.ts` drag a track and read the value back — up, back down, and
   over a drag that takes three seconds; `form.e2e.ts` flicks across a row and
   asserts the list moved and nothing pressed, and taps a row that was given no
   `onPress`; `context-menu.e2e.ts`
   holds at one point and asserts the menu opened there and the view under it never
   fired.
2. **The screen-reader tree.** `reader.ts` asks whether the reader is _told_ a
   state, and `os-tree.ts` asks what the tree says on the node a finger lands on —
   `checked`, `enabled`, a group's selection, and the Android class a role reaches
   the tree as. The driver's snapshot normalises those flags away, and an in-app
   query cannot see a hosted control's name at all, because Compose publishes it on
   a `SemanticsNode` rather than a `View`. The whole-table version is the sweep in
   phase 2.
3. **Keyboard avoidance.** `keyboard.ts`, for the text controls: a focused field
   the keyboard would cover is moved clear of it, a `TextInput` inside a Popover
   stays above it, and the Popover itself is pushed, not only its field. Both
   measurements are taken once the keyboard's edge and the field's box have come to
   rest; the placement itself is never polled.
4. **Drawn press feedback.** `press-feedback.ts` compares pixels of a held press,
   and of the lift after it, against the ink the app is supposed to draw.
5. **The IME the app asks for.** `text-field.e2e.ts` and `search-field.e2e.ts`
   type through the real keyboard, and press the app's own focus and blur buttons,
   so an imperative focus is measured as a keyboard appearing and a blur as one
   going away.

Everything else — a refused change snapping back, disabled controls taking nothing,
one event per tap over N taps, event order, `maxLength`, the controlled echo — is
asserted by the harness suites, at a tenth of the cost and with an event handshake
instead of a screenshot.

## Device reads the driver will not make

Four go straight to the device, each because the driver's own route cannot answer it:
the window manager's `ime` inset and one frame of the screen taken while a finger is
down (`device-read.ts`, whose `adbShell` names the leased serial on the leased adb
server), the accessibility tree as `uiautomator dump` serves it (`os-tree.ts`), and
the density a dp number has to be judged against (`device-read.ts`).

`keyboard.ts` also _writes_ two device settings — it swaps in the emulator's real
IME and lifts `show_ime_with_hard_keyboard`, because agent-device's own IME never
draws a keyboard and a check would otherwise measure avoidance by measuring nothing.
Both go back the way they were, including when the check fails.

## Layout

The runner refuses a control with no file and a file with no control, so a control
cannot leave the suite unnoticed. Shared parts:

| File                | What it is                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `support.ts`        | tab navigation, the tappable band, echo readers                   |
| `reader.ts`         | the screen-reader rule and its known-debt rows                    |
| `keyboard.ts`       | keyboard geometry, measured from the window manager's `ime` inset |
| `press-feedback.ts` | pixels of a held press, and of the lift after it                  |
| `os-tree.ts`        | the same tree with its flags on, and the rule applied to it       |
| `device-read.ts`    | the device reads the driver will not make, on the leased serial   |

## Reading a failure

`e2e` writes a trace per attempt under `example/e2e/.e2e/android/results/<test>/`,
and the run's JSON report to `example/e2e/.e2e/android/report.json`; the trace names
the step, the box it asked for, and the screen as the driver read it at the moment
it failed. The sweep and the tree checks write nothing of their own: a refused press
prints the dump it was refused against, and a failed check prints the readings that
decided it, both into the run's log. `node scripts/gate.mjs` keeps that log and the
ledger line; the artifacts are not the record.
