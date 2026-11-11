/**
 * The conformance suite: four rules, run over every control in the registry.
 *
 * This is the in-app half of task X4. Three of the four rules are asserted here, for
 * every self-sizing control, from one parameterised suite rather than seven hand-written
 * ones; the fourth — the accessibility name on the node a person can act on — is asserted
 * here on iOS and, on Android, from the host inside `real-input:android`
 * (`scripts/real-input/a11y.mjs`), because a test process on Android cannot see a Compose
 * control's name at all: the harness queries match `View.contentDescription` and Compose
 * publishes `SemanticsNode`s that are not Views. `Slider.harness.tsx` and
 * `Progress.harness.tsx` already say so where they hit the same wall, so this file does not
 * pretend otherwise: it asserts the iOS half and, on Android, prints where the rule runs.
 *
 * ## Why a suite instead of seven tests
 *
 * Every one of these bug classes was caught late in review because the check for it existed
 * for one control and not for the others (`docs/tasks/PROCESS-review-2026-10-26.md` §1: fix
 * rounds cost 44 % of implementer time). The rules and tables live in
 * `scripts/conformance-core.mjs`, driven by the registry's own manifests, and
 * `scripts/__tests__/component-coverage.test.js` asserts this file has one fixture per
 * manifest — so 0.4's Menu is covered the day it gets a `component.json`, and the day
 * before that `check` is red on a machine with no device.
 *
 * ## Why the table below is a mirror, and not an import
 *
 * No harness suite imports anything from `scripts/` (nothing in `example/__tests__/` does
 * today), so the shared numbers are embedded as JSON in the marked region and
 * `checkSharedTableMirror` asserts that region equals `sharedInAppTable()` on every
 * `bun run check`. That is what stops this file from asserting against its own copy of the
 * answer — the tautology AGENTS.md rules out ("test fixtures must not coincide with the
 * right answer"), which is otherwise exactly what a duplicated table becomes.
 *
 * ## What makes these able to fail
 *
 * Each rule's decision logic is shown red in `scripts/__tests__/conformance.test.js`, and
 * each has a device-side counterpart here that is not satisfied by the same number twice:
 *
 * - the fallback rule compares the control's measured size with a table written from the
 *   component's source, then **poisons** the engine's guess with a size no control declares
 *   and requires a correction to arrive. `Button.harness.tsx` explains the precedent for
 *   why, at its own poison helper: a declared fallback that is close to the truth makes
 *   every "the box was right" assertion pass even when no correction ever happens.
 * - the leak rule takes its baseline *after* a warm-up mount, so the component's own
 *   registry row cannot be counted as a leak — the mistake that would get the rule exempted
 *   the first time it was green-ish for the wrong reason.
 * - the recycle rule asserts each property against the props of the control's *second*
 *   owner, so a value that stayed behind names itself.
 *
 * ## The recycle rule, and what it can reach on each platform
 *
 * Both platforms run the reset today, and F6 is what established that for Android rather than
 * reading it off a call graph. Round 1 of this file had it the other way round, and what it
 * wrote was true of RN 0.80 and false of the version this repo ships on.
 *
 * - **iOS recycles by default.** Nitrogen reports each of our views as recyclable when it
 *   implements `RecyclableView` (`NitroUiAutolinking.swift:71`), which all seven do, and
 *   nothing overrides that — so Fabric's registry enqueues the instance on unmount, calling
 *   `prepareForRecycle` as it does (`RCTComponentViewRegistry.mm:117`), and dequeues it for
 *   the next mount of that component (`:95`).
 * - **Android recycles under a flag the example app now turns on.** X4 recorded that
 *   `prepareToRecycleView` is a legacy-architecture hook whose only caller is
 *   `ViewManager.recycleView`, so Fabric's Android layer "calls `onDropViewInstance` and
 *   nothing else". On RN 0.88 that is not the whole graph: `ViewManager.onDropViewInstance`
 *   also calls `prepareToRecycleView` and pushes the view onto a pool, and
 *   `createViewInstance(tag, …)` pops it — guarded on `enableViewRecycling`, whose default is
 *   `false`, which is presumably why the hook looked dead. The example app sets that flag
 *   (`example/android/.../NitroUiFeatureFlags.kt`), and `example/__tests__/Recycling.harness.tsx`
 *   proves the consequence rather than assuming it: a dropped control answers `recycled` on
 *   the perf ring, and a *later* mount reads `recycles >= 1` from counters the reset
 *   deliberately does not clear — which a freshly allocated view cannot do under any
 *   circumstance.
 *
 * Consequence for this suite, stated plainly: **the residue probes can go red on either
 * platform**, and both have been shown red (the report lists the per-control mutations and
 * the assertion each one turned up). Both halves run on both platforms, and
 * `checkInAppFixtures` insists every control has a probe or a written reason it cannot have
 * one, so the list of unprovable controls cannot grow by omission.
 *
 * @file Gates: `harness:ios`, `harness:android`. Discovered automatically:
 *       `example/jest.harness.config.mjs` matches any `*.harness.tsx` under a
 *       `__tests__` directory, so nothing here needed registering.
 */
import type { ComponentProps, ReactElement } from 'react';
import { Platform, Text, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import { deviceLocale, deviceLocaleNote } from './deviceContext';
import { waitForHandle } from './handles';
import { ALLOW_LOCALE_MISMATCH_ENV, localeMismatchAllowed } from './timingGate';
import {
  AlertDialog,
  BottomSheet,
  Button,
  Checkbox,
  Chip,
  ContextMenu,
  DatePicker,
  Form,
  ButtonGroup,
  IconButton,
  ListItem,
  Menu,
  Picker,
  Popover,
  Progress,
  SearchField,
  SegmentedControl,
  Slider,
  Stepper,
  Switch,
  TextField,
  Tooltip,
  nitroUiCore,
  type MenuGroup,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/**
 * BEGIN CONFORMANCE SHARED TABLE
 *
 * Emitted by `sharedInAppTable()` in `scripts/conformance-core.mjs` and checked
 * against it by `checkSharedTableMirror` on every `bun run check`, so a number
 * changed here without being changed there fails `check` rather than passing a
 * wrong assertion. The region is JSON — that is what makes it checkable as text —
 * so no type annotation, comment or expression may go inside it, and the
 * `prettier-ignore` below stays: the formatter quotes object keys, and quoted-out
 * keys are no longer JSON. Regenerate the whole block with
 * `node scripts/conformance/print-shared-table.mjs --write`.
 */
// prettier-ignore
const SHARED = {
  "declaredFallbacks": {
    "NitroUiSwitch": {
      "android": {
        "width": 52,
        "height": 48
      },
      "ios": {
        "width": 61,
        "height": 28
      }
    },
    "NitroUiMenu": {
      "android": {
        "width": 75.1,
        "height": 52
      },
      "ios": {
        "width": 74,
        "height": 38
      }
    },
    "NitroUiSlider": {
      "android": {
        "width": 328,
        "height": 48
      },
      "ios": {
        "width": 351,
        "height": 31
      }
    },
    "NitroUiButton": {
      "android": {
        "width": 75.1,
        "height": 48
      },
      "ios": {
        "width": 77,
        "height": 35
      }
    },
    "NitroUiProgress": {
      "android": {
        "width": 320,
        "height": 4
      },
      "ios": {
        "width": 320,
        "height": 4
      }
    },
    "NitroUiSegmentedControl": {
      "android": {
        "width": 187.9,
        "height": 48
      },
      "ios": {
        "width": 165,
        "height": 31
      }
    },
    "NitroUiDatePicker": {
      "android": {
        "width": 131,
        "height": 48
      },
      "ios": {
        "width": 107,
        "height": 36.33,
        "measuredUnderLocale": "en-US"
      }
    },
    "NitroUiPicker": {
      "android": {
        "width": 280,
        "height": 56
      },
      "ios": {
        "width": 72,
        "height": 35
      }
    },
    "NitroUiTextField": {
      "android": {
        "width": 200,
        "height": 24
      },
      "ios": {
        "width": 200,
        "height": 22
      }
    },
    "NitroUiSearchField": {
      "android": {
        "width": 200,
        "height": 56
      },
      "ios": {
        "width": 200,
        "height": 28
      }
    },
    "NitroUiChip": {
      "android": {
        "width": 96,
        "height": 48
      },
      "ios": {
        "width": 80,
        "height": 28
      }
    },
    "NitroUiCheckbox": {
      "android": {
        "width": 48,
        "height": 48
      },
      "ios": {
        "width": 26,
        "height": 26
      }
    },
    "NitroUiIconButton": {
      "android": {
        "width": 48,
        "height": 48
      },
      "ios": {
        "width": 44,
        "height": 44
      }
    },
    "NitroUiStepper": {
      "android": {
        "width": 104,
        "height": 48
      },
      "ios": {
        "width": 94,
        "height": 32
      }
    },
    "NitroUiButtonGroup": {
      "android": {
        "width": 300,
        "height": 48
      },
      "ios": {
        "width": 300,
        "height": 34.4
      }
    },
    "NitroUiListItem": {
      "android": {
        "width": 300,
        "height": 56
      },
      "ios": {
        "width": 300,
        "height": 52
      }
    }
  },
  "poisonSizes": {
    "android": {
      "width": 111,
      "height": 13
    },
    "ios": {
      "width": 97,
      "height": 11
    }
  },
  "tolerance": 0.6,
  "boxRules": {
    "NitroUiSwitch": "both",
    "NitroUiMenu": "none",
    "NitroUiSlider": "height",
    "NitroUiButton": "none",
    "NitroUiProgress": "height",
    "NitroUiSegmentedControl": "both",
    "NitroUiDatePicker": "both",
    "NitroUiPicker": "both",
    "NitroUiTextField": "height",
    "NitroUiSearchField": "height",
    "NitroUiChip": "none",
    "NitroUiCheckbox": "height",
    "NitroUiIconButton": "both",
    "NitroUiStepper": "both",
    "NitroUiButtonGroup": "height",
    "NitroUiListItem": "height"
  },
  "exemptions": [
    {
      "component": "Menu",
      "rule": "recycle-reset",
      "followups": "X4 recycle rule: Menu holds residue no read-out can show, so the rule cannot fail for it",
      "detail": "a Menu’s open popup is native-owned state (D29). Since F6 the blind half is iOS alone: no harness gesture reaches a SwiftUI `Menu`, and `nuiTestMenuReport()` answers `-1` for `expanded` there. Android reads the flag and recycles, and its reset line is guarded by `MenuModelTest`."
    }
  ]
};
/** END CONFORMANCE SHARED TABLE */

/** The in-app view of {@link SHARED}, typed; the table itself stays JSON so it is checkable. */
type Exemption = {
  component: string;
  rule: string;
  followups: string;
  detail: string;
};
const EXEMPTIONS = SHARED.exemptions as ReadonlyArray<Exemption>;

/* --------------------------------- the seams --------------------------------- */

type Size = { width: number; height: number };
/**
 * A `DECLARED_FALLBACKS` row for one platform: the box, plus the locale its numbers were
 * measured in when they depend on one (`measuredUnderLocale` — the DatePicker's field width
 * is a date formatter's output). From the mirrored table, never written here.
 */
type DeclaredRow = Size & { measuredUnderLocale?: string };
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
  typeChar(character: string): Promise<void>;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What a control's `hybridRef` hands back.
 *
 * Declared here rather than imported: DECISIONS D14 keeps Hybrid View types off the public
 * surface, and every field below is one the real handles all have — `accessibilityLabel`
 * and `measureContent()` on all seven, the value fields on the ones that have a value to
 * report. Optional because a control that has no `selectedIndex` reports no field, and the
 * recycle rule must not invent one.
 */
type Handle = {
  readonly accessibilityLabel: string | null;
  readonly value?: boolean | number | string | null;
  readonly selectedIndex?: number | null;
  /**
   * Menu's trigger text (`HybridNitroUiMenu.swift`'s `title` getter). Read because the
   * recycle rule's props half asks what the control says about itself, and a Menu has no
   * value — its title *is* the thing a previous owner could leave behind if a wrapper ever
   * stopped providing it.
   */
  readonly title?: string;
  measureContent(): Size;
  /**
   * The Slider's own answer to "what value is showing, and what happened when a reader
   * acted on it" — `performed accessibilityIncrement on <node> <from>-><to> disabled=<bool>`,
   * numbered `#n` on Android. The recycle rule's oracle for this control, because it is the
   * one number that comes from the view rather than from React's last write: the `value`
   * getter above returns `model.state.js` (`HybridNitroUiSlider.swift:693`), which is what
   * React sent, so it cannot show what the reset owns.
   */
  nuiTestAccessibilityStep?(direction: number): void;
  nuiTestAccessibilityStepReport?(): string;
  /**
   * Picker's report — `expanded=<0|1>;live=<n>;…`. `live` is how many menus the platform
   * believes this control has open, which is state the reset owns and no prop rewrites.
   */
  nuiTestMenuReport?(): string;
  /**
   * DatePicker's report — its displayed instant plus whether a presentation is open, both
   * from the view. `nuiTestSelect(...)` drives a selection through the control's own path,
   * which is what leaves residue for a reset to clear.
   */
  nuiTestStateReport?(): string;
  /** Opens the DatePicker's own presentation — the other thing a dropped mount can leak. */
  nuiTestPresent?(): void;
  /**
   * Drive a selection through the control's own path. Two arities because two controls share
   * the hook name: `Picker` names an index (`HybridNitroUiPicker.swift:544`), `DatePicker`
   * names a year/month/day/hour/minute, and this is one handle type for all seven controls.
   */
  nuiTestSelect?(...fields: number[]): void;
  /** Progress's displayed fraction, as the view draws it, plus its animation flag. */
  nuiTestDisplayedValue?(): string;
  /**
   * SegmentedControl's answer to "which segment is the row painting" — `displayed=<index>`,
   * or `displayed=none` before the hosted row has been handed a selection at all. F6's
   * read-out, written in the SwiftUI body / the composable rather than in a prop setter, and
   * the recycle rule's oracle for this control: the handle's `selectedIndex` returns
   * `state.js`, which is what React sent, so it cannot show what the reset owns.
   */
  nuiTestDisplayedIndex?(): string;
  /**
   * The Form's line: `rows`/`sections` registered with this list, `orphans` in neither a
   * cell nor their section's holding view, and the scroll the platform is showing. Both are
   * the view's own answer about what it is holding, which is what a reset owns.
   */
  nuiTestFormReport?(): string;
  /** Scroll the Form's list, so a probe can leave an offset behind for a reset to clear. */
  nuiTestScrollTo?(y: number): void;
  /**
   * Stepper's seam: take one step through the path a tap takes (`+1` up, `-1` down), so a
   * probe can leave a *value* behind that no prop describes. The other control with a seam
   * of this shape is Slider, which publishes the reader's action instead of the tap's.
   */
  nuiTestStep?(direction: number): void;
  /** Dialog's JS copy of `isPresented`, read back from the view's own props. */
  readonly presented?: boolean;
  /** Dialog's test hook: dismiss as a user would, through the real path. */
  nuiTestDismiss?(): void;
  /**
   * TextField's own report: the text the control holds (not React's `value`), its focus,
   * and the handshake's counts - state no prop rewrites.
   */
  nuiTestState?(): { text: string; focused: boolean; nativeEvents: number };
  /** TextField's focus, through the native method its `ref` calls. */
  focus?(): void;
  blur?(): void;
  /**
   * Chip's label, the props half of its recycle rule. `null` is Picker's: its handle
   * carries an optional field label of the same name.
   */
  readonly label?: string | null;
  /**
   * Chip's press, through the tap's own path (`ChipModel.press()`): the iOS harness's
   * HID-less touch reaches no SwiftUI button gesture, so this is how a probe presses a
   * Chip there (`Chip.harness.tsx` measured it).
   */
  nuiTestPress?(): void;
  /**
   * ButtonGroup's press of one named item, through the tap's own path
   * (`ButtonGroupModel.press(id)`): a harness touch cannot name an item in a row.
   */
  nuiTestPressItem?(id: string): void;
  /**
   * ButtonGroup's "what did the row draw" probe, which has to be *driven* before
   * `nuiTestStateReport` can answer: neither platform can read overflow out of its
   * toolkit's state, so the row stamps the report as it lays out.
   */
  nuiTestProbeRow?(): void;
  /** ButtonGroup's semantics probe, same reason. */
  nuiTestProbeAccessibility?(): void;
  /**
   * Checkbox's value, the props half of its recycle rule. `Chip`'s `label` and `Switch`'s
   * `value` have the same job: `useControlled` echoes it back, so it is what React last
   * sent rather than what the view shows — which is why each of the two recycle probes
   * below is an interaction and not a read of this field.
   */
  readonly checked?: boolean | null;
  /**
   * Checkbox's toggle, through the tap's own path (`CheckboxModel.press()`). On iOS the
   * harness's HID-less touch reaches no SwiftUI gesture and a `.switch` `Toggle` is one,
   * so this is how a probe toggles a Checkbox there (`Checkbox.harness.tsx`'s
   * `toggleCheckbox` says why). Both platforms end in `press()`, which is where the
   * residue a reset has to clear is written.
   */
  nuiTestToggle?(): void;
  /**
   * ContextMenu's report (`ContextMenu.nitro.ts`): `open`, `opens`/`closes`/`selects`,
   * `title` and the rest, `;`-separated, from a snapshot the UI thread publishes.
   */
  nuiTestContextMenuReport?(): string;
  /** ContextMenu's pick, through the path a row press takes. */
  nuiTestSelectRow?(id: string): void;
};

/**
 * Toggle a Checkbox: a real harness tap on Android, the control's own press path on iOS,
 * where the harness's HID-less touch reaches no SwiftUI gesture (`Checkbox.harness.tsx`'s
 * `toggleCheckbox` and `Chip.harness.tsx`'s `pressChip` measure the same thing). Both go
 * through `press()`, so a probe and a finger cannot disagree about what a press means.
 */
const pressCheckbox = async (testId: string): Promise<void> => {
  if (PLATFORM === 'ios') {
    await screen.findByTestId(testId);
    const handle = handleFor(testId);
    if (handle.nuiTestToggle == null) {
      throw new Error(
        `"${testId}" is not a Checkbox - it has no nuiTestToggle()`
      );
    }
    handle.nuiTestToggle();
    return;
  }
  await pressControl(testId);
};

/**
 * The glyph every IconButton fixture mounts, named on both platforms.
 *
 * A drawable *name* the library itself ships, not an app asset: the conformance
 * suite runs against a release-less harness build on two platforms, and G19's
 * drawable-name form needs no dev server and no Metro asset to resolve. `xmark`
 * is the same drawing's iOS name — and it has to be named, because on iOS the
 * symbol *is* the control's width, so a fixture that sent `null` would measure an
 * empty label and the fallback row would be compared against nothing.
 */
const ICON_BUTTON_GLYPH = {
  systemImage: 'xmark',
  androidIcon: 'nitroui_close',
};

/**
 * Press an IconButton: a real harness tap on Android, the control's own press path on
 * iOS, where the harness's HID-less touch reaches no SwiftUI `Button` gesture (the
 * Checkbox and Chip notes above say why). Both end in `press()`, so a probe and a
 * finger cannot disagree about what a press means — including the fact that a disabled
 * control takes neither.
 */
const pressIconButton = async (testId: string): Promise<void> => {
  if (PLATFORM === 'ios') {
    await screen.findByTestId(testId);
    const handle = handleFor(testId);
    if (handle.nuiTestPress == null) {
      throw new Error(
        `"${testId}" is not an IconButton - it has no nuiTestPress()`
      );
    }
    handle.nuiTestPress();
    return;
  }
  await pressControl(testId);
};

/**
 * Type into the focused TextField the way a keyboard does: `insertText` on the iOS first
 * responder, the focused view's `InputConnection` on Android (the example app's probe -
 * `TextField.harness.tsx` says why `HarnessUI` cannot reach a Compose field).
 */
async function typeIntoFocusedField(text: string): Promise<void> {
  for (const key of Array.from(text)) {
    if (PLATFORM === 'ios') {
      await harnessUi.typeChar(key);
    } else {
      const probe = TurboModuleRegistry.getEnforcing(
        'NitroUiProbe'
      ) as unknown as {
        imeInput(kind: string, text: string): Promise<string>;
      };
      await probe.imeInput('commit', key);
    }
    await sleep(30);
  }
}

/** Focus a TextField fixture and type `text` into it; waits for the field to hold it. */
async function typeIntoField(testId: string, text: string, expected: string) {
  const handle = handleFor(testId);
  handle.focus?.();
  await waitFor(() => expect(handle.nuiTestState?.().focused).toBe(true), {
    timeout: 5000,
  });
  await typeIntoFocusedField(text);
  await waitFor(() => expect(handle.nuiTestState?.().text).toBe(expected), {
    timeout: 5000,
  });
  handle.blur?.();
}

/**
 * The recycle rule's per-control oracle, and the honest answer to what round 1 asserted.
 *
 * A recycled control's **props cannot show residue**, on either platform, for reasons two
 * layers above ours:
 *
 * - Fabric hands a recycled instance its props as a *fresh mount* - the Insert mutation calls
 *   `updateProps:newProps oldProps:nil` (`RCTMountingManager.mm:83`) - so the generated
 *   setters run for every provided prop (`HybridNitroUiSwitchComponent.mm:84`:
 *   `oldViewProps == nullptr ? prop.isProvided() : ...`).
 * - and our wrappers always provide: every prop is sent, `null` included (`Switch.tsx:145-151`),
 *   and a callback the app did not pass is sent as a stable no-op *specifically* so a recycled
 *   view cannot keep the previous owner's handler (`Button.tsx:99-110`).
 *
 * So `model.accessibilityLabel = nil` in a reset is a safety line, not an observable one: the
 * next mount writes that field either way, which is exactly why deleting it left round 1's rule
 * green and the review called the rule unable to fail. What a reset *uniquely* owns is state no
 * prop rewrites - the **displayed value**, the handshake's **event counts**, and the
 * `didApplyDefault` one-shot. Only an *interaction* produces that state, and only a control's
 * own read-out shows it: the handle's `value` returns `model.state.js`
 * (`HybridNitroUiSlider.swift:693`), which is what React sent, not what is drawn.
 *
 * A probe therefore owns both lifetimes: it leaves residue behind on purpose, mounts a second
 * owner whose props are all defaults, and asks the control the one question only its own state
 * can answer. A control with no such question says so in the run rather than banking a pass
 * from a check that could not have failed - and `component-coverage.test.js` insists each
 * control has either a probe or that note, so the list of unprovable controls cannot grow in
 * silence.
 *
 * The note has **two kinds**, because the two situations want different verdicts (X4
 * re-review, medium "recycle-reset says covered for three `noProbe` controls"):
 *
 * - `noProbe` — the control holds **nothing** a reset could clear. `Button`'s props are all
 *   re-sent and its callback is always provided; `Progress` is an indicator with no
 *   interaction at all. Nothing is being missed, so the matrix says `n/a` with these words.
 * - `blindSpot` — the control **does** hold state a recycle has to clear and no platform can
 *   be shown the difference. `SegmentedControl`'s picked index and `Menu`'s open popup are
 *   real, and neither has a read-out where the recycle happens. That is a hole in the guard,
 *   so the matrix says **failing** and points at a `docs/tasks/FOLLOWUPS.md` line; the
 *   fixture prints `known failing (…)` the way the a11y sweep prints its own debt, and
 *   `staleDebt` retires the row when a run stops reporting it.
 *
 * Putting a control in the wrong kind is not free: `checkRecycleNotes` reads this table and
 * refuses a `blindSpot` with no `CONFORMANCE_EXEMPTIONS` row and a debt row whose fixture
 * claims `noProbe`, so the two lists cannot drift and a hole cannot be filed as a pass.
 */
type RecycleProbe = {
  /** What the residue is, in words, printed beside the verdict. */
  leaveBehind: string;
  /** The first owner, in non-default state. */
  first: () => ReactElement;
  /** The interaction that creates the state the reset must clear. */
  act: () => Promise<void>;
  /** The second owner: same testID, every prop at its default. */
  second: () => ReactElement;
  /**
   * Ask the second mount. An `actual` that is not what the second owner's own props imply is
   * the control answering out of somebody else's state.
   */
  read: () => Promise<
    Array<{ label: string; expected: unknown; actual: unknown }>
  >;
};

/**
 * Why a control has no probe: printed as the verdict, so a pass is not read as coverage. The
 * two kinds, and what the coverage table does with each, are in {@link RecycleProbe}'s header.
 */
type RecycleNote = { noProbe: string } | { blindSpot: string };

/** Every callback the probes wired up, in order, as `testID:value`. */
const recycleEvents: string[] = [];

/** One handler per control, recording what the app was told. */
const recordRecycle =
  (testId: string) =>
  (value: unknown): void => {
    recycleEvents.push(`${testId}:${String(value)}`);
  };

/**
 * A ButtonGroup's `onCheckedChange` names the item *and* the new state, where Chip's and
 * IconButton's events carry one value. The one-value recorder above would record the id
 * alone, so a probe that reads `id:false` could never match what the control reported —
 * this records the shape the event actually has.
 */
const recordRecycleChecked =
  (testId: string) =>
  (id: string, checked: boolean): void => {
    recycleEvents.push(`${testId}:${id}:${String(checked)}`);
  };

/**
 * ListItem's `onPress` carries no value at all — a row press is a press, not a state change
 * (DECISIONS D46) — so the one-value recorder above would log `…:undefined` and the probe
 * would assert a string that means nothing. This records the row that answered.
 */
const recordRecyclePress = (testId: string) => (): void => {
  recycleEvents.push(testId);
};

/** Events recorded since `from`, so a probe reads only the effect of its own press. */
const eventsSince = (from: number): string[] => recycleEvents.slice(from);

/**
 * Wait for `wanted` to be the whole of what the app has been told since `from`, and hand back
 * what was actually seen either way.
 *
 * A probe's *setup* may throw - an interaction that never produced its event means the fixture
 * is broken, and that should stop the run. A probe's **read** may not: a control that stays
 * silent is the residue this rule looks for, and it has to arrive as a finding naming both
 * values, not as a Jest timeout that names neither. So this waits, and then reports.
 */
async function eventsSettled(from: number, wanted: string): Promise<string> {
  const deadline = Date.now() + 1500;
  for (;;) {
    const seen = eventsSince(from).join(',');
    if (seen === wanted) return seen;
    if (Date.now() >= deadline) return seen;
    await sleep(50);
  }
}

/**
 * Press a ListItem through the control's own press seam (`ListItemModel.press()`), on both
 * platforms.
 *
 * The reason is Chip's and IconButton's — the harness's touch on iOS carries no HID event,
 * and UIKit's row highlight is a gesture recogniser, which is exactly the thing that
 * gesture needs and the harness does not send. On Android a harness tap would land, but a
 * probe that pressed one platform with a finger and the other with a seam could not tell a
 * lost touch from a lost reset, and the reset is what this fixture is about. `press()` is
 * where the counter a reset owns is written on both, so both go through it.
 */
const pressListItem = (testId: string): void => {
  const handle = handleFor(testId);
  if (handle.nuiTestPress == null) {
    throw new Error(`"${testId}" is not a ListItem - it has no nuiTestPress()`);
  }
  handle.nuiTestPress();
};

/**
 * ListItem's report (`HybridNitroUiListItem`'s `nuiTestStateReport`), as `key -> value`.
 *
 * Split on the first `=` only: `displayed=Notifications|-|On|none` has no `=` in its value,
 * and the a11y answer after it does (`role=button,…`), which would otherwise be read as
 * seven keys of its own.
 */
function listItemReportOf(handle: Handle): Record<string, string> {
  const report: Record<string, string> = {};
  for (const pair of (handle.nuiTestStateReport?.() ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) {
      report[pair.slice(0, at)] = pair.slice(at + 1);
    }
  }
  return report;
}

/** Press a control at its own box. */
const pressControl = async (testId: string): Promise<void> => {
  await userEvent.press(await screen.findByTestId(testId));
};

/**
 * Press a Chip: a real harness tap on Android, the control's own press path on iOS, where
 * the harness's HID-less touch reaches neither chip variant (measured in G12 -
 * `Chip.harness.tsx`'s `pressChip` says why). Both go through `press()`, which is where
 * the residue a reset has to clear is written.
 */
const pressChip = async (testId: string): Promise<void> => {
  if (PLATFORM === 'ios') {
    await screen.findByTestId(testId);
    const handle = handleFor(testId);
    if (handle.nuiTestPress == null) {
      throw new Error(`"${testId}" is not a Chip - it has no nuiTestPress()`);
    }
    handle.nuiTestPress();
    return;
  }
  await pressControl(testId);
};

/**
 * Tap segment `index` of `testId`, at the centre of the slice of its box that segment owns.
 *
 * The same arithmetic `SegmentedControl.harness.tsx:405` uses, and it is fair here because
 * this fixture's row is not over-wide: three short labels, so the box is the row's own width
 * and each third of it is one segment. A press is the only oracle that can put a SegmentedControl
 * in state no prop describes — the handle's `selectedIndex` echoes what React sent, so driving
 * the value through props would leave nothing for the reset to clear.
 */
const tapSegmentOf = async (
  testId: string,
  index: number,
  optionCount: number
): Promise<void> => {
  const box = harnessUi.queryByTestId(testId);
  if (box == null) {
    throw new Error(`Cannot tap "${testId}" - the harness sees no box for it.`);
  }
  await userEvent.pressAt(
    box.x + (box.width * (2 * index + 1)) / (2 * optionCount),
    box.y + box.height / 2
  );
};

/**
 * Which segment a SegmentedControl's row is painting, once it has painted one.
 *
 * Polling here is safe in a way the DatePicker probe's read is not: the reset clears this
 * report to the word `none`, so waiting for a real index is waiting for the *new* mount to
 * draw, not for a reset to happen. A control that kept its previous owner's index answers
 * that index the moment you ask, so this can never go green on a missing reset — the worst it
 * can do is time out on a row that never drew, which the caller reports as a finding.
 */
async function drawnIndexOf(testId: string): Promise<string> {
  const report = await pollReport(
    () => handleFor(testId).nuiTestDisplayedIndex?.() ?? '',
    (next) => next !== 'displayed=none' && next !== '',
    `the drawn index of "${testId}"`
  );
  return /displayed=(\S+)/.exec(report)?.[1] ?? report;
}

/**
 * Which value a Stepper is painting, or a sentence saying it never painted one.
 *
 * Polling is safe for the same reason {@link drawnIndexOf}'s is: the reset clears this
 * report to the word `none` (`StepperModel.clearReports` / `StepperModel.reset`), so
 * waiting is waiting for the **new** mount to draw, never for a reset to happen — a
 * control that kept its previous owner's value answers with that value the moment you
 * ask. Unlike `drawnIndexOf`, a timeout here is *returned* rather than thrown: a read
 * that throws turns the residue this rule looks for into a Jest failure that names
 * neither value, and the coverage matrix wants the pair.
 */
async function drawnValueOfStepper(testId: string): Promise<string> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const report = handleFor(testId).nuiTestStateReport?.() ?? '';
    const value = /(?:^|;)displayed=([^;]*)/.exec(report)?.[1] ?? '';
    if (value !== '' && value !== 'none') return value;
    if (Date.now() >= deadline) {
      return value === 'none'
        ? 'nothing drawn'
        : `no drawn value in "${report}"`;
    }
    await sleep(50);
  }
}

