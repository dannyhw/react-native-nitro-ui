# A2 — Phase A: deferred small fixes — report

**Branch:** `task/A2-small-fixes` (from `main` at `9a1da40`) · **Devices:** iPhone 17
`F08675D3-A32B-4F88-BC81-02D7E0CB797E` and AVD `nitroui_t01` (`emulator-5570`, private adb
server `5041`), Metro `8293` — both booted by this task and shut down at the end. iPhone Air
`331EF109…`, `nitroui_t02` / `emulator-5572` / adb `5042` / Metro `8294` and
`emulator-5560` were not touched. · **Node:** `v24.18.0` (`.nvmrc`; the device
runners refuse 25/26). · **Platforms:** both, everywhere it matters. · **Not done,
deliberately:** no push, no workflow changes (D22).

## Verdict

All five brief items are done, plus one fix the gates forced (`example`'s default screen), and
the new smoke gate earned itself on its first device run: it was wrong about fractional layout
boxes, and both platforms proved it before it was trusted.

1. **`useSizingId(configuration?)` is now durable across discarded renders** — the id is hook
   state, adjusted during render, not a ref written during render. `Progress` computes its
   normalised variant once and uses that single value for `key`, the `variant` prop and the
   sizing configuration. Six new unit tests, each shown red against the code it replaces.
2. **The consumer smoke test now asserts layout, not just life.** `scripts/smoke/App.tsx`
   reports a box per control in its ready line, and both platform paths in `common.sh` call one
   shared checker. Shown red on a device, then green on all four consumer rows
   (Expo SDK 58 + RN CLI 0.88.0, both platforms).
3. **`manifest:check` and `npm pack` agree regardless of step order** — api-extractor's TSDoc
   metadata no longer lands in `lib/`. 332 files from a clean build *and* after
   `api-extractor:check`.
4. **The Button "Appearances" story stopped lying about dark mode.** The fake black card is
   gone on both platforms; before/after captures are in the repo.
5. **The G3 re-review's doc leftovers are closed** — two were already fixed by R2 (verified, not
   assumed), the iOS indeterminate-linear note is now in both `value` JSDocs.

## Files changed

- `src/core/useSizingId.ts` — id as state + render-phase adjust; the JSDoc says why not a ref and
  why not `useMemo`.
- `src/components/Progress/Progress.tsx` — one `variantKey` feeds `key`, `variant` and
  `useSizingId`; the iOS indeterminate-linear limit documented on `value`.
- `src/components/Progress/Progress.nitro.ts` — the same limit in the spec's `value` JSDoc.
- `src/__tests__/useSizingId.test.tsx` (new) — 7 tests: the hook contract (fresh id per
  configuration, stable across re-renders, a discarded change must not re-id a mounted view, a
  committed change must) and `Progress`' key/configuration agreement.
- `scripts/smoke/lib.mjs` (new) — the ready-line contract as pure functions.
- `scripts/smoke/ready-line.mjs` (new) — the command both platform paths call (exit 0/1/2).
- `scripts/__tests__/smoke-ready-line.test.js` (new) — 19 tests, including the list-sync check
  against `App.tsx`.
- `scripts/smoke/App.tsx` — per-control `onLayout`, ready line with five boxes, `…_PENDING`
  after 6 s, amber "waiting for a box" background.
- `scripts/smoke/common.sh` — `PENDING_PATTERN` + `verify_ready_line()`, used by both poll loops.
- `CONTRIBUTING.md` — the contract, what a failure looks like, and the "adding a component"
  rules (JSX line with `onLayout` + the name in `SMOKE_CONTROLS` on both sides).
- `etc/api-extractor.json`, `etc/package-files.txt` — TSDoc metadata to
  `.turbo/api-extractor-temp/`, and the manifest down to the 332 files a pack really ships.
- `example/src/stories/Button.stories.tsx` — honest `Appearances` panel (drops the fake dark
  card and its styles).
- `example/src/App.tsx` — `DEFAULT_SCREEN` back to `'switch'`, with the reason documented.
- `docs/tasks/A2-small-fixes/{ios,android}-button-appearances.png` — the after captures
  (`docs/tasks/S1-storybook/` keeps the before ones).
