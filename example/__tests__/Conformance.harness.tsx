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
import { ALLOW_LOCALE_MISMATCH_ENV, localeMismatchAllowed } from './runState';
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
 * A declared-fallback row for one platform: the box, plus the locale its
 * numbers were measured in when they depend on one.
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
 * What a control's `hybridRef` hands back. Every field is optional because a
 * control reports only the fields it has.
 */
type Handle = {
  readonly accessibilityLabel: string | null;
  readonly value?: boolean | number | string | null;
  readonly selectedIndex?: number | null;
  /** Menu's trigger text. */
  readonly title?: string;
  measureContent(): Size;
  /**
   * The Slider's report of an accessibility step: `performed
   * accessibilityIncrement on <node> <from>-><to> disabled=<bool>`, numbered
   * `#n` on Android. `from` is the value the view was showing, not the one
   * React sent.
   */
  nuiTestAccessibilityStep?(direction: number): void;
  nuiTestAccessibilityStepReport?(): string;
  /**
   * Picker's report: `expanded=<0|1>;live=<n>;…`. `live` is how many menus the
   * platform believes this control has open.
   */
  nuiTestMenuReport?(): string;
  /**
   * DatePicker's report: its displayed instant plus whether a presentation is
   * open, both from the view.
   */
  nuiTestStateReport?(): string;
  /** Opens the DatePicker's own presentation. */
  nuiTestPresent?(): void;
  /**
   * Drives a selection through the control's own path. `Picker` names an index;
   * `DatePicker` names a year, month, day, hour and minute.
   */
  nuiTestSelect?(...fields: number[]): void;
  /** Progress's displayed fraction, as the view draws it, plus its animation flag. */
  nuiTestDisplayedValue?(): string;
  /**
   * SegmentedControl's `displayed=<index>`, or `displayed=none` before the
   * hosted row has been handed a selection. Written where the row is drawn, so
   * it shows the view's state, not the prop React sent.
   */
  nuiTestDisplayedIndex?(): string;
  /**
   * The Form's line: `rows`/`sections` registered with this list, `orphans` in
   * neither a cell nor their section's holding view, and the scroll the
   * platform is showing.
   */
  nuiTestFormReport?(): string;
  /** Scrolls the Form's list. */
  nuiTestScrollTo?(y: number): void;
  /**
   * Stepper: takes one step through the path a tap takes (`+1` up, `-1` down).
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
   * Chip's label. `null` is Picker's: its handle carries an optional field
   * label of the same name.
   */
  readonly label?: string | null;
  /** Chip's press, through the tap's own path. */
  nuiTestPress?(): void;
  /** ButtonGroup's press of one named item, through the tap's own path. */
  nuiTestPressItem?(id: string): void;
  /**
   * ButtonGroup's row probe. It has to be driven before `nuiTestStateReport`
   * can answer: the row stamps the report as it lays out.
   */
  nuiTestProbeRow?(): void;
  /** ButtonGroup's semantics probe, driven the same way. */
  nuiTestProbeAccessibility?(): void;
  /** Checkbox's value as React last sent it, not what the view shows. */
  readonly checked?: boolean | null;
  /** Checkbox's toggle, through the tap's own path. */
  nuiTestToggle?(): void;
  /**
   * ContextMenu's report: `open`, `opens`/`closes`/`selects`, `title` and the
   * rest, `;`-separated.
   */
  nuiTestContextMenuReport?(): string;
  /** ContextMenu's pick, through the path a row press takes. */
  nuiTestSelectRow?(id: string): void;
};

/**
 * Toggles a Checkbox: a harness tap on Android, the control's own press path on
 * iOS, where the harness's touch carries no HID event and reaches no SwiftUI
 * gesture.
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
 * The glyph every IconButton fixture mounts: a drawable name the library ships
 * on Android, and the same drawing's SF Symbol name on iOS, where the symbol is
 * the control's width.
 */
const ICON_BUTTON_GLYPH = {
  systemImage: 'xmark',
  androidIcon: 'nitroui_close',
};

