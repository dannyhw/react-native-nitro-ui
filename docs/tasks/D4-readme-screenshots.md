# D4 — Every component in the README, with screenshots, and a check that keeps it so

**Worktree / branch:** named in your delegation message (`task/D4-readme-screenshots`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task D4 --boot
--wait-minutes 240`). Both pairs may be held by other tasks when you start, so do the guard and docs first, and take
the screenshots once the lease is granted.

## Why

The owner wants every component in the README, with iOS and Android screenshots like the ones the first eight have
(`docs/images/components/*.png`, PR #11). AlertDialog and ConfirmationDialog shipped with a README section but no
screenshots. Nothing checks this, so the next component can miss it too. TextField (G13), Chip (G12) and BottomSheet
(G14) are adding theirs in their own tasks. Don't add theirs here.

## The screenshot convention (write it down; the guard enforces what it can)

- **Source:** the example app's Storybook story for the component (`example/src/stories/*.stories.tsx`;
  `STORYBOOK_ENABLED=true`), light appearance, default text size.
- **iOS:** a 3x iOS 27 iPhone simulator (the lease's iPhone 17 or iPhone Air), cropped to **804 px wide**.
- **Android:** the lease's API 35 emulator, cropped to **720 px wide**.
- **Naming:** `docs/images/components/<kebab-case name>-ios.png` / `-android.png`, e.g. `alert-dialog-ios.png`.
- **README:** in the component's Usage section, the same `<table>` as Switch's (`<tr><th>iOS</th><th>Android</th></tr>`,
  `width="300"`, an alt text that says what's shown).
- A presentation (dialog, sheet) is shown **presented**.

## Do

1. **Dialog screenshots.**
   - AlertDialog presented: title, message, a cancel action and a destructive action. Add a story if
     `Dialog.stories.tsx` has none that shows this.
   - ConfirmationDialog presented: the iOS action sheet, and the Android bottom sheet of rows.
   - Put both into the README's "AlertDialog and ConfirmationDialog" section as two tables. Files:
     `alert-dialog-{ios,android}.png` and `confirmation-dialog-{ios,android}.png`.
2. **The guard: a `check`-time test, `scripts/__tests__/readme-components.test.js`, with no new dependencies.**
   For every component exported as a value from `src/index.ts` out of `./components/*`, it requires:
   - a row in README's Components table;
   - the component's name in the README import block;
   - both screenshot files to exist, referenced from README in an `<img src=…>`;
   - the PNG width, read from the IHDR chunk: 804 for iOS (accept 803, because the existing `button-ios.png` is 803)
     and 720 for Android.

   `Host` is exempt, as a container with no look of its own; keep the reason next to the exemption. Error messages
   name the component and what is missing.
   It must be green on this branch, which means AlertDialog and ConfirmationDialog have their images. Prove it red
   three ways: drop a Components row, delete a screenshot, and a wrong-width PNG fixture. One line each in the
   report.
3. **The written rule.**
   - Add one line to AGENTS.md's "Quality bar": a new component lands its README Components row, import line,
     Usage section and both screenshots by the convention above, and the readme guard checks this.
   - Put the full convention in CONTRIBUTING, wherever adding a component is described (or a short new
     subsection).
   - Fix README's Usage intro sentence about the devices, so it matches the convention.
4. A patch changeset isn't needed (docs and tests only). If `check`'s package checks want one, follow what they say.

## Not in scope

Retaking the eight existing components' screenshots. TextField, Chip and BottomSheet's README sections. Anything
else: a one-line Follow-up.

## Gates

`check`. No harness file changes are expected; if you change a story, it isn't a harness file. If the guard lands in
`scripts/__tests__/`, it is check-only tooling. Then run `need --for review` and `gate.mjs export --task D4`, and
write the report from `docs/tasks/REPORT-TEMPLATE.md`, attaching the four new PNGs' sizes.
