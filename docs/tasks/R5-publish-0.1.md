# R5 — Publish prep: 0.1.0 from main

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/R5` (branch `task/R5-publish-0.1`, from `main` after
the public-docs pass D1 merges). **Devices / env:** assigned in the delegation message.
**Round cap (D19):** 1 + 2 fix rounds. Do not push, tag or `npm publish` — the owner publishes by hand.
CI stays off. No personal information in anything you write (D25).

The owner's call (D26): the first npm release is **0.1.0 from current `main`** — Switch, Slider,
Progress, Button, SegmentedControl, DatePicker, Picker, and `<Host>` (Android, Switch only; iOS
passthrough). Host support for more controls becomes 0.2.

1. **Version + changelog:** `package.json` stays `0.1.0`. `CHANGELOG.md`: fold the "Unreleased" section
   into `0.1.0` (dated on the day you finish), one coherent entry. Check `release-it` config would not
   fight this (don't run it).
2. **Tarball:** `bun run smoke:pack` / `npm pack` from a clean `lib/` and clean tree; list contents in
   the report; confirm `manifest:check`, `publint`, `api-extractor` agree; nothing from `example/`,
   `bench/`, `docs/`, tests, or build output; `nitrogen/generated`, `cpp/`, `ios/`, `android/` (no
   `build/`), `lib/`, podspec present; package size.
3. **Consumer smoke on the tarball:** `smoke:expo` and `smoke:rn-cli` (current RN, and the older
   runtime row the README lists if it can run here) on both platforms. The smoke app must render all
   seven controls and one `<Host>` with two Switches, and the ready line must carry a non-zero box
   per control (extend `scripts/smoke/App.tsx` + assertions as A2 did; show red once). Update the
   README consumer table to exactly what ran green; anything that can't run here is labelled.
4. **Install docs:** README install section ready for the real publish: `npm install
   react-native-nitro-ui react-native-nitro-modules` (and the Expo prebuild / pods steps that the
   smoke actually used); remove the "not yet published" caveat **only in a final commit titled
   `docs: switch install instructions to npm`** so it can be dropped if the publish slips.
5. **Publish checklist** in the report for the owner: exact commands (`npm login`, `npm publish
   --access public` from a clean checkout of the merge commit, `git tag v0.1.0`, push the tag, GitHub
   release text from the CHANGELOG), and the post-publish check (`npm view`, a fresh smoke from the
   registry).

6. **Leftovers from the public-docs pass (D1):** README status note + component table + CHANGELOG move
   Picker / DatePicker / Host from "unreleased (main)" to `0.1.0`; the README smoke matrix must
   cover all seven (from step 3); `Picker.tsx`'s `tintColor` doc comment ("active outline/label")
   must match the four Android tint roles in `docs/components/picker.md`; add `swiftui`,
   `jetpack-compose`, `nitro-modules` (and similar) to `package.json` `keywords`.

Gates: `bun run check`; smoke as in 3. No harness/bench runs needed unless a smoke failure points at
library code. Report in `docs/tasks/R5-publish-0.1.report.md`.