/**
 * Presses an IconButton: a harness tap on Android, the control's own press path
 * on iOS (see `pressCheckbox`).
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
 * Types into the focused TextField the way a keyboard does: `insertText` on the
 * iOS first responder, the focused view's `InputConnection` on Android.
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
 * A recycled control's props cannot show residue: a recycled instance is sent
 * every prop as a fresh mount. What a reset alone owns is state no prop
 * rewrites: the displayed value, the handshake's event counts and the one-shot
 * that applies a default. So a probe leaves that state behind through an
 * interaction, mounts a second owner whose props are all defaults, and asks
 * the control's own read-out.
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
   * Asks the second mount. An `actual` that is not what the second owner's
   * props imply is residue.
   */
  read: () => Promise<
    Array<{ label: string; expected: unknown; actual: unknown }>
  >;
};

/**
 * Why a control has no probe. `noProbe`: the control holds nothing a reset
 * could clear. `blindSpot`: it holds state a recycle has to clear, and no
 * platform can be shown the difference.
 */
type RecycleNote = { noProbe: string } | { blindSpot: string };

/** Every callback the probes wired up, in order, as `testID:value`. */
const recycleEvents: string[] = [];

const recordRecycle =
  (testId: string) =>
  (value: unknown): void => {
    recycleEvents.push(`${testId}:${String(value)}`);
  };

/**
 * A ButtonGroup's `onCheckedChange` names the item and the new state, where the
 * other controls' events carry one value.
 */
const recordRecycleChecked =
  (testId: string) =>
  (id: string, checked: boolean): void => {
    recycleEvents.push(`${testId}:${id}:${String(checked)}`);
  };

/**
 * ListItem's `onPress` carries no value, so this records the row that answered.
 */
const recordRecyclePress = (testId: string) => (): void => {
  recycleEvents.push(testId);
};

const eventsSince = (from: number): string[] => recycleEvents.slice(from);

/**
 * Waits for `wanted` to be everything the app was told since `from`, and
 * returns what was seen either way: a control that stays silent has to arrive
 * as a finding naming both values, not as a timeout.
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
 * Presses a ListItem through the control's own press path on both platforms:
 * the iOS harness touch carries no HID event, and UIKit's row highlight is a
 * gesture recogniser.
 */
const pressListItem = (testId: string): void => {
  const handle = handleFor(testId);
  if (handle.nuiTestPress == null) {
    throw new Error(`"${testId}" is not a ListItem - it has no nuiTestPress()`);
  }
  handle.nuiTestPress();
};

/**
 * ListItem's report as `key -> value`. Split on the first `=` only: the a11y
 * answer's value contains `=`.
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

const pressControl = async (testId: string): Promise<void> => {
  await userEvent.press(await screen.findByTestId(testId));
};

/**
 * Presses a Chip: a harness tap on Android, the control's own press path on iOS
 * (see `pressCheckbox`).
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
 * Taps segment `index` at the centre of the slice of the box that segment owns.
 * Fair here because the fixture's row is not over-wide: three short labels, so
 * each third of the box is one segment.
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
 * Which segment a SegmentedControl's row is painting. Polling is safe: the
 * reset clears this report to `none`, so waiting for an index waits for the new
 * mount to draw, and a control that kept its previous owner's index answers it
 * at once.
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
 * Which value a Stepper is painting. Polling is safe for the same reason as
 * `drawnIndexOf`. A timeout is returned as a sentence rather than thrown, so a
 * finding can name both values.
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

function stepStepper(testId: string, direction: number): void {
  const handle = handleFor(testId);
  if (handle.nuiTestStep == null) {
    throw new Error(`"${testId}" is not a Stepper - it has no nuiTestStep()`);
  }
  // Called *on* the handle: a Nitro hybrid method lifted into a local loses its `this`,
  // and the call answers "this is not bound" instead of stepping.
  handle.nuiTestStep(direction);
}

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

const localDay = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

/**
 * The DatePicker's report is positional, not `key=value`: `millis`,
 * `presented`, `calendarMonthUtc`, `hasSelection`, `livePresentations`,
 * `controlBuilds`, `builtMinimum` and `builtMaximum`, separated by `|`. The
 * segment count is checked, so a reordered or extended report fails here.
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
  // The action runs in a later turn of the UI thread's queue, so the wait is on
  // the report changing, not on a pause.
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
 * Engine counters, read once the ledger has stopped moving: two consecutive
 * equal reads, because a drop from an earlier test can land inside the window.
 * Throws if the window never settles.
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
 * Forgets any handle held for `testId`, so the next `ensureHandle` can only be
 * answered by a mount that has not happened yet. Call it before every `render`
 * whose control the test then reads: `hybridRef` fires once per native view at
 * mount and is never called with `null`, so the map would otherwise answer with
 * an earlier owner's handle.
 */
