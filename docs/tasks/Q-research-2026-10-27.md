# Q1–Q4 — Read-only research while the bench baselines mint (2026-10-27)

**Hard rule for all four: the machine is running an exclusive benchmark (A3), and CPU load ruins
it.** Allowed: `git` (including `git log -S`), `ls`, `cat`/`sed`/`head`, and `grep`/`rg` on named
paths. That includes `node_modules/` of the main checkout
(`/Users/danielwilliams/Workspace/oss/react-native-nitro-ui/node_modules`, read-only). You may also
`git clone --depth 1` a public reference repo into `/tmp/<ID>-refs/`; read it, never run or install
anything from it. Forbidden until told otherwise: `bun`, `npm`, `npx`, `node` scripts, jest, tsc,
eslint, prettier, xcodebuild, gradle, pod, simulators, emulators, leases, `gate.mjs`, and any
`find`/`grep` across the home directory. No `bun install` in your worktree; read dependencies from
the main checkout's `node_modules`.

Each task writes **one** Markdown file in its worktree and commits it on its branch, without
pushing. Cite file:line for every claim about this repo, and a URL plus commit or version for every
claim about another repo. If you can't verify something, say so; don't guess. Keep the doc under 1,500 words
unless the task says otherwise. End your final message with a 10-line summary and the commit SHA.

## Q1 — Menu (G7a) design → `docs/tasks/Q1-menu-design.md`

0.4's Menu is button-anchored (`docs/tasks/PLAN-0.4.md`). Propose:
- the public API, following this repo's rules (AGENTS.md perf contract: no optional Hybrid View
  props, `T | null`, stable callbacks, no JSON/AnyMap props). Cover items as data (title, id,
  destructive, disabled, icon/SF Symbol, sections or dividers, maybe one level of submenu), the
  trigger (our own button label, or children?), the selection event, and the open/close events.
  Is there a controlled state at all?
- iOS: SwiftUI `Menu` inside our hosting (`ios/core`), primary action, how the label renders and
  sizes (`intrinsic`), what UIKit does underneath, and a11y.
- Android: Compose `DropdownMenu` anchored to a button inside our host, and how popups were handled
  for Picker/DatePicker, including inside `<Host>` (H2b: `docs/tasks/H2b-*`, `HostPopups.harness.tsx`,
  `NitroComposeHost.kt`).
- How `@expo/ui` does it (`node_modules/@expo/ui`), and what to copy or avoid.
- Sizing, recycling and leak risks; what the conformance suite (X4, `docs/tasks/X4-conformance.md`)
  will check; the harness and real-input test plan.
- A recommendation, plus open questions for the owner.

## Q2 — TextField pre-spike research → `docs/tasks/Q2-textfield-research.md`

T18 is a one-round spike that decides whether TextField ships in 0.4. Make that round short by
answering in advance:
- the feature list versus RN `TextInput` that a first version needs and what can wait (value,
  placeholder, secure, keyboard type, return key, autocapitalize/correct, multiline auto-grow, max
  length, editable, focus/blur/submit, selection);
- controlled text under IME composition and fast typing with this repo's event-count handshake
  (`docs/research/core-architecture.md` §4; see how Slider/Picker implement it): where it breaks and
  what the spike must prove;
- iOS: SwiftUI `TextField`/`SecureField` (`@FocusState`, selection limits) versus hosting a
  `UITextField` in our host, and auto-grow sizing for multiline;
- Android: Compose `BasicTextField`/`TextField` (`TextFieldState` vs `TextFieldValue`), IME and
  keyboard insets, and focus inside a RN tree;
- prior art: `react-native-nitro-input` (shallow-clone it from its GitHub repo), `@expo/ui`'s
  TextField (`node_modules/@expo/ui`), and RN's own `TextInput` native code where relevant
  (`node_modules/react-native`);
- the spike plan: exactly which prototypes and measurements, and explicit go/no-go criteria.

## Q3 — Three intermittent tests → `docs/tasks/Q3-flaky-tests.md`

Recorded in `docs/tasks/FOLLOWUPS.md` (last lines) and `docs/tasks/X3-component-registry.report.md`:
1. iOS `example/__tests__/Picker.harness.tsx` "asks a wheel the box question after a variant
   change": `wheel=0.00x0.00`, once at load 2.7.
2. Android `example/__tests__/HostPopups.harness.tsx` hosted DatePicker "comes down with its row,
   and leaves nothing when the Host is dropped": it asserts a process-wide
   `DatePickerModel.livePresentations` counter.
3. iOS real input `testRealInputSwitch` (`example/ios/NitroUiExampleUITests/RealInputTests.swift`):
   the second real tap isn't delivered (a known HID tap drop).

For each, give the root cause from the code (test and native implementation), whether it is a test
bug or a product bug, and a proposed fix as a patch **in the doc**. Don't edit code. Say how the fix
would be shown red, and how it would be proven deterministic (for example N consecutive runs at high
load).

## Q4 — FOLLOWUPS triage → `docs/tasks/Q4-followups-triage.md`

For every line of `docs/tasks/FOLLOWUPS.md`, give:
- a status (**open** with current file:line evidence, **fixed** with the commit, **obsolete**, or
  **covered by X4**, the conformance suite);
- a size (XS/S/M);
- for user-visible bugs, whether it affects published 0.3.x.

Then propose at most 6 small tasks that group the open items, ranked by value. This doc may run to
3,000 words; use a table.