- `docs/tasks/A2-small-fixes.report.md`, `docs/tasks/FOLLOWUPS.md`.

## Proving the new tests and gates red

AGENTS.md requires it, so every claim below was broken and re-run, on this branch.

**Item 1, against HEAD's hook** (`git show HEAD:src/core/useSizingId.ts > src/core/useSizingId.ts`,
`npx jest src/__tests__/useSizingId.test.tsx`):

```
✕ hands a still-mounted view no new id when a configuration change is discarded
  Expected: 1   Received: 3        → Tests: 1 failed, 6 passed
```

Three ids for one mounted view: the ref mutation survives the discarded render, the hook state
does not, so the next commit mints again — and the id the live view carries has no drop coming.

**Item 1, against HEAD's `Progress`** (same method, HEAD's `Progress.tsx`):

```
✕ neither remounts nor re-ids when only the unnormalised string changes
```

`variant={'round' as ProgressVariant}` remounts nothing (`key` normalises) but re-ids the sizing
entry (the configuration did not) — the leak, from the JS side, without a native view.

**Item 2, unit level** — `scripts/__tests__/smoke-ready-line.test.js` fails the old contract by
construction: the `fails the bare line the app used to print` fixture is exactly
`NITRO_UI_SMOKE_READY` with no boxes, and it must fail (it does; 19/19 green now).

**Item 2, on a device** — `onLayout={measureFor('slider')}` deleted from `scripts/smoke/App.tsx`,
then `PLATFORM=ios bun run smoke:expo` (fresh Expo consumer, `SMOKE_TARBALL` packed from this
tree). It failed in seconds, not after `READY_TIMEOUT`:

```
smoke: FAILED: iOS ready line failed the layout contract:
ready-line: no NITRO_UI_SMOKE_READY line in the log
ready-line: the app reported: … NITRO_UI_SMOKE_PENDING switch=61x28 slider=never
  button=61x34.333343505859375 progress=354x4 segmented-control=165x31
ready-line: the ready line must carry 5 name=WxH boxes, each > 0x0.
(artifacts: /tmp/nitro-ui-smoke/artifacts/expo-20261024-143819-54286)
```

**Item 2's own bug, found by the gate** — the first *green* attempt failed on both platforms:

```
iOS:     ready-line: button: no "WxH" box in the ready line     (button=61x34.333343505859375)
Android: switch/slider/button/progress: no "WxH" box            (switch=52.19047546386719x48, …)
(artifacts: expo-20261024-144043-62715, expo-20261024-144051-64457)
```

All five controls *were* laid out; my contract asked for integers and `onLayout` reports computed
metrics — dp scaled by display density on Android, font metrics on iOS. The unit fixtures were all
integers, so nothing but a device could have caught it. The number grammar is now
`digits[.digits]`, the observed device lines are fixtures (`accepts the fractional boxes the
platforms really report`), and the fix was shown red the same way: with the integer-only grammar
that one test fails (`Tests: 1 failed, 18 passed`), with the fixed grammar 19/19 pass.

**Item 3** — `git show HEAD:etc/package-files.txt > etc/package-files.txt` (333 entries, the tsdoc
one included), same tarball, `bun run manifest:check`:

```
package-files: -lib/typescript/src/tsdoc-metadata.json is in the manifest but not in the tarball.
error: script "manifest:check" exited with code 1
```

**Item 4** — no test, a screenshot pair:
`docs/tasks/S1-storybook/ios-button-appearances.png` shows the disabled Button inside the black
card at roughly nothing; `docs/tasks/A2-small-fixes/ios-button-appearances.png` shows four
readable buttons and the note. Android: same pair (`android-button-appearances.png` in both
dirs) — the fake was equally wrong there.

## Gate results