function expectANewHandle(testId: string): void {
  handles.delete(testId);
}

/**
 * Waits until `hybridRef` has run for this testID. It fires on a commit after
 * the view is created, so a box can exist while the handle has not arrived.
 * Waits for the handle only, never for an answer.
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
 * `react-native-harness` gives a render 1000 ms unless told otherwise, and the
 * first cold mount of a native view on an emulator can exceed that.
 */
const RENDER = { timeout: 20000 } as const;

/* ------------------------------ the rule bodies ------------------------------ */
/*
 * The in-app halves of the fallback, leak and recycle rules. The harness cannot
 * import a Node module, so these re-implement the branches of
 * `scripts/conformance-core.mjs` and take their numbers from the shared table.
 */

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
 * Strips a launch identifier to the language(+script)+region prefix the engine
 * reports. Mirrors `canonicalLocale` in `scripts/conformance-core.mjs`.
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
 * Rule 1: is the fallback the control's own, and does a wrong guess still get
 * corrected? `declared` is `expected` when the engine has a fallback registered
 * and `null` when it has none: JS can read only whether one exists. A row
 * measured under a named locale fails on a locale mismatch unless the run opted
 * out.
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
    // A locale mismatch fails: the harness pins the launch locale, so the app
    // reporting another one means the pin was lost. It is a skip only when the
    // run opted out, and the poison must still be corrected either way.
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
    // A locale wider than the measured one costs its first instance a
    // correction, so a locale mismatch suspends this claim too.
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
 * Rule 2: did the engine's bookkeeping return to baseline after every instance
 * dropped? `baseline` is a settled read, taken while nothing is mounted or
 * dropped.
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

