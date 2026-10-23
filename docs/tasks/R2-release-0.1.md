# R2 — Release readiness 2: v0.1 docs, smoke, baselines

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/R2` (branch `task/R2-release-0.1`, from `main`
after G3 and G4 merge). **Devices / env:** assigned in the delegation message.
**Round cap (D19):** 1 + 2 fix rounds. Stay inside this list. This is the last task before the
human decides on publishing: do **not** push, create a repo, `npm publish` or tag.

v0.1 scope is fixed (D19): Switch, Slider, Progress, Button, SegmentedControl.

1. **README.md** — rewrite for a user installing 0.1:
   - drop the "pre-release / no components" status; one-paragraph pitch; requirements table;
     install (keep the verified Expo / RN CLI steps and the consumer table, updated to step 3's
     results);
   - a component table (name, SwiftUI view, Compose composable, link to
     `docs/components/<name>.md`) and one short usage example per component, typechecked
     (put them in a file the typecheck covers, e.g. `example/src/readme-examples.tsx`, and keep the
     README copies identical);
   - "Sizing" (intrinsic by default, `fillWidth`, the D17 one-frame fallback rule in plain words);
   - "Performance" — the D15 status per platform from the merged reports, honestly: where it meets
     the shared-host Expo arm and where it misses (Android mount UI CPU / memory, iOS memory with
     one host per control), and the reason (one Composition / hosting controller per control,
     T12/T13). Link `docs/architecture/benchmarks.md`;
   - "Known limitations" from `docs/tasks/FOLLOWUPS.md` items that affect users (e.g. iOS 26+
     `UIDesignRequiresCompatibility`, Expo Go unsupported, anything G3/G4 documented);
   - keep Contributing / License.
2. **Component docs:** every v0.1 component has `docs/components/<name>.md` in the same shape as
   `switch.md` (props table matching the TS types exactly, events, controlled vs uncontrolled,
   sizing, accessibility, platform differences). Fix any doc whose props table drifts from
   `src/`. Add `CHANGELOG.md` with a `0.1.0` entry listing the components.
3. **Consumer smoke:** add `Progress` and `SegmentedControl` to `scripts/smoke/App.tsx` (each with a
   testID the smoke assertions check, as the existing three do), then run `smoke:expo` and
   `smoke:rn-cli` on both platforms on your assigned devices. Update the README consumer table to
   what actually ran green; anything that cannot run on this machine is labelled, not ticked.
4. **Packaging check:** `bun run smoke:pack` (or `npm pack --dry-run`) — list the tarball contents
   in the report; confirm no `example/`, `bench/`, `docs/tasks/`, test or build output ships, and
   that `nitrogen/generated`, `cpp/`, `ios/`, `android/` (no `build/`), `lib/` and the podspec do.
5. **Baselines (D18):** one bench quick plan per v0.1 component on the canonical iPhone 17 and on
   your Android AVD with ART primed to `speed-profile`, then `--update-baseline` **only if** the
   runner accepts the run (quiet machine, no refusals). If it refuses because the machine is busy,
   record the refusal and the load average and move on — do not retry in a loop, do not `--force`.
   Put the final ratio table (all five components, both platforms, vs `expo-ui-shared-host`,
   `expo-ui-host-per-control`, `rn-core`) in the report; the README "Performance" section uses it.
6. **Gates:** `bun run check` green; iOS + Android harness full suites green; real-input green on
   both platforms (all components it covers).

Report: as AGENTS.md, plus a short "Release notes draft" section the human can paste into a GitHub
release.
