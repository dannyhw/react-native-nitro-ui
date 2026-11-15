# The real-input suite (Android)

Real touches, delivered by [e2e](https://github.com/e2e-inc/e2e) through
`@e2e-dev/mobile` (agent-device), asserted only against what the app draws and
what the screen reader is told. Run it with:

```sh
node scripts/gate.mjs real-input:android         # every control
node scripts/gate.mjs real-input:android -- --control slider
```

`scripts/real-input/android.mjs` owns the device, the stamped APK, Metro and the
private agent-device daemon; this directory owns the checks. The suite asks the
driver for every touch — nothing in `example/e2e` runs `adb input` or `am` — and
nothing here asks a model what to do next: `agent.act` and `agent.assert` are not used,
because a gate that depends on a model is not a gate. `retries` is 0 — a flaky check
is fixed or reported, never retried green.

Four _reads_ do go straight to the device, each because the driver's own route
cannot answer it, each named and explained in
`example/e2e/real-input/device-read.ts`: the window manager's `ime` inset, one
frame of the screen taken while a finger is down, the accessibility tree as
`uiautomator dump` serves it, and the density a dp number has to be judged
against.

## What a test asserts

One thing per control: **a touch the operating system delivered reached the
hosted Compose control**. That is the class of bug no in-app test can see — the
harness drives controls through the library's own hooks and has never proved the
InputDispatcher → window → React Native → Compose path — and it is the reason
the suite exists (`docs/tasks/T15-real-input.md`).

Beyond that, only the four kinds the 2026-11-15 audit ties to a real defect, and
which no harness test in `example/__tests__` covers:

1. **Hit-testing and gesture arbitration** — `form.e2e.ts` (a flick across a row
   must not press it), `slider.e2e.ts` (a drag is one gesture, not ten taps),
   `context-menu.e2e.ts` (a scroll opens nothing).
2. **The screen-reader tree** — `reader.ts`, used by the controls whose names and
   states the audit found on the wrong node (G15, G16, G23, G24, G31). An in-app
   query cannot see a hosted control's name at all: Compose publishes it on a
   `SemanticsNode`, not a `View`. Two readings, because the driver's snapshot
   normalises the flags away: `reader.ts` asks whether the reader is _told_ the
   state, and `os-tree.ts` asks what the tree says on the node a finger lands on —
   `checked`, `enabled`, the selection of a group and the Android class a role
   reaches the tree as. `a11y-sweep.e2e.ts` then runs the whole
   `A11Y_CONTROLS` table over that same tree, one case per control, at the end of
   every run; `scripts/real-input/a11y-sweep.mjs` is the rule, unchanged from the
   driver era, and a run that does not produce its sweep is a red gate.
3. **Keyboard avoidance** — `keyboard.ts`, for the text controls (G24: a focused
   field left behind the keyboard; G22: a popup placed under it).
4. **Drawn press feedback** — `press-feedback.ts` (G30: a Form row that drew no
   ripple ink while held).

Everything else the old driver asserted — refused changes snap back, disabled
controls take nothing, one event per tap over N taps, event order, `maxLength`,
the controlled echo — is asserted by the harness suites, at a tenth of the cost
and with an event handshake instead of a screenshot.
`docs/tasks/X44-real-input-hybrid.report.md` lists each assertion of the old
driver this gate no longer makes against the harness test of the same observable.

## After the suite

Two passes run once the last test has reported, with the daemon stopped:
`uiautomator dump` dies while the driver's session holds the device's one
accessibility connection, so anything read from a dump has to wait for it to let go.

`scripts/real-input/a11y-sweep.mjs` walks every control and grades the tree a
reader sees. `scripts/real-input/android-tree-checks.mjs` then makes the checks the
driver cannot express: its node map carries no `clickable`, `checkable` or
`scrollable`, so a control's state has to be read off the node a finger actually
lands on, and it refuses a swipe whose path leaves the view it began inside — which
is exactly what a page scroll starting on a control, or a drag across a time drum,
has to do. Those checks drive the device itself (`input tap`, `input motionevent`,
`am start`) at the leased serial only, and each one is the check this gate made
before the suite existed, moved rather than rewritten. A failure there lands on the
same summary line, named `<control> (tree)`.

## Layout

One `<control-id>.e2e.ts` per row of `scripts/real-input/controls.mjs` — the
runner refuses a control with no file and a file with no control, so a control
cannot leave the suite unnoticed. Shared parts:

| File                | What it is                                                      |
| ------------------- | --------------------------------------------------------------- |
| `support.ts`        | tab navigation, the tappable band, echo readers                 |
| `reader.ts`         | the screen-reader rule and its known-debt rows                  |
| `keyboard.ts`       | keyboard geometry, measured from the resized content view       |
| `press-feedback.ts` | pixels of a held press                                          |
| `os-tree.ts`        | the same tree with its flags on, and the rule applied to it     |
| `device-read.ts`    | the device reads the driver will not make, on the leased serial |

## Reading a failure

`e2e` writes a trace per attempt under `example/e2e/.e2e/android/results/<test>/`,
and the run's JSON report to `example/e2e/.e2e/android/report.json`; both are artifacts,
not the ledger — `gate.mjs` is the record. The trace names the step, the box it
asked for, and the screen as the driver read it at the moment it failed.
