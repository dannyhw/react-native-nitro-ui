# FIX36 review — iOS development warning for an SF Symbol that draws nothing

**Diff:** `0db5b849..814aade1` · **Verdict: fix round** (two small blocking items; the design,
threading and coverage are sound)

## Checked and fine

- Release: every call site goes through `warnIosSystemImageName`, which returns on `!__DEV__`
  before touching native (`src/systemImageName.ts:83`). Release cost is one call and one
  boolean test per icon per render. The `.mm` and the core method still ship in release; they
  are a few hundred bytes, run only when called, and nothing in the library calls them.
- Threading: JS -> C++ -> `dispatch_async(main)` -> Nitro `Promise` resolved on main, which
  Nitro hands back to the JS thread. No `main.sync`, no JS-thread wait, no deadlock. The ask
  happens from a `setTimeout(0)` batch, not inside render.
- Coverage: every app-supplied name that reaches `Image(systemName:)` / `Label(systemImage:)` /
  `UIImage(systemName:)` in ios/components is covered: Button, Chip, IconButton, ListItem, Menu
  trigger, ButtonGroup items, Menu and ContextMenu rows and submenus (`useMenuRows(group,
  'ContextMenu')`). Checkbox, ListItem's chevron and ButtonGroup's overflow `ellipsis` are
  library-chosen and correctly not asked. No library-chosen name reaches a JS call site.
- Re-render: the answer is cached per name, the warning per component+name, so a re-render
  after the answer neither asks nor warns; one in flight only appends a site.
- Android: JS returns on `Platform.OS !== 'ios'`; the shared C++ takes the `#else` branch and
  resolves empty; no Kotlin change is needed (the HybridObject is C++ on both). `harness:android`
  is green on the same digest, so it builds.
- Test: `.ios.harness.tsx` follows the existing `MountChurn.android.harness.tsx` precedent; the
  suite counts (31/31) agree. Names are unique per test, so the process-wide memory cannot
  couple the tests. Removing the warning makes all three red.
- Changeset: patch, user-visible wording, no mention of the internal method. Appropriate.

## Findings

1. **Blocking — doc states something false.** `docs/components/button.md:114-115`: "A name
   with no symbol on the device draws nothing, and what is drawn for a good name and a bad one
   is the same." Read as written, a good name draws the same as a bad one (nothing). The
   intended claim is that the warning changes nothing that is drawn. Scenario: a reader of the
   "SF Symbols" section, which every new warning links to, is told good and bad names render
   alike. Fix: "The check changes nothing that is drawn."

2. **Blocking — new method on a public interface, unmarked.** `src/NitroUiCore.nitro.ts:160-168`
   adds `unresolvedSystemImageNames` to `NitroUiCore`, which is exported `@public`
   (`etc/react-native-nitro-ui.api.md:636`), and its JSDoc is written to an app developer ("A
   development-time question the app cannot answer for itself"). The brief keeps this internal,
   and the report already uses member-level `// @internal` (e.g. `hybridRef`, api.md:44).
   Scenario: the API report locks the method in as public contract, so renaming or dropping it
   later is a breaking change in a patch-level feature. Fix: tag the member `@internal`, reword
   the JSDoc as library-internal, regenerate the API report.

3. **Non-blocking — unbounded `waiting` growth when the ask fails.** `src/systemImageName.ts:50`
   and `:68` swallow a throw or rejection, but the names stay in `asked` and their `waiting`
   entries are never removed, so every later render pushes another site (`:98`) forever.
   Scenario: a Jest unit test on the default `ios` platform with no `NitroUiCore` mock (the
   manual mock throws) that renders a Button many times. Dev-only and small; delete the
   `waiting` entries for `names` in both failure paths.

4. **Non-blocking — header comment says the wrong thread.** `cpp/NitroUiSystemImages.hpp:17-18`:
   "`onDone` runs on whichever thread UIKit finished on". The `.mm` always calls it on the main
   queue; say so, since a caller that touches JS state from `onDone` needs to know.

5. **Non-blocking — test names cite the task.** `example/__tests__/SystemImage.ios.harness.tsx:82`
   (`'SF Symbol warnings (FIX36)'`) and `:30-32` (`nui.fix36.*`). AGENTS.md "Comments" forbids
   citing a task; the test title is read the same way in gate output. One precedent exists
   (`Form.harness.tsx:1822`, "X24"), which is not a reason to add another.

6. **Non-blocking — brittle total count.** `SystemImage.ios.harness.tsx:117,134` assert
   `warnings.length === 1` across the whole console, so any unrelated dev `console.warn` (a
   React or LogBox warning) during the test fails it for a reason unrelated to symbols. The
   per-name `about(...)` assertions already prove the behaviour; filter to `nitro-ui:` lines.

7. **Non-blocking — the re-render case has no red proof of its own.** The report's mutation
   (`warn()` returns early) fails test 3 at `waitForWarning`, not at the once-only assertion.
   Removing the `warned` dedupe (`systemImageName.ts:33-36`) would fail it at line 170; that
   is the red proof the brief's "none on re-render" needs. Run it, add the line.

## Follow-ups (outside the diff)

- None beyond the report's own two.