| Command | Result |
| --- | --- |
| `bun run check` | **PASS** — exit 0 (`/tmp/A2-check-final.log`): typecheck, lint, format, jest 11 suites / 158 tests (both new files included), `test:native`, `perf:renders` 5/5, `nitrogen:check`, `autolinking:check`, `api-extractor:check`, `publint` "All good!", `manifest:check` 332 files, `readme:check` 5 blocks |
| `IOS_SIM_UDID=… METRO_PORT=8293 HARNESS_APP_PATH=$PWD/example/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app bun run harness:ios` | **PASS** — 7 suites, 99/99, 58.7 s |
| `ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 HARNESS_APP_PATH=$PWD/example/android/app/build/outputs/apk/debug/app-debug.apk bun run harness:android` | **PASS** — 7 suites, 99/99, 56.5 s |
| `IOS_UDID=… METRO_PORT=8293 bun run test:real-input:ios` | **PASS** — 4/4 controls (button, segmented-control, slider, switch) |
| `ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 bun run test:real-input:android` | **PASS** — 4/4 controls (red before the `DEFAULT_SCREEN` fix, see below) |
| `PLATFORM=ios bun run smoke:expo` (SDK 58) | **PASS** — total 150 s, all five boxes in the ready line |
| `PLATFORM=android bun run smoke:expo` (SDK 58) | **PASS** — total 195 s, ditto |
| `PLATFORM=ios bun run smoke:rn-cli` (RN 0.88.0) | **PASS** — total 119 s |
| `PLATFORM=android bun run smoke:rn-cli` (RN 0.88.0) | **PASS** — total 108 s |
| `rm -rf lib` (via `bunx del-cli lib`) → `npm pack --dry-run` | **PASS** — `total files: 332`, zero `tsdoc` entries |
| `bun run api-extractor:check` → `npm pack --dry-run` → `bun run manifest:check` | **PASS** — metadata in `.turbo/api-extractor-temp/`, nothing in `lib/`, still 332, manifest matches |

The smoke rows share one tarball packed from this working tree (`SMOKE_TARBALL`, HEAD-checked by
`assert_tarball_head`); each run copies `scripts/smoke/App.tsx` from the working tree. Ready lines
as observed — iOS `switch=61x28 slider=354x31 button=61x34.333343505859375 progress=354x4
segmented-control=165x31`, Android `switch=52.19047546386719x48 slider=363.4285583496094x48
button=91.04762268066406x48 progress=363.4285583496094x4.19049072265625 segmented-control=256x48`
— and the four screenshots sit in the runs' artifact dirs under `/tmp/nitro-ui-smoke/artifacts/`
(`expo-20261024-144435-71673`, `expo-20261024-144442-72008`, `rn-cli-20261024-144805-81396`,
`rn-cli-20261024-144810-81802`).

Both harness suites were re-run on the final tree, after every change in this report (the earlier
runs in this task predated the `example` change), and the harness files themselves are untouched,
so nothing here needed the both-platforms rule to be invoked — it was satisfied anyway.

## The fix the brief does not list: `DEFAULT_SCREEN`

`bun run test:real-input:android` was **red** on this branch, and red in exactly the same shape on
`main` with this branch's work stashed: `the app did not render its tab bar within 180000ms`. The
cause is the committed `DEFAULT_SCREEN: Screen = 'progress'` (a screenshot convenience from an
earlier task): that screen starts a 60 Hz value writer and two indeterminate indicators, the
Android window therefore never idles, `uiautomator dump` answers "could not get idle state", and
the runner — which reads the screen that way — never sees the tab bar. A `uiautomator dump`
succeeds one tab over, which is what pins it to that screen.

It is a pre-existing problem, but it makes a gate red on a clean checkout of `main`, which is not
something to leave for someone else to rediscover: `DEFAULT_SCREEN` is back to `'switch'`, with the
reason in the comment above it. Real-input Android is 4/4 after the change (and iOS was already
4/4, re-run after it: `/tmp/A2-ri-ios-fixed.log`).

Note that `docs/tasks/S1-storybook.report.md` records `real-input:android` as PASS on a branch
that carries the same `'progress'` default. Either something about that session differed (a
`DEFAULT_SCREEN` flipped for captures, a slower/quieter host) or the claim is wrong; I measured
red twice, on `main` and on this branch. Flagged in Follow-ups rather than argued.

## Decisions

