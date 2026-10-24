# S1 — React Native Storybook in the example app

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/S1` (branch `task/S1-storybook`, from `main`).
**Devices / env:** assigned in the delegation message.
**Round cap (D19):** 1 + 2 fix rounds. Stay inside this list. Do not push (the orchestrator pushes).

The human wants the example app to double as a tester / showcase app built on React Native
Storybook, with every v0.1 component shown off. The human maintains React Native Storybook, so
follow its current documented setup exactly rather than inventing one.

1. **Setup** — add `@storybook/react-native` **10.7.x** (npm `latest`) to `example/` only (never to
   the library's `dependencies`/`peerDependencies`). Follow the package's own README / docs in
   `node_modules` and its `peerDependencies` for the required native deps (ondevice UI, controls,
   actions, backgrounds as the docs recommend). Use the documented v10 layout: `.rnstorybook/`
   config, `withStorybook` in `example/metro.config.js`, generated `storybook.requires`.
   Keep the existing `withMetroConfig` monorepo setup and the D21 timing-gate route working.
2. **How it starts** — the documented `STORYBOOK_ENABLED` pattern: `withStorybook(config, {
   enabled })` and the app entry picks the Storybook UI when enabled, the existing tabbed app
   otherwise. Add `storybook`, `storybook:ios`, `storybook:android` scripts to `example/` (and
   root aliases). The default (non-Storybook) app, the harness and the real-input runner must
   behave exactly as today — when disabled, Storybook must add nothing to the bundle.
3. **Stories** — one CSF3 file per component (`Switch`, `Slider`, `Progress`, `Button`,
   `SegmentedControl`), colocated under `example/src/stories/` (or the documented location):
   - a `Playground` story with `args`/`argTypes` covering every public prop (selects for enums,
     color controls for colours, ranged numbers, booleans) and actions for every event;
   - showcase stories that show the component off: all variants/sizes side by side, disabled,
     controlled vs uncontrolled (controlled one echoing its value in a `Text`), dark mode, and the
     sizing behaviour (intrinsic vs `fillWidth`, a parent width). Reuse the existing example
     screens' content where it fits instead of duplicating it badly.
   - Stories must type-check against the real component props (no `any`).
4. **Docs** — a short "Storybook" section in `example/README.md` and a line in the root README's
   Contributing area: how to run it on each platform.
5. **Gates** — `bun run check` green (stories are linted/typechecked); `pod install` result
   committed as needed (no worktree-path churn in `Podfile.lock`); example builds on both
   platforms; with Storybook **enabled** every story renders on both platforms (screenshot each
   component's Playground + one showcase story per platform into `docs/tasks/S1-storybook/`);
   with it **disabled**, full harness suites green on both platforms and real-input green on both.

Report per AGENTS.md: list each added dependency and why, and how you verified the disabled build
is unchanged.