/** One step of a Stepper, through the seam's own path — the same one a tap takes. */
function stepStepper(testId: string, direction: number): void {
  const handle = handleFor(testId);
  if (handle.nuiTestStep == null) {
    throw new Error(`"${testId}" is not a Stepper - it has no nuiTestStep()`);
  }
  // Called *on* the handle: a Nitro hybrid method lifted into a local loses its `this`,
  // and the call answers "this is not bound" instead of stepping.
  handle.nuiTestStep(direction);
}

/** Poll a control's own report until it answers the way `until` wants, then hand it back. */
async function pollReport(
  read: () => string,
  until: (report: string) => boolean,
  what: string
): Promise<string> {
  const seen: { report: string } = { report: '' };
  await waitFor(
    () => {
      seen.report = read();
      if (!until(seen.report)) {
        throw new Error(`${what}: report="${seen.report}"`);
      }
    },
    { timeout: 8000 }
  );
  return seen.report;
}

/** Epoch millis for a local day, so the DatePicker probe can name a day rather than a number. */
const localDay = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

/**
 * The DatePicker's displayed instant and open presentation, read off the view.
 *
 * `nuiTestStateReport()` is **positional**, not `key=value`: `millis|presented|calendarMonthUtc|
 * hasSelection|livePresentations|controlBuilds|builtMinimum|builtMaximum`
 * (`HybridNitroUiDatePicker.swift`'s `publishReport`). Round 1's reader looked for `millis=` in
 * it, so every field it "read" was the `<no millis in "…">` sentinel and the probe would have
 * polled for a value it could never observe. The Picker's report *is* `key=value`-shaped
 * (`expanded=-1;live=-1;…`), which is what made the mistake easy — two controls, two formats.
 *
 * The order is the one `DatePicker.harness.tsx:208` destructures, and the segment count is
 * checked rather than trusted: a reordered or extended report has to fail here, not silently
 * answer a question about somebody else's field.
 */
const DATE_PICKER_FIELDS = [
  'millis',
  'presented',
  'calendarMonthUtc',
  'calendarHasSelection',
  'livePresentations',
  'controlBuilds',
  'builtMinimum',
  'builtMaximum',
] as const;

function datePickerStateOf(testId: string): {
  millis: number;
  presented: string;
  raw: string;
} {
  const handle = handleFor(testId);
  if (handle.nuiTestStateReport == null) {
    throw new Error(
      `"${testId}" reports no state, so the recycle rule cannot read it`
    );
  }
  const raw = handle.nuiTestStateReport();
  const parts = raw.split('|');
  if (parts.length !== DATE_PICKER_FIELDS.length) {
    throw new Error(
      `"${testId}" reported ${String(parts.length)} field(s) ` +
        `("${raw}") and the DatePicker's report has ` +
        `${String(DATE_PICKER_FIELDS.length)} (${DATE_PICKER_FIELDS.join(',')}), ` +
        'so reading it by position would answer a question about the wrong field'
    );
  }
  const [millis, presented] = parts;
  return {
    millis: Number(millis),
    presented: presented ?? '<none>',
    raw,
  };
}

/** The Slider's a11y step: fire the queued action and wait for its report to change. */
async function sliderStep(
  handle: Handle,
  direction: number,
  what: string
): Promise<string> {
  if (
    handle.nuiTestAccessibilityStep == null ||
    handle.nuiTestAccessibilityStepReport == null
  ) {
    throw new Error(
      `${what}: this control's handle reports no accessibility step`
    );
  }
  // Both calls stay on the handle (see `datePickerReportOf`'s note). The action runs in a turn
  // of the UI thread's queue (`HybridNitroUiSlider.swift:957`), so the wait is on the report
  // *changing*, not on a guessed pause - same shape as `Slider.harness.tsx:80`.
  const before = handle.nuiTestAccessibilityStepReport();
  handle.nuiTestAccessibilityStep(direction);
  return pollReport(
    () => handle.nuiTestAccessibilityStepReport?.() ?? '',
    (next) => next !== before,
    what
  );
}

/** The `from` of a `... <from>-><to> ...` step report: what the control was showing. */
function stepFrom(report: string): string {
  const pair = /(\d+(?:\.\d+)?)->(\d+(?:\.\d+)?)/.exec(report);
  const from = pair == null ? undefined : pair[1];
  if (from == null) {
    throw new Error(`step report names no value pair: "${report}"`);
  }
  return from;
}

/**
 * Engine counters, read once the ledger has stopped moving.
 *
 * Two consecutive equal reads, because "the ledger returned to baseline" only means something
 * against a baseline that is not on its way somewhere else. A drop from a test that ran before
 * this one can land inside the window — the first run of the leak control measured exactly that,
 * `+7` on the way up and `−8` on the way down for eight controls — and a comparison against a
 * moving number passes for the wrong reason, which is how a leak rule gets a green row.
 *
 * Throws rather than returning a contested read: this is a rule's setup, and a window that never
 * settles is not the finding this test exists to report.
 */
async function settledStats(what: string): Promise<NitroUiSizingStats> {
  let previous = stats();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await settle(150);
    const current = stats();
    if (
      current.ledgerEntries === previous.ledgerEntries &&
      current.registryEntries === previous.registryEntries
    ) {
      return current;
    }
    previous = current;
  }
  throw new Error(
    `${what}: the engine's ledger and registry kept moving for 3s ` +
      `(last read ${String(previous.ledgerEntries)}/` +
      `${String(previous.registryEntries)}), so no number here is a baseline`
  );
}

/** A `hybridRef` callback per testID, so one `render` can hand several controls out. */
const handles = new Map<string, Handle>();
const captureFor =
  (testId: string) =>
  (handle: Handle): void => {
    handles.set(testId, handle);
  };

function handleFor(testId: string): Handle {
  const handle = handles.get(testId);
  if (handle == null) {
    throw new Error(
      `no hybridRef handle for "${testId}" — the control never handed back its own ` +
        'state, so nothing here can ask it what it is'
    );
  }
  return handle;
}

/**
 * Forget any handle held for `testId`, so the next `ensureHandle` can only be answered by a
 * mount that has not happened yet.
 *
 * Call this immediately before every `render` whose control the test then reads. Without it
 * the map answers with a handle from an *earlier* owner: `hybridRef` fires once per native
 * view at mount and is never called with `null` (`useStableCallback.ts`'s own caveat — "a
 * callback prop that is already installed is never re-invoked"), and `handles` is cleared only
 * in `afterEach`. So for the second owner of the recycle rule, for the warm mount of the
 * fallback rule, and for both second owners of the residue probes, `ensureHandle` used to find
 * the first owner's handle sitting in the map and return it without waiting at all.
 *
 * That is CI run 41256853746's DatePicker failure: the uncontrolled second owner "kept its
 * identity across lifetimes" and the day it showed was `1799971200000`, which is precisely the
 * *first* owner's pick, read through the first owner's handle. It also hid the race the wait
 * exists for, since a lookup that always succeeds proves nothing about timing.
 *
 * What this cannot hide: if a remount really never re-fires the callback, `ensureHandle` now
 * times out and says so, which is the accurate finding — the control did not hand back its own
 * state.
 */
function expectANewHandle(testId: string): void {
  handles.delete(testId);
}

/**
 * Wait until the callback for this testID has run, then hand the handle back.
 *
 * Called once after each `render` (and only meaningful after
 * {@link expectANewHandle} has run before it), because `hybridRef` fires on a commit *after*
 * the view is created: a box can exist (that is what `waitForTestId`/`queryByTestId` see)
 * while the handle has not arrived. Run 41230848294, at load1 152 on 3 cores, is what proved
 * the difference is real rather than theoretical — `Conformance · is named on its own box`
 * died on this sentence for the DatePicker, while the same test passed on the next dispatch of
 * the same tree (41234953779). "The control never handed back its state" was a statement about
 * a callback that was 20 ms late.
 *
 * It waits for the handle only, never for an *answer*: every rule below still reads the
 * control exactly once, so the recycle rule in particular keeps its "do not wait for the
 * reset" property (see the comment on its read).
 */
async function ensureHandle(testId: string): Promise<Handle> {
  return waitForHandle(() => handles.get(testId), { what: `"${testId}"` });
}