- **`useState` + render-phase adjust, not `useMemo`.** The brief suggested `useMemo` on the key or
  an inner component. `useMemo` is the wrong tool here: React documents a memo as a hint it may
  throw away, and a memo discarded under a live view mints a fresh id — the exact leak this hook
  exists to prevent. (It also fails `react-hooks/exhaustive-deps` on a value that must not be
  recomputed per render.) The state form is React's documented "adjust state when a prop changes"
  pattern: what a discarded render wrote is discarded with it, so the next render sees the
  committed configuration and keeps the id the mounted view already carries. The old id still ends
  exactly once, in the drop of the view that carried it.
- **`Progress` derives one `variantKey`.** `key`, the `variant` prop and the sizing configuration
  are the same expression now, so they cannot disagree, and a JS caller that bypasses the union
  cannot mint an id without a remount.
- **The contract lives in `lib.mjs`, the CLI in `ready-line.mjs`, `common.sh` calls the CLI.** Same
  split as `scripts/bench/`, and it is what makes iOS and Android unable to drift: neither path
  greps the pattern any more. `App.tsx` cannot import the module (it is copied into a consumer app
  we do not build), so the control list is a deliberate copy and a test checks both sides.
- **The app says `NITRO_UI_SMOKE_PENDING` rather than going quiet.** A control that never lays out
  used to cost the full `READY_TIMEOUT` and a screenshot; now it costs 6 s and the sizes are in
  the failure message.
- **Packaging: move the artefact, not the manifest.** Adding `tsdoc-metadata.json` to the manifest
  would make the tarball depend on whether api-extractor had been run; redirecting it to
  `.turbo/api-extractor-temp/` (already the tool's scratch area, and never packed) makes the
  answer independent of step order, which is what the brief asked for.
- **Dropped the dark panel rather than faking it harder.** RN 0.88 has no per-subtree appearance
  override (no `overrideAppearance` prop; `Appearance.setColorScheme()` is app-wide), so no story
  can honestly paint a second appearance. The panel now says which appearance it *is* in, and
  `docs/components/button.md` keeps the real light/dark pair.
- **`DEFAULT_SCREEN` back to `'switch'`** — the committed default should be a screen a window can
  idle on; screenshots still flip it per task, as before.

## Capturing the Storybook pair

`bun run storybook:generate`, then a scratch `initialSelection: 'button--appearances'` in
`example/.rnstorybook/index.tsx` (restored afterwards — `git status` shows the entry unmodified),
Metro as `STORYBOOK_ENABLED=true … react-native start --port 8293`, then the app pointed at it the
way `scripts/real-input/` does: `RCT_jsLocation` on iOS (deleted afterwards), `debug_http_host` +
`adb -s emulator-5570 reverse tcp:8293` on Android (reverse removed afterwards). Screenshots via
`simctl io screenshot` / `exec-out screencap`.

## Follow-ups

- The same fake "on a dark surface" card is still in `Switch.stories.tsx:216`,
  `Progress.stories.tsx:216` and `SegmentedControl.stories.tsx:288`. Same problem, same fix
  (Button's is the pattern). Out of this brief, which named the Button showcase.
- `docs/tasks/S1-storybook.report.md` claims `real-input:android` PASS; measured red at `main`
  and at `9a1da40` with `DEFAULT_SCREEN = 'progress'` (root cause above). Worth correcting in that
  report so nobody trusts the row.
- Deeper than the default screen: an animating Android screen makes `uiautomator dump` unusable
  ("could not get idle state"), so any future Android gate that reads the hierarchy inherits this.
  A `Progress` that animates forever is legitimate app content, not a bug — the runner may want a
  non-idle-tolerant read path.
- `react-native-harness` needs an **absolute** `HARNESS_APP_PATH`; a relative one aborts the
  session as an opaque `DOMException [AbortError]` with no hint at the cause (cost me three runs).
- The smoke ready line now prints raw metrics (`34.333343505859375`), which is truthful and noisy.
  Rounding for humans was not worth splitting the value the assertion parses.

## Questions for orchestrator

None — nothing blocks merging. One heads-up: this branch changes what
`bun run smoke:expo`/`smoke:rn-cli` accept as a passing run (five non-zero boxes), so any other
open task that reads a consumer smoke as "ready line appeared" will now see failures it did not
expect — correctly, if a control really is not laying out.