/** Prints known debt and fails on anything new. */
function expectConformance(findings: Finding[]): void {
  const failures: string[] = [];
  for (const finding of findings) {
    if (finding.skipped != null) {
      // Printed, so a run that compared less than it claims says so in the log.
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
  // Thrown, not asserted: a thrown `Error` reaches the gate log whole, where
  // `toEqual([])` prints only a count and `console.log` from a device run may
  // not arrive.
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
 * `prewarmSizing` returns how many of the names it was given had a fallback
 * registered. `seedSizingSize` writes the same table, so the answer is only
 * meaningful before anything in the process seeds: see `readRegistrationOnce`.
 */
function hasDeclaredFallback(component: string): boolean {
  return nitroUiCore.prewarmSizing([component]) === 1;
}

/**
 * Plants a size no control declares, so being right requires correcting it.
 * Poisoning is process-wide and must be undone: the harness resets the JS
 * runtime between files, not the native engine.
 */
function poison(component: string): void {
  const size = SHARED.poisonSizes[PLATFORM];
  nitroUiCore.seedSizingSize(component, '', size.width, size.height);
  nitroUiCore.invalidateSizingEnvironment();
}

/**
 * The engine's answer for every control, read once before this file seeds
 * anything: after any `seedSizingSize` in the process, `prewarmSizing` answers
 * `true` whether or not the startup table had a row.
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
 * Puts the declared number back, so the suites that run after this one start
 * from a sane fallback. It cannot restore the startup declaration: from the
 * first poison on, the engine's row is JS-supplied.
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
 * Which axes this control's declaration describes, from the mirrored table. A
 * missing entry throws: it means the mirror is stale.
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
/*
 * One fixture per control the registry declares. The two owners are
 * deliberately not symmetric: the first puts its control in non-default state,
 * and the second sends its props at their defaults, so the reset is the only
 * source of the stored value.
 */

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
   * The same control under a caller-chosen `testID`, for the leak rule, which
   * mounts several at once. `variant` flips a prop so the rows are distinct.
   */
  control: (testId: string, variant: boolean) => ReactElement;
  /**
   * What the control reports about itself, for the recycle rule. May be async:
   * the Form answers from a native report built on the UI thread, which a mount
   * can move a beat later.
   */
  state: (
    handle: Handle,
    second: boolean
  ) =>
    | Array<{ label: string; expected: unknown; actual: unknown }>
    | Promise<Array<{ label: string; expected: unknown; actual: unknown }>>;
  /**
   * Two owners of one testID, an interaction, and the control's own answer
   * afterwards; or the reason there is no probe.
   */
  probe: RecycleProbe | RecycleNote;
  /**
   * The same rule with a controlled second owner. A reset has two parts:
   * re-arming the default, which an uncontrolled owner can see, and zeroing the
   * handshake's event counts, which only a controlled owner reads. A controlled
   * owner sends its value with event count 0, so counts left over from the
   * previous owner make the write look stale and it is refused.
   */
  controlledProbe?: RecycleProbe;
  /**
   * `false` for a component with no box of its own (`sizing: null` in its
   * `component.json`). It never enters the sizing engine, so the fallback and
   * leak tests print why they do not apply, and the a11y test asserts that the
   * anchor carries no name.
   */
  selfSizing?: false;
  /**
   * `true` for a component that is a React Native `View`: its accessibility
   * props land on the view the `testID` names, so the a11y rule holds the
   * labelled box to that box on both platforms.
   */
  isView?: true;
};

const SECOND = 'second owner';

const columnStyle = { flexDirection: 'column' } as const;

/**
 * The rows every Menu fixture passes: a constant rather than something built
 * per render.
 */
const MENU_GROUP: MenuGroup = {
  actions: [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
  ],
};

/**
 * Deliberately long: a content-sized control must not measure exactly its
 * declared fallback, and Menu declares a Button-sized one.
 */
const MENU_TITLE = 'Conformance actions';
const MENU_TITLE_SECOND = 'Second owner’s actions';

const CONTEXT_LABEL = 'Conformance context menu';
const CONTEXT_TITLE = 'Conformance rows';

function contextMenuReportOf(handle: Handle): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of (handle.nuiTestContextMenuReport?.() ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/**
 * `captureFor` for a ContextMenu, whose handle has no `accessibilityLabel` and
 * no `measureContent()`: it is a `View`.
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
 * `captureFor` for a dialog, which has no `accessibilityLabel` and no
 * `measureContent()`: it has no box.
 */
const captureDialog =
  (testId: string) =>
  (view: object): void => {
    handles.set(testId, view as unknown as Handle);
  };

function dialogReportOf(handle: Handle): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of (handle.nuiTestStateReport?.() ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

function dialogShows(report: Record<string, string>, title: string): boolean {
  return report.kind !== 'none' && report.title === title;
}

const SHEET_LABEL = 'Conformance sheet';
/** The two owners' content heights: different, and neither a detent's. */
const SHEET_FIRST_HEIGHT = 120;
const SHEET_SECOND_HEIGHT = 260;

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
 * The message is the name a presented tooltip carries, so it is also what the
 * a11y rule looks for.
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
const POPOVER_FIRST_HEIGHT = 120;
const POPOVER_SECOND_HEIGHT = 260;

/**
 * Sends no `accessibilityLabel`: a Popover's anchor stays in the app's layout,
 * and a label never reaches a presented window on either platform.
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

function popoverShows(report: Record<string, string>, height: number): boolean {
  return (
    report.presented === '1' &&
    report.live === '1' &&
    Math.abs(Number(report.contentH) - height) <= 1
  );
}

// MARK: - Form's fixture

const FORM_LABEL = 'Conformance form';
const FORM_LABEL_SECOND = 'Second owner’s form';

/**
 * `captureFor` for a Form, which has no `measureContent()` and no
 * `accessibilityLabel`.
 */
const captureForm =
  (testId: string) =>
  (view: object): void => {
    handles.set(testId, view as unknown as Handle);
  };

/**
 * `captureFor` for a ListItem. Its `title` is `string | null`, which is not
 * assignable to the shared handle's `title?: string`, hence the cast.
 */
const captureListItem =
  (testId: string) =>
  (view: object): void => {
    handles.set(testId, view as unknown as Handle);
  };

/**
 * One Form, with a row count that differs between the two owners by more than
 * one, so an off-by-one reset cannot look like a late layout.
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
 * The Form's report once it has stopped moving. The numbers are the UI thread's
 * and a call answers what the last call's build produced, so the first read
 * after a mount can be the previous owner's. Waits for two consecutive reads to
 * agree, never for a particular number.
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
 * Module-level because `items` is an object-array prop: a literal in the JSX
 * would be a new identity on every render.
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
 * One uncontrolled toggle item: `defaultChecked` seeds it checked once, so
 * pressing it reports `false`.
 */
const CONFORMANCE_BUTTON_GROUP_TOGGLES = [
  { id: 'bold', title: 'Bold', toggle: true, defaultChecked: true },
];

/** The same item, controlled at unchecked. */
const CONFORMANCE_BUTTON_GROUP_CONTROLLED = [
  { id: 'bold', title: 'Bold', toggle: true, checked: false },
];

/**
 * Presses one item of a ButtonGroup through the control's own press path on
 * both platforms: a tap can only be aimed at a point, and on iOS a harness
 * touch reaches no SwiftUI `Button` gesture.
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
    // The residue is `false`, the value the reset itself writes, and the second
    // owner's default is `true`: only a re-armed default can show it.
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
        // A second owner whose default was applied shows ON, so its first press
        // reports `false`. One that kept the previous owner's state shows OFF
        // and reports `true`.
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
      // Controlled at `false`, the opposite of the residue. The write arrives
      // with event count 0, so it is accepted only if the reset zeroed the
      // native event count; otherwise it is refused as stale and the control
      // keeps showing `true`.
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
        // The residue is 0, the value the reset itself writes. The event
        // carries a JS number, so it records as `0`, not the report's `0.0`.
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
        // The report's `from` is the drawn value, not React's number.
        const report = await sliderStep(
          handleFor('conformance-slider'),
          1,
          'the second owner’s first step'
        );
        return [
          {
            // The report prints the value as a double (`0.0->0.25`), so the
            // expected string has the same shape.
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
        // One step down: a control that accepted the controlled write is on 0
        // and cannot move, and one that refused it as stale reports 0.25 to 0.
        // A step up would report `0.25` either way.
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
        // A tap, not a prop: `defaultSelectedIndex` stays 0, so index 2 can
        // only come from the control's own state.
        await tapSegmentOf('conformance-segmented', 2, 3);
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-segmented:2'])
        );
        // The residue is checked through the read-out this probe depends on:
        // one that echoed the prop would answer 0 here.
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
          // The row's own answer, not the handle's `selectedIndex`. The residue
          // is 2 and the reset writes 0, so index 1 is reachable only by the
          // second owner's default being applied.
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
      // Controlled on 0, the opposite of the residue (see the Switch fixture's
      // controlled probe).
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
          // Read through the row, not the handle: `selectedIndex` answers what
          // React sent, whether or not the write was accepted.
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
            // Read from the view, and read once: waiting for the reset before
            // asking whether it happened would pass a control that resets late.
            // The expected day is the second owner's own default, which is
            // neither the residue nor the epoch 0 the reset writes.
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
          // `millis` rather than the handle's `value`: the handle answers the
          // day React sent either way.
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
        // A pick of the index already displayed emits nothing, so the silent
        // second call says the control really is on 1.
        choose();
        await settle(300);
        if (eventsSince(before).length !== 1) {
          throw new Error(
            `the picker emitted twice for one repeated choice: ` +
              eventsSince(before).join(',')
          );
        }
      },
      // Defaulted to 2, which is neither the residue (1) nor what the reset
      // writes (0): with the default applied, picking 0 fires; left on 0, it
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
        // Silence is the residue, so it is reported rather than waited away: a
        // `waitFor` here would turn a missing reset into a timeout that names
        // neither value.
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
        // A stale write is dropped, so the control is still on option 2 and a
        // pick of 2 is silent.
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
    // A Menu's only native-owned state is whether its popup is open. Android
    // reads that flag; on iOS no harness gesture reaches a SwiftUI `Menu` and
    // the read-out answers `-1`.
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
    // A user dismissal is a native event, so the first owner ends with one
    // counted. If the reset kept it, the second owner's `isPresented` is
    // refused as stale and its dialog never presents; if it kept the
    // controller, the old title shows.
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
        // The flag is read once. The window is waited for, because presenting
        // is asynchronous on both platforms.
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
    // The dialog's residue, plus the content: a reset that kept the previous
    // sheet's content box would show the first owner's height.
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
    // The dialog's residue, plus the content: a reset that kept the previous
    // popup's content would show the first owner's message.
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
    // The dialog's residue, plus the content: a reset that kept the previous
    // popover's content box would show the first owner's height.
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
    // An uncontrolled chip that started selected and was pressed off, then a
    // second owner whose default is selected. A chip whose default was
    // re-applied shows selected and reports `false` on its first press.
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
    // Controlled at `true`, not `false`: Android's reset clears the drawn value
    // to `false` on its own, so a second owner controlled at `false` would look
    // right with the counters left over.
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
    // The residue is `false`, the value the reset writes, so the first press
    // after the second mount is the evidence (see the Switch fixture).
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
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-checkbox:false',
            actual: await eventsSettled(from, 'conformance-checkbox:false'),
          },
        ];
      },
    },
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
      // Controlled at `false` while the residue is `true` (see the Switch
      // fixture's controlled probe).
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
    // Read from the view's own report: a `null` title has to arrive as `-`, and
    // the menu must not come back open.
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
    // The residue is the menu's own history: a pick counts into `selects`,
    // which no prop writes. On Android the same reset closes a menu the
    // previous owner left open.
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
    // A Form is laid out by its caller, so it never joins the sizing engine's
    // ledger. `isView` because the Form is the view that carries the label.
    selfSizing: false,
    isView: true,
    owner: (second) => <Form {...formFixtureProps(second)} />,
    control: (testId, variant) => (
      <Form
        {...formFixtureProps(variant, testId, `Leak ${variant ? 'B' : 'A'}`)}
      />
    ),
    // `rows` is what registered with the list; `orphans` is a component view a
    // recycle moved out and nothing moved back.
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
    // Four rows and a real scroll for the first owner, two rows for the second.
    // The scroll is logged rather than asserted: on Android the scroller is
    // React Native's `ScrollView`, which belongs to the wrapper, not the
    // recycled view.
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
        // Wait for the list to say it moved. iOS publishes `offset`, Android
        // `scroll`.
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
    // The press form at every default: the configuration the fallback row
    // describes. iOS gives a `Toggle(.button)` its own padding, so the toggle
    // form is a different box there.
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
    // The second owner's default is the opposite of the residue, so the answer
    // cannot coincide with what a missing reset would print.
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
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-icon-button:false',
            actual: await eventsSettled(from, 'conformance-icon-button:false'),
          },
        ];
      },
    },
    // The handshake's event counts, which an uncontrolled owner never reads.
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
    // Two action items at every default: the configuration the fallback row
    // describes. An iOS toggle row is a different height from an action row.
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
    // The checked set of uncontrolled items belongs to the control and survives
    // every prop the second owner sends. The second owner's `defaultChecked` is
    // the opposite of the residue.
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
        // The item starts checked (`defaultChecked`), so the press that arms
        // the probe reports it unchecked.
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
    // A toggle press on an uncontrolled item, then a second owner controlled at
    // unchecked: the press leaves the item checked, so a stale counter reports
    // `true` where a clean one reports `false`.
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
        // The item starts checked (`defaultChecked`), so the press that arms
        // the probe reports it unchecked.
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
    // The default range and step: a Stepper's box depends on neither.
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
    // Three possible answers, three numbers: the previous owner stepped to 4,
    // the reset writes 0, and the second owner's default is 6.
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
        // The same question through the event: from 4 a step down gives 3, from
        // 0 there is nothing to step down to, and only the second owner's 6
        // answers 5.
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
    // The first owner's step leaves one native event counted, so a controlled
    // mount's write would be dropped as stale and the control would sit on 0
    // while its app shows 7.
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
    // The one-line row with a trailing value: the configuration the fallback
    // row describes. A subtitle would change the height.
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
    // The second owner's title and value are different words from the first's,
    // and the press counter is asked with a press: a reset that left
    // `presses=1` behind prints `presses=2`.
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

afterEach(() => {
  cleanup();
  handles.clear();
});

/* ---------------------------------- the suite --------------------------------- */

describe('conformance · every control, four rules', () => {
  for (const fixture of FIXTURES) {
    describe(`· ${fixture.name}`, () => {
      // Both lookups are done inside the test, not in the `describe` body:
      // there, a fixture with no row in the shared table would be a collection
      // error that takes every control's suite down.

      it('has its own declared fallback, and still corrects a wrong guess', async () => {
        if (fixture.selfSizing === false) {
          console.log(
            `    · ${fixture.name} declares no sizing policy, so it has no fallback to ` +
              'declare and never enters the engine to guess one (component.json sizing: null)'
          );
          return;
        }
        const expected = declaredFallback(fixture.component);
        const appLocale = deviceLocale();
        // The app cannot read the runner's environment, so the opt-out is
        // published by `example/rn-harness.config.mjs` and read back here;
        // unreadable means `false`.
        const mismatchAllowed = await localeMismatchAllowed();
        if (mismatchAllowed.allowed) {
          console.log(
            `    · ${ALLOW_LOCALE_MISMATCH_ENV}=1: a locale mismatch will be a ` +
              'printed skip rather than a failure, for this file only'
          );
        }
        const boxRule = boxRuleFor(fixture.component);

        // 1. The engine knows a fallback at all, read once for the whole file
        // before any poison here has written one.
        readRegistrationOnce();
        const registered = registration[fixture.component] === true;

        // 2. Poisoned mount first, so the seed cannot be masked by a cached
        // answer the warm mount would leave behind.
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

        // 3. Warm. Where the declaration describes the whole box, nothing has
        // to be corrected; `boxRule` narrows the comparison for a `fillWidth`
        // or content-sized control.
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
        // Mounts K controls, waits for the last to be laid out, requires the
        // ledger to have risen by exactly K, then drops them and requires the
        // rise to be gone. Both reads are settled: an instance from the
        // previous test's `unmount()` can release inside the window.
        const MOUNTS = 8;
        const before = await settledStats('before the mount window');
        const many = await render(
          <View>
            {Array.from({ length: MOUNTS }, (_, row) => row).map((row) =>
              // A `testID` per row, so every one is its own Fabric node.
              fixture.control(`leak-mounted-${String(row)}`, row % 2 === 0)
            )}
          </View>,
          RENDER
        );
        // The last row's box is the witness: Fabric lays out in order, so a
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
        // `onDropView` runs on the mounting transaction that removes the view,
        // so this waits for the drops rather than assuming they are synchronous
        // with `unmount()`.
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
          // A finding rather than a thrown error: a control whose instances
          // never reach the engine cannot leak there, and the rule would be
          // vacuous for it.
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
        // Compared against the pre-mount baseline: the mounted read already
        // includes the K entries.
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

      it('shows none of its previous owner under one identity', async () => {
        // Half one, the props: it notices a wrapper that stopped providing a
        // prop, not a missing reset.
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

        // Half two: an interaction that puts state in the view no prop
        // describes, then a second mount whose props are all defaults, then a
        // question only the control's own state can answer.
        const probe = fixture.probe;
        if ('noProbe' in probe || 'blindSpot' in probe) {
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
        // Half three, where a fixture has it: the same rule through a
        // controlled second owner.
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
          // Long enough for the drop to have run and, on iOS, for the instance
          // to reach the recycle pool, which is where `prepareForRecycle` is
          // called.
          await settle(500);

          expectANewHandle(fixture.testId);
          const secondOwner = await render(run.probe.second(), RENDER);
          await settle();
          // The second owner's own handle: `hybridRef` is installed once per
          // native view and never cleared, so the entry was deleted above.
          await ensureHandle(fixture.testId);
          // Two consecutive equal ledger reads say no mount or drop is still in
          // flight. They cannot say the reset happened, so the read below is
          // still a single read.
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
          // The box the testID names is the element on both platforms: the
          // harness query walks an RN view's `contentDescription` on Android.
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
          // A closed dialog's anchor is hidden from accessibility, so nothing
          // on screen may carry its title. The name belongs to the presented
          // window.
          console.log(
            `    · presentation: box=${describeBox(box)} labelBox=` +
              `${describeBox(labelled)} - the window's name is asserted by real input`
          );
          expect(labelled).toBeNull();
          mounted.unmount();
          return;
        }
        if (PLATFORM !== 'ios') {
          // On Android the harness walks `View.contentDescription` and Compose
          // publishes `SemanticsNode`s, so nothing in-process can see the name.
          // The rule runs from the host against the accessibility tree.
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
        // The box comparison is the rule: a wrapper can carry the label too,
        // and a node whose box is the control's is a name the person can act
        // on.
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