function stats(): NitroUiSizingStats {
  return nitroUiCore.sizingStats();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Let queued corrections land before reading counters that move on a later turn. */
async function settle(ms = 350): Promise<void> {
  await sleep(ms);
}

function describeBox(box: Size | ViewInfo | null): string {
  return box == null
    ? 'null'
    : `${box.width.toFixed(1)}x${box.height.toFixed(1)}`;
}

/** Corrections issued since `before` was read, so the number is this mount's. */
function correctionsSince(before: NitroUiSizingStats): number {
  const now = stats();
  return Math.max(
    0,
    now.correctionsImmediate -
      before.correctionsImmediate +
      (now.correctionsBatched - before.correctionsBatched)
  );
}

const PLATFORM = Platform.OS === 'ios' ? 'ios' : 'android';

/**
 * Every `render` in this file, for the reason every other harness suite gives it.
 *
 * `react-native-harness` rejects with "Render timeout: Element did not mount within 1000ms"
 * unless a suite says otherwise, and the first cold mount of a native view on an emulator can
 * exceed that on its own — the Android run went red on exactly that, at load1 11, on a control
 * that had nothing wrong with it. 20 s is what `Button.harness.tsx` and
 * `MountChurn.harness.tsx` pass; the value is a budget for the *mount*, not for the
 * measurement, and the wall-clock assertions below still have their own tighter gates.
 */
const RENDER = { timeout: 20000 } as const;

/* ------------------------------ the rule bodies ------------------------------ */
/* The device-side shape of `fallbackFindings`, `leakFindings` and `recycleFindings` in
 * `scripts/conformance-core.mjs`. Round 1 called these "mirrors" and said a divergence
 * between the halves was caught by `conformance.test.js` (X4 review N4). It is not, and
 * calling them mirrors oversells what is here:
 *
 * - The harness cannot import a Node module, so this file re-implements the branches. It
 *   takes its *numbers* from the shared table below, which `checkSharedTableMirror` does
 *   prove equal to `sharedInAppTable()` on every `check` — tolerance, poison sizes,
 *   declared fallbacks and box rules cannot disagree between the halves.
 * - The *wording* is free to drift, and has: three of these strings already differ from the
 *   originals by a clause. `conformance.test.js` drives the originals, not these, so no test
 *   reads this file's messages at all. What that risks is not a wrong verdict — the branches
 *   are short and the numbers are shared — it is a device failure whose sentence no longer
 *   matches the one in the report, so the two say the same bug in different words.
 * - Recorded as debt rather than fixed by loosening the claim: see the FOLLOWUPS row
 *   "X4 conformance: the in-app rule bodies are a re-implementation, not a mirror".
 *
 * What is asserted about these bodies is that a control's fixture row exists and carries a
 * probe (`checkInAppFixtures`), and that the tables match. Nothing asserts their prose. */

type Finding = {
  component: string;
  rule: string;
  problem?: string | null;
  /** A comparison the run's own configuration makes meaningless; see `skippedFindings`. */
  skipped?: string;
};

function near(a: Size, b: Size, tolerance: number): boolean {
  return (
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

function fmt(size: Size | null): string {
  return size == null
    ? 'nothing'
    : `${String(size.width)}x${String(size.height)}`;
}

/**
 * The in-app half of `canonicalLocale` / `localePremiseMiss` in
 * `scripts/conformance-core.mjs` (same re-implementation note as the file header's).
 *
 * Only the shape the rule needs: strip a launch identifier to the language(+script)+region
 * prefix the engine itself reports, compare it with the locale the row was measured in, and
 * carry whether *this run* published the opt-out. Without that third field a mismatch would
 * have to be either always a failure (so nobody could ever probe another locale) or always a
 * skip (so the comparison silently stops happening) — both of which are wrong.
 */
function canonicalLocale(identifier: string): string {
  const parts = String(identifier).replace(/_/g, '-').split('-');
  const out = [(parts[0] ?? '').toLowerCase()];
  for (const part of parts.slice(1)) {
    if (part.length === 4 || part.length === 2 || /^\d{3}$/.test(part)) {
      out.push(part.toLowerCase());
    } else {
      break;
    }
  }
  return out.join('-');
}

function localePremiseMiss(
  row: DeclaredRow | undefined,
  reportedLocale: string | null,
  mismatchAllowed: boolean
): { expected: string; actual: string; tolerated: boolean } | null {
  const expected = row?.measuredUnderLocale;
  if (expected == null) return null;
  if (reportedLocale == null || reportedLocale === '') return null;
  if (canonicalLocale(expected) === canonicalLocale(reportedLocale))
    return null;
  return { expected, actual: reportedLocale, tolerated: mismatchAllowed };
}

/**
 * Rule 1: is the fallback the control's own, and does a wrong guess still get corrected?
 *
 * @param input.declared what the engine reports for the control (`null` = nothing
 *   registered). JS cannot read the number, only whether one exists, so the caller passes
 *   `expected` when `hasDeclaredFallback` said yes and `null` when it said no.
 * @param input.boxRule which axes the declaration describes — from the mirrored table,
 *   never worked out here. See `boxRuleFor` in `scripts/conformance-core.mjs` for why a
 *   `fillWidth` control's width and a content-sized control's box are not its declaration.
 * @param input.deviceLocale the locale this run's app reports
 *   (`deviceContext.ts`), and `input.mismatchAllowed` whether the run published
 *   `NITRO_UI_ALLOW_LOCALE_MISMATCH`. Only the box comparison consults them, and only for a
 *   row that declares it was measured in one (`measuredUnderLocale`): a mismatch then FAILS
 *   unless the run said it meant it. See `localePremiseMiss`.
 */
function fallbackFindings(input: {
  component: string;
  declared: Size | null;
  measured: Size | null;
  corrections: number;
  poisoned: boolean;
  expected: DeclaredRow;
  boxRule: 'both' | 'height' | 'none';
  deviceLocale?: string | null;
  mismatchAllowed?: boolean;
}): Finding[] {
  const {
    component,
    declared,
    measured,
    corrections,
    poisoned,
    expected,
    boxRule,
  } = input;
  const tolerance = SHARED.tolerance;
  const poisonedSize = SHARED.poisonSizes[PLATFORM];
  const problems: Finding[] = [];
  const report = (problem: string): void => {
    problems.push({ component, rule: 'declared-fallback', problem });
  };
  const ownsAgrees = (actual: Size, want: Size): boolean => {
    if (Math.abs(actual.height - want.height) > tolerance) return false;
    if (boxRule === 'both') {
      return Math.abs(actual.width - want.width) <= tolerance;
    }
    return true;
  };

  if (declared == null) {
    report(
      'the engine knows no declared fallback, so a cold mount falls to the `0x0` ' +
        'branch and is force-laid-out — the frame the first frame lies about'
    );
  }
  if (measured == null) {
    report('a warm mount settled at nothing, so there is no size to compare');
    return problems;
  }
  if (poisoned && near(measured, poisonedSize, tolerance)) {
    report(
      `settled at the poisoned ${fmt(poisonedSize)} — the guess was never corrected, and ` +
        'every cold mount of this control is laid out at a size it never declared'
    );
    return problems;
  }
  // The premise the DatePicker's row needs (see `measuredUnderLocale` in the shared
  // table), read from the app itself. `null` for every other control, so nothing here
  // changes for them.
  const miss = localePremiseMiss(
    expected,
    input.deviceLocale ?? null,
    input.mismatchAllowed ?? false
  );

  if (boxRule === 'none') {
    if (near(measured, expected, tolerance)) {
      report(
        `this control is exempt from the box comparison as content-sized, and it ` +
          `settled at its own declared ${fmt(expected)} anyway — a control that ` +
          'always measures its declared size is not sizing itself from its content, ' +
          'so the exemption is no longer true'
      );
    }
  } else if (miss != null && !ownsAgrees(measured, expected)) {
    // A locale mismatch is a failed premise, and a failed premise is a FAILURE: the harness
    // pins the launch locale, so the app reporting another one means the pin was lost, was
    // overridden without being said, or the formatter stopped following the locale it was
    // handed. The skip exists only behind the run's own opt-out (see `localeMismatchAllowed`
    // in `timingGate.ts`), and names the two claims it suspends — the box comparison and the
    // warm-corrections claim below, which `HybridNitroUiDatePicker.swift`'s `fallbackSize`
    // prices in words. Everything else still runs either way: the poison must still be
    // corrected, and a mount that settles at nothing still fails.
    const both =
      `the app runs in ${miss.actual} and this row’s ${fmt(expected)} is what the ` +
      `control measures in ${miss.expected}, so the measured ${fmt(measured)} is the ` +
      'same formatter answering a different question. Launch the app in the pinned ' +
      `locale (${miss.expected.replace(/-/g, '_')}) or set ` +
      'NITRO_UI_ALLOW_LOCALE_MISMATCH=1 to say you meant this';
    if (miss.tolerated) {
      problems.push({
        component,
        rule: 'declared-fallback',
        problem: null,
        skipped:
          `box and warm-corrections comparison skipped ` +
          `(NITRO_UI_ALLOW_LOCALE_MISMATCH=1): ${fmt(expected)} is what this control ` +
          `measures in ${miss.expected} and this run's app locale is ${miss.actual}, ` +
          `so the measured ${fmt(measured)} proves nothing about the declaration`,
      });
    } else {
      report(both);
    }
  } else if (!ownsAgrees(measured, expected)) {
    report(
      `the fallback ${fmt(expected)} is not the measured ${fmt(measured)} for a ` +
        (boxRule === 'height'
          ? 'control whose own axis is its height (its width is its parent’s)'
          : 'control that declares its size') +
        ' — a mismatch means the declaration drifted from the component'
    );
  }
  if (
    !poisoned &&
    corrections > 0 &&
    boxRule === 'both' &&
    // Same premise as the box comparison above, and suspended by it whether or not the run
    // opted out: `fallbackSize`'s own comment says a locale wider than the measured one costs
    // its first instance one correction, so `corrections > 0` cannot distinguish a dead
    // declaration from a formatter answering in another locale. The box finding is the
    // accurate headline either way, so nothing is hidden by suspending this.
    !(miss != null && !ownsAgrees(measured, expected))
  ) {
    report(
      `needed ${String(corrections)} correction(s) from a warm engine whose ` +
        `fallback ${fmt(expected)} already describes this control’s whole box — ` +
        'the declaration is not reaching the engine'
    );
  }
  if (poisoned && corrections === 0) {
    report(
      `settled at ${fmt(measured)} with no correction, having been poisoned to ` +
        `${fmt(poisonedSize)} — that size can only have come from the component, so the ` +
        'correction went missing while the ledger stayed quiet'
    );
  }
  return problems;
}

/**
 * Rule 2: did the engine's bookkeeping return to baseline after every instance dropped?
 *
 * `baseline` is taken after a warm-up mount, so the component's own registry row is already
 * in it and cannot be mistaken for a leak.
 */
function leakFindings(input: {
  component: string;
  baseline: NitroUiSizingStats;
  after: NitroUiSizingStats;
  instances: number;
}): Finding[] {
  const problems: Finding[] = [];
  const report = (problem: string): void => {
    problems.push({
      component: input.component,
      rule: 'no-leak-on-drop',
      problem,
    });
  };
  const ledger = input.after.ledgerEntries - input.baseline.ledgerEntries;
  const registry = input.after.registryEntries - input.baseline.registryEntries;
  if (ledger !== 0) {
    report(
      `${String(ledger)} ledger entry(ies) survived ${String(
        input.instances
      )} drops — each missing ` +
        '`NitroUiSizing::forget(sizing_.get())` pair in `onDropView` shows up here, and ' +
        'a handle keeps the view alive, so the leaked entry is the leak'
    );
  }
  if (registry > 0) {
    report(
      `the registry grew by ${String(registry)} across ${String(
        input.instances
      )} mounts of an already-registered component — per-instance state in a ` +
        'process-wide table is the shape of a leak the engine cannot see either'
    );
  }
  return problems;
}

/** Rule 3: does the control show any of its previous owner's props? */
function recycleFindings(input: {
  component: string;
  identity: string;
  checks: ReadonlyArray<{ label: string; expected: unknown; actual: unknown }>;
}): Finding[] {
  const problems: Finding[] = [];
  for (const check of input.checks) {
    if (check.actual === check.expected) continue;
    problems.push({
      component: input.component,
      rule: 'recycle-reset',
      problem:
        `${input.identity} kept its identity across lifetimes and ${check.label} ` +
        `reads ${String(check.actual)} where the props say ${String(
          check.expected
        )} — the view came back wearing its previous owner`,
    });
  }
  return problems;
}

/**
 * Print debt, fail on anything new. The one report every rule shares, and the reason an
 * exemption is visible in the run rather than only in a source file.
 */
function expectConformance(findings: Finding[]): void {
  const failures: string[] = [];
  for (const finding of findings) {
    if (finding.skipped != null) {
      // Its own channel, and printed rather than swallowed: a run that compared less than it
      // claims has to say so in the log, or "green" and "premise missing, box never compared"
      // are the same line to anyone reading the gate afterwards.
      console.log(`    · ${finding.skipped}`);
      continue;
    }
    const exemption = EXEMPTIONS.find(
      (row) => row.component === finding.component && row.rule === finding.rule
    );
    if (exemption == null) {
      failures.push(
        `${finding.component} × ${finding.rule}: ${finding.problem}`
      );
      continue;
    }
    console.log(
      `    · known failing (${exemption.followups}): ${finding.component} × ` +
        `${finding.rule}: ${finding.problem}`
    );
  }
  // Thrown, not asserted (X4 round 2). Neither of Jest's two channels carries a finding out
  // of a device run here: `toEqual([])` prints `expected [ …(2) ] to deeply equal []`, `toBe('')`
  // prints `expected 'Switch × no-leak-on-drop: 8 controls …' to be ''`, and `console.log`/
  // `console.error` from this file reached the gate log in none of three runs — while a thrown
  // `Error` from a probe arrived whole (`the first owner's pick: report="1799971200000|0|…"`).
  // So the sentence a rule writes is the sentence a reviewer reads, or the gate is a list of
  // control names. One thrown Error is still one failed test, so the summary's count is right.
  if (failures.length > 0) {
    throw new Error(
      `${String(failures.length)} conformance finding(s):\n${failures
        .map((failure) => `  - ${failure}`)
        .join('\n')}`
    );
  }
}

/* ------------------------------- the shared tables --------------------------- */

/**
 * Does the engine have a declared fallback for this control?
 *
 * `prewarmSizing` returns how many of the names it was given had one registered, so `1` is
 * the engine saying "a size is registered for this control" and `0` is it saying nobody did.
 *
 * That is the only way to ask from JS, and it is *not* a clean question — see
 * {@link readRegistrationOnce} for the expiry date. What the older version of this comment
 * claimed (X4 re-review, low: it contradicted M5's finding) was that the answer "does not
 * change when another suite has already mounted the control". Mounting is indeed not the
 * problem; **seeding** is, and `seedSizingSize` writes the same table
 * (`NitroUiSizingEngine.cpp:512`), so a harness that poisons a fallback anywhere in the
 * process makes every later read of this say `true` about a control the startup table may
 * never have had a row for. The guard is therefore about ordering, not about the seam: read
 * once, before anything here seeds, and say in the log when the process was already warm.
 */
function hasDeclaredFallback(component: string): boolean {
  return nitroUiCore.prewarmSizing([component]) === 1;
}

/**
 * Plant a size no control declares, so being right requires correcting it.
 *
 * `seedSizingSize` also *writes* the declared fallback (`ColdSizing.harness.tsx:288-292`
 * says so because it matters there), so poisoning is a process-wide act and must be undone:
 * the harness resets the JS runtime between files, not the native engine.
 */
function poison(component: string): void {
  const size = SHARED.poisonSizes[PLATFORM];
  nitroUiCore.seedSizingSize(component, '', size.width, size.height);
  nitroUiCore.invalidateSizingEnvironment();
}

/**
 * The engine's own answer, for every control, read **before this file seeds anything**.
 *
 * `prewarmSizing` is the only way to ask from JS whether the engine has a declared fallback for
 * a name, and its answer is just "the name is in `fallbacks_`" (`NitroUiSizingEngine.cpp:855`).
 * That is a question with an expiry date: `seedSizingSize` writes `fallbacks_` too — not only
 * the guess, the declaration (`NitroUiSizingEngine.cpp:512`) — so after any seed in a process,
 * the answer is `true` whether or not the library's startup table ever had a row for the
 * control. Reading it once per test, as round 1 did, means the first poison in this file makes
 * every later read in this file evidence of nothing; and it is why Button's row can read `true`
 * in a whole-suite run even though `Button.harness.tsx` was the one that seeded it
 * (`Button.harness.tsx:297`).
 *
 * So the read is done once, in the file's first test, before any poison here has run, and every
 * later assertion takes its `declared` from this table rather than re-asking. On a warm process
 * even that first read is not the startup table's answer, and the log says which of the two it
 * is — the same `measurements === 0` witness `ColdSizing.harness.tsx` uses, for the same reason.
 */
const registration: Record<string, boolean> = {};

function readRegistrationOnce(): void {
  if (Object.keys(registration).length > 0) return;
  const cold = stats().measurements === 0;
  for (const fixture of FIXTURES) {
    registration[fixture.component] = hasDeclaredFallback(fixture.component);
  }
  const declared = Object.values(registration).filter(Boolean).length;
  console.log(
    `    · registration (${cold ? 'COLD' : 'NOT COLD'} process): ` +
      `${String(declared)}/${String(Object.keys(registration).length)} controls ` +
      `have an engine fallback` +
      (cold
        ? ' — read before any seed in this process, so this is the startup ' +
          "table's own answer"
        : ' — something has already measured in this process, so a `true` here ' +
          'is the engine’s current state and not proof of the startup table. ' +
          'That claim is `bun run harness:cold:*` and `checkFallbackTable` ' +
          "in `check`, which don't seed at all")
  );
}

/**
 * Put the declared *number* back.
 *
 * This does not, and cannot, restore the startup declaration: `seedSizingSize` writes
 * `fallbacks_` (`NitroUiSizingEngine.cpp:512`), so from the first poison onward this component's
 * engine row is JS-supplied, and there is no JS seam that re-runs the startup table's
 * `setFallback` pass. What it does is leave a sane fallback for the suites that run after this
 * one — the obligation `ColdSizing.harness.tsx`'s header states for the same reason — and the
 * number is exact because the table it writes is the mirror checked against
 * `scripts/conformance-core.mjs` on every `check`, so a restored number cannot be a wrong number
 * the rest of the process then quietly trusts.
 *
 * Round 1 called this `restore` as if it undid the poison. It does not: what protects the
 * registration claim is {@link readRegistrationOnce} running first, not anything undone here.
 */
function restore(component: string): void {
  const declared =
    SHARED.declaredFallbacks[
      component as keyof typeof SHARED.declaredFallbacks
    ];
  if (declared == null) return;
  const size = declared[PLATFORM];
  nitroUiCore.seedSizingSize(component, '', size.width, size.height);
  nitroUiCore.invalidateSizingEnvironment();
}

function declaredFallback(component: string): DeclaredRow {
  const table = SHARED.declaredFallbacks as Record<
    string,
    Record<'ios' | 'android', DeclaredRow>
  >;
  const entry = table[component];
  if (entry == null) {
    throw new Error(
      `no DECLARED_FALLBACKS row for ${component} on ${PLATFORM}, so every ` +
        'assertion about this control’s fallback would be vacuous'
    );
  }
  return entry[PLATFORM];
}

/**
 * Which axes this control's declaration describes, from the mirrored table.
 *
 * A missing entry throws rather than defaulting: `boxRules` is generated from the same keys
 * as `declaredFallbacks`, so its absence means the mirror is stale, and silently choosing
 * the strict rule would turn a broken table into a false red on the control.
 */
function boxRuleFor(component: string): 'both' | 'height' | 'none' {
  const rule = (SHARED.boxRules as Record<string, string>)[component];
  if (rule !== 'both' && rule !== 'height' && rule !== 'none') {
    throw new Error(
      `no boxRules row for ${component} — regenerate the shared table with ` +
        '`node scripts/conformance/print-shared-table.mjs --write`'
    );
  }
  return rule;
}

/* ------------------------------ the control table ---------------------------- */
/* One fixture per control the registry declares. `component-coverage.test.js` asserts this
 * list has exactly one row per manifest in `src/components`, which is what makes a new
 * control a *failing test* rather than an untested control.
 *
 * `owner(second)` is how the recycle rule hands one testID to a second owner, and `state`
 * reads what the control says about itself afterwards — through `hybridRef`, because that is
 * the control's own answer rather than a React-side copy of the props.
 *
 * The two owners are deliberately **not** symmetric, and that asymmetry is the fix. The first
 * owner puts its control in non-default state — by interaction where the control can be
 * interacted with — and the second owner sends its props at their defaults. Because:
 *
 * - if the second owner re-sends every prop with a fresh value, every generated setter runs
 *   and overwrites exactly what the reset was supposed to have cleared, so the rule passes
 *   with the reset deleted. Fabric's Insert mutation passes `oldProps:nil`
 *   (`RCTMountingManager.mm:83`), so a recycled mount runs *all* provided setters anyway;
 * - and a prop the second owner sends at its default leaves the reset as the only source of
 *   its stored value, which is the thing under test.
 *
 * `residue`/`oracle` are the part that decides whether this rule can fail at all — see
 * {@link RecycleProbe}. A control with no `oracle` has no state that survives independently
 * of React's next write (or no read-out that is not a stub on one platform), and says so in
 * the run instead of banking a pass from a check that could not have failed. */

type Fixture = {
  /** The manifest `name`, which is also the key the tables use. */
  name: string;
  /** The Fabric name: what the sizing engine files sizes under. */
  component: string;
  /** The `accessibilityLabel` the first owner sends, and the a11y rule looks for. */
  label: string;
  /** The same control's identity in both lifetimes. */
  testId: string;
  /** One owner's element. Every prop is always passed: nitro#1184. */
  owner: (second: boolean) => ReactElement;
  /**
   * The same control under a caller-chosen `testID`, for the leak rule's positive control,
   * which mounts K of them *at once* — `owner` reuses one testID, and K controls sharing an
   * identity is a different test (and a broken query). `variant` flips a prop so the rows are
   * visibly distinct, the way the other suites' churn does (`Sizing.harness.tsx:504`).
   */
  control: (testId: string, variant: boolean) => ReactElement;
  /**
   * What the control reports about itself, for the recycle rule.
   *
   * May be async because one control's state is not a prop: the Form answers from a native
   * report whose numbers belong to the UI thread (`nuiTestFormReport`), so a JS-thread read
   * returns the report *as it last stood* and a mount can move it a beat later. Deciding on
   * the first answer would blame the component's reset for a report that had not been
   * rebuilt yet — see {@link settledFormReport}.
   */
  state: (
    handle: Handle,
    second: boolean
  ) =>
    | Array<{ label: string; expected: unknown; actual: unknown }>
    | Promise<Array<{ label: string; expected: unknown; actual: unknown }>>;
  /**
   * The part of this rule that can actually fail: two owners of one testID, an interaction,
   * and the control's own answer afterwards. See {@link RecycleProbe} for why a prop cannot
   * show residue and an interaction can, and {@link RecycleNote} for the controls where even
   * that is not available.
   */
  probe: RecycleProbe | RecycleNote;
  /**
   * The same rule's second probe, whose second owner is **controlled**, and the only way to
   * see the other half of a reset (X4 re-review M2).
   *
   * A reset here has two lines and they live on different axes. `didApplyDefault = false`
   * re-arms the *displayed value*, which is what an uncontrolled owner's props leave for the
   * control to decide. `model.state = NitroUiControlledValue(…)` zeroes the *handshake's
   * event counts*, which nothing an uncontrolled control does ever reads — `reconcile()` only
   * applies a write when `js != nil` (`NitroUiModel.swift:71-79`), so with no `value` in
   * flight the counts are state with no consequence. A controlled owner is the case that
   * reads them: it sends `value` with `mostRecentEventCount` 0 (`useControlled.ts:56`), so
   * counts left over from the previous owner make `jsEvents < nativeEvents` and the write is
   * **refused as stale** — the control keeps showing what the last app left on screen, which
   * is the bug the line exists to prevent.
   *
   * So each line gets the probe that can see it, and the report says so rather than
   * repeating round 1's "they cover for each other": that was true of one fixture, where the
   * second owner's default equalled the reset value (`defaultValue={false}` against
   * `displayed: false`) so the two writes could not be told apart.
   */
  controlledProbe?: RecycleProbe;
  /**
   * `false` for a component with no box of its own - `sizing: null` in its
   * `component.json`, G11's dialogs. Such a control never enters the sizing engine, so
   * the fallback and both leak tests print the reason the coverage matrix gives
   * (`CONFORMANCE_RULES[].applies`) instead of asserting about a ledger it never joins,
   * and the a11y test asserts the presentation-aware half: the anchor carries no name
   * (the presented window does, and `A11Y_PRESENTATIONS` names the real-input check that
   * reads it). `checkInAppFixtures` holds this member to the manifest in both
   * directions, so a self-sizing control cannot opt out of its sizing rules here.
   */
  selfSizing?: false;
  /**
   * `true` for a component that **is** a React Native `View` - ContextMenu, whose box is
   * Yoga's and whose accessibility props are React Native's own, landing on the view the
   * `testID` names (D36 item 1). The a11y rule then holds the labelled box to that box on
   * both platforms (an RN view's `contentDescription` is what the Android harness query
   * walks, unlike a Compose control's semantics) and skips the handle's label, which a
   * `View` does not have.
   */
  isView?: true;
};

const SECOND = 'second owner';

const columnStyle = { flexDirection: 'column' } as const;

/**
 * The rows every Menu fixture passes.
 *
 * A fixture has to send a `group` because the wrapper always sends `rows` to native
 * (`Menu.nitro.ts:120-126`: a missing `rows` would leave a recycled view showing the
 * previous row's menu), and the leak rule mounts eight of these at once, so the rows are a
 * constant rather than something built per render — the same reason the other fixtures pass
 * literal `options` arrays to Picker and SegmentedControl.
 */
const MENU_GROUP: MenuGroup = {
  actions: [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
  ],
};

/**
 * The Menu fixtures' trigger text, which is also what the props half reads back.
 *
 * Deliberately long and deliberately not the fixture's `accessibilityLabel`: the fallback
 * rule's `boxRule: 'none'` branch goes red if a content-sized control measures *exactly* its
 * declared number, and Menu declares a Button-sized 74×38 pt / 75.1×52 dp, so a two-syllable
 * title would be a coin flip on whether that guard had anything to say. A distinct label is
 * for the same reason one way and one name in two places is how round 1's Picker stutter got
 * missed.
 */
const MENU_TITLE = 'Conformance actions';
const MENU_TITLE_SECOND = 'Second owner’s actions';

/** The ContextMenu fixture's name, and the header its menu draws for the first owner. */
const CONTEXT_LABEL = 'Conformance context menu';
const CONTEXT_TITLE = 'Conformance rows';

/** ContextMenu's report, as `key -> value`. */
function contextMenuReportOf(handle: Handle): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of (handle.nuiTestContextMenuReport?.() ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/**
 * `captureFor` for a ContextMenu, whose handle is its own type (no `accessibilityLabel`,
 * no `measureContent()`: it is a `View`), filed under the shared one as Dialog's is.
 */
const captureContextMenu =
  (testId: string) =>
  (view: object): void => {
    const handle = view as unknown as Handle;
    handles.set(testId, handle);
    // A ContextMenu builds its report only once a harness asks (an app never does), and
    // a recycle clears that: ask now, so the single reads below find one built.
    handle.nuiTestContextMenuReport?.();
  };

const DIALOG_TITLE = 'Conformance dialog';
const DIALOG_TITLE_SECOND = 'Second owner’s dialog';
const DIALOG_ACTIONS = [
  { id: 'keep', title: 'Keep', role: 'cancel' as const },
  { id: 'go', title: 'Go' },
];

/**
 * `captureFor` for a dialog. A dialog has no `accessibilityLabel` and no
 * `measureContent()` (no box: Q5 Appendix B4/B5), so its view is filed under the
 * shared handle type here; nothing in the suite calls either member for a fixture
 * that says `selfSizing: false`.
 */
const captureDialog =
  (testId: string) =>
  (view: object): void => {
    handles.set(testId, view as unknown as Handle);
  };

/** Dialog's report (`nuiTestStateReport`), as `key -> value`. */
function dialogReportOf(handle: Handle): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of (handle.nuiTestStateReport?.() ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/** Whether a dialog's report says its window is up and shows `title`. */
function dialogShows(report: Record<string, string>, title: string): boolean {
  return report.kind !== 'none' && report.title === title;
}

const SHEET_LABEL = 'Conformance sheet';
/** The two owners' content heights: different, and neither a detent's. */
const SHEET_FIRST_HEIGHT = 120;
const SHEET_SECOND_HEIGHT = 260;

/** A BottomSheet owner whose content is a box of a known height. */
function sheetOwner(presented: boolean, height: number): ReactElement {
  return (
    <BottomSheet
      isPresented={presented}
      onIsPresentedChange={recordRecycle('conformance-sheet')}
      accessibilityLabel={SHEET_LABEL}
      testID="conformance-sheet"
      hybridRef={captureDialog('conformance-sheet')}
    >
      <View style={{ height }} />
    </BottomSheet>
  );
}

/** Whether a sheet's report says it is up holding content `height` tall. */
function sheetShows(report: Record<string, string>, height: number): boolean {
  return (
    report.presented === '1' &&
    report.live === '1' &&
    Math.abs(Number(report.contentH) - height) <= 1
  );
}

const TOOLTIP_MESSAGE = 'Conformance tooltip';
const TOOLTIP_MESSAGE_SECOND = 'Second owner’s tooltip';
const TOOLTIP_ACTIONS = [{ id: 'ok', title: 'Got it' }];

/**
 * A Tooltip owner around a 40 x 40 anchor. The message is the name a presented tooltip
 * carries, so it is also what the a11y rule's presentation half looks for.
 */
function tooltipOwner(presented: boolean, message: string): ReactElement {
  return (
    <Tooltip
      isPresented={presented}
      onIsPresentedChange={recordRecycle('conformance-tooltip')}
      title="Conformance"
      message={message}
      actions={TOOLTIP_ACTIONS}
      testID="conformance-tooltip"
      hybridRef={captureDialog('conformance-tooltip')}
    >
      <View style={{ width: 40, height: 40 }} />
    </Tooltip>
  );
}

/** Whether a tooltip's report says it is up showing `message`. */
function tooltipShows(
  report: Record<string, string>,
  message: string
): boolean {
  return (
    report.presented === '1' &&
    report.live === '1' &&
    report.kind !== 'none' &&
    report.message === message
  );
}

const POPOVER_LABEL = 'Conformance popover';
/** The two owners' content heights: different, and neither the other's. */
const POPOVER_FIRST_HEIGHT = 120;
const POPOVER_SECOND_HEIGHT = 260;

/**
 * A Popover owner whose content is a box of a known height.
 *
 * It sends no `accessibilityLabel` because there is none to send: a Popover's `anchor`
 * stays in the app's layout and keeps its own taps, so a name on the wrapper would be a
 * real element on screen that the a11y rule would (correctly) find, and D44 records that
 * an `accessibilityLabel` never reaches a presented window on either platform. The name a
 * person hears is the content's own, which real input reads through the tree.
 */
function popoverOwner(presented: boolean, height: number): ReactElement {
  return (
    <Popover
      isPresented={presented}
      onIsPresentedChange={recordRecycle('conformance-popover')}
      anchor={<View style={{ width: 140, height: 36 }} />}
      testID="conformance-popover"
      hybridRef={captureDialog('conformance-popover')}
    >
      <View style={{ width: 180, height }} />
    </Popover>
  );
}

/** Whether a popover's report says it is up holding content `height` tall. */
function popoverShows(report: Record<string, string>, height: number): boolean {
  return (
    report.presented === '1' &&
    report.live === '1' &&
    Math.abs(Number(report.contentH) - height) <= 1
  );
}

/**
 * Every callback the a11y rule's own wrapper has to keep alive: a probe's control is wrapped
 * in a plain `View`, so the box the harness measures is the control's and the press lands on
 * it. `columnStyle` is what `Slider.harness.tsx` and the other suites use for the same reason.
 */

// MARK: - Form's fixture

const FORM_LABEL = 'Conformance form';
const FORM_LABEL_SECOND = 'Second owner’s form';

/**
 * `captureFor` for a Form. A Form has no box of its own and so no `measureContent()`, and
 * it is not a control with an `accessibilityLabel` to read back - both members live on the
 * shared `Handle` type for the controls that do. Same arrangement as `captureDialog`.
 */
const captureForm =
  (testId: string) =>
  (view: object): void => {
    handles.set(testId, view as unknown as Handle);
  };

/**
 * ListItem's handle, captured the way Form's is.
 *
 * The shared `Handle` type carries `title?: string`, which is Menu's trigger text; a
 * ListItem's `title` is `string | null` because every text slot is nullable (no optional
 * Hybrid View props — D7/nitro#1184), and the two types are not assignable to each other.
 * The cast is this file's standing answer for a control whose own props are wider than the
 * one handle type: the fields the fixtures below read are on both.
 */
const captureListItem =
  (testId: string) =>
  (view: object): void => {
    handles.set(testId, view as unknown as Handle);
  };

/**
 * One Form, with a row count that differs between the two owners.
 *
 * The counts differ by more than one on purpose: with 3 and 4, a reset that was off by a row
 * still looks like a layout that settled late. 4 and 2 also mean the second owner cannot be
 * satisfied by a leftover from the first.
 */
function formFixtureProps(
  second: boolean,
  testId = 'conformance-form',
  label: string = second ? FORM_LABEL_SECOND : FORM_LABEL
): ComponentProps<typeof Form> {
  const rows = second ? 2 : 4;
  return {
    testID: testId,
    accessibilityLabel: label,
    hybridRef: captureForm(testId),
    children: (
      <Form.Section footer="One group, for the rule." title="Group">
        {Array.from({ length: rows }, (_, index) => (
          <Form.Row key={`row-${String(index)}`}>
            <Text testID={`${testId}-row-${String(index)}`}>
              Row {String(index)}
            </Text>
          </Form.Row>
        ))}
      </Form.Section>
    ),
  };
}

/** One report string, as `key -> value` — the shape every other report here has. */
function formFieldsOf(report: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of report.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

function formFields(handle: Handle): Record<string, string> {
  return formFieldsOf(handle.nuiTestFormReport?.() ?? '');
}

/**
 * The Form's report once it has stopped moving.
 *
 * `nuiTestFormReport()` is the eventual-consistency seam every report in this library is
 * (the numbers are the UI thread's, the reader is on the JS thread, so a call answers what
 * the *last* call's build produced), and a recycled view inherits the report its previous
 * owner left in it. So the first read after a mount is allowed to be the previous owner's
 * `rows=4`, or the first-ever read is `pending`. This waits for two consecutive reads to
 * agree on something real, which says the tree is not moving — it never waits for a
 * particular number, so a reset that really did leave four rows registered still reads
 * four, and still fails.
 *
 * Same shape as the a11y sweep's "read 3 times before two agreed" (`scripts/real-input/a11y.mjs`).
 */
async function settledFormReport(handle: Handle): Promise<string> {
  let previous = handle.nuiTestFormReport?.() ?? 'pending';
  for (let read = 0; read < 12; read += 1) {
    await settle(80);
    const next = handle.nuiTestFormReport?.() ?? 'pending';
    if (next !== 'pending' && next === previous) return next;
    previous = next;
  }
  return previous;
}

/**
 * The item rows the ButtonGroup fixture mounts.
 *
 * Module-level because `items` is an object-array prop: a literal in the JSX would be a
 * fresh identity on every re-render, which is a prop diff no other fixture pays and a
 * repaint the sizing rules would then be measuring instead of a mount.
 */
const CONFORMANCE_BUTTON_GROUP_ACTIONS = [
  { id: 'copy', title: 'Copy' },
  { id: 'paste', title: 'Paste' },
];

/** The leak rule's two variants: different item counts, so the rows are visibly distinct. */
const CONFORMANCE_BUTTON_GROUP_A = CONFORMANCE_BUTTON_GROUP_ACTIONS;

const CONFORMANCE_BUTTON_GROUP_B = [
  { id: 'copy', title: 'Copy' },
  { id: 'cut', title: 'Cut' },
  { id: 'paste', title: 'Paste' },
];

/**
 * One uncontrolled toggle item: `defaultChecked` seeds it checked once, so pressing it
 * reports `false` — and an item whose seed was re-applied reports the same thing, which
 * is why the probe's *read* is the press after the second mount and not the state before
 * it.
 */
const CONFORMANCE_BUTTON_GROUP_TOGGLES = [
  { id: 'bold', title: 'Bold', toggle: true, defaultChecked: true },
];

/**
 * The same item, *controlled* at unchecked: a boolean `checked` is what makes the
 * wrapper put the id in `checkedIds`/`controlledIds`, which is the only write the
 * handshake's counters can refuse.
 */
const CONFORMANCE_BUTTON_GROUP_CONTROLLED = [
  { id: 'bold', title: 'Bold', toggle: true, checked: false },
];

/**
 * Press one item of a ButtonGroup, through the control's own press path on both
 * platforms.
 *
 * Not a harness tap: on iOS a harness touch is a `UITouch` with no HID event behind it
 * and reaches no SwiftUI `Button` gesture (Chip's note above), and on either platform a
 * tap can only be aimed at a *point* — it cannot name the item, which for a row whose
 * items have different widths is guesswork. `nuiTestPressItem(id)` runs the same
 * `press(id)` a tap runs, including the disabled refusal.
 */
const pressButtonGroupItem = async (
  testId: string,
  id: string
): Promise<void> => {
  await screen.findByTestId(testId);
  const handle = handleFor(testId);
  if (handle.nuiTestPressItem == null) {
    throw new Error(
      `"${testId}" is not a ButtonGroup - it has no nuiTestPressItem(id)`
    );
  }
  handle.nuiTestPressItem(id);
};

const FIXTURES: ReadonlyArray<Fixture> = [
  {
    name: 'Switch',
    component: 'NitroUiSwitch',
    label: 'Conformance switch',
    testId: 'conformance-switch',
    owner: (second) => (
      <Switch
        value={second}
        testID="conformance-switch"
        accessibilityLabel={
          second ? `Conformance switch, ${SECOND}` : 'Conformance switch'
        }
        hybridRef={captureFor('conformance-switch')}
      />
    ),
    control: (testId, variant) => (
      <Switch
        value={variant}
        testID={testId}
        accessibilityLabel={`Leak switch ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      { label: 'value', expected: second, actual: handle.value },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance switch, ${SECOND}`
          : 'Conformance switch',
        actual: handle.accessibilityLabel,
      },
    ],
    // A reset in this library has two lines and each one answers to a different probe, so
    // this control has two. The reason a single fixture cannot see both is stated on
    // `Fixture.controlledProbe` and measured in the report; what follows is the pair.
    //
    // This one puts the residue on `false` and the second owner's default on `true`, which
    // is the arrangement that separates the two lines: the residue has to be the value the
    // *component's* reset writes (`NitroUiControlledValue<Bool>(displayed: false)`,
    // `HybridNitroUiSwitch.swift:312`) so the display is not already right for the wrong
    // reason, and the default has to be the third possibility — impossible for a Bool, which
    // is exactly why round 1's fixture (`defaultValue={false}` against a `false` reset) could
    // not tell the lines apart. Here, the second owner's default (`true`) is neither the
    // reset's number nor the residue's.
    probe: {
      leaveBehind:
        'an uncontrolled Switch that started ON and was pressed off, then a second ' +
        'owner whose own default is ON — a number the control can only be standing on ' +
        'because `didApplyDefault` was re-armed and let the default apply',
      first: () => (
        <Switch
          defaultValue
          onValueChange={recordRecycle('conformance-switch')}
          testID="conformance-switch"
          accessibilityLabel="Conformance switch"
          hybridRef={captureFor('conformance-switch')}
        />
      ),
      act: async () => {
        // Pressed *off*: the displayed value left behind is `false`, which is also what
        // `prepareForRecycle` writes, so the display alone can never be the evidence.
        await pressControl('conformance-switch');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-switch:false'])
        );
      },
      second: () => (
        <Switch
          defaultValue
          onValueChange={recordRecycle('conformance-switch')}
          testID="conformance-switch"
          accessibilityLabel="Conformance switch"
          hybridRef={captureFor('conformance-switch')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressControl('conformance-switch');
        // The oracle is `Switch.harness.tsx:8`'s tap-twice, pointed at the one-shot: a
        // second owner whose default was applied shows ON, so its first press reports
        // `false`. A control still believing it applied its default shows OFF — the value
        // its previous owner pressed — and its first press reports `true`.
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-switch:false',
            actual: await eventsSettled(from, 'conformance-switch:false'),
          },
        ];
      },
    },
    controlledProbe: {
      leaveBehind:
        'a tap on an uncontrolled Switch, then a second owner that is *controlled* ' +
        'at `false` — the only shape that reads the handshake’s counters, which is ' +
        'what `model.state = NitroUiControlledValue(…)` uniquely owns',
      first: () => (
        <Switch
          defaultValue={false}
          onValueChange={recordRecycle('conformance-switch')}
          testID="conformance-switch"
          accessibilityLabel="Conformance switch"
          hybridRef={captureFor('conformance-switch')}
        />
      ),
      act: async () => {
        await pressControl('conformance-switch');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-switch:true'])
        );
      },
      // Controlled at `false`, so the app's own value is the opposite of the residue.
      // `useControlled.ts:56` sends `mostRecentEventCount` 0 with it and the setter assigns
      // it (`HybridNitroUiSwitch.swift:206`), so the only thing that can accept this write
      // is `nativeEvents` back at 0 — which is what the struct assignment does and nothing
      // else does. Leave it out and `reconcile()` sees `jsEvents 0 < nativeEvents 1`,
      // refuses the write as stale, and the control keeps showing the previous app's `true`:
      // the first press then reports `false`, which is the app's own value coming back out of
      // a control with somebody else's counters.
      //
      // `didApplyDefault` cannot matter on this axis — the default pass is guarded on
      // `model.state.js == nil` (`HybridNitroUiSwitch.swift:196`) and a controlled owner makes
      // that false — which is the whole reason there are two probes: each puts the other
      // reset line out of reach, so neither can be quietly covered by the other.
      second: () => (
        <Switch
          value={false}
          onValueChange={recordRecycle('conformance-switch')}
          testID="conformance-switch"
          accessibilityLabel="Conformance switch"
          hybridRef={captureFor('conformance-switch')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressControl('conformance-switch');
        return [
          {
            label: 'the first press on the controlled second mount reports',
            expected: 'conformance-switch:true',
            actual: await eventsSettled(from, 'conformance-switch:true'),
          },
        ];
      },
    },
  },
  {
    name: 'Slider',
    component: 'NitroUiSlider',
    label: 'Conformance slider',
    testId: 'conformance-slider',
    owner: (second) => (
      <Slider
        value={second ? 0.75 : 0.25}
        testID="conformance-slider"
        accessibilityLabel={
          second ? `Conformance slider, ${SECOND}` : 'Conformance slider'
        }
        hybridRef={captureFor('conformance-slider')}
      />
    ),
    control: (testId, variant) => (
      <Slider
        value={variant ? 0.6 : 0.2}
        testID={testId}
        accessibilityLabel={`Leak slider ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      { label: 'value', expected: second ? 0.75 : 0.25, actual: handle.value },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance slider, ${SECOND}`
          : 'Conformance slider',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      leaveBehind:
        'an uncontrolled drag to 0.5, then a second owner whose own `defaultValue` ' +
        'is 0.75 — a number the control can only be standing on because the one-shot ' +
        'let the default apply',
      first: () => (
        <View style={columnStyle}>
          <Slider
            defaultValue={0.25}
            step={0.25}
            onValueChange={recordRecycle('conformance-slider')}
            testID="conformance-slider"
            accessibilityLabel="Conformance slider"
            hybridRef={captureFor('conformance-slider')}
          />
        </View>
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await sliderStep(
          handleFor('conformance-slider'),
          -1,
          'the first owner’s drag down'
        );
        // The residue is 0: the value `prepareForRecycle` itself writes
        // (`HybridNitroUiSlider.swift:871`), so the drawn number alone can never be the
        // evidence — see `Fixture.controlledProbe` for the probe that reads the rest. The
        // event carries a JS number, so it records as `0`, not the report's `0.0`.
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-slider:0'])
        );
      },
      second: () => (
        <View style={columnStyle}>
          <Slider
            defaultValue={0.75}
            step={0.25}
            onValueChange={recordRecycle('conformance-slider')}
            testID="conformance-slider"
            accessibilityLabel="Conformance slider"
            hybridRef={captureFor('conformance-slider')}
          />
        </View>
      ),
      read: async () => {
        // One step up from wherever the second mount is standing. The report's `from` is
        // `model.state.displayed` read on the main thread
        // (`HybridNitroUiSlider.swift:979`), so it is the drawn value, not React's number.
        const report = await sliderStep(
          handleFor('conformance-slider'),
          1,
          'the second owner’s first step'
        );
        return [
          {
            // The report prints the value as the double it is (`... 0.0->0.25 ...`,
            // `HybridNitroUiSlider.swift:979`), so the expected string is the same shape: `0`
            // and `0.0` are the same number and different strings, and a rule that can only
            // fail because of a format is a rule the next person deletes.
            label: 'the value the control was showing before any step',
            expected: '0.75',
            actual: stepFrom(report),
          },
        ];
      },
    },
    controlledProbe: {
      leaveBehind:
        'a drag to 0.25 on an uncontrolled Slider, then a second owner that is ' +
        '*controlled* at 0 — the counters are what decide whether that write lands',
      first: () => (
        <View style={columnStyle}>
          <Slider
            defaultValue={0}
            step={0.25}
            onValueChange={recordRecycle('conformance-slider')}
            testID="conformance-slider"
            accessibilityLabel="Conformance slider"
            hybridRef={captureFor('conformance-slider')}
          />
        </View>
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await sliderStep(
          handleFor('conformance-slider'),
          1,
          'the first owner’s drag'
        );
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-slider:0.25'])
        );
      },
      second: () => (
        <View style={columnStyle}>
          <Slider
            value={0}
            step={0.25}
            onValueChange={recordRecycle('conformance-slider')}
            testID="conformance-slider"
            accessibilityLabel="Conformance slider"
            hybridRef={captureFor('conformance-slider')}
          />
        </View>
      ),
      read: async () => {
        // `value={0}` is refused as stale by counters left at `nativeEvents 1`, so the
        // control is still showing 0.25 and its next step starts there rather than at 0.
        // One step *down* from wherever the second mount stands: from 0.25 that arrives at 0,
        // and from 0 it cannot move — `stepped(from:up:)` returns the same value at the bound
        // and `accessibilityStep` then does nothing at all
        // (`HybridNitroUiSlider.swift:314-322`). So a control that accepted the controlled
        // write reports a step from 0 to 0, and one that refused it as stale reports 0.25 to 0.
        // Asking in this direction is what makes the two answers different strings; asking up
        // would report `0.25` either way and the oracle would be a tautology.
        const report = await sliderStep(
          handleFor('conformance-slider'),
          -1,
          'the controlled second owner’s first step'
        );
        return [
          {
            label: 'where the controlled second mount was standing',
            expected: '0.0',
            actual: stepFrom(report),
          },
        ];
      },
    },
  },
  {
    name: 'TextField',
    component: 'NitroUiTextField',
    label: 'Conformance field',
    testId: 'conformance-text-field',
    owner: (second) => (
      <View style={columnStyle}>
        <TextField
          value={second ? 'second' : 'first'}
          testID="conformance-text-field"
          accessibilityLabel={
            second ? `Conformance field, ${SECOND}` : 'Conformance field'
          }
          hybridRef={captureFor('conformance-text-field')}
        />
      </View>
    ),
    control: (testId, variant) => (
      <TextField
        value={variant ? 'Leak B' : 'Leak A'}
        testID={testId}
        accessibilityLabel={`Leak field ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'value',
        expected: second ? 'second' : 'first',
        actual: handle.value,
      },
      {
        label: 'accessibilityLabel',
        expected: second ? `Conformance field, ${SECOND}` : 'Conformance field',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      leaveBehind:
        'typing `x` into an uncontrolled field seeded `first`, then a second owner whose ' +
        'own `defaultValue` is `second` - text the control can only hold if the reset ' +
        're-armed the default and cleared what the first owner typed',
      first: () => (
        <View style={columnStyle}>
          <TextField
            defaultValue="first"
            onChangeText={recordRecycle('conformance-text-field')}
            testID="conformance-text-field"
            accessibilityLabel="Conformance field"
            hybridRef={captureFor('conformance-text-field')}
          />
        </View>
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await typeIntoField('conformance-text-field', 'x', 'firstx');
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-text-field:firstx'])
        );
      },
      second: () => (
        <View style={columnStyle}>
          <TextField
            defaultValue="second"
            onChangeText={recordRecycle('conformance-text-field')}
            testID="conformance-text-field"
            accessibilityLabel="Conformance field"
            hybridRef={captureFor('conformance-text-field')}
          />
        </View>
      ),
      read: async () => {
        const handle = handleFor('conformance-text-field');
        await settle(200);
        const state = handle.nuiTestState?.();
        return [
          {
            label: 'the text the control holds',
            expected: 'second',
            actual: state?.text,
          },
          {
            label: 'native events counted for this owner',
            expected: 0,
            actual: state?.nativeEvents,
          },
        ];
      },
    },
    controlledProbe: {
      leaveBehind:
        'three keystrokes into an uncontrolled field, then a second owner *controlled* at ' +
        '`ctl` - counts left at `nativeEvents 3` would refuse that write as stale',
      first: () => (
        <View style={columnStyle}>
          <TextField
            defaultValue=""
            onChangeText={recordRecycle('conformance-text-field')}
            testID="conformance-text-field"
            accessibilityLabel="Conformance field"
            hybridRef={captureFor('conformance-text-field')}
          />
        </View>
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await typeIntoField('conformance-text-field', 'abc', 'abc');
        await waitFor(() =>
          expect(eventsSince(before)).toEqual([
            'conformance-text-field:a',
            'conformance-text-field:ab',
            'conformance-text-field:abc',
          ])
        );
      },
      second: () => (
        <View style={columnStyle}>
          <TextField
            value="ctl"
            onChangeText={recordRecycle('conformance-text-field')}
            testID="conformance-text-field"
            accessibilityLabel="Conformance field"
            hybridRef={captureFor('conformance-text-field')}
          />
        </View>
      ),
      read: async () => {
        const handle = handleFor('conformance-text-field');
        await settle(200);
        return [
          {
            label: 'the text the controlled second owner shows',
            expected: 'ctl',
            actual: handle.nuiTestState?.().text,
          },
        ];
      },
    },
  },
  {
    name: 'SearchField',
    component: 'NitroUiSearchField',
    label: 'Conformance search field',
    testId: 'conformance-search-field',
    owner: (second) => (
      <View style={columnStyle}>
        <SearchField
          value={second ? 'second' : 'first'}
          testID="conformance-search-field"
          accessibilityLabel={
            second
              ? `Conformance search field, ${SECOND}`
              : 'Conformance search field'
          }
          hybridRef={captureFor('conformance-search-field')}
        />
      </View>
    ),
    control: (testId, variant) => (
      <SearchField
        value={variant ? 'Leak B' : 'Leak A'}
        testID={testId}
        accessibilityLabel={`Leak search field ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'value',
        expected: second ? 'second' : 'first',
        actual: handle.value,
      },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance search field, ${SECOND}`
          : 'Conformance search field',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      leaveBehind:
        'typing `x` into an uncontrolled field seeded `first`, then a second owner whose ' +
        'own `defaultValue` is `second` - text the control can only hold if the reset ' +
        're-armed the default and cleared what the first owner typed',
      first: () => (
        <View style={columnStyle}>
          <SearchField
            defaultValue="first"
            onChangeText={recordRecycle('conformance-search-field')}
            testID="conformance-search-field"
            accessibilityLabel="Conformance search field"
            hybridRef={captureFor('conformance-search-field')}
          />
        </View>
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await typeIntoField('conformance-search-field', 'x', 'firstx');
        await waitFor(() =>
          expect(eventsSince(before)).toEqual([
            'conformance-search-field:firstx',
          ])
        );
      },
      second: () => (
        <View style={columnStyle}>
          <SearchField
            defaultValue="second"
            onChangeText={recordRecycle('conformance-search-field')}
            testID="conformance-search-field"
            accessibilityLabel="Conformance search field"
            hybridRef={captureFor('conformance-search-field')}
          />
        </View>
      ),
      read: async () => {
        const handle = handleFor('conformance-search-field');
        await settle(200);
        const state = handle.nuiTestState?.();
        return [
          {
            label: 'the text the control holds',
            expected: 'second',
            actual: state?.text,
          },
          {
            label: 'native events counted for this owner',
            expected: 0,
            actual: state?.nativeEvents,
          },
        ];
      },
    },
    controlledProbe: {
      leaveBehind:
        'three keystrokes into an uncontrolled field, then a second owner *controlled* at ' +
        '`ctl` - counts left at `nativeEvents 3` would refuse that write as stale',
      first: () => (
        <View style={columnStyle}>
          <SearchField
            defaultValue=""
            onChangeText={recordRecycle('conformance-search-field')}
            testID="conformance-search-field"
            accessibilityLabel="Conformance search field"
            hybridRef={captureFor('conformance-search-field')}
          />
        </View>
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await typeIntoField('conformance-search-field', 'abc', 'abc');
        await waitFor(() =>
          expect(eventsSince(before)).toEqual([
            'conformance-search-field:a',
            'conformance-search-field:ab',
            'conformance-search-field:abc',
          ])
        );
      },
      second: () => (
        <View style={columnStyle}>
          <SearchField
            value="ctl"
            onChangeText={recordRecycle('conformance-search-field')}
            testID="conformance-search-field"
            accessibilityLabel="Conformance search field"
            hybridRef={captureFor('conformance-search-field')}
          />
        </View>
      ),
      read: async () => {
        const handle = handleFor('conformance-search-field');
        await settle(200);
        return [
          {
            label: 'the text the controlled second owner shows',
            expected: 'ctl',
            actual: handle.nuiTestState?.().text,
          },
        ];
      },
    },
  },
  {
    name: 'Button',
    component: 'NitroUiButton',
    label: 'Conformance button',
    testId: 'conformance-button',
    owner: (second) => (
      <Button
        title={second ? 'Second' : 'First'}
        testID="conformance-button"
        accessibilityLabel={
          second ? `Conformance button, ${SECOND}` : 'Conformance button'
        }
        hybridRef={captureFor('conformance-button')}
      />
    ),
    control: (testId, variant) => (
      <Button
        title={variant ? 'Leak B' : 'Leak A'}
        testID={testId}
        accessibilityLabel={`Leak button ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance button, ${SECOND}`
          : 'Conformance button',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      noProbe:
        'a Button owns no state a reset can clear. `title`, `variant`, `size`, ' +
        '`shape`, `accessibilityLabel` and `onPress` are all re-sent by the wrapper ' +
        'on every mount - and the callback is deliberately always sent, as a stable ' +
        'no-op when the app passed none, which is what stops a recycled view keeping ' +
        'a dead owner’s handler (Button.tsx:117-126). Its `prepareForRecycle` is the ' +
        'belt, and nothing on either platform can show it missing: `shape` is the ' +
        'newest of those props, and the wrapper sends it on every mount too, so a ' +
        'recycled view cannot keep the previous mount’s corner.',
    },
  },
  {
    name: 'Progress',
    component: 'NitroUiProgress',
    label: 'Conformance progress',
    testId: 'conformance-progress',
    owner: (second) => (
      <Progress
        value={second ? 0.8 : 0.2}
        testID="conformance-progress"
        accessibilityLabel={
          second ? `Conformance progress, ${SECOND}` : 'Conformance progress'
        }
        hybridRef={captureFor('conformance-progress')}
      />
    ),
    control: (testId, variant) => (
      <Progress
        value={variant ? 0.6 : 0.2}
        testID={testId}
        accessibilityLabel={`Leak progress ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      { label: 'value', expected: second ? 0.8 : 0.2, actual: handle.value },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance progress, ${SECOND}`
          : 'Conformance progress',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      noProbe:
        'Progress has no interaction to leave residue with - it is an indicator, not ' +
        'a control - and both platforms’ own read-out of it is a stub: ' +
        '`nuiTestDisplayedValue()` answers `-1` on iOS and `-1;animating=-1` on ' +
        'Android, so any assertion written against it would be a tautology. Its ' +
        'value, tint, variant and - since E4 - `appearance` and `contained` are all ' +
        'props the wrapper re-sends on every mount, so a recycled view cannot keep ' +
        'the previous owner’s wave or container; both platforms’ reset clears them ' +
        'anyway as the belt, which `ProgressModelTest.aResetClearsTheConfigurationToo` ' +
        'is where forgetting is proved to matter.',
    },
  },
  {
    name: 'SegmentedControl',
    component: 'NitroUiSegmentedControl',
    label: 'Conformance segmented',
    testId: 'conformance-segmented',
    owner: (second) => (
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={second ? 2 : 0}
        testID="conformance-segmented"
        accessibilityLabel={
          second ? `Conformance segmented, ${SECOND}` : 'Conformance segmented'
        }
        hybridRef={captureFor('conformance-segmented')}
      />
    ),
    control: (testId, variant) => (
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={variant ? 1 : 0}
        testID={testId}
        accessibilityLabel={`Leak segmented ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'selectedIndex',
        expected: second ? 2 : 0,
        actual: handle.selectedIndex,
      },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance segmented, ${SECOND}`
          : 'Conformance segmented',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      leaveBehind:
        'a tapped segment on an uncontrolled control, then a second owner whose ' +
        'own `defaultSelectedIndex` is 1 — neither the residue (2) nor what the ' +
        'reset writes (0), so only the re-armed one-shot can put the row there',
      first: () => (
        <SegmentedControl
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={0}
          onChange={(event) =>
            recordRecycle('conformance-segmented')(event.index)
          }
          testID="conformance-segmented"
          accessibilityLabel="Conformance segmented"
          hybridRef={captureFor('conformance-segmented')}
        />
      ),
      act: async () => {
        const before = eventsSince(0).length;
        // A finger, not a prop: `defaultSelectedIndex` stays 0 for the whole fixture, so
        // the index 2 the row ends up on exists nowhere in what React sent and can only
        // arrive from the control's own state.
        await tapSegmentOf('conformance-segmented', 2, 3);
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-segmented:2'])
        );
        // And the residue is *measured* through the read-out this probe depends on, before
        // that read-out is trusted: a `nuiTestDisplayedIndex` that echoed the prop would
        // answer 0 here (React never sent 2) and go red on this line rather than banking a
        // pass for the second mount. 2 is also what `prepareForRecycle` does *not* write,
        // so the second read below cannot be this number arriving late.
        await pollReport(
          () =>
            handleFor('conformance-segmented').nuiTestDisplayedIndex?.() ?? '',
          (report) => report === 'displayed=2',
          'the first owner’s tap, as the row draws it'
        );
      },
      second: () => (
        <SegmentedControl
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={1}
          onChange={(event) =>
            recordRecycle('conformance-segmented')(event.index)
          }
          testID="conformance-segmented"
          accessibilityLabel="Conformance segmented"
          hybridRef={captureFor('conformance-segmented')}
        />
      ),
      read: async () => [
        {
          // The row's own answer, not the handle's `selectedIndex`: a second owner that
          // sends no `selectedIndex` sees `null` from that getter either way, which is the
          // blindness X4 recorded as "residue no read-out can show". Index 1 is reachable
          // only through `prepareForRecycle` re-arming `didApplyDefault`
          // (`HybridNitroUiSegmentedControl.swift:518`, `HybridNitroUiSegmentedControl.kt`
          // `reset`) so the second owner's own default can apply: the residue is 2 and the
          // reset writes 0, so this is the third value the arrangement can produce, and the
          // line is specific to the one-shot rather than to the display write beside it.
          label: 'the segment the row paints',
          expected: '1',
          actual: await drawnIndexOf('conformance-segmented'),
        },
      ],
    },
    controlledProbe: {
      leaveBehind:
        'a tapped segment on an uncontrolled SegmentedControl, then a second owner ' +
        'that is *controlled* on the first one — whose index cannot be shown unless ' +
        'the counters came back at zero',
      first: () => (
        <SegmentedControl
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={0}
          onChange={(event) =>
            recordRecycle('conformance-segmented')(event.index)
          }
          testID="conformance-segmented"
          accessibilityLabel="Conformance segmented"
          hybridRef={captureFor('conformance-segmented')}
        />
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await tapSegmentOf('conformance-segmented', 2, 3);
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-segmented:2'])
        );
      },
      // Controlled on 0, the opposite of the residue. `useControlled.ts:56` sends
      // `mostRecentEventCount` 0 with it, so the only thing that can accept the write is
      // `nativeEvents` back at 0 — which is what the reset's handshake assignment does and
      // nothing else does. Left at the previous owner's count, `reconcile()` sees
      // `jsEvents 0 < nativeEvents 1`, refuses it as stale, and the row keeps painting
      // segment 2 while the app believes it asked for 0.
      second: () => (
        <SegmentedControl
          options={['One', 'Two', 'Three']}
          selectedIndex={0}
          onChange={(event) =>
            recordRecycle('conformance-segmented')(event.index)
          }
          testID="conformance-segmented"
          accessibilityLabel="Conformance segmented"
          hybridRef={captureFor('conformance-segmented')}
        />
      ),
      read: async () => [
        {
          // Read through the row, not the handle: `selectedIndex` answers `state.js`, which
          // is 0 because that is what React sent, whether or not the write was accepted.
          label: 'the segment the controlled second mount paints',
          expected: '0',
          actual: await drawnIndexOf('conformance-segmented'),
        },
      ],
    },
  },
  {
    name: 'DatePicker',
    component: 'NitroUiDatePicker',
    label: 'Conformance date picker',
    testId: 'conformance-date-picker',
    owner: (second) => (
      <DatePicker
        value={new Date(second ? 1735700000000 : 1735600000000)}
        testID="conformance-date-picker"
        accessibilityLabel={
          second
            ? `Conformance date picker, ${SECOND}`
            : 'Conformance date picker'
        }
        hybridRef={captureFor('conformance-date-picker')}
      />
    ),
    control: (testId, variant) => (
      <DatePicker
        value={new Date(variant ? 1735700000000 : 1735600000000)}
        testID={testId}
        accessibilityLabel={`Leak date picker ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance date picker, ${SECOND}`
          : 'Conformance date picker',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      leaveBehind:
        'a picked day and an opened presentation, both owned by the view rather ' +
        'than by a prop, then a second owner whose own default is a third day',
      first: () => (
        <DatePicker
          defaultValue={new Date(localDay(2026, 6, 4))}
          onChange={(date) => recordRecycle('conformance-date-picker')(date)}
          testID="conformance-date-picker"
          accessibilityLabel="Conformance date picker"
          hybridRef={captureFor('conformance-date-picker')}
        />
      ),
      act: async () => {
        const picked = localDay(2027, 1, 15);
        handleFor('conformance-date-picker').nuiTestSelect?.(2027, 1, 15, 0, 0);
        await pollReport(
          () => datePickerStateOf('conformance-date-picker').raw,
          () => datePickerStateOf('conformance-date-picker').millis === picked,
          'the first owner’s pick'
        );
        handleFor('conformance-date-picker').nuiTestPresent?.();
        await pollReport(
          () => datePickerStateOf('conformance-date-picker').raw,
          () => datePickerStateOf('conformance-date-picker').presented === '1',
          'the first owner’s presentation'
        );
      },
      second: () => (
        <DatePicker
          defaultValue={new Date(localDay(2025, 3, 1))}
          onChange={(date) => recordRecycle('conformance-date-picker')(date)}
          testID="conformance-date-picker"
          accessibilityLabel="Conformance date picker"
          hybridRef={captureFor('conformance-date-picker')}
        />
      ),
      read: async () => {
        const state = datePickerStateOf('conformance-date-picker');
        return [
          {
            // The displayed day, read from the view rather than from the `value` React sent:
            // the second owner passes no `value` at all, so only the control's own state can
            // answer this. No `pollReport` here — waiting for the reset before asking whether
            // it happened is how this rule would go green on a control that resets late.
            //
            // The expected day is the *second owner's own default*, and that is the whole
            // point of the choice: it is neither the residue (`2027-01-15`) nor what
            // `prepareForRecycle` writes into `displayed` (epoch 0,
            // `HybridNitroUiDatePicker.swift:1394`), so this number can only arrive by the
            // one-shot being re-armed and the default pass running. Round 1's fixture used
            // the same day for the default as for the residue's neighbour, which is what made
            // the two reset lines look interchangeable.
            label: 'the day the field shows',
            expected: localDay(2025, 3, 1),
            actual: state.millis,
          },
          {
            label: 'a presentation left open',
            expected: '0',
            actual: state.presented,
          },
        ];
      },
    },
    controlledProbe: {
      leaveBehind:
        'a picked day on an uncontrolled DatePicker, then a second owner that is ' +
        '*controlled* at a third day — the counters decide whether that day can be shown',
      first: () => (
        <DatePicker
          defaultValue={new Date(localDay(2026, 6, 4))}
          onChange={(date) => recordRecycle('conformance-date-picker')(date)}
          testID="conformance-date-picker"
          accessibilityLabel="Conformance date picker"
          hybridRef={captureFor('conformance-date-picker')}
        />
      ),
      act: async () => {
        const picked = localDay(2027, 1, 15);
        handleFor('conformance-date-picker').nuiTestSelect?.(2027, 1, 15, 0, 0);
        await pollReport(
          () => datePickerStateOf('conformance-date-picker').raw,
          () => datePickerStateOf('conformance-date-picker').millis === picked,
          'the controlled probe’s pick'
        );
      },
      second: () => (
        <DatePicker
          value={new Date(localDay(2025, 3, 1))}
          onChange={(date) => recordRecycle('conformance-date-picker')(date)}
          testID="conformance-date-picker"
          accessibilityLabel="Conformance date picker"
          hybridRef={captureFor('conformance-date-picker')}
        />
      ),
      read: async () => [
        {
          // Counters left at the previous owner's event make this write stale
          // (`NitroUiModel.swift:71-79`), and a stale write is dropped: the field keeps
          // showing the day the *previous* app picked. Reading `millis` rather than the
          // handle's `value` is what makes that visible — the handle answers `state.js`,
          // which is the day React sent either way.
          label: 'the day the controlled second mount shows',
          expected: localDay(2025, 3, 1),
          actual: datePickerStateOf('conformance-date-picker').millis,
        },
      ],
    },
  },
  {
    name: 'Picker',
    component: 'NitroUiPicker',
    label: 'Conformance picker',
    testId: 'conformance-picker',
    owner: (second) => (
      <Picker
        options={['One', 'Two', 'Three']}
        selectedIndex={second ? 2 : 0}
        testID="conformance-picker"
        accessibilityLabel={
          second ? `Conformance picker, ${SECOND}` : 'Conformance picker'
        }
        hybridRef={captureFor('conformance-picker')}
      />
    ),
    control: (testId, variant) => (
      <Picker
        options={['One', 'Two', 'Three']}
        selectedIndex={variant ? 1 : 0}
        testID={testId}
        accessibilityLabel={`Leak picker ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'selectedIndex',
        expected: second ? 2 : 0,
        actual: handle.selectedIndex,
      },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance picker, ${SECOND}`
          : 'Conformance picker',
        actual: handle.accessibilityLabel,
      },
    ],
    probe: {
      leaveBehind:
        'a pick of option 1 on an uncontrolled control, then a second owner whose ' +
        'own `defaultSelectedIndex` is 2 — so picking 0 fires only if the one-shot ' +
        'was re-armed and the second owner’s default is what the control is standing on',
      first: () => (
        <Picker
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={0}
          onChange={(event) => recordRecycle('conformance-picker')(event.index)}
          testID="conformance-picker"
          accessibilityLabel="Conformance picker"
          hybridRef={captureFor('conformance-picker')}
        />
      ),
      act: async () => {
        const before = eventsSince(0).length;
        const choose = () => handleFor('conformance-picker').nuiTestSelect?.(1);
        choose();
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-picker:1'])
        );
        // The same choice again: `applyUserSelection` returns without emitting when the
        // index equals what is displayed (`HybridNitroUiPicker.swift:103`, whose comment
        // names this as the thing that makes a *rolled-back* selection observable). So the
        // second call says, in the negative, that the control really is on 1.
        choose();
        await settle(300);
        if (eventsSince(before).length !== 1) {
          throw new Error(
            `the picker emitted twice for one repeated choice: ` +
              eventsSince(before).join(',')
          );
        }
      },
      // Defaulted to **2**, which is neither the residue (1) nor what `prepareForRecycle`
      // writes into `displayed` (0). That is the line-specificity X4 re-review 2 asked for:
      // round 1's second owner defaulted to `0`, the reset's own number, so deleting
      // `didApplyDefault = false` stayed green — the control was already on 0 for the wrong
      // reason and both arrangements emitted the same events. Now the three states are three
      // different answers to the same question: one-shot alive → on 2, so picking 0 moves it
      // and fires; one-shot dead → on 0 (the reset's write), so picking 0 changes nothing and
      // stays silent.
      second: () => (
        <Picker
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={2}
          onChange={(event) => recordRecycle('conformance-picker')(event.index)}
          testID="conformance-picker"
          accessibilityLabel="Conformance picker"
          hybridRef={captureFor('conformance-picker')}
        />
      ),
      read: async () => {
        const before = eventsSince(0).length;
        handleFor('conformance-picker').nuiTestSelect?.(0);
        // The event is the reset reporting for itself. Silence *is* the residue, so it gets
        // reported rather than waited away: `waitFor` here would turn the missing reset into
        // a Jest timeout that names neither value.
        //
        // What this oracle separates, and what it cannot. Its one question is "are you
        // standing on 0?", and a pick is destructive - a firing pick moves the control, so a
        // second question in the same read would be answered about the first pick's result.
        // That leaves exactly two things to ask of this shape, and the pair splits them:
        // this probe asks about `didApplyDefault` (the second owner's default of 2 is what
        // makes that the only answer a healthy control can give), and `controlledProbe`
        // below asks about the handshake counters - which is also where a *wholesale* reset
        // deletion shows up, because a recycled control left on 2 with its counts intact
        // refuses the controlled write and goes silent on that probe, not this one. Nothing
        // an uncontrolled control does ever reads those counts, so this probe could not ask
        // that question even with a second read to spend.
        return [
          {
            label:
              'choosing an option other than the second owner’s default emits',
            expected: 'conformance-picker:0',
            actual: await eventsSettled(before, 'conformance-picker:0'),
          },
        ];
      },
    },
    controlledProbe: {
      leaveBehind:
        'a pick of the last option on an uncontrolled Picker, then a second owner ' +
        'that is *controlled* on the first one — whose index cannot be shown unless ' +
        'the counters came back at zero',
      first: () => (
        <Picker
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={0}
          onChange={(event) => recordRecycle('conformance-picker')(event.index)}
          testID="conformance-picker"
          accessibilityLabel="Conformance picker"
          hybridRef={captureFor('conformance-picker')}
        />
      ),
      act: async () => {
        const before = eventsSince(0).length;
        handleFor('conformance-picker').nuiTestSelect?.(2);
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-picker:2'])
        );
      },
      second: () => (
        <Picker
          options={['One', 'Two', 'Three']}
          selectedIndex={0}
          onChange={(event) => recordRecycle('conformance-picker')(event.index)}
          testID="conformance-picker"
          accessibilityLabel="Conformance picker"
          hybridRef={captureFor('conformance-picker')}
        />
      ),
      read: async () => {
        const before = eventsSince(0).length;
        handleFor('conformance-picker').nuiTestSelect?.(2);
        // Counters left at the previous owner's event make `selectedIndex={0}` stale, and a
        // stale write is dropped, so the control is still showing option 2 — and a pick of 2
        // changes nothing, which `applyUserSelection` reports as silence. The app asked for
        // index 0 and the control is on 2: that is the bug the counters' reset exists to stop.
        return [
          {
            label: 'choosing the previous owner’s option again emits',
            expected: 'conformance-picker:2',
            actual: await eventsSettled(before, 'conformance-picker:2'),
          },
        ];
      },
    },
  },
  {
    name: 'Menu',
    component: 'NitroUiMenu',
    label: 'Conformance menu',
    testId: 'conformance-menu',
    owner: (second) => (
      <Menu
        title={second ? MENU_TITLE_SECOND : MENU_TITLE}
        group={MENU_GROUP}
        onSelect={recordRecycle('conformance-menu')}
        testID="conformance-menu"
        accessibilityLabel={
          second ? `Conformance menu, ${SECOND}` : 'Conformance menu'
        }
        hybridRef={captureFor('conformance-menu')}
      />
    ),
    control: (testId, variant) => (
      <Menu
        title={variant ? 'Leak B' : 'Leak A'}
        group={MENU_GROUP}
        testID={testId}
        accessibilityLabel={`Leak menu ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'title',
        expected: second ? MENU_TITLE_SECOND : MENU_TITLE,
        actual: handle.title,
      },
      {
        label: 'accessibilityLabel',
        expected: second ? `Conformance menu, ${SECOND}` : 'Conformance menu',
        actual: handle.accessibilityLabel,
      },
    ],
    // The props half runs; the residue half runs nowhere, and what that hole *is* changed in
    // F6 so the row describes today's two platforms rather than the pair X4 measured. A Menu's
    // only native-owned state is whether its popup is open (DECISIONS D29: no `open()`/
    // `close()` in v0.1, so only a gesture puts it there and no harness gesture can reach a
    // SwiftUI `Menu`). `nuiTestMenuReport` reads that flag for real on **Android**, which F6
    // proved also recycles (`example/__tests__/Recycling.harness.tsx`) — so the Android half
    // is no longer blind, and `MenuModelTest` in `android/src/test` covers the reset line the
    // fixture cannot reach from a device: `MenuModel.reset()` clears `expanded` ahead of every
    // other field, and the popup's own witness closes it when its composition is disposed
    // (`HybridNitroUiMenu.kt`'s `MenuWitness.onDispose`), which a device run goes through
    // first. The failing half is **iOS**, where both doors are shut at once: no gesture
    // reaches the control (D29) *and* the read-out answers `-1`
    // (`HybridNitroUiMenu.swift:762`), and the coverage table has no way to mark one platform
    // of a cell — see the report's follow-up for splitting it.
    probe: {
      blindSpot:
        'a Menu holds one piece of state no prop rewrites - whether its popup is ' +
        'open - and on iOS, the platform that recycles by default, neither door is ' +
        'open: no harness gesture can reach a SwiftUI `Menu` (D29), and the ' +
        'read-out for the flag answers `-1` there ' +
        '(`HybridNitroUiMenu.swift:762`). Android reads the flag and recycles too, so ' +
        'the blind half is one platform, not both.',
    },
  },
  {
    name: 'Dialog',
    component: 'NitroUiDialog',
    label: DIALOG_TITLE,
    testId: 'conformance-dialog',
    selfSizing: false,
    owner: (second) => (
      <AlertDialog
        isPresented={false}
        title={second ? DIALOG_TITLE_SECOND : DIALOG_TITLE}
        actions={DIALOG_ACTIONS}
        onIsPresentedChange={recordRecycle('conformance-dialog')}
        testID="conformance-dialog"
        hybridRef={captureDialog('conformance-dialog')}
      />
    ),
    control: (testId, variant) => (
      <AlertDialog
        isPresented={false}
        title={variant ? 'Leak B' : 'Leak A'}
        actions={DIALOG_ACTIONS}
        testID={testId}
      />
    ),
    state: (handle, second) => [
      {
        label: 'title',
        expected: second ? DIALOG_TITLE_SECOND : DIALOG_TITLE,
        actual: handle.title,
      },
      { label: 'presented', expected: false, actual: handle.presented },
    ],
    // The residue a dialog can leave is the handshake's: a user dismissal is a native
    // event, so the first owner ends with one native event counted. A second owner sends
    // `isPresented` with `mostRecentEventCount` 0 (useControlled.ts), and if the reset
    // left the first owner's count behind, `reconcile()` refuses that write as stale -
    // the dialog the second app asked for never presents. The other residue is the
    // first owner's controller: a reset that kept it would show the old title. Both are
    // read from the view (`nuiTestStateReport`), never from React's own props.
    probe: {
      leaveBehind:
        'a dismissal the first owner took (one native event) - the second owner ' +
        'presents with a fresh count, so a left-over count refuses it, and a left-over ' +
        'controller shows the first title',
      first: () => (
        <AlertDialog
          isPresented
          title={DIALOG_TITLE}
          actions={DIALOG_ACTIONS}
          onIsPresentedChange={recordRecycle('conformance-dialog')}
          testID="conformance-dialog"
          hybridRef={captureDialog('conformance-dialog')}
        />
      ),
      act: async () => {
        const handle = await ensureHandle('conformance-dialog');
        const deadline = Date.now() + 8000;
        while (!dialogShows(dialogReportOf(handle), DIALOG_TITLE)) {
          if (Date.now() > deadline) {
            throw new Error(
              'the first owner never presented its dialog: ' +
                (handle.nuiTestStateReport?.() ?? '(no report)')
            );
          }
          await sleep(100);
        }
        // Let the entry transition finish: a dismissal during it is carried by the
        // helper, which is a different path from the one this probe is about.
        await sleep(600);
        const from = recycleEvents.length;
        handle.nuiTestDismiss?.();
        const seen = await eventsSettled(from, 'conformance-dialog:false');
        if (seen !== 'conformance-dialog:false') {
          throw new Error(
            `the dismissal reported "${seen}", so the first owner has no native event ` +
              'for a reset to clear'
          );
        }
      },
      second: () => (
        <AlertDialog
          isPresented
          title={DIALOG_TITLE_SECOND}
          actions={DIALOG_ACTIONS}
          onIsPresentedChange={recordRecycle('conformance-dialog')}
          testID="conformance-dialog"
          hybridRef={captureDialog('conformance-dialog')}
        />
      ),
      read: async () => {
        const handle = handleFor('conformance-dialog');
        // The flag is read once. The window is waited for, because presenting is
        // asynchronous on both platforms - the wait is for UIKit or Compose to put
        // up what the second owner asked for, not for a reset to happen.
        const presented = dialogReportOf(handle).presented;
        const deadline = Date.now() + 4000;
        let report = dialogReportOf(handle);
        while (report.kind === 'none' && Date.now() < deadline) {
          await sleep(100);
          report = dialogReportOf(handle);
        }
        return [
          {
            label: 'the dialog the second owner asked for is presented',
            expected: '1',
            actual: presented,
          },
          {
            label: 'the title its window shows',
            expected: DIALOG_TITLE_SECOND,
            actual: report.title,
          },
        ];
      },
    },
  },
  {
    name: 'BottomSheet',
    component: 'NitroUiBottomSheet',
    label: SHEET_LABEL,
    testId: 'conformance-sheet',
    selfSizing: false,
    owner: () => sheetOwner(false, SHEET_FIRST_HEIGHT),
    control: (testId, variant) => (
      <BottomSheet isPresented={false} testID={testId}>
        <View style={{ height: variant ? 80 : 40 }} />
      </BottomSheet>
    ),
    state: (handle) => [
      { label: 'presented', expected: false, actual: handle.presented },
    ],
    // A sheet's residue is the dialog's, plus its content: a user dismissal leaves one
    // native event, so a reset that kept the count refuses the second owner's
    // `isPresented` as stale; and a reset that kept the previous sheet's content box
    // would show the first owner's height in the second owner's sheet. Both are read
    // from the view (`nuiTestStateReport`).
    probe: {
      leaveBehind:
        'a dismissal the first owner took (one native event), and the content the first ' +
        "owner's sheet held - the second owner presents with a fresh count and content " +
        'of another height',
      first: () => sheetOwner(true, SHEET_FIRST_HEIGHT),
      act: async () => {
        const handle = await ensureHandle('conformance-sheet');
        const deadline = Date.now() + 8000;
        while (!sheetShows(dialogReportOf(handle), SHEET_FIRST_HEIGHT)) {
          if (Date.now() > deadline) {
            throw new Error(
              'the first owner never presented its sheet: ' +
                (handle.nuiTestStateReport?.() ?? '(no report)')
            );
          }
          await sleep(100);
        }
        await sleep(600);
        const from = recycleEvents.length;
        handle.nuiTestDismiss?.();
        const seen = await eventsSettled(from, 'conformance-sheet:false');
        if (seen !== 'conformance-sheet:false') {
          throw new Error(
            `the dismissal reported "${seen}", so the first owner has no native event ` +
              'for a reset to clear'
          );
        }
      },
      second: () => sheetOwner(true, SHEET_SECOND_HEIGHT),
      read: async () => {
        const handle = handleFor('conformance-sheet');
        const presented = dialogReportOf(handle).presented;
        const deadline = Date.now() + 6000;
        let report = dialogReportOf(handle);
        while (
          !sheetShows(report, SHEET_SECOND_HEIGHT) &&
          Date.now() < deadline
        ) {
          await sleep(100);
          report = dialogReportOf(handle);
        }
        return [
          {
            label: 'the sheet the second owner asked for is presented',
            expected: '1',
            actual: presented,
          },
          {
            label: "the content height its sheet holds (the second owner's)",
            expected: String(SHEET_SECOND_HEIGHT),
            actual: report.contentH,
          },
        ];
      },
    },
  },
  {
    name: 'Tooltip',
    component: 'NitroUiTooltip',
    label: TOOLTIP_MESSAGE,
    testId: 'conformance-tooltip',
    selfSizing: false,
    owner: () => tooltipOwner(false, TOOLTIP_MESSAGE),
    control: (testId, variant) => (
      <Tooltip
        isPresented={false}
        message={variant ? 'Leak B' : 'Leak A'}
        testID={testId}
      >
        <View style={{ width: variant ? 60 : 40, height: 40 }} />
      </Tooltip>
    ),
    state: (handle) => [
      { label: 'presented', expected: false, actual: handle.presented },
    ],
    // A tooltip's residue is the dialog's, plus its content: a user dismissal leaves one
    // native event, so a reset that kept the count refuses the second owner's
    // `isPresented` as stale; and a reset that kept the previous popup's content would
    // show the first owner's message. Both are read from the view (`nuiTestStateReport`).
    probe: {
      leaveBehind:
        'a dismissal the first owner took (one native event), and the message the ' +
        "first owner's tooltip showed - the second owner presents with a fresh count " +
        'and another message',
      first: () => tooltipOwner(true, TOOLTIP_MESSAGE),
      act: async () => {
        const handle = await ensureHandle('conformance-tooltip');
        const deadline = Date.now() + 8000;
        while (!tooltipShows(dialogReportOf(handle), TOOLTIP_MESSAGE)) {
          if (Date.now() > deadline) {
            throw new Error(
              'the first owner never presented its tooltip: ' +
                (handle.nuiTestStateReport?.() ?? '(no report)')
            );
          }
          await sleep(100);
        }
        await sleep(600);
        const from = recycleEvents.length;
        handle.nuiTestDismiss?.();
        const seen = await eventsSettled(from, 'conformance-tooltip:false');
        if (seen !== 'conformance-tooltip:false') {
          throw new Error(
            `the dismissal reported "${seen}", so the first owner has no native event ` +
              'for a reset to clear'
          );
        }
      },
      second: () => tooltipOwner(true, TOOLTIP_MESSAGE_SECOND),
      read: async () => {
        const handle = handleFor('conformance-tooltip');
        const presented = dialogReportOf(handle).presented;
        const deadline = Date.now() + 6000;
        let report = dialogReportOf(handle);
        while (
          !tooltipShows(report, TOOLTIP_MESSAGE_SECOND) &&
          Date.now() < deadline
        ) {
          await sleep(100);
          report = dialogReportOf(handle);
        }
        return [
          {
            label: 'the tooltip the second owner asked for is presented',
            expected: '1',
            actual: presented,
          },
          {
            label: "the message its tooltip shows (the second owner's)",
            expected: TOOLTIP_MESSAGE_SECOND,
            actual: report.message,
          },
        ];
      },
    },
  },
  {
    name: 'Popover',
    component: 'NitroUiPopover',
    label: POPOVER_LABEL,
    testId: 'conformance-popover',
    selfSizing: false,
    owner: () => popoverOwner(false, POPOVER_FIRST_HEIGHT),
    control: (testId, variant) => (
      <Popover
        isPresented={false}
        anchor={<View style={{ width: variant ? 120 : 90, height: 32 }} />}
        testID={testId}
      >
        <View
          style={{ width: variant ? 140 : 100, height: variant ? 60 : 40 }}
        />
      </Popover>
    ),
    state: (handle) => [
      { label: 'presented', expected: false, actual: handle.presented },
    ],
    // A popover's residue is the dialog's, plus its content: a user dismissal leaves one
    // native event, so a reset that kept the count refuses the second owner's
    // `isPresented` as stale; and a reset that kept the previous popover's content box
    // would show the first owner's height in the second owner's popover. Both are read
    // from the view (`nuiTestStateReport`).
    probe: {
      leaveBehind:
        'a dismissal the first owner took (one native event), and the content the first ' +
        "owner's popover held - the second owner presents with a fresh count and content " +
        'of another height',
      first: () => popoverOwner(true, POPOVER_FIRST_HEIGHT),
      act: async () => {
        const handle = await ensureHandle('conformance-popover');
        const deadline = Date.now() + 8000;
        while (!popoverShows(dialogReportOf(handle), POPOVER_FIRST_HEIGHT)) {
          if (Date.now() > deadline) {
            throw new Error(
              'the first owner never presented its popover: ' +
                (handle.nuiTestStateReport?.() ?? '(no report)')
            );
          }
          await sleep(100);
        }
        await sleep(600);
        const from = recycleEvents.length;
        handle.nuiTestDismiss?.();
        const seen = await eventsSettled(from, 'conformance-popover:false');
        if (seen !== 'conformance-popover:false') {
          throw new Error(
            `the dismissal reported "${seen}", so the first owner has no native event ` +
              'for a reset to clear'
          );
        }
      },
      second: () => popoverOwner(true, POPOVER_SECOND_HEIGHT),
      read: async () => {
        const handle = handleFor('conformance-popover');
        const presented = dialogReportOf(handle).presented;
        const deadline = Date.now() + 6000;
        let report = dialogReportOf(handle);
        while (
          !popoverShows(report, POPOVER_SECOND_HEIGHT) &&
          Date.now() < deadline
        ) {
          await sleep(100);
          report = dialogReportOf(handle);
        }
        return [
          {
            label: 'the popover the second owner asked for is presented',
            expected: '1',
            actual: presented,
          },
          {
            label: "the content height its popover holds (the second owner's)",
            expected: String(POPOVER_SECOND_HEIGHT),
            actual: report.contentH,
          },
        ];
      },
    },
  },
  {
    name: 'Chip',
    component: 'NitroUiChip',
    label: 'Conformance chip',
    testId: 'conformance-chip',
    owner: (second) => (
      <Chip
        label={second ? 'Second owner chip' : 'Conformance chip label'}
        testID="conformance-chip"
        accessibilityLabel={
          second ? `Conformance chip, ${SECOND}` : 'Conformance chip'
        }
        hybridRef={captureFor('conformance-chip')}
      />
    ),
    control: (testId, variant) => (
      <Chip
        label={variant ? 'Leak chip B' : 'Leak chip A'}
        variant={variant ? 'assist' : 'filter'}
        testID={testId}
        accessibilityLabel={`Leak chip ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      {
        label: 'label',
        expected: second ? 'Second owner chip' : 'Conformance chip label',
        actual: handle.label,
      },
      {
        label: 'accessibilityLabel',
        expected: second ? `Conformance chip, ${SECOND}` : 'Conformance chip',
        actual: handle.accessibilityLabel,
      },
    ],
    // Switch's pair, for Switch's reason (`Fixture.controlledProbe`): an uncontrolled chip
    // that started selected and was pressed off, then a second owner whose own default is
    // selected. The residue (`false`) is what `prepareForRecycle` writes, so the display
    // alone cannot be the evidence; the first press after the second mount is. A chip whose
    // `didApplyDefault` was re-armed shows selected and reports `false`; one that kept
    // the flag shows the previous owner's unselected and reports `true`.
    probe: {
      leaveBehind:
        'an uncontrolled filter chip that started selected and was pressed off, then a ' +
        'second owner whose own default is selected - which the control can only be ' +
        'showing because `didApplyDefault` was re-armed and let the default apply',
      first: () => (
        <Chip
          label="Conformance chip label"
          defaultSelected
          onSelectedChange={recordRecycle('conformance-chip')}
          testID="conformance-chip"
          accessibilityLabel="Conformance chip"
          hybridRef={captureFor('conformance-chip')}
        />
      ),
      act: async () => {
        await pressChip('conformance-chip');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-chip:false'])
        );
      },
      second: () => (
        <Chip
          label="Conformance chip label"
          defaultSelected
          onSelectedChange={recordRecycle('conformance-chip')}
          testID="conformance-chip"
          accessibilityLabel="Conformance chip"
          hybridRef={captureFor('conformance-chip')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressChip('conformance-chip');
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-chip:false',
            actual: await eventsSettled(from, 'conformance-chip:false'),
          },
        ];
      },
    },
    // The handshake's counters: a press on an uncontrolled chip, then a second owner
    // controlled at `true`. Counters left over make that write look stale, so it is
    // refused and the chip keeps showing `false`: its first press reports `true` where a
    // clean chip, showing the `true` it was sent, reports `false`.
    //
    // Why `true` and not Switch's `false` (measured, G12): Android draws a chip from
    // `ChipModel.displayed`, which `reset()` clears to `false` on its own line, so a
    // second owner controlled at `false` is shown `false` whether or not the counters
    // were reset - the fixture's answer coincided with the reset's, and this probe stayed
    // green on Android with the counter reset deleted. iOS draws from `state.displayed`,
    // the residue itself, which is why the first owner here starts selected and is pressed
    // *off*: the residue (`false`) differs from the controlled value on both platforms.
    controlledProbe: {
      leaveBehind:
        'a press that turns an uncontrolled filter chip off, then a second owner that ' +
        'is *controlled* at `true` - the only shape that reads the handshake’s ' +
        'counters, which is what `model.state = NitroUiControlledValue(…)` uniquely owns',
      first: () => (
        <Chip
          label="Conformance chip label"
          defaultSelected
          onSelectedChange={recordRecycle('conformance-chip')}
          testID="conformance-chip"
          accessibilityLabel="Conformance chip"
          hybridRef={captureFor('conformance-chip')}
        />
      ),
      act: async () => {
        await pressChip('conformance-chip');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-chip:false'])
        );
      },
      second: () => (
        <Chip
          label="Conformance chip label"
          selected
          onSelectedChange={recordRecycle('conformance-chip')}
          testID="conformance-chip"
          accessibilityLabel="Conformance chip"
          hybridRef={captureFor('conformance-chip')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressChip('conformance-chip');
        return [
          {
            label: 'the first press on the controlled second mount reports',
            expected: 'conformance-chip:false',
            actual: await eventsSettled(from, 'conformance-chip:false'),
          },
        ];
      },
    },
  },
  {
    name: 'Checkbox',
    component: 'NitroUiCheckbox',
    label: 'Conformance checkbox',
    testId: 'conformance-checkbox',
    owner: (second) => (
      <Checkbox
        checked={second}
        testID="conformance-checkbox"
        accessibilityLabel={
          second ? `Conformance checkbox, ${SECOND}` : 'Conformance checkbox'
        }
        hybridRef={captureFor('conformance-checkbox')}
      />
    ),
    control: (testId, variant) => (
      <Checkbox
        checked={variant}
        testID={testId}
        accessibilityLabel={`Leak checkbox ${String(variant)}`}
      />
    ),
    state: (handle, second) => [
      { label: 'checked', expected: second, actual: handle.checked },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance checkbox, ${SECOND}`
          : 'Conformance checkbox',
        actual: handle.accessibilityLabel,
      },
    ],
    // Switch's pair, for Switch's reason (`Fixture.controlledProbe`): a reset has two
    // lines, `didApplyDefault = false` and a fresh `NitroUiControlledValue`, and an
    // uncontrolled owner can only read the first. The residue here is `false` because
    // that is what `prepareForRecycle` writes (`HybridNitroUiCheckbox.swift`'s
    // `NitroUiControlledValue<Bool>(displayed: false)`, `CheckboxModel.reset()` on
    // Android), so the display alone can never be the evidence and the first press after
    // the second mount is.
    probe: {
      leaveBehind:
        'an uncontrolled Checkbox that started ON and was pressed off, then a second ' +
        'owner whose own default is ON - a number the control can only be standing on ' +
        'because `didApplyDefault` was re-armed and let the default apply',
      first: () => (
        <Checkbox
          defaultChecked
          onCheckedChange={recordRecycle('conformance-checkbox')}
          testID="conformance-checkbox"
          accessibilityLabel="Conformance checkbox"
          hybridRef={captureFor('conformance-checkbox')}
        />
      ),
      act: async () => {
        await pressCheckbox('conformance-checkbox');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-checkbox:false'])
        );
      },
      second: () => (
        <Checkbox
          defaultChecked
          onCheckedChange={recordRecycle('conformance-checkbox')}
          testID="conformance-checkbox"
          accessibilityLabel="Conformance checkbox"
          hybridRef={captureFor('conformance-checkbox')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressCheckbox('conformance-checkbox');
        // A second owner whose default was applied shows ON, so its first press reports
        // `false`. One still believing it applied its default shows the `false` its
        // previous owner pressed, and its first press reports `true`.
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-checkbox:false',
            actual: await eventsSettled(from, 'conformance-checkbox:false'),
          },
        ];
      },
    },
    // A press asks for the opposite of what is showing on both platforms, which is what
    // makes this probe read the way Switch's does rather than the way Chip's does: a
    // checkbox that asked for `true` whatever it showed would report `true` here whether
    // or not the counters were reset, and the line it is testing would be unmeasured.
    controlledProbe: {
      leaveBehind:
        'a press that turns an uncontrolled Checkbox on, then a second owner that is ' +
        '*controlled* at `false` - the only shape that reads the handshake\u2019s ' +
        'counters, which is what `model.state = NitroUiControlledValue(\u2026)` uniquely owns',
      first: () => (
        <Checkbox
          defaultChecked={false}
          onCheckedChange={recordRecycle('conformance-checkbox')}
          testID="conformance-checkbox"
          accessibilityLabel="Conformance checkbox"
          hybridRef={captureFor('conformance-checkbox')}
        />
      ),
      act: async () => {
        await pressCheckbox('conformance-checkbox');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-checkbox:true'])
        );
      },
      // Controlled at `false` while the residue is `true`, so the app's own value is the
      // opposite of what the first owner left. `useControlled.ts` sends
      // `mostRecentEventCount` 0 with it; only `nativeEvents` back at 0 can accept the
      // write. Leave the counters alone and `reconcile()` sees `jsEvents 0 <
      // nativeEvents 1`, refuses it as stale, and the control keeps showing the previous
      // app's `true` - so its first press asks for `false`, the app's own value coming
      // back out of a control with somebody else's counters.
      second: () => (
        <Checkbox
          checked={false}
          onCheckedChange={recordRecycle('conformance-checkbox')}
          testID="conformance-checkbox"
          accessibilityLabel="Conformance checkbox"
          hybridRef={captureFor('conformance-checkbox')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressCheckbox('conformance-checkbox');
        return [
          {
            label: 'the first press on the controlled second mount reports',
            expected: 'conformance-checkbox:true',
            actual: await eventsSettled(from, 'conformance-checkbox:true'),
          },
        ];
      },
    },
  },
  {
    name: 'ContextMenu',
    component: 'NitroUiContextMenu',
    label: CONTEXT_LABEL,
    testId: 'conformance-context-menu',
    selfSizing: false,
    isView: true,
    owner: (second) => (
      <ContextMenu
        group={MENU_GROUP}
        title={second ? undefined : CONTEXT_TITLE}
        accessible
        accessibilityLabel={
          second ? `${CONTEXT_LABEL}, ${SECOND}` : CONTEXT_LABEL
        }
        testID="conformance-context-menu"
        hybridRef={captureContextMenu('conformance-context-menu')}
        style={{ padding: 8 }}
      >
        <View style={{ height: 40 }} />
      </ContextMenu>
    ),
    control: (testId, variant) => (
      <ContextMenu group={MENU_GROUP} disabled={variant} testID={testId}>
        <View style={{ height: variant ? 40 : 20 }} />
      </ContextMenu>
    ),
    // Read from the view's own report, never from React's props: a `null` title the
    // second owner sends has to arrive as `-`, and the menu must not come back open.
    state: (handle, second) => {
      const report = contextMenuReportOf(handle);
      return [
        {
          label: 'title',
          expected: second ? '-' : CONTEXT_TITLE,
          actual: report.title,
        },
        { label: 'open', expected: '0', actual: report.open },
      ];
    },
    // The residue is the menu's own history: a pick counts into `selects` (and an open
    // menu into `opens`), state no prop writes. A recycled view that kept it would report
    // a pick its owner never made - and on Android the same reset is what closes a menu
    // the previous owner left open (`ContextMenuModel.reset`, "a recycled view must never
    // come back open").
    probe: {
      leaveBehind:
        'a pick the first owner made through the row path (selects=1) - the second ' +
        'owner made none, so a count left over is the reset missing',
      first: () => (
        <ContextMenu
          group={MENU_GROUP}
          title={CONTEXT_TITLE}
          onSelect={recordRecycle('conformance-context-menu')}
          testID="conformance-context-menu"
          hybridRef={captureContextMenu('conformance-context-menu')}
        >
          <View style={{ height: 40 }} />
        </ContextMenu>
      ),
      act: async () => {
        const handle = await ensureHandle('conformance-context-menu');
        const from = recycleEvents.length;
        handle.nuiTestSelectRow?.('two');
        const seen = await eventsSettled(from, 'conformance-context-menu:two');
        if (seen !== 'conformance-context-menu:two') {
          throw new Error(
            `the pick reported "${seen}", so the first owner has no pick for a reset ` +
              'to clear'
          );
        }
        const deadline = Date.now() + 2000;
        while (contextMenuReportOf(handle).selects !== '1') {
          if (Date.now() > deadline) {
            throw new Error(
              'the first owner reported its pick but its own counter never moved: ' +
                (handle.nuiTestContextMenuReport?.() ?? '(no report)')
            );
          }
          await sleep(50);
        }
      },
      second: () => (
        <ContextMenu
          group={MENU_GROUP}
          onSelect={recordRecycle('conformance-context-menu')}
          testID="conformance-context-menu"
          hybridRef={captureContextMenu('conformance-context-menu')}
        >
          <View style={{ height: 40 }} />
        </ContextMenu>
      ),
      read: async () => {
        const report = contextMenuReportOf(
          handleFor('conformance-context-menu')
        );
        return [
          {
            label: 'picks this mount reports',
            expected: '0',
            actual: report.selects,
          },
          { label: 'the menu is open', expected: '0', actual: report.open },
        ];
      },
    },
  },
  {
    name: 'Form',
    component: 'NitroUiForm',
    label: FORM_LABEL,
    testId: 'conformance-form',
    // A Form is laid out by its caller (D45): it has no intrinsic size to compare with a
    // declared fallback, so it never joins the sizing engine's ledger. `isView` because the
    // Form *is* the view that carries the label - the a11y rule reads its own box, not a row
    // inside it.
    selfSizing: false,
    isView: true,
    owner: (second) => <Form {...formFixtureProps(second)} />,
    control: (testId, variant) => (
      <Form
        {...formFixtureProps(variant, testId, `Leak ${variant ? 'B' : 'A'}`)}
      />
    ),
    // The Form's own account of what it is holding: `rows` is what registered with the list,
    // and `orphans` is the shape a component view takes when a recycle moved it out and
    // nothing moved it back.
    state: async (handle, second) => {
      const fields = formFieldsOf(await settledFormReport(handle));
      return [
        {
          label: 'rows',
          expected: second ? 2 : 4,
          actual: Number(fields.rows),
        },
        {
          label: 'orphans',
          expected: 0,
          actual: Number(fields.orphans),
        },
      ];
    },
    // The residue a Form leaves is its own bookkeeping: which rows are registered, and where
    // its list is scrolled to. Four rows and a real scroll for the first owner, two rows for
    // the second. A reset that skipped the bookkeeping reports `rows=4`, or - the shape the
    // recycling path produces when a row is dropped on the floor - `orphans>0`. The scroll is
    // logged rather than asserted: on Android the scroller is React Native's `ScrollView`,
    // which belongs to the wrapper and not to the recycled view, so a zero there is not this
    // component's own evidence on that platform.
    probe: {
      leaveBehind:
        'four registered rows and a list scrolled 120 pt - the second owner mounts two, so ' +
        'a reset that skipped the bookkeeping reports the first owner’s count, or a row that ' +
        'is in no cell at all',
      first: () => (
        <Form {...formFixtureProps(false, 'conformance-form', FORM_LABEL)} />
      ),
      act: async () => {
        const handle = await ensureHandle('conformance-form');
        const until = Date.now() + 8000;
        while (Number(formFields(handle).rows) !== 4) {
          if (Date.now() > until) {
            throw new Error(
              `the first owner never registered four rows: ${
                handle.nuiTestFormReport?.() ?? '(no report)'
              }`
            );
          }
          await sleep(100);
        }
        handle.nuiTestScrollTo?.(120);
        // Wait for the list to say it moved, so the residue is real before the second owner
        // arrives. Either platform's field counts: iOS publishes `offset`, Android `scroll`.
        const moved = Date.now() + 4000;
        while (Date.now() < moved) {
          const report = formFields(handle);
          const shown = Number(report.scroll ?? report.offset ?? '0');
          if (shown > 10) break;
          await sleep(100);
        }
      },
      second: () => (
        <Form
          {...formFixtureProps(true, 'conformance-form', FORM_LABEL_SECOND)}
        />
      ),
      read: async () => {
        const handle = handleFor('conformance-form');
        // Settled, for the reason `settledFormReport` states: this read is one beat behind
        // the UI thread, and a recycled view starts life holding its previous owner's report.
        const report = formFieldsOf(await settledFormReport(handle));
        console.log(
          `    · the second owner's list: rows=${report.rows ?? '(none)'} ` +
            `sections=${report.sections ?? '(none)'} orphans=${report.orphans ?? '(none)'} ` +
            `scroll=${report.scroll ?? report.offset} offset=${report.offset}`
        );
        return [
          { label: 'rows', expected: '2', actual: report.rows },
          { label: 'sections', expected: '1', actual: report.sections },
          { label: 'orphans', expected: '0', actual: report.orphans },
        ];
      },
    },
  },
  {
    name: 'IconButton',
    component: 'NitroUiIconButton',
    label: 'Conformance icon button',
    testId: 'conformance-icon-button',
    // The **press** form, at every default the wrapper resolves: this is the
    // configuration the fallback row claims, so it is the one the sizing rules
    // measure. The toggle form's box is the same on Android (Material's toggle
    // icon buttons take the same container tokens) and is what
    // `IconButtonsKeepOneBoxAcrossStates` pins in `IconButton.harness.tsx`; iOS
    // gives a `Toggle(.button)` its own padding, which `docs/components/icon-button.md`
    // prints instead of pretending the two forms are one box.
    owner: (second) => (
      <IconButton
        accessibilityLabel={
          second
            ? `Conformance icon button, ${SECOND}`
            : 'Conformance icon button'
        }
        androidIcon={ICON_BUTTON_GLYPH.androidIcon}
        systemImage={ICON_BUTTON_GLYPH.systemImage}
        testID="conformance-icon-button"
        hybridRef={captureFor('conformance-icon-button')}
      />
    ),
    control: (testId, variant) => (
      <IconButton
        accessibilityLabel={`Leak icon button ${String(variant)}`}
        androidIcon={ICON_BUTTON_GLYPH.androidIcon}
        systemImage={ICON_BUTTON_GLYPH.systemImage}
        disabled={variant}
        testID={testId}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance icon button, ${SECOND}`
          : 'Conformance icon button',
        actual: handle.accessibilityLabel,
      },
    ],
    // An IconButton holds two things a prop cannot rewrite: the selection the last
    // app pressed, and the parsed glyph. Both are on `reset()`
    // (`IconButtonModel.reset()` / `HybridNitroUiIconButton.swift`'s
    // `prepareForRecycle`), and the selection is the half a probe can read:
    // `displayed` is written where the control is drawn, and the glyph's half is
    // `IconButton.harness.tsx`'s pixel probe, which is where drawing is checked.
    //
    // The second owner's default is deliberately the *opposite* of the residue, so
    // the answer cannot coincide with what a missing reset would also print —
    // Chip's note above is the case where that coincidence kept a line unmeasured.
    probe: {
      leaveBehind:
        'an uncontrolled toggle that started ON and was pressed off, then a second ' +
        'owner whose own default is ON - a number the control can only be standing ' +
        'on because `didApplyDefault` was re-armed and let the default apply',
      first: () => (
        <IconButton
          accessibilityLabel="Conformance icon button"
          androidIcon={ICON_BUTTON_GLYPH.androidIcon}
          defaultChecked
          onCheckedChange={recordRecycle('conformance-icon-button')}
          systemImage={ICON_BUTTON_GLYPH.systemImage}
          testID="conformance-icon-button"
          hybridRef={captureFor('conformance-icon-button')}
        />
      ),
      act: async () => {
        await pressIconButton('conformance-icon-button');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-icon-button:false'])
        );
      },
      second: () => (
        <IconButton
          accessibilityLabel="Conformance icon button"
          androidIcon={ICON_BUTTON_GLYPH.androidIcon}
          defaultChecked
          onCheckedChange={recordRecycle('conformance-icon-button')}
          systemImage={ICON_BUTTON_GLYPH.systemImage}
          testID="conformance-icon-button"
          hybridRef={captureFor('conformance-icon-button')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressIconButton('conformance-icon-button');
        // A second owner whose default was applied shows ON, so its first press
        // reports `false`. One still believing it applied its default shows the
        // `false` its previous owner pressed, and reports `true`.
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-icon-button:false',
            actual: await eventsSettled(from, 'conformance-icon-button:false'),
          },
        ];
      },
    },
    // The other half of the reset: the handshake's event counts, which an
    // uncontrolled owner never reads (`Fixture.controlledProbe`). A press asks for
    // the opposite of what is showing on both platforms, which is what makes this
    // read like Switch's and Checkbox's rather than Chip's.
    controlledProbe: {
      leaveBehind:
        'a press that turns an uncontrolled toggle on, then a second owner that is ' +
        '*controlled* at `false` - the only shape that reads the handshake\u2019s ' +
        'counters, which is what `model.state = NitroUiControlledValue(\u2026)` ' +
        'uniquely owns',
      first: () => (
        <IconButton
          accessibilityLabel="Conformance icon button"
          androidIcon={ICON_BUTTON_GLYPH.androidIcon}
          defaultChecked={false}
          onCheckedChange={recordRecycle('conformance-icon-button')}
          systemImage={ICON_BUTTON_GLYPH.systemImage}
          testID="conformance-icon-button"
          hybridRef={captureFor('conformance-icon-button')}
        />
      ),
      act: async () => {
        await pressIconButton('conformance-icon-button');
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-icon-button:true'])
        );
      },
      second: () => (
        <IconButton
          accessibilityLabel="Conformance icon button"
          androidIcon={ICON_BUTTON_GLYPH.androidIcon}
          checked={false}
          onCheckedChange={recordRecycle('conformance-icon-button')}
          systemImage={ICON_BUTTON_GLYPH.systemImage}
          testID="conformance-icon-button"
          hybridRef={captureFor('conformance-icon-button')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressIconButton('conformance-icon-button');
        return [
          {
            label: 'the first press on the controlled second mount reports',
            expected: 'conformance-icon-button:true',
            actual: await eventsSettled(from, 'conformance-icon-button:true'),
          },
        ];
      },
    },
  },
  {
    name: 'ButtonGroup',
    component: 'NitroUiButtonGroup',
    label: 'Conformance button group',
    testId: 'conformance-button-group',
    // Two **action** items at every default the wrapper resolves: this is the
    // configuration `DECLARED_FALLBACKS.NitroUiButtonGroup` claims, so it is the one
    // the sizing rules measure. A toggle item is deliberately absent from the *owner* —
    // an iOS toggle row is a different height from an action row, and the fallback
    // describes the row the docs print — but both recycle probes mount one.
    owner: (second) => (
      <ButtonGroup
        accessibilityLabel={
          second
            ? `Conformance button group, ${SECOND}`
            : 'Conformance button group'
        }
        items={CONFORMANCE_BUTTON_GROUP_ACTIONS}
        testID="conformance-button-group"
        hybridRef={captureFor('conformance-button-group')}
      />
    ),
    control: (testId, variant) => (
      <ButtonGroup
        accessibilityLabel={`Leak button group ${String(variant)}`}
        items={
          variant ? CONFORMANCE_BUTTON_GROUP_B : CONFORMANCE_BUTTON_GROUP_A
        }
        testID={testId}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance button group, ${SECOND}`
          : 'Conformance button group',
        actual: handle.accessibilityLabel,
      },
    ],
    // A ButtonGroup holds the checked set the last app toggled, and that set survives
    // every prop the second owner sends: `checkedIds` is built from the *controlled*
    // items only, and an uncontrolled item's state belongs to the control. So the
    // residue is real and the press after the remount is what reads it — Chip's and
    // IconButton's shape, for the same reason.
    //
    // The second owner's `defaultChecked` is deliberately the *opposite* of the residue,
    // so the answer cannot coincide with what a missing reset would also print.
    probe: {
      leaveBehind:
        'an uncontrolled toggle item that started checked and was pressed off, then a ' +
        'second owner whose own default is checked - a state the control can only be ' +
        'showing because `seeded` was re-armed and let the default apply',
      first: () => (
        <ButtonGroup
          accessibilityLabel="Conformance button group"
          items={CONFORMANCE_BUTTON_GROUP_TOGGLES}
          onCheckedChange={recordRecycleChecked('conformance-button-group')}
          testID="conformance-button-group"
          hybridRef={captureFor('conformance-button-group')}
        />
      ),
      act: async () => {
        await pressButtonGroupItem('conformance-button-group', 'bold');
        // The item starts checked (`defaultChecked`), so the press that arms the probe
        // reports it *unchecked* — the residue a missing reset would show.
        await waitFor(() =>
          expect(eventsSince(0)).toEqual([
            'conformance-button-group:bold:false',
          ])
        );
      },
      second: () => (
        <ButtonGroup
          accessibilityLabel="Conformance button group"
          items={CONFORMANCE_BUTTON_GROUP_TOGGLES}
          onCheckedChange={recordRecycleChecked('conformance-button-group')}
          testID="conformance-button-group"
          hybridRef={captureFor('conformance-button-group')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressButtonGroupItem('conformance-button-group', 'bold');
        // A clean control re-seeded from `defaultChecked` shows the item checked, so its
        // first press reports the *unchecked* id with `false`. One still believing it
        // applied that default shows the previous owner's unchecked item and reports
        // `true`.
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-button-group:bold:false',
            actual: await eventsSettled(
              from,
              'conformance-button-group:bold:false'
            ),
          },
        ];
      },
    },
    // The other half of the reset: the handshake's event counts. A toggle press on an
    // uncontrolled item, then a second owner **controlled** at unchecked — the only
    // shape that reads the counters, because an uncontrolled write is refused before
    // them (`reconcile()` only applies a write when `js != null`).
    //
    // The residue differs from the controlled value on both platforms by construction:
    // the press leaves the item *checked*, and the second owner says unchecked, so a
    // stale counter (write refused, control still showing checked) reports `true` where
    // a clean one reports `false`.
    controlledProbe: {
      leaveBehind:
        'a press that checks an uncontrolled toggle item, then a second owner that is ' +
        '*controlled* at unchecked - the only shape that reads the handshake\u2019s ' +
        'counters',
      first: () => (
        <ButtonGroup
          accessibilityLabel="Conformance button group"
          items={CONFORMANCE_BUTTON_GROUP_TOGGLES}
          onCheckedChange={recordRecycleChecked('conformance-button-group')}
          testID="conformance-button-group"
          hybridRef={captureFor('conformance-button-group')}
        />
      ),
      act: async () => {
        await pressButtonGroupItem('conformance-button-group', 'bold');
        // The item starts checked (`defaultChecked`), so the press that arms the probe
        // reports it *unchecked* — the residue a missing reset would show.
        await waitFor(() =>
          expect(eventsSince(0)).toEqual([
            'conformance-button-group:bold:false',
          ])
        );
      },
      second: () => (
        <ButtonGroup
          accessibilityLabel="Conformance button group"
          items={CONFORMANCE_BUTTON_GROUP_CONTROLLED}
          onCheckedChange={recordRecycleChecked('conformance-button-group')}
          testID="conformance-button-group"
          hybridRef={captureFor('conformance-button-group')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressButtonGroupItem('conformance-button-group', 'bold');
        return [
          {
            label: 'the first press on the controlled second mount reports',
            expected: 'conformance-button-group:bold:true',
            actual: await eventsSettled(
              from,
              'conformance-button-group:bold:true'
            ),
          },
        ];
      },
    },
  },

  {
    name: 'Stepper',
    component: 'NitroUiStepper',
    label: 'Conformance stepper',
    testId: 'conformance-stepper',
    // The default range (0…100) and step (1): a Stepper's box depends on neither, which is
    // what its empty sizing variant claims, so the fixture mounts the configuration the
    // fallback row describes rather than one the sizing key would have to name.
    owner: (second) => (
      <Stepper
        accessibilityLabel={
          second ? `Conformance stepper, ${SECOND}` : 'Conformance stepper'
        }
        onValueChange={recordRecycle('conformance-stepper')}
        testID="conformance-stepper"
        hybridRef={captureFor('conformance-stepper')}
      />
    ),
    control: (testId, variant) => (
      <Stepper
        accessibilityLabel={`Leak stepper ${String(variant)}`}
        disabled={variant}
        testID={testId}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance stepper, ${SECOND}`
          : 'Conformance stepper',
        actual: handle.accessibilityLabel,
      },
    ],
    // The residue is the displayed value and the one-shot that re-applies a default. The
    // three possible answers are three different numbers, which is the line-specificity X4
    // re-review 2 asked for: the previous owner stepped to **4**, `prepareForRecycle`
    // writes **0**, and the second owner's own default is **6** — so "one-shot alive" is
    // the only arrangement that can paint a 6, and a second owner defaulted to either of
    // the other two would have let a deleted reset look right.
    probe: {
      leaveBehind:
        'a step up to 4 on an uncontrolled stepper that started on 3, then a second ' +
        'owner whose own `defaultValue` is 6 — a number the control can only be ' +
        'painting because `didApplyDefault` was re-armed and the default applied again',
      first: () => (
        <Stepper
          accessibilityLabel="Conformance stepper"
          defaultValue={3}
          onValueChange={recordRecycle('conformance-stepper')}
          testID="conformance-stepper"
          hybridRef={captureFor('conformance-stepper')}
        />
      ),
      act: async () => {
        const before = eventsSince(0).length;
        stepStepper('conformance-stepper', 1);
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-stepper:4'])
        );
      },
      second: () => (
        <Stepper
          accessibilityLabel="Conformance stepper"
          defaultValue={6}
          onValueChange={recordRecycle('conformance-stepper')}
          testID="conformance-stepper"
          hybridRef={captureFor('conformance-stepper')}
        />
      ),
      read: async () => {
        const before = eventsSince(0).length;
        const drawn = await drawnValueOfStepper('conformance-stepper');
        // Then the same question in the negative, through the event: a control still
        // standing on the previous owner's 4 steps down to 3, and one the reset left on
        // its own 0 has no lower bound to step down from at all. Only the second owner's
        // 6 answers 5.
        stepStepper('conformance-stepper', -1);
        return [
          {
            label: 'the value the second owner’s default paints',
            expected: '6',
            actual: drawn,
          },
          {
            label: 'a step down from that value emits',
            expected: 'conformance-stepper:5',
            actual: await eventsSettled(before, 'conformance-stepper:5'),
          },
        ];
      },
    },
    // The other line of the same reset, which no uncontrolled owner ever reads: the
    // handshake's event counts. The first owner's step leaves `nativeEvents` at 1, a
    // controlled mount arrives with `mostRecentEventCount` 0, and a stale write is
    // *dropped* — so the control would sit on the reset's own 0 while its app shows 7.
    controlledProbe: {
      leaveBehind:
        'a step up on an uncontrolled stepper, then a second owner that is *controlled* ' +
        'on 7 — a value that cannot be shown unless the handshake’s counters came back ' +
        'at zero, because a write behind the previous owner’s event count is refused',
      first: () => (
        <Stepper
          accessibilityLabel="Conformance stepper"
          defaultValue={3}
          onValueChange={recordRecycle('conformance-stepper')}
          testID="conformance-stepper"
          hybridRef={captureFor('conformance-stepper')}
        />
      ),
      act: async () => {
        const before = eventsSince(0).length;
        stepStepper('conformance-stepper', 1);
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-stepper:4'])
        );
      },
      second: () => (
        <Stepper
          accessibilityLabel="Conformance stepper"
          onValueChange={recordRecycle('conformance-stepper')}
          testID="conformance-stepper"
          value={7}
          hybridRef={captureFor('conformance-stepper')}
        />
      ),
      read: async () => {
        const before = eventsSince(0).length;
        const drawn = await drawnValueOfStepper('conformance-stepper');
        stepStepper('conformance-stepper', 1);
        return [
          {
            label: 'the value the controlled second owner wrote',
            expected: '7',
            actual: drawn,
          },
          {
            label: 'a step up from that value emits',
            expected: 'conformance-stepper:8',
            actual: await eventsSettled(before, 'conformance-stepper:8'),
          },
        ];
      },
    },
  },
  {
    name: 'ListItem',
    component: 'NitroUiListItem',
    label: 'Conformance list item',
    testId: 'conformance-list-item',
    // The one-line row with a trailing value: the configuration
    // `DECLARED_FALLBACKS.NitroUiListItem` describes and the docs print. The subtitle is
    // the only slot that moves the height, so it is deliberately absent here and measured
    // rung by rung in `ListItem.harness.tsx` — a fixture that carried one would compare
    // Material's two-line minimum against a number that says one line.
    owner: (second) => (
      <ListItem
        accessibilityLabel={
          second ? `Conformance list item, ${SECOND}` : 'Conformance list item'
        }
        onPress={recordRecyclePress('conformance-list-item')}
        testID="conformance-list-item"
        title="Notifications"
        value={second ? 'Weekly' : 'On'}
        hybridRef={captureListItem('conformance-list-item')}
      />
    ),
    control: (testId, variant) => (
      <ListItem
        accessibilityLabel={`Leak list item ${String(variant)}`}
        testID={testId}
        title={variant ? 'Bluetooth' : 'Notifications'}
        value={variant ? 'Off' : 'On'}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance list item, ${SECOND}`
          : 'Conformance list item',
        actual: handle.accessibilityLabel,
      },
    ],
    // What a row can leave behind is its own press counter and the line it drew, and no
    // prop rewrites either: `ListItem.tsx` sends every prop on every commit, while
    // `presses` is written where the tap lands and `displayed` where the row composes.
    //
    // The second owner's title and value are *different words* from the first's, so a
    // `displayed=` that was never re-taken cannot coincide with the right answer, and the
    // counter the reset owns is asked with a press rather than read: a reset that left
    // `presses=1` behind prints `presses=2` for the second owner's first tap.
    probe: {
      leaveBehind:
        "a press the first owner took, through the tap's own path - one accepted press " +
        "in the row's counter - and a drawn line the second owner never asked for",
      first: () => (
        <ListItem
          accessibilityLabel="Conformance list item"
          onPress={recordRecyclePress('conformance-list-item')}
          testID="conformance-list-item"
          title="Notifications"
          value="On"
          hybridRef={captureListItem('conformance-list-item')}
        />
      ),
      act: async () => {
        const handle = await ensureHandle('conformance-list-item');
        const from = recycleEvents.length;
        pressListItem('conformance-list-item');
        const seen = await eventsSettled(from, 'conformance-list-item');
        if (seen !== 'conformance-list-item') {
          throw new Error(
            `the first owner's press reported "${seen}", so the row has no press for a ` +
              'reset to clear and the assertion below would be measuring nothing'
          );
        }
        if (
          !(listItemReportOf(handle).displayed ?? '').includes('Notifications')
        ) {
          throw new Error(
            `the first owner's row never reported what it drew: ` +
              (handle.nuiTestStateReport?.() ?? '(no report)')
          );
        }
      },
      second: () => (
        <ListItem
          accessibilityLabel="Conformance list item"
          onPress={recordRecyclePress('conformance-list-item')}
          testID="conformance-list-item"
          title="Bluetooth"
          value="Off"
          hybridRef={captureListItem('conformance-list-item')}
        />
      ),
      read: async () => {
        const handle = handleFor('conformance-list-item');
        // Read the row the second owner is showing *before* pressing it: a stale
        // `displayed=` is the residue, and pressing first would overwrite it with the
        // answer the props would have produced anyway.
        const before = listItemReportOf(handle);
        const from = recycleEvents.length;
        pressListItem('conformance-list-item');
        const reported = await eventsSettled(from, 'conformance-list-item');
        return [
          {
            label: "the line the second owner's row drew",
            expected: 'Bluetooth|-|Off|none',
            actual: before.displayed,
          },
          {
            label: 'a press on it still reaches the app',
            expected: 'conformance-list-item',
            actual: reported,
          },
          {
            label: 'and it is the first press this row has had',
            expected: '1',
            actual:
              listItemReportOf(handleFor('conformance-list-item')).presses ??
              'none',
          },
        ];
      },
    },
  },
];

/** Mounts per control in the leak fixture. */
const CHURN = 50;

afterEach(() => {
  cleanup();
  handles.clear();
});

/* ---------------------------------- the suite --------------------------------- */

describe('conformance · every control, four rules', () => {
  for (const fixture of FIXTURES) {
    describe(`· ${fixture.name}`, () => {
      // Both lookups are done *inside* the one test that uses them, not here (X4 review N3).
      // In the `describe` body they ran while Jest was collecting the file, so a fixture whose
      // component has no row in the shared table took every other control's suite down with it:
      // one stale row became a collection error and the run reported nothing about the six
      // controls that were fine. Here it is one red test with its name on it.
      // `checkInAppFixtures` is what refuses such a fixture at all, on the host, in `check`.

      it('has its own declared fallback, and still corrects a wrong guess', async () => {
        if (fixture.selfSizing === false) {
          console.log(
            `    · ${fixture.name} declares no sizing policy, so it has no fallback to ` +
              'declare and never enters the engine to guess one (component.json sizing: null)'
          );
          return;
        }
        // Which axes this control's declaration describes comes from the mirrored table,
        // because that is a host-side fact about its sizing policy — the suite that asserts
        // does not get to decide it. See `boxRuleFor` in scripts/conformance-core.mjs.
        const expected = declaredFallback(fixture.component);
        // The premise, read from the app rather than assumed: what locale this run's
        // formatter ran in. Printed per control so the log names the configuration the
        // numbers below were taken in.
        const appLocale = deviceLocale();
        // And whether *this run* said it meant to test a locale the table was not measured in.
        // The app cannot read the runner's environment, so the answer is published by
        // `example/rn-harness.config.mjs` with the machine state and read back here; the
        // default when it cannot be read is `false`, i.e. the comparison is enforced.
        const mismatchAllowed = await localeMismatchAllowed();
        if (mismatchAllowed.allowed) {
          console.log(
            `    · ${ALLOW_LOCALE_MISMATCH_ENV}=1: a locale mismatch will be a ` +
              'printed skip rather than a failure, for this file only'
          );
        }
        const boxRule = boxRuleFor(fixture.component);

        // 1. The engine knows a fallback at all — read once for the whole file, before any
        //    poison here has had the chance to write one. See `readRegistrationOnce` for why a
        //    per-test read is not evidence, and for what a `false` means on a warm process.
        readRegistrationOnce();
        const registered = registration[fixture.component] === true;

        // 2. Poisoned mount, first: the correction has to arrive, and the box that results
        //    has to be the declared one. Done before the warm case so the seed cannot be
        //    masked by a cached answer the warm mount would have left behind.
        try {
          poison(fixture.component);
          const coldBefore = stats();
          expectANewHandle(fixture.testId);
          const cold = await render(fixture.owner(false), RENDER);
          await settle(600);
          const coldHandle = await ensureHandle(fixture.testId);
          const coldMeasure = coldHandle.measureContent();
          const coldBox = harnessUi.queryByTestId(fixture.testId);
          const coldCorrections = correctionsSince(coldBefore);
          console.log(
            `    · poisoned measured=${describeBox(coldMeasure)} box=` +
              `${describeBox(coldBox)} corrections=${String(coldCorrections)} ` +
              `poison=${describeBox(SHARED.poisonSizes[PLATFORM])} ` +
              `locale=${deviceLocaleNote()}`
          );
          expectConformance(
            fallbackFindings({
              component: fixture.name,
              declared: registered ? expected : null,
              measured: coldMeasure,
              corrections: coldCorrections,
              poisoned: true,
              expected,
              boxRule,
              deviceLocale: appLocale,
              mismatchAllowed: mismatchAllowed.allowed,
            })
          );
          cold.unmount();
        } finally {
          restore(fixture.component);
        }
        await settle();

        // 3. Warm. For a control whose declaration describes its whole box, the declared
        //    number *is* the measured one and nothing has to be corrected — the assertion a
        //    poisoned fallback cannot satisfy and a stale declaration cannot either. For a
        //    `fillWidth` or content-sized control the box it settles at is its parent's or
        //    its content's, so `boxRule` narrows the comparison and this run only reports a
        //    finding if a correction was needed where the declaration should have made it
        //    unnecessary.
        const warmBefore = stats();
        expectANewHandle(fixture.testId);
        const warm = await render(fixture.owner(false), RENDER);
        await settle(600);
        const warmHandle = await ensureHandle(fixture.testId);
        const warmMeasure = warmHandle.measureContent();
        console.log(
          `    · warm measured=${describeBox(warmMeasure)} declared=${describeBox(expected)} ` +
            `boxRule=${boxRule} locale=${deviceLocaleNote()}`
        );
        expectConformance(
          fallbackFindings({
            component: fixture.name,
            declared: registered ? expected : null,
            measured: warmMeasure,
            corrections: correctionsSince(warmBefore),
            poisoned: false,
            expected,
            boxRule,
            deviceLocale: appLocale,
            mismatchAllowed: mismatchAllowed.allowed,
          })
        );
        warm.unmount();
      });

      it('is known to the engine while mounted, and unknown after', async () => {
        if (fixture.selfSizing === false) {
          console.log(
            `    · ${fixture.name} is not self-sizing, so it never enters the engine's ` +
              'ledger or registry (component.json sizing: null) - its drops are proved ' +
              'by its own suite, which reads the presentation count'
          );
          return;
        }
        // The positive control, which is the half round 1's leak rule was missing. It churned
        // 50 mount/unmount pairs with no settle between them and read `ledger 0→0`, a number a
        // control that never registered an instance produces just as well as one that registers
        // and forgets correctly. So this mounts K controls, waits for the last of them to be
        // laid out — an instance reaches the engine on its first measure — requires the ledger
        // to have risen by exactly K, then drops them and requires the rise to be gone.
        //
        // The window has to be *quiescent* at both reads, and that is not a nicety: the first
        // run of this test read `rose=7` for 8 controls and `−8` on the way down, which is one
        // instance from the *previous test's* `unmount()` releasing inside the window. Against a
        // baseline that is still moving, "returned to baseline" is unfalsifiable in exactly the
        // way round 1's churn was, so `settledStats` waits for two consecutive equal reads and
        // refuses rather than comparing against a number that is on its way somewhere.
        const MOUNTS = 8;
        const before = await settledStats('before the mount window');
        const many = await render(
          <View>
            {Array.from({ length: MOUNTS }, (_, row) => row).map((row) =>
              // A `testID` per row, so every one is its own Fabric node and the query below can
              // name the last; `variant` flips a prop so the rows are visibly distinct, the way
              // the other suites' churn does (`Sizing.harness.tsx:504`).
              fixture.control(`leak-mounted-${String(row)}`, row % 2 === 0)
            )}
          </View>,
          RENDER
        );
        // The layout has to have happened for all K, or the rise asserted below is a race
        // rather than a fact. The last row's box is the witness: Fabric lays out in order, so a
        // measured last row means every row before it was measured.
        await waitFor(
          () => {
            const box = harnessUi.queryByTestId(
              `leak-mounted-${String(MOUNTS - 1)}`
            );
            if (box == null || box.height <= 0) {
              throw new Error(`row ${String(MOUNTS - 1)} not laid out yet`);
            }
          },
          { timeout: 20000 }
        );
        const mounted = await settledStats('after the mount window');
        many.unmount();
        // `onDropView` runs on the mounting transaction that removes the view and `host.drop()`
        // is where the instance is released (`NitroSwiftUIHost.swift:327`), so this waits for
        // the drops to have happened rather than assuming they were synchronous with unmount().
        const after = await settledStats('after the drop window');
        console.log(
          `    · ledger ${String(before.ledgerEntries)}→` +
            `${String(mounted.ledgerEntries)}→${String(after.ledgerEntries)} ` +
            `registry ${String(before.registryEntries)}→` +
            `${String(mounted.registryEntries)}→${String(after.registryEntries)} ` +
            `across ${String(MOUNTS)} mounted together`
        );
        const problems: Finding[] = [];
        const rose = mounted.ledgerEntries - before.ledgerEntries;
        if (rose !== MOUNTS) {
          // A finding rather than a thrown error, because the reason matters: a control whose
          // instances never reach the engine cannot leak there, and this rule would be vacuous
          // for it — a fact about the control worth printing, not banking.
          problems.push({
            component: fixture.name,
            rule: 'no-leak-on-drop',
            problem:
              `${String(MOUNTS)} controls were mounted and laid out together and the ` +
              `ledger rose by ${String(rose)}. One entry per instance is what makes the ` +
              'drop half below mean anything: an instance that is not in the ledger cannot ' +
              'be seen to leave it, which is the vacuity round 1’s churn had',
          });
        }
        // Compared against the *pre-mount* baseline, not the mounted one. `leakFindings`
        // subtracts its baseline from the post-drop read, and the mounted read already includes
        // the K entries being asserted: passing it as the baseline asks for `0` where the honest
        // answer is `-K` (the first run reported `-8 ledger entry(ies) survived 8 drops` for a
        // control that had just released all eight, which is the rule crying wolf about a leak
        // in the one direction it cannot be wrong in).
        problems.push(
          ...leakFindings({
            component: fixture.name,
            baseline: before,
            after,
            instances: MOUNTS,
          })
        );
        expectConformance(problems);
      });

      it('leaves the engine where it started across a churn of drops', async () => {
        if (fixture.selfSizing === false) {
          console.log(
            `    · ${fixture.name} is not self-sizing, so it never enters the engine's ` +
              'ledger or registry (component.json sizing: null) - its drops are proved ' +
              'by its own suite, which reads the presentation count'
          );
          return;
        }
        // The churn, kept because it is a different shape from the one above: instances that
        // come and go over time, in a process that has already measured this component. The
        // warm-up is what makes its baseline honest — the component's own registry row is
        // created by the first measure, not by a drop, so a baseline taken before it would
        // count one legitimate entry as a leak.
        const warmUp = await render(fixture.owner(false), RENDER);
        await settle();
        warmUp.unmount();

        // A *quiescent* baseline, for the reason the positive-control test above
        // states: an iOS instance reaches `onDropView` after its unmount, so the
        // warm-up's own drop can still be in flight when the read happens, and the
        // run that measures it reads one legitimate release as a leak. CI proved
        // the shape — run 41230848294 reported `Menu × no-leak-on-drop: 1 ledger
        // entry(ies) survived 50 drops` at load1 152-380 on 3 cores, and the same
        // tree passed the same test on the next dispatch. `stats()` after a fixed
        // `settle` was the fixture asserting about a number still on its way
        // somewhere; `settledStats` refuses rather than comparing against one.
        const baseline = await settledStats('the churn baseline');
        for (let cycle = 0; cycle < CHURN; cycle += 1) {
          const mounted = await render(fixture.owner(cycle % 2 === 1), RENDER);
          mounted.unmount();
        }
        const after = await settledStats('the churn after-read');
        console.log(
          `    · ledger ${String(baseline.ledgerEntries)}→` +
            `${String(after.ledgerEntries)} registry ${String(
              baseline.registryEntries
            )}→${String(after.registryEntries)} cached ${String(
              baseline.cachedSizes
            )}→${String(after.cachedSizes)} across ${String(CHURN)} mounts`
        );
        expectConformance(
          leakFindings({
            component: fixture.name,
            baseline,
            after,
            instances: CHURN,
          })
        );
      });

      it('shows none of its previous owner under one identity', async () => {
        // Half one is the props, and it is the half round 1 mistook for the rule. It still
        // earns its place: it is what notices a wrapper that stopped *providing* a prop,
        // which is the other way this class of bug arrives (a prop that goes unset never
        // reaches native at all, so the next mount keeps whatever was there). It is not what
        // notices a missing reset, and the log says which half is which.
        expectANewHandle(fixture.testId);
        const first = await render(fixture.owner(false), RENDER);
        await settle();
        await ensureHandle(fixture.testId);
        expect(
          recycleFindings({
            component: fixture.name,
            identity: 'first owner',
            checks: await fixture.state(handleFor(fixture.testId), false),
          })
        ).toEqual([]);
        first.unmount();
        await settle(400);

        expectANewHandle(fixture.testId);
        const second = await render(fixture.owner(true), RENDER);
        await settle();
        await ensureHandle(fixture.testId);
        const propChecks = await fixture.state(handleFor(fixture.testId), true);
        console.log(
          `    · ${fixture.testId} props after the second owner: ` +
            propChecks
              .map((check) => `${check.label}=${String(check.actual)}`)
              .join(' ')
        );
        expectConformance(
          recycleFindings({
            component: fixture.name,
            identity: `testID "${fixture.testId}"`,
            checks: propChecks,
          })
        );
        second.unmount();
        await settle(400);

        // Half two is the one that can fail, and it owns both lifetimes: an interaction that
        // puts state in the view no prop describes, then a second mount whose props are all
        // defaults, then a question only the control's own state can answer.
        const probe = fixture.probe;
        if ('noProbe' in probe || 'blindSpot' in probe) {
          // The two kinds are not the same sentence, and the run has to print the difference
          // the coverage table makes: a control with nothing to reset is a pass-shaped `n/a`,
          // a control whose residue is invisible is *debt*, printed the way the a11y sweep
          // prints its own so a reader cannot mistake the green line for coverage.
          const note = 'noProbe' in probe ? probe.noProbe : probe.blindSpot;
          const debt =
            'noProbe' in probe
              ? null
              : EXEMPTIONS.find(
                  (row) =>
                    row.component === fixture.name &&
                    row.rule === 'recycle-reset'
                );
          console.log(
            `    · ${fixture.testId} residue probe: ${
              debt == null
                ? `none — ${note}`
                : `none, and that is a hole — known failing (${debt.followups}): ` +
                  `${debt.detail}`
            }`
          );
          return;
        }
        // …and half three, for the controls that have it: the same rule read through a
        // *controlled* second owner, which is the only shape that reads the handshake's
        // counters. See `Fixture.controlledProbe` for why one fixture cannot see both lines.
        for (const run of [
          { name: 'uncontrolled', probe },
          ...(fixture.controlledProbe == null
            ? []
            : [{ name: 'controlled', probe: fixture.controlledProbe }]),
        ]) {
          console.log(
            `    · ${fixture.testId} residue probe (${run.name} second owner): ` +
              run.probe.leaveBehind
          );
          recycleEvents.length = 0;
          expectANewHandle(fixture.testId);
          const firstOwner = await render(run.probe.first(), RENDER);
          await settle();
          await ensureHandle(fixture.testId);
          await run.probe.act();
          firstOwner.unmount();
          // Long enough for the drop to have run and, on iOS, for the instance to reach the
          // recycle pool: `enqueueComponentViewWithComponentHandle` is what calls
          // `prepareForRecycle` (`RCTComponentViewRegistry.mm:117`), and it happens on the
          // mounting transaction that removes the view.
          await settle(500);

          expectANewHandle(fixture.testId);
          const secondOwner = await render(run.probe.second(), RENDER);
          await settle();
          // The second owner's own handle, which is why the line above deleted the entry
          // first. What this file used to claim here — that React hands the previous callback
          // `null` on unmount, so a stale entry could not survive — is wrong: `hybridRef` is
          // installed once per native view and never re-invoked or cleared
          // (`src/core/useStableCallback.ts`), and `handles` was emptied only in `afterEach`.
          // So the lookup found the *first* owner's handle and returned it without waiting,
          // and this probe read the first owner's day and its open presentation count. That is
          // CI's `reads 1799971200000 where the props say 1740787200000` with
          // `presented 1`, on both hosted runs, in the one rule that cannot be explained by
          // load. The read below still stays a single read, with no wait for the reset.
          await ensureHandle(fixture.testId);
          // Then wait for the *bookkeeping* to be quiescent, which is a different thing
          // from waiting for the answer. Run 41230848294 read
          // `the day the field shows = 1799971200000` (the first owner's pick) and
          // `a presentation left open = 1` for this control at load1 152-380 on 3 cores,
          // and the same tree read `1740787200000 / 0` on the next dispatch. One fixed
          // `settle(500)` was the fixture assuming the device had processed the
          // unmount-and-mount by then; on a starved main thread it had not, so the read
          // was of a view whose previous owner's lifetime was still in flight.
          //
          // Two consecutive equal ledger/registry reads says no mount or drop is still in
          // flight. It cannot say the reset happened — the reset writes no counters — so a
          // control that never re-arms its one-shot settles quietly at the wrong day and the
          // read below still goes red. Same discipline the leak rule uses for its baseline,
          // for the same reason: only a quiescent read is evidence about a mount.
          await settledStats(`after "${fixture.testId}" changed owner`);
          const checks = await run.probe.read();
          for (const check of checks) {
            console.log(
              `    · ${fixture.testId} after the ${run.name} second owner: ` +
                `${check.label}=${String(check.actual)} (expected ` +
                `${String(check.expected)})`
            );
          }
          expectConformance(
            recycleFindings({
              component: fixture.name,
              identity: `testID "${fixture.testId}" (${run.name} second owner)`,
              checks,
            })
          );
          secondOwner.unmount();
          await settle(400);
        }
      });

      it('is named on its own box, not on a wrapper around it', async () => {
        expectANewHandle(fixture.testId);
        const mounted = await render(fixture.owner(false), RENDER);
        await settle();
        await ensureHandle(fixture.testId);
        const box = harnessUi.queryByTestId(fixture.testId);
        const labelled = harnessUi.queryByAccessibilityLabel(fixture.label);
        if (fixture.isView === true) {
          // A `View`'s own accessibility props (D36 item 1): the box the testID names is
          // the element, on both platforms - the harness query walks an RN view's
          // `contentDescription` on Android, which it cannot do for a Compose control. The
          // platform tree (VoiceOver's element, TalkBack's node) is asserted by real input.
          console.log(
            `    · a View: box=${describeBox(box)} labelBox=${describeBox(labelled)}`
          );
          expect(box).not.toBeNull();
          expect(labelled).not.toBeNull();
          expect(Math.abs(labelled!.width - box!.width)).toBeLessThan(2);
          expect(Math.abs(labelled!.height - box!.height)).toBeLessThan(2);
          mounted.unmount();
          return;
        }
        if (fixture.selfSizing === false) {
          // The presentation-aware half (Q5 Appendix B5): a closed dialog's anchor is
          // hidden from accessibility, so nothing on screen may carry its title - a
          // name on a 0 x 0 view would be a stop a screen reader lands on and cannot
          // act on. The name belongs to the presented window, which real input reads
          // (`A11Y_PRESENTATIONS` in scripts/real-input/a11y.mjs).
          console.log(
            `    · presentation: box=${describeBox(box)} labelBox=` +
              `${describeBox(labelled)} - the window's name is asserted by real input`
          );
          expect(labelled).toBeNull();
          mounted.unmount();
          return;
        }
        if (PLATFORM !== 'ios') {
          // The honest Android statement, from the suites that already make it: the harness
          // walks `View.contentDescription`, Compose publishes `SemanticsNode`s, and so
          // nothing in-process can see the name however well the component behaves. The
          // rule runs from the host against the accessibility tree instead.
          console.log(
            `    · Android: the in-app a11y query cannot see a Compose control's ` +
              `name (labelBox=${describeBox(labelled)}) — this rule is asserted by ` +
              'real-input:android, see scripts/real-input/a11y.mjs'
          );
          expect(box).not.toBeNull();
          mounted.unmount();
          return;
        }
        console.log(
          `    · box=${describeBox(box)} labelBox=${describeBox(labelled)}`
        );
        expect(box).not.toBeNull();
        expect(labelled).not.toBeNull();
        // The box comparison is the rule. "Some node carries the label" is also true of a
        // wrapper, and a wrapper is the bug; a node whose box *is* the control's is a name
        // the person can act on.
        expect(Math.abs(labelled!.width - box!.width)).toBeLessThan(2);
        expect(Math.abs(labelled!.height - box!.height)).toBeLessThan(2);
        expect(handleFor(fixture.testId).accessibilityLabel).toBe(
          fixture.label
        );
        mounted.unmount();
      });
    });
  }
});
