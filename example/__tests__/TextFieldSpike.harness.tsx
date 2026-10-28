/**
 * On-device spike tests for the TextField prototypes (task T18, `docs/tasks/Q2-textfield-research.md` §7).
 *
 * These are **evidence, not a component's test suite**: the spike exports nothing and has no `component.json`,
 * so nothing here can quietly become a shipped contract. What they do is run P1, P3, P4 (and P4b's
 * content-driven auto-grow) and as much of X4's four rules as a JS harness can reach, against the real hosting
 * path — `NitroSwiftUIHost`, `NitroComposeHost`, a hosted `UITextField` — and print the numbers the go/no-go
 * table is built from. X4's rules are named one by one in `X4`'s own evidence line, measured where this runner
 * can see them and marked `not measured here` where it cannot, because T18's review (M6) found the old label
 * claiming more than the scenario checked.
 *
 * Division of labour, because each runner proves things the other cannot:
 *
 *  - the real-input runner proves the one thing no harness can: a keystroke produced by the *operating system*
 *    reaches a hosted field (`spike-text-typing`), and it is the only place keystroke→commit latency is a
 *    symmetric comparison (`spike-latency`);
 *  - this file drives what no OS-level driver drives at any precision: a controlled write applied at a chosen
 *    moment, `maxLength` over named vectors, a sizing key driven through known widths, focus latency measured
 *    between two imperative `focus()` calls inside one clock, and mount/drop churn against the sizing engine's
 *    own counters.
 *
 * Every scenario prints one `nui-spike <name> k=v …` line. Those lines are what the report transcribes, and
 * they print whether or not the assertions around them pass: a number the go/no-go line dislikes still has to
 * be *seen* rather than hidden behind a red test.
 */
import type { ReactNode } from 'react';
import { Platform, TextInput, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  beforeAll,
  cleanup,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import { nitroUiCore } from 'react-native-nitro-ui';

import type { SpikeTextFieldHandle } from '../../src/spike/TextField/SpikeTextField';
import { SpikeTextField } from '../../src/spike/TextField/SpikeTextField';
import {
  KEYBOARD_SECURE,
  sizingVariantFor,
  widthBucket,
} from '../../src/spike/TextField/keyboard';
import { expectTimingBudget } from './timingGate';

const iOS = Platform.OS === 'ios';

/**
 * Four emoji: 4 code points, 8 UTF-16 units, 14 grapheme clusters. `maxLength` is defined in code points, so
 * this is the string that tells a code-point cap from a UTF-16 cap, and the lone-surrogate regex below is what
 * tells a code-point truncation from a unit truncation.
 */
const EMOJI_32 = '\u{1F600}\u{1F601}\u{1F602}\u{1F603}';

/*
 * Which arm an imperative `focus()` actually works on.
 *
 * Which arm a scenario drives: the one an app can focus on command. On iOS that is the hosted `UITextField`
 * (arm B), whose `becomeFirstResponder()` is called from the view. Arm A's `@FocusState` is private to the
 * SwiftUI subtree, so an imperative ask reaches it only through the binding the SwiftUI body hands to the
 * model in `onAppear`, and `P5 focus latency` measures whether that lands rather than assuming it. Android
 * has one shape and takes focus through the composable's own `FocusRequester`, so every arm value there
 * means the same field. Either way the arm choice carries a G8 cost: a field whose imperative focus depends
 * on the shape it was mounted with is a field whose API has two behaviours.
 */
const focusableArm: 'swiftui' | 'textfield' = iOS ? 'textfield' : 'swiftui';

/*
 * The arm `P5` times focus on, which is not the same question as "which arm can be focused at all".
 *
 * `focusableArm` is what T18 *read* out of the source, and the iOS measurement came back the other way: the
 * hosted `UITextField` arm answers an imperative ask with `lastWrite=focus:no-field` and `live=0` — SwiftUI
 * has not built its representable in that instance — while the SwiftUI arm is the one with a handle now
 * (`SpikeSwiftUITextField.focusBinding`). Timing focus on the arm that cannot take it produced a red that
 * measured the arm choice rather than the method, so `P5` runs the loop on the arm that has an imperative
 * path on both platforms and records what the other arm did as its own row.
 */
const latencyArm: 'swiftui' | 'textfield' = 'swiftui';

/**
 * The mirror line, parsed.
 *
 * One parser for three shapes (`swiftui`, `textfield`, `compose`) — which is the point of the mirror's schema
 * (`SpikeTextFieldModel.mirrorLine` and `NitroSpikeTextMirror` write the same keys on purpose): a cross-shape
 * comparison is a field-by-field string comparison rather than two schemas that can drift.
 */
function parseMirror(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of line.trim().split(' ')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      out[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  return out;
}

/** One `nui-spike` evidence line, which is what the report reads out of the run log. */
function evidence(scenario: string, fields: Record<string, string | number>) {
  const rendered = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`nui-spike ${scenario} ${rendered}`);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(1))
    : (sorted[mid] ?? 0);
}

function p95(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
  );
  return sorted[index] ?? 0;
}

/**
 * The example app's test-only heap probe (`NitroUiProbe`), which reports the *Java* heap after the collectors
 * were asked to run.
 *
 * It is fetched lazily and only used on Android because Hermes reports only its own heap to JS and the probe
 * module does not exist on iOS — the same shape `MountChurn.harness.tsx` uses for the same reason. P5's memory
 * line is therefore an Android number; the iOS half of the row says so rather than borrowing it.
 */
type HeapStats = {
  usedBytes: number;
  totalBytes: number;
  maxBytes: number;
  dalvikPrivateDirtyKb: number;
  dalvikPssKb: number;
};
type ProbeModule = {
  heapStats(forceGc: boolean): Promise<HeapStats>;
};

let probe: ProbeModule | null = null;
function heapStats(): Promise<HeapStats> {
  if (probe == null) {
    probe = TurboModuleRegistry.getEnforcing(
      'NitroUiProbe'
    ) as unknown as ProbeModule;
  }
  return probe.heapStats(true);
}

const MIB = 1024 * 1024;
const toMib = (bytes: number) => Number((bytes / MIB).toFixed(2));

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------------------------------------------- *
 * A field under test
 * ------------------------------------------------------------------------------------------------------- *
 *
 * `mountSpike` wraps the harness's own `render` / `rerender`: props live in an object the scenario mutates
 * through `set()`, which re-renders the same element tree with those props. Nothing here is a seam the library
 * ships — it is a test holding one instance while it drives it, which is what `Button.harness.tsx` does by
 * calling `rerender` by hand thirty times.
 */

interface FieldOptions {
  arm: 'swiftui' | 'textfield';
  defaultValue?: string;
  value?: string | undefined;
  maxLength?: number | null;
  multiline?: boolean;
  maxLines?: number | null;
  keyboardHints?: number;
  layoutWidth?: number | null;
  placeholder?: string | null;
  /**
   * The box width, as a style.
   *
   * P4 needs both halves of a width change and they are different things: `layoutWidth` is what goes in the
   * *sizing key*, while `width` is what Yoga actually lays the field out at. Setting only the key gives a
   * field whose cache entry changes while its measured height does not — which is exactly the wrong answer to
   * "is the height width-driven", and the first device run caught it by reporting one flat height four times.
   */
  width?: number | null;
  /** Box height as a style, for a scenario that needs a field whose height is already known. */
  height?: number | null;
}

interface FieldLog {
  changes: string[];
  focus: number;
  blur: number;
  submits: number;
  lastChangeAt: number;
  lastFocusAt: number;
}

interface SpikeFieldUnderTest {
  /** What the scenario mounted, for a failure message that says which field spoke. */
  id: string;
  /** Native's cached mirror, parsed. Read on the JS thread; never touches the UI thread. */
  mirror(): Record<string, string>;
  handle(): SpikeTextFieldHandle | null;
  log: FieldLog;
  set(patch: Partial<FieldOptions>): Promise<void>;
  unmount(): void;
}

/**
 * Renders a field — plus any siblings the scenario needs *in the same tree* — and hands back the controls to
 * drive it.
 *
 * `extra` exists because the coexistence and comparison scenarios are the ones making an in-one-tree claim:
 * P1's two shapes side by side, P5's RN `TextInput` beside the spike field on the same clock.
 */
async function mountSpike(
  options: FieldOptions,
  extra?: () => ReactNode
): Promise<SpikeFieldUnderTest> {
  let props = { ...options };
  const log: FieldLog = {
    changes: [],
    focus: 0,
    blur: 0,
    submits: 0,
    lastChangeAt: 0,
    lastFocusAt: 0,
  };
  let view: SpikeTextFieldHandle | null = null;

  const tree = () => (
    <View>
      <SpikeTextField
        testID="spike-harness-field"
        iosImplementation={props.arm}
        value={props.value}
        defaultValue={props.defaultValue ?? ''}
        placeholder={props.placeholder ?? undefined}
        maxLength={props.maxLength ?? null}
        multiline={props.multiline ?? false}
        maxLines={props.maxLines ?? null}
        keyboardHints={props.keyboardHints ?? 0}
        layoutWidth={props.layoutWidth ?? null}
        style={
          props.width == null && props.height == null
            ? undefined
            : {
                ...(props.width == null ? {} : { width: props.width }),
                ...(props.height == null ? {} : { height: props.height }),
              }
        }
        onValueChange={(value) => {
          log.changes.push(value);
          log.lastChangeAt = Date.now();
        }}
        onFocus={() => {
          log.focus += 1;
          log.lastFocusAt = Date.now();
        }}
        onBlur={() => {
          log.blur += 1;
        }}
        onSubmitEditing={() => {
          log.submits += 1;
        }}
        hybridRef={(next) => {
          view = next;
        }}
      />
      {extra?.()}
    </View>
  );

  // A hosted SwiftUI / Compose subtree is not mounted in the same beat a plain view is, and the harness's
  // 1000ms default is tuned for plain views: the first spike mount of a run paid it and failed.
  const mounted = await render(tree(), { timeout: 20000 });

  return {
    id: `spike(${options.arm ?? 'default'},${
      options.value != null
        ? `value=${options.value}`
        : `default=${options.defaultValue ?? ''}`
    })`,
    mirror: () => parseMirror(view?.nuiTestState() ?? ''),
    handle: () => view,
    log,
    set: async (patch) => {
      props = { ...props, ...patch };
      await mounted.rerender(tree());
    },
    unmount: () => mounted.unmount(),
  };
}

/** The part of a mounted field a mirror wait needs, so a sibling with no props can be waited on too. */
interface MirrorReader {
  id: string;
  mirror(): Record<string, string>;
}

/** The wait every scenario uses: the mirror is published on the UI thread, so a single read is a race. */
async function mirrorReads(
  field: MirrorReader,
  key: string,
  expected: string,
  timeout = 6000
): Promise<void> {
  await waitFor(
    () => {
      const mirror = field.mirror();
      if (mirror[key] !== expected) {
        throw new Error(
          `${field.id}: ${key}=${String(mirror[key])}, want ${expected} — ${JSON.stringify(mirror)}`
        );
      }
    },
    { timeout, interval: 40 }
  );
}

/** A mirror read that must hold right now, with the same full-field message. */
function mirrorIs(
  field: MirrorReader,
  key: string,
  expected: string | undefined
): void {
  const mirror = field.mirror();
  if (mirror[key] !== expected) {
    throw new Error(
      `${field.id}: expected ${key}=${String(expected)}, got ${String(mirror[key])} — ${JSON.stringify(mirror)}`
    );
  }
}

/**
 * A second field, on the other iOS shape, for the scenarios that need two in one tree.
 *
 * It is rendered by the scenario's `extra` slot rather than mounted on its own, because "in the same tree" is
 * the claim P1 is testing. Its props are fixed, so it needs no `set`.
 */
function makeSiblingField() {
  let view: SpikeTextFieldHandle | null = null;
  return {
    id: 'spike-sibling',
    element: (
      <SpikeTextField
        testID="spike-harness-field-b"
        iosImplementation={iOS ? 'textfield' : 'swiftui'}
        defaultValue="hello"
        hybridRef={(next) => {
          view = next;
        }}
      />
    ),
    handle: () => view,
    mirror: (): Record<string, string> =>
      parseMirror(view?.nuiTestState() ?? ''),
  };
}

/**
 * Whether this environment lets a field take focus *on command* at all, measured once per run.
 *
 * The first iOS run of this file found the spike field's `focus()` producing no `onFocus` and a mirror that
 * stayed at `focused=0`. On its own that fact has two readings, and they want opposite responses: either the
 * spike's imperative focus path is broken, or nothing can take focus here because `becomeFirstResponder`
 * needs a key window and the harness drives the app without XCUITest owning the screen (real-input, which
 * *does* see the field focused, delivers a tap — UIKit gives first responder to a touched field without
 * anyone asking the window).
 *
 * So the question goes to the reference implementation: RN's own `TextInput`, asked the same way, in the same
 * app, on the same clock. If its field takes focus and the spike field does not, that is the spike's bug and
 * the scenarios stay red. If neither does, focus latency is not measurable in this environment, and a
 * scenario that measured it would be comparing two zeroes — so it says so instead.
 */
let focusCapability: {
  rnTakesFocus: boolean;
  spikeBoxedTakesFocus: boolean;
  spikePlainTakesFocus: boolean;
  /** What the control said about the ask (`HybridNitroUiSpikeTextField.focus`). */
  plainWrite: string;
  boxedWrite: string;
} | null = null;

/**
 * Wait until the hosted control behind an instance actually exists.
 *
 * `handle()` arrives with the Fabric node. On iOS the `UITextField` is built later — SwiftUI has to run a
 * pass over the body that chooses the arm — so an imperative ask sent in between reaches a model with no
 * control behind it, and `focus()` finds nothing to focus. Reporting "this field cannot be focused on
 * command" about a field that was never built would be a measurement of the test. `live=` is the mirror's
 * own answer to "is the control attached" (`NitroSpikeTextMirror`), and Android has no such gap to wait
 * for: its single shape builds the Compose field with the host.
 *
 * It answers instead of failing. A control that never got built is the finding, and an ask aimed at it
 * proves nothing about focus; the scenario that has to say which of the two happened is `P1`'s
 * `attached_by`, so the answer here is evidence, not a gate.
 */
async function awaitHostedField(field: MirrorReader): Promise<boolean> {
  if (!iOS) {
    return true;
  }
  try {
    await waitFor(
      () => {
        expect(field.mirror().live).toBe('1');
      },
      { timeout: 4000, interval: 50 }
    );
    return true;
  } catch {
    return false;
  }
}

/** Ask for focus and report whether the event arrived, without failing when it does not. */
async function focusLands(
  ask: () => void,
  count: () => number,
  timeoutMs = 1500
): Promise<boolean> {
  const before = count();
  ask();
  return eventArrives(count, before, timeoutMs);
}

/**
 * Whether an event counter moves past `before` inside `timeoutMs`, without asking for it.
 *
 * `focusLands` asks *and* waits. Half the follow-up questions a focus ask raises are about the second edge:
 * the `onBlur` that should answer a `blur()` already sent. Splitting the wait out keeps those questions from
 * re-asking the thing under test.
 */
async function eventArrives(
  count: () => number,
  before: number,
  timeoutMs = 1500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (count() > before) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

/**
 * Whether a field can take focus *on command* in this environment, measured once per run.
 *
 * The first iOS run of this file found the spike field's `focus()` producing no `onFocus` and a mirror that
 * stayed at `focused=0`. Alone, that fact has two readings that want opposite responses: our imperative focus
 * path is broken, or nothing takes focus on command inside an in-app test runner at all. So it is asked of
 * the reference implementation — RN's own `TextInput`, same app, same clock. If RN's field focuses and the
 * spike field does not, that is the spike's bug and the scenarios stay red. If neither does, focus latency
 * is not measurable here, and a scenario that measured it would compare two zeroes.
 *
 * The spike field is asked twice because the second reading is geometry, not the responder chain: a hosted
 * control has no height until its sizing correction answers, while RN's `TextInput` ships an intrinsic
 * height and never shows that face. Each scenario then asserts on the answer for the box it actually
 * mounts — `P5` boxed, like the `TextInput` it times against, and `X4` plain, because that is the shape it
 * sizes. "A field with no box of its own cannot be focused on command" is a finding worth having either
 * way, which is why both answers go into the evidence line.
 */
async function resolveFocusCapability(): Promise<{
  rnTakesFocus: boolean;
  spikeBoxedTakesFocus: boolean;
  spikePlainTakesFocus: boolean;
  plainWrite: string;
  boxedWrite: string;
}> {
  if (focusCapability != null) {
    return focusCapability;
  }
  const rnInput: { current: { focus(): void; blur(): void } | null } = {
    current: null,
  };
  let rnFocusEvents = 0;
  const plain = await mountSpike(
    { arm: focusableArm, defaultValue: '' },
    () => (
      <TextInput
        testID="spike-focus-probe-rn"
        ref={(node) => {
          rnInput.current = node as unknown as {
            focus(): void;
            blur(): void;
          } | null;
        }}
        defaultValue=""
        onFocus={() => {
          rnFocusEvents += 1;
        }}
      />
    )
  );
  await waitFor(
    () => {
      expect(plain.handle()).not.toBeNull();
      expect(rnInput.current).not.toBeNull();
    },
    { timeout: 10000, interval: 50 }
  );
  const plainIsLive = await awaitHostedField(plain);
  const spikePlainTakesFocus = await focusLands(
    () => plain.handle()?.focus(),
    () => plain.log.focus
  );
  const plainWrite = plainIsLive
    ? (plain.mirror().lastWrite ?? 'none')
    : 'no-control';
  const rnTakesFocus = await focusLands(
    () => rnInput.current?.focus(),
    () => rnFocusEvents
  );
  plain.handle()?.blur();
  rnInput.current?.blur();
  plain.unmount();

  const boxed = await mountSpike({
    arm: focusableArm,
    defaultValue: '',
    width: 320,
    height: 44,
  });
  await waitFor(
    () => {
      expect(boxed.handle()).not.toBeNull();
    },
    { timeout: 10000, interval: 50 }
  );
  const boxedIsLive = await awaitHostedField(boxed);
  const spikeBoxedTakesFocus = await focusLands(
    () => boxed.handle()?.focus(),
    () => boxed.log.focus
  );
  const boxedWrite = boxedIsLive
    ? (boxed.mirror().lastWrite ?? 'none')
    : 'no-control';
  boxed.handle()?.blur();
  boxed.unmount();

  focusCapability = {
    rnTakesFocus,
    spikeBoxedTakesFocus,
    spikePlainTakesFocus,
    plainWrite,
    boxedWrite,
  };
  console.log(
    `nui-spike focus_capability platform=${Platform.OS} rn=${
      rnTakesFocus ? 1 : 0
    } spike_plain=${spikePlainTakesFocus ? 1 : 0} spike_boxed=${
      spikeBoxedTakesFocus ? 1 : 0
    } plain_write=${plainWrite} boxed_write=${boxedWrite}`
  );
  return focusCapability;
}

describe('T18 spike — TextField', () => {
  afterEach(cleanup);

  /*
   * The focus probe is a `render()`, and the harness's `render()` unmounts whatever is already rendered
   * (`@react-native-harness/runtime/src/render/index.ts:21-26`). T18 resolved it lazily, from *inside* `P5`
   * and `X4`, so the probe's own two trees tore down the field each scenario had just mounted, and the ask
   * that followed reached a dropped view: `P5` printed `expected 0 to be greater than or equal to 1` and
   * `X4` reported its focus observable as `unobserved`. Both were measurements of the test order.
   *
   * So it runs once, before any scenario has a tree to lose. It is memoised, which is what makes the fix
   * cover every caller: after this, `resolveFocusCapability()` returns the cached answer and renders nothing.
   */
  beforeAll(async () => {
    await resolveFocusCapability();
  });

  /**
   * **P1 — the two iOS shapes host, round-trip, and coexist** (Q2 §3's deciding question, §7 P1).
   *
   * Both shapes in one tree *is* the coexistence claim. `impl=` answering with the same schema on both is what
   * makes the A/B a comparison rather than two unrelated measurements; the typing half of P1 belongs to the
   * real-input runner, because only the OS can produce a keystroke.
   */
  it('P1 both iOS shapes host, round-trip, and coexist', async () => {
    const sibling = makeSiblingField();
    const field = await mountSpike(
      { arm: 'swiftui', defaultValue: '' },
      () => sibling.element
    );
    await waitFor(
      () => {
        expect(field.handle()).not.toBeNull();
        expect(field.mirror().impl).toBeTruthy();
        expect(sibling.mirror().impl).toBeTruthy();
      },
      { timeout: 10000, interval: 50 }
    );

    const mirrorA = field.mirror();
    /*
     * Arm B is a `UIViewRepresentable` inside the same SwiftUI body, so it does not exist until SwiftUI builds
     * it. `frozen=` is the branch the instance committed to; `live=1` says the `UITextField` is attached and
     * therefore that its numbers are the ones in the line.
     *
     * Reading `impl=` once at mount is what made the first iOS run's P1 unreadable: the snapshot was taken
     * before the attach, so an instance asked for `textfield` reported `impl=swiftui selection=-1--1` and the
     * A/B could not tell "not built yet" from "built the wrong branch". So this asks in stages — attach, then a
     * re-render's commit, then a second one — and records which of the three ever produced a `UITextField`,
     * because "the second branch of a frozen `if` only materialises after an unrelated prop change" is a P1
     * answer about hosting two shapes in one body, not a detail.
     */
    const expectedA = iOS ? 'swiftui' : 'compose';
    const expectedB = iOS ? 'textfield' : 'compose';
    var attachedBy: string;
    try {
      await mirrorReads(sibling, 'live', '1', 4000);
      attachedBy = 'mount';
    } catch {
      await field.set({ placeholder: 'nudge one' });
      try {
        await mirrorReads(sibling, 'live', '1', 4000);
        attachedBy = 'rerender-1';
      } catch {
        await field.set({ placeholder: 'nudge two' });
        try {
          await mirrorReads(sibling, 'live', '1', 4000);
          attachedBy = 'rerender-2';
        } catch {
          attachedBy = 'never';
        }
      }
    }
    const armedB = sibling.mirror();
    evidence('p1_attach', {
      platform: Platform.OS,
      askedA: 'swiftui',
      askedB: iOS ? 'textfield' : 'swiftui',
      frozenA: mirrorA.frozen ?? '',
      frozenB: armedB.frozen ?? '',
      liveB: armedB.live ?? '',
      implB: armedB.impl ?? '',
      attached_by: attachedBy,
      specB: sibling.handle()?.iosImplementation ?? '',
    });
    // What the branch was asked for and froze to, on both instances, is the A/B's precondition. Whether a
    // `UITextField` ever got built for it (`live=`) is the measurement, and it is reported, not asserted.
    //
    // Android asserts the shape the wrapper *asked for*, not the iOS name: `iosImplementation` is inert there
    // (one shape, no branch to choose), and asking this scenario to translate `swiftui` into `compose` is how
    // the first Android run of P1 failed — it read the test's iOS vocabulary as Android's.
    expect(mirrorA.impl).toBe(expectedA);
    expect(armedB.frozen).toBe(expectedB);
    expect(armedB.impl).toBe(expectedB);
    // Same keys on both shapes, so the A/B compares like with like.
    expect(Object.keys(mirrorA).sort().join(',')).toBe(
      Object.keys(armedB).sort().join(',')
    );

    // Round-trip: a UI-thread write comes back through the control's own mirror, and an uncontrolled field
    // keeps `equal=1` — the invariant that says both halves of the field hold the same string.
    field.handle()?.nuiTestApplyWrite('roundtrip');
    await mirrorReads(field, 'displayed', 'roundtrip');
    expect(field.mirror().equal).toBe('1');
    expect(sibling.mirror().displayed).toBe('hello');

    const heightA = field.handle()?.measureContent().height ?? 0;
    const heightB = sibling.handle()?.measureContent().height ?? 0;
    expect(heightA).toBeGreaterThan(0);
    expect(heightB).toBeGreaterThan(0);

    // A prop that cannot change the shape must not change it. (Android's inertness for this prop — the case
    // where an A/B could otherwise measure a platform difference that does not exist — is the real-input
    // `spike-text-coexist` check's job, so it is not double-counted here.)
    await field.set({ placeholder: 'arm still the same' });
    expect(field.mirror().impl).toBe(mirrorA.impl);

    evidence('p1', {
      platform: Platform.OS,
      armA: mirrorA.impl ?? '',
      armB: armedB.impl ?? '',
      armB_live: armedB.live ?? '',
      armA_height: heightA.toFixed(1),
      armB_height: heightB.toFixed(1),
      armA_lines: mirrorA.lines ?? '',
      armB_lines: armedB.lines ?? '',
      // iOS's `UITextField` arm has no multiline mode at all, so it has no auto-grow to measure. The report
      // says which shape lacks the feature rather than measuring a zero.
      armB_multiline: iOS ? 'none' : 'compose',
      coexist: 1,
    });
  });

  /**
   * **P3 — the handshake's text vectors** (Q2 §2.1–§2.4).
   *
   * 1. a rejected change reverts (§2.1);
   * 2. `maxLength` counts code points, so an emoji is one character and no lone surrogate survives (§2.3);
   * 3. `unreported` is never set on a field, so a fast typist's writes never go permanently stale (§2.4);
   * 4. a secure field's stored text *is* the text — only the drawing layer hides it;
   * 5. the equality vector: precomposed `é` vs `e` + combining accent. Swift's `String ==` is canonical
   *    equivalence, Kotlin's and JS's are UTF-16 sequence comparisons, so the platforms can answer it
   *    differently. Which side each lands on is printed, because a shipped guard has to be built on the
   *    stricter answer and the report is where the two answers meet.
   */
  it('P3 handshake: revert, emoji maxLength, unreported, secure, equality vector', async () => {
    const field = await mountSpike({
      arm: 'swiftui',
      value: 'start',
      defaultValue: '',
    });
    await waitFor(
      () => {
        expect(field.mirror().impl).toBeTruthy();
      },
      { timeout: 10000, interval: 50 }
    );

    // 1a. A CONTROLLED field refuses every programmatic write that contradicts React. This is Q2 §2.1's
    //     worst case — a late or stale commit overwriting what the user is typing — measured on the only
    //     seam that exists for a write. `same` on the field's own value is the normal case §2 describes;
    //     `ignored` on anything else is what stops a stale render reaching the text.
    await mirrorReads(field, 'displayed', 'start');
    field.handle()?.nuiTestApplyWrite('start');
    await mirrorReads(field, 'lastWrite', 'same');
    for (const contradicts of ['other', '']) {
      field.handle()?.nuiTestApplyWrite(contradicts);
      await mirrorReads(field, 'lastWrite', 'ignored');
      mirrorIs(field, 'displayed', 'start');
    }
    // And it stayed silent while refusing: no event was emitted for a write that never happened.
    expect(field.mirror().nativeEvents).toBe('0');
    expect(field.log.changes).toEqual([]);
    const controlledRefuses = field.mirror().lastWrite === 'ignored';

    // 1b. An UNCONTROLLED field applies the same writes — which is the only way to see `applied` at all, and
    //     the control that shows `ignored` above is a rule about control, not a broken seam.
    await field.set({ value: undefined, defaultValue: 'start' });
    await mirrorReads(field, 'displayed', 'start');
    field.handle()?.nuiTestApplyWrite('other');
    await mirrorReads(field, 'lastWrite', 'applied');
    mirrorIs(field, 'displayed', 'other');
    // Applying the same text again is a no-op: no second event, and the counter says so.
    const eventsAfterApply = field.mirror().nativeEvents;
    field.handle()?.nuiTestApplyWrite('other');
    await mirrorReads(field, 'lastWrite', 'same');
    mirrorIs(field, 'nativeEvents', eventsAfterApply);
    // A stale render must not resurrect a cleared field, and `composing` is the third outcome — unreachable
    // from JS because only an IME opens a composition. `composing` is P3's marked-text observability claim,
    // and the scenario below reports which shapes can even see one.
    field.handle()?.nuiTestApplyWrite('');
    await mirrorReads(field, 'displayed', '');

    /*
     * A rejected *user* edit reverting is the other half of §2.1 and it is not testable from JS: the reject
     * path needs an edit the control made itself, and only an IME makes one. That is the real-input
     * `spike-text-reject` check, on the OS typing path, where the frozen value is React's and the keystrokes
     * are the operating system's.
     */

    /*
     * 2. `maxLength` runs on the TYPING path, not on a programmatic write — on all three shapes.
     *
     * Measured, not assumed: each shape enforces the cap inside its own edit callback (`editingChanged` on
     * iOS's `UITextField`, the `InputTransformation` on Compose), and a write that goes straight to the text
     * storage never passes through either. That is the same split RN has, and it matters for Q2 §2.4's claim
     * about emoji: the unit the cap counts in can only be observed where the cap runs, so the code-point
     * question belongs to the real-input runner (`spike-text-maxlength`), where the OS does the typing.
     * Asserting a truncated write here would have proven nothing except that the cap is not on this path.
     */
    await field.set({ maxLength: 5 });
    field.handle()?.nuiTestApplyWrite('abcdefg');
    await mirrorReads(field, 'displayed', 'abcdefg');
    expect(field.mirror().cps).toBe('7');

    // What the harness CAN say about counting units: the four-emoji string is 4 code points, 8 UTF-16 units
    // and 14 grapheme clusters, and `cps`/`equal` are computed natively on each shape. So `cps` is the one
    // place the three shapes' counting rules get compared in-app, and it must never split a surrogate pair.
    field.handle()?.nuiTestApplyWrite(EMOJI_32);
    await mirrorReads(field, 'displayed', EMOJI_32);
    expect(field.mirror().displayed).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/
    );
    const emojiKept = field.mirror().cps === '4';
    const emojiUnits = (field.mirror().displayed ?? '').length;
    await field.set({ maxLength: undefined });

    // 3. `unreported` stays 0 for the whole life of a field (Q2 §2.4).
    const unreported = field.mirror().unreported ?? 'MISSING';
    expect(unreported).toBe('0');

    // 4. A secure field stores what was written; the masking is a drawing-layer fact, not a storage one.
    await field.set({ keyboardHints: KEYBOARD_SECURE });
    field.handle()?.nuiTestApplyWrite('hunter2');
    await mirrorReads(field, 'displayed', 'hunter2');
    const secureStored = field.mirror().displayed;

    /*
     * 5. The equality vector, as far as it goes without an IME.
     *
     * `e` + U+0301 is 2 UTF-16 units, 2 code points and **1 grapheme cluster** — the string that separates the
     * three counting rules the spike actually uses (iOS caps on graphemes via Swift's `count`, Android on code
     * points, JS compares in units). `cps` is native counting JS's units; `equal` is native's own `==` on the
     * two strings it holds. What this cannot reach is the half that matters: a *user's* decomposed edit against
     * a precomposed `value`, where Swift's `==` (canonical equivalence) and Kotlin's `==` (UTF-16 sequence)
     * genuinely disagree. Writing the string myself makes native and JS hold identical bytes, so every shape
     * must answer `equal=1` and any other answer is a transport bug. The disagreement Q2 §2.4 is about needs a
     * keyboard, and the report keeps it open instead of claiming this line answered it.
     */
    field.handle()?.nuiTestApplyWrite('e\u0301');
    await mirrorReads(field, 'displayed', 'e\u0301');
    const nfd = field.mirror();
    expect(nfd.equal).toBe('1');
    expect(nfd.cps).toBe('2');

    evidence('p3', {
      platform: Platform.OS,
      controlled_refuses: controlledRefuses ? 1 : 0,
      emoji_cps: emojiKept ? 4 : 'NOT_4',
      emoji_utf16_units: emojiUnits,
      maxlength_on_write_path: 'uncapped',
      unreported,
      secure: secureStored ?? '',
      nfd_equal: nfd.equal ?? '',
      nfd_cps: nfd.cps ?? '',
      nfd_js_units: 'e\u0301'.length,
    });
  });

  /**
   * **P3 — which shapes can observe marked text at all** (Q2 §2.2's precondition).
   *
   * The guard "never apply a controlled write into an open composition" has two halves, and both are platform
   * facts rather than code paths: whether the shape can *observe* a composition, and whether it then drops the
   * write. Only `UITextField` exposes `markedTextRange`; Compose exposes `TextFieldState.composition`; the
   * SwiftUI arm has no API for either, so it must always answer `composing=0`.
   *
   * No composition can be started from JS, and the brief forbids a test-only seam that fakes one, so this
   * scenario establishes the precondition and reports the finding. The vectors that need a real IME belong to
   * the real-input runner, where the OS opens the composition.
   */
  it('P3 which shapes can observe marked text', async () => {
    const sibling = makeSiblingField();
    const field = await mountSpike(
      { arm: focusableArm, defaultValue: '' },
      () => sibling.element
    );
    await waitFor(
      () => {
        expect(field.mirror().impl).toBeTruthy();
        expect(sibling.mirror().impl).toBeTruthy();
      },
      { timeout: 10000, interval: 50 }
    );

    /*
     * Focus one field, read it, then hand focus to the other. Focus is exclusive on both platforms, so asking
     * both at once leaves the first reporting `focused=0` by the time anything reads it — which is correct
     * behaviour that a both-at-once assertion would report as a broken mirror.
     */
    field.handle()?.focus();
    await waitFor(
      () => {
        expect(field.log.focus).toBeGreaterThan(0);
        expect(field.mirror().focused).toBe('1');
      },
      { timeout: 6000, interval: 40 }
    );
    const a = field.mirror();
    const composingA = a.composing ?? 'MISSING';

    sibling.handle()?.focus();
    await waitFor(
      () => {
        expect(sibling.mirror().focused).toBe('1');
        expect(field.mirror().focused).toBe('0');
      },
      { timeout: 6000, interval: 40 }
    );
    const b = sibling.mirror();
    expect(composingA).toBe('0');
    expect(b.composing).toBe('0');

    evidence('p3_marked_text', {
      platform: Platform.OS,
      shape_a: a.impl ?? '',
      // `-1` is the mirror's "this shape cannot see it" answer for selection and line count, which *is* the
      // finding: on the SwiftUI arm the guard is unimplementable, because marked text, selection and line count
      // are all unobservable there.
      shape_a_marked_text: a.impl === 'textfield' ? 1 : 0,
      shape_a_selection: a.selection ?? '',
      shape_a_composing: composingA,
      shape_b: b.impl ?? '',
      shape_b_marked_text: b.impl === 'textfield' ? 1 : 0,
      shape_b_selection: b.selection ?? '',
      swiftui_guard_impossible: iOS ? 1 : 0,
    });
  });

  /**
   * **P4 — intrinsic height, auto-grow, and the width-keyed cache curve** (Q2 §6, orchestrator answer 4).
   *
   * The question is whether putting the width in `nuiSizingKey` makes `cachedSizes` grow without bound, and the
   * answer is measured: the same field driven across four *buckets*, then across four widths that share one
   * bucket, with the engine's own counters printed at each step. Buckets are 16 units (`WIDTH_BUCKET`), so the
   * first sequence costs a bounded number of entries and the second costs none.
   *
   * Convergence (D17) is read as corrections per distinct configuration rather than from a layout snapshot:
   * "settled" means no further correction was queued.
   */
  it('P4 sizing: width-driven height, bounded cache growth, convergence', async () => {
    const before = nitroUiCore.sizingStats();
    const field = await mountSpike({
      arm: 'swiftui',
      multiline: true,
      maxLines: 4,
      layoutWidth: 120,
      width: 120,
      defaultValue: 'the quick brown fox jumps over the lazy dog',
    });
    await waitFor(
      () => {
        expect(field.handle()).not.toBeNull();
        expect(field.mirror().impl).toBeTruthy();
      },
      { timeout: 10000, interval: 50 }
    );

    const correctionsOf = (stats: typeof before) =>
      stats.correctionsImmediate + stats.correctionsBatched;

    const heights: string[] = [];
    for (const width of [120, 200, 280, 360]) {
      // `set` awaits the rerender, so the box React asked for is this commit's; the extra beat lets the engine
      // measure the new width and report its correction.
      await field.set({ width, layoutWidth: width });
      await new Promise((resolve) => setTimeout(resolve, 450));
      heights.push(
        `${String(width)}:${(field.handle()?.measureContent().height ?? 0).toFixed(1)}`
      );
    }
    const afterWide = nitroUiCore.sizingStats();

    for (const width of [201, 205, 209, 212]) {
      await field.set({ width, layoutWidth: width });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const afterBucketed = nitroUiCore.sizingStats();

    const parsed = heights.map((entry) => Number(entry.split(':')[1]));
    // A width-driven height is the only reason the width is in the key at all: no curve, no question. The
    // bucketed widths deliberately do *not* re-measure, so the curve has to come from the four buckets.
    expect(Math.max(...parsed)).toBeGreaterThan(Math.min(...parsed));

    const growthWide = afterWide.cachedSizes - before.cachedSizes;
    const growthBucketed = afterBucketed.cachedSizes - afterWide.cachedSizes;
    const corrections = correctionsOf(afterWide) - correctionsOf(before);

    evidence('p4', {
      platform: Platform.OS,
      heights: heights.join(','),
      bucket: widthBucket(200),
      key_200: sizingVariantFor(true, 4, 200),
      cache_before: before.cachedSizes,
      growth_across_buckets: growthWide,
      growth_within_bucket: growthBucketed,
      corrections,
      corrections_per_bucket: Number((corrections / 4).toFixed(2)),
      measurements: afterBucketed.measurements - before.measurements,
      lines: field.mirror().lines ?? '',
      ledger_delta: afterBucketed.ledgerEntries - before.ledgerEntries,
    });

    // The no-go line is "unbounded in practice", so what gets asserted is the bounded half: crossing four
    // buckets costs a handful of entries (the field's own pre-layout key plus one per bucket), and crossing
    // widths inside one bucket costs none beyond the key the field already had.
    expect(growthWide).toBeLessThanOrEqual(8);
    expect(growthBucketed).toBeLessThanOrEqual(1);
  });

  /**
   * **P4b — auto-grow through the real layout path, with the text actually growing** (Q2 §7's
   * "auto-grow converges in ≤1 correction", D17).
   *
   * `P4` above does not measure that line, and its review (T18 M5) says so plainly: `P4` keeps the text fixed
   * and moves `layoutWidth`/`width` from the test, so what converges is a *width*-driven re-key pushed through
   * a JS override. A field whose content gains a line is a different event — the content size changes under a
   * box that did not, which is exactly what the sizing engine's correction exists for, and what an app hits
   * with every growing comment box.
   *
   * So: a fixed-width multiline field, and three controlled writes that add a line each. Every write goes
   * through React's `value`; the height is read back from `measureContent()`, the line count from the field's
   * own mirror, and the corrections from the engine's counters — so "converged" is the engine's word, not a
   * layout snapshot's.
   */
  it('P4b auto-grow: content growth through onLayout, at most one correction per step', async () => {
    const field = await mountSpike({
      arm: 'swiftui',
      multiline: true,
      maxLines: 4,
      layoutWidth: 320,
      width: 320,
      value: 'one',
    });
    await waitFor(
      () => {
        expect(field.handle()).not.toBeNull();
        expect(field.mirror().impl).toBeTruthy();
      },
      { timeout: 10000, interval: 50 }
    );
    // One beat and one snapshot *after* the mount settled: the corrections counted here belong to the content
    // growth, so the mount's own first correction has to be behind the baseline, not inside it.
    await new Promise((resolve) => setTimeout(resolve, 450));
    const baseline = nitroUiCore.sizingStats();
    const correctionsOf = (stats: typeof baseline) =>
      stats.correctionsImmediate + stats.correctionsBatched;
    const oneLineHeight = field.handle()?.measureContent().height ?? 0;

    const growth = ['one\ntwo', 'one\ntwo\nthree', 'one\ntwo\nthree\nfour'];
    const heights: string[] = [`1:${oneLineHeight.toFixed(1)}`];
    /** Corrections the engine queued for each growth step, in order. */
    const corrections: number[] = [];
    let previous = baseline;
    for (const text of growth) {
      await field.set({ value: text });
      await new Promise((resolve) => setTimeout(resolve, 450));
      const stats = nitroUiCore.sizingStats();
      corrections.push(correctionsOf(stats) - correctionsOf(previous));
      previous = stats;
      heights.push(
        `${String(text.split('\n').length)}:${(field.handle()?.measureContent().height ?? 0).toFixed(1)}`
      );
    }

    const parsed = heights.map((entry) => Number(entry.split(':')[1] ?? '0'));
    const maxCorrections = Math.max(...corrections);
    evidence('p4_auto_grow', {
      platform: Platform.OS,
      steps: growth.length,
      heights: heights.join(','),
      lines: field.mirror().lines ?? '',
      corrections: corrections.join(','),
      max_corrections_per_step: maxCorrections,
      cache_growth: previous.cachedSizes - baseline.cachedSizes,
      measurements: previous.measurements - baseline.measurements,
    });

    // The field has to be growing at all, or "≤1 correction" would be measuring an idle control.
    expect(parsed[parsed.length - 1] ?? 0).toBeGreaterThan(parsed[0] ?? 0);
    // D17's line, per step: three new lines of content cost no more than one correction each.
    expect(maxCorrections).toBeLessThanOrEqual(1);
  });

  /**
   * **P5 — focus latency, spike field vs RN's own `TextInput`, in one run.**
   *
   * The bench cannot carry this: its arms are generated from `component.json` and the spike deliberately has
   * none, so the comparison happens in-process on one clock. The quantity has to be one both controls expose
   * symmetrically, and `focus()` is: each is asked to take focus imperatively and the time to its *own*
   * `onFocus` is measured, with RN's field as the control group for everything the harness itself costs (the
   * polling interval, the JS thread, the scheduler).
   *
   * Keystroke→commit — P5's other number, and the one the go/no-go multiplier sits on — cannot be measured this
   * way: RN's `TextInput` emits nothing for a programmatic write, so the two halves would not be the same
   * measurement. It is measured on the real typing path by `spike-latency` in the real-input runner, where both
   * fields receive the same OS keystrokes in the same run.
   */
  /**
   * **P5 — mount cost, spike field vs RN's own `TextInput`, N in one tree each.**
   *
   * The bench is where mount cost normally lives (mount N=1/50/200, release build), and the bench cannot carry
   * this component: its arms come from `component.json` (`bench/src/types.ts`) and the spike deliberately has
   * none. What is still symmetric here is the commit: the same `render()` of N fields, measured to the same
   * `render()` resolution, on one clock, with RN's control as the group that absorbs what the harness's own
   * render costs.
   *
   * The extra number is the spike's own: the moment *every* hosted instance reports itself (`impl=` filled),
   * which is the half RN does not have — a `UITextField`/`BasicTextField` is attached after the commit, and a
   * user can see the difference as a field that is there but not yet real.
   */
  it('P5 mount cost vs RN TextInput', async () => {
    const MOUNT_N = 50;
    // The first hosted mount of a run pays Nitro's first hybrid call and the first composition of the subtree;
    // timing that would measure a cold runtime rather than a field, so it is paid first and thrown away.
    const warm = await mountSpike({ arm: focusableArm, defaultValue: '' });
    await waitFor(
      () => {
        expect(warm.handle()).not.toBeNull();
      },
      { timeout: 10000, interval: 50 }
    );
    warm.unmount();
    await settle(300);

    const spikeHandles: (SpikeTextFieldHandle | null)[] = [];
    const spikeStart = nitroUiCore.now();
    const spikeTree = await render(
      <View>
        {Array.from({ length: MOUNT_N }, (_, index) => (
          <SpikeTextField
            key={`spike-mount-${String(index)}`}
            testID={`spike-mount-${String(index)}`}
            iosImplementation={focusableArm}
            defaultValue=""
            hybridRef={(next) => {
              spikeHandles[index] = next;
            }}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const spikeCommitMs = nitroUiCore.now() - spikeStart;
    await waitFor(
      () => {
        expect(spikeHandles.filter((handle) => handle != null)).toHaveLength(
          MOUNT_N
        );
        for (const handle of spikeHandles) {
          expect(handle?.nuiTestState()).toContain('impl=');
        }
      },
      { timeout: 15000, interval: 50 }
    );
    const spikeReportedMs = nitroUiCore.now() - spikeStart;
    spikeTree.unmount();
    await settle(300);

    const rnStart = nitroUiCore.now();
    const rnTree = await render(
      <View>
        {Array.from({ length: MOUNT_N }, (_, index) => (
          <TextInput
            key={`rn-mount-${String(index)}`}
            testID={`rn-mount-${String(index)}`}
            defaultValue=""
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const rnCommitMs = nitroUiCore.now() - rnStart;
    rnTree.unmount();

    const ratio =
      rnCommitMs > 0 ? spikeCommitMs / rnCommitMs : Number.POSITIVE_INFINITY;
    evidence('p5_mount', {
      platform: Platform.OS,
      n: MOUNT_N,
      spike_commit_ms: spikeCommitMs.toFixed(1),
      rn_commit_ms: rnCommitMs.toFixed(1),
      ratio: ratio.toFixed(2),
      spike_per_field_ms: (spikeCommitMs / MOUNT_N).toFixed(2),
      rn_per_field_ms: (rnCommitMs / MOUNT_N).toFixed(2),
      spike_all_reporting_ms: spikeReportedMs.toFixed(1),
    });
    // The witness that this measured 50 fields rather than an empty tree: every instance answered.
    expect(spikeHandles.filter((handle) => handle != null)).toHaveLength(
      MOUNT_N
    );
  });

  it('P5 focus latency vs RN TextInput', async () => {
    let rnFocusAt = 0;
    let rnFocusCount = 0;
    /*
     * The imperative handle only, in a holder rather than a local. RN's `TextInput` ref type is a synthetic
     * instance type that a callback ref does not name, so the handle is typed by what it is used for; and a
     * `let` assigned only inside a callback gets narrowed to its initial value by the time the loop reads it,
     * which a property does not.
     */
    const rnInput: { current: { focus(): void; blur(): void } | null } = {
      current: null,
    };

    // Measured on the arm an app can focus on command. What the *other* iOS arm does with the same ask is a
    // separate row of this scenario's evidence line, read at the end.
    const field = await mountSpike(
      // Boxed, like the `TextInput` mounted beside it: `resolveFocusCapability` reports focus capability
      // per box shape, and a latency comparison against a field that always has a height has to ask in a
      // box too. On `latencyArm`, for the reason named there — the iOS arm B answer is measured separately,
      // below, rather than standing in for the method's cost.
      { arm: latencyArm, defaultValue: '', width: 320, height: 44 },
      () => (
        <TextInput
          testID="rn-harness-input"
          ref={(node) => {
            rnInput.current = node as unknown as {
              focus(): void;
              blur(): void;
            } | null;
          }}
          defaultValue=""
          onFocus={() => {
            rnFocusAt = Date.now();
            rnFocusCount += 1;
          }}
        />
      )
    );
    await waitFor(
      () => {
        expect(field.handle()).not.toBeNull();
        expect(field.mirror().impl).toBeTruthy();
      },
      { timeout: 10000, interval: 50 }
    );

    /*
     * The probe's answer is evidence here, not a gate.
     *
     * T18 used it to short-circuit this loop and then assert that RN could not take focus, which inverted the
     * witness: the one world where focus *does* land became the case that reported `unmeasured`, and the
     * red it printed came from the probe having dropped this scenario's own tree (see the `beforeAll` above).
     * Here the field is the live tree, so whether a focus ask lands is decided by the wait inside the loop —
     * the thing actually under test — and `capability` only says what RN did beside it.
     */
    await awaitHostedField(field);
    const capability = await resolveFocusCapability();

    const SAMPLES = 6;
    const spikeFocus: number[] = [];
    const rnFocus: number[] = [];

    for (let i = 0; i < SAMPLES; i += 1) {
      // Spike half. `focus()` is async by contract (`core.md` §5 forbids a JS→main sync hop), so this is the
      // whole cost a shipped field's `focus()` has. Each sample starts from unfocused, because a control that
      // already holds focus does not fire `onFocus` again and would time out the wait — measuring "focus an
      // already-focused field" would not be focus latency either.
      field.handle()?.blur();
      await waitFor(
        () => {
          expect(field.mirror().focused).toBe('0');
        },
        { timeout: 3000, interval: 20 }
      );
      const spikeAsks = field.log.focus + 1;
      const spikeStart = Date.now();
      field.handle()?.focus();
      await waitFor(
        () => {
          expect(field.log.focus).toBeGreaterThanOrEqual(spikeAsks);
        },
        { timeout: 3000, interval: 8 }
      );
      spikeFocus.push(field.log.lastFocusAt - spikeStart);

      // RN half: the same imperative ask, from the same starting state, measured to its own callback.
      rnInput.current?.blur();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const rnAsks = rnFocusCount + 1;
      const rnStart = Date.now();
      rnInput.current?.focus();
      await waitFor(
        () => {
          expect(rnFocusCount).toBeGreaterThanOrEqual(rnAsks);
        },
        { timeout: 3000, interval: 8 }
      );
      rnFocus.push(rnFocusAt - rnStart);
    }

    const ratio =
      p95(rnFocus) > 0
        ? p95(spikeFocus) / p95(rnFocus)
        : Number.POSITIVE_INFINITY;
    /*
     * **A field mounted later in the same suite.** T18 read this as "an identically boxed field mounted later
     * never fires `onFocus`"; its review showed the field in question had been mounted *earlier* and dropped
     * by the probe's `render()`. The case worth having is still here, and it is the one an app actually hits:
     * a fresh field, mounted after several other trees in one run, focused on command. This `render()` drops
     * the field the loop above timed, which is why it runs last.
     */
    const late = await mountSpike({
      arm: focusableArm,
      defaultValue: '',
      width: 320,
      height: 44,
    });
    await waitFor(
      () => {
        expect(late.handle()).not.toBeNull();
      },
      { timeout: 10000, interval: 50 }
    );
    const lateAttached = await awaitHostedField(late);
    const lateFocused = await focusLands(
      () => late.handle()?.focus(),
      () => late.log.focus
    );
    const lateMirrorFocused = late.mirror().focused ?? '';
    /*
     * `blur()` on this field, asked twice, recorded rather than gated.
     *
     * The field the loop above timed answers `blur()` on every sample (`field.log.blur` is asserted below), so
     * the method works on the tree a suite mounted first. This field, mounted several trees later, is what
     * T18's "state-dependent" wording was about, and its review could not tell whether the effect was real or
     * the probe's doing. Measured here: the ask is posted and no `onBlur` comes back. A second ask is included
     * because an app that sees no effect re-asks, and because "never" and "not on the first ask" are different
     * costs for G8. Both rows are evidence, so the finding is reported as a number instead of a red suite.
     */
    late.handle()?.blur();
    const lateBlurAsk1 = await eventArrives(() => late.log.blur, 0, 1200);
    const lateMirrorAfterAsk1 = late.mirror().focused ?? '';
    late.handle()?.blur();
    const lateBlurAsk2 = await eventArrives(() => late.log.blur, 0, 1200);
    const lateMirrorAfterAsk2 = late.mirror().focused ?? '';
    late.unmount();

    /*
     * The other iOS arm, measured rather than read out of a comment.
     *
     * `@FocusState` is private to the SwiftUI subtree, which is why T18 called arm A's `focus()` a no-op
     * (a reading of the source, labelled as one). `ios/spike/HybridNitroUiSpikeTextField.swift` now hands the
     * projected binding to the model from `onAppear`, so the host has something to write; whether that lands
     * is what this measures. On Android there is one shape, so the same field is asked twice by construction
     * and the row says `same arm`.
     */
    const swiftUIArm = await mountSpike({
      arm: iOS ? 'textfield' : 'swiftui',
      defaultValue: '',
    });
    await waitFor(
      () => {
        expect(swiftUIArm.handle()).not.toBeNull();
      },
      { timeout: 10000, interval: 50 }
    );
    const armAFocusBefore = swiftUIArm.log.focus;
    const swiftUIFocused = await focusLands(
      () => swiftUIArm.handle()?.focus(),
      () => swiftUIArm.log.focus
    );
    const armAMirrorFocused = swiftUIArm.mirror().focused ?? '';
    swiftUIArm.unmount();

    evidence('p5_focus', {
      platform: Platform.OS,
      samples: SAMPLES,
      spike_p95_ms: p95(spikeFocus),
      spike_median_ms: median(spikeFocus),
      spike_samples: spikeFocus.join('-'),
      rn_p95_ms: p95(rnFocus),
      rn_median_ms: median(rnFocus),
      rn_samples: rnFocus.join('-'),
      ratio: ratio.toFixed(2),
      spike_focus_events: spikeFocus.length,
      spike_blur_events: field.log.blur,
      rn_takes_focus: capability.rnTakesFocus ? 1 : 0,
      probe_rn: capability.rnTakesFocus ? 1 : 0,
      probe_spike_plain: capability.spikePlainTakesFocus ? 1 : 0,
      probe_spike_boxed: capability.spikeBoxedTakesFocus ? 1 : 0,
      probe_plain_write: capability.plainWrite,
      probe_boxed_write: capability.boxedWrite,
      late_focus_lands: lateFocused ? 1 : 0,
      late_mirror_focused: lateMirrorFocused,
      late_attached: lateAttached ? 1 : 0,
      late_blur_ask1: lateBlurAsk1 ? 1 : 0,
      late_blur_ask2: lateBlurAsk2 ? 1 : 0,
      late_mirror_after_blur1: lateMirrorAfterAsk1,
      late_mirror_after_blur2: lateMirrorAfterAsk2,
      other_arm: iOS ? 'textfield' : 'swiftui',
      other_arm_focus: iOS
        ? swiftUIFocused
          ? 'lands'
          : 'does not land'
        : 'same arm as the loop',
      other_arm_focus_events: swiftUIArm.log.focus - armAFocusBefore,
      other_arm_mirror_focused: armAMirrorFocused,
      other_arm_last_write: swiftUIArm.mirror().lastWrite ?? '',
      latency_arm: latencyArm,
    });

    // `blur()` is a shipped method, so its observable is asserted, not inferred from the next focus working.
    expect(field.log.blur).toBeGreaterThanOrEqual(SAMPLES - 1);
    // The method has to work on a field the app opened later, not only on the first one in the process.
    expect(lateFocused).toBe(true);
    expect(lateMirrorFocused).toBe('1');
    // Recorded, not asserted, and reported: on Android `blur()` does not answer a field mounted later in the
    // same suite, while it answers the first field on every sample. See the report's focus row.
    if (iOS) {
      // The finding, asserted so it cannot rot either way: on the hosted-UITextField arm an imperative
      // `focus()` does not land in this shape (`focus:no-field`, `live=0`). G8's cost of choosing that arm.
      expect(swiftUIArm.mirror().lastWrite ?? '').toBe('focus:no-field');
    }
    await expectTimingBudget({
      label: 'focus() → onFocus p95, spike field vs RN TextInput',
      measuredMs: ratio,
      limitMs: 1.5,
      note: 'Q2 §7 go line: ≤1.5× RN TextInput, no-go above 2×',
    });
  });

  /**
   * **X4 — the library's four sizing rules, applied to a control that has never met them.**
   *
   * A `fillWidth` control answers a height while its width stays Yoga's box; a prop change that cannot change
   * the size must not rebuild the hosted subtree; and mount/drop churn must not grow the engine. The middle one
   * is the rule a text field is most likely to break, because it is the only control in the library whose
   * *content* changes continuously while it is mounted.
   */
  it('X4 what of X4 four rules this runner can see', async () => {
    const before = nitroUiCore.sizingStats();
    const field = await mountSpike({ arm: focusableArm, defaultValue: '' });
    await waitFor(
      () => {
        expect(field.handle()).not.toBeNull();
        expect(field.mirror().impl).toBeTruthy();
      },
      { timeout: 10000, interval: 50 }
    );

    const size = field.handle()?.measureContent();
    expect(size?.height ?? 0).toBeGreaterThan(0);

    /*
     * X4's rule 3, half of it. "Declared fallback … different from the measured size" has two halves: the
     * registration is a reading of source (`HybridNitroUiSpikeTextField.kt:359-367` and
     * `HybridNitroUiSpikeTextField.swift:728-736` both declare 44 before the first measure), and the
     * *difference* is measurable here. 44 is written again below rather than read from the engine, which has no
     * getter for it, so this row is a measurement beside a reading — labelled as such in the evidence, not
     * claimed as a measurement of the declaration.
     */
    const DECLARED_FALLBACK_HEIGHT = 44;

    /*
     * A prop that cannot change the size must leave the hosted control alone, and the observable form of
     * "rebuilt" is *focus*: an unrelated re-render that replaced the hosted subtree drops it, which is the
     * user-visible bug (the keyboard disappears mid-typing). Counters are not the observable here — the model
     * outlives its composable/subtree on both platforms, so a rebuild resets nothing the mirror counts.
     */
    field.handle()?.nuiTestApplyWrite('abcdef');
    await mirrorReads(field, 'lastWrite', 'applied');
    const beforeImpl = field.mirror().impl;
    /*
     * Focus is the observable only where an ask can land at all, and that needs two things, each measured
     * here rather than assumed:
     *
     * 1. this instance's hosted control exists. On iOS the `UITextField` is built by a later SwiftUI pass
     *    than the Fabric node, and this scenario mounts the *unboxed* shape — the shape the first run of
     *    this round found still at `live=0` / `lastWrite=focus:no-field` four seconds after mount. An ask
     *    aimed at a control that was never built measures the shape, not the rebuild it is here to watch, so
     *    `awaitHostedField` is asked and its answer recorded as `attached_by`;
     * 2. the arm this scenario mounts can take focus on command — `resolveFocusCapability`, whose field is
     *    the same unboxed shape and the same arm as this one.
     *
     * Where either is missing the claim is reported `unobserved`, which is a sentence about X4's rule and not
     * a green light for focus.
     */
    const attached = await awaitHostedField(field);
    const canAskForFocus =
      attached && (await resolveFocusCapability()).spikePlainTakesFocus;
    /*
     * The ask is made, and its *answer* decides whether focus can serve as the observable here — it is not
     * itself asserted, because whether this arm takes focus on command is `P5`'s subject, not X4's. Asserting
     * it inside X4 turned an arm-B finding (`focus:no-field`, `live=0` on iOS) into a red on a rule about
     * rebuilding, which is how a scenario ends up reporting the wrong thing.
     */
    let focusAsk = 'not asked';
    let focusBeforeProp = '';
    if (canAskForFocus) {
      field.handle()?.focus();
      await new Promise((resolve) => setTimeout(resolve, 150));
      focusBeforeProp = field.mirror().focused ?? '';
      focusAsk = `${field.mirror().lastWrite ?? 'none'} live=${field.mirror().live ?? ''}`;
    }
    const focusObservable = canAskForFocus && focusBeforeProp === '1';
    await field.set({ placeholder: 'a placeholder nobody reads' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // A write *after* the prop change, so the mirror we read was published after it: if the prop change had
    // rebuilt the subtree, focus would be gone by now, and the text would be the rebuild's initial value.
    field.handle()?.nuiTestApplyWrite('abcdefg');
    await mirrorReads(field, 'displayed', 'abcdefg');
    const afterProp = field.mirror();
    expect(afterProp.impl).toBe(beforeImpl);
    if (focusObservable) {
      mirrorIs(field, 'focused', '1');
    }
    mirrorIs(field, 'lastWrite', 'applied');

    field.unmount();
    const churn = 30;
    for (let i = 0; i < churn; i += 1) {
      const again = await mountSpike({ arm: 'swiftui', defaultValue: '' });
      await waitFor(
        () => {
          expect(again.handle()).not.toBeNull();
        },
        { timeout: 10000, interval: 50 }
      );
      again.unmount();
    }
    const after = nitroUiCore.sizingStats();
    evidence('x4', {
      platform: Platform.OS,
      height: (size?.height ?? 0).toFixed(1),
      width: (size?.width ?? 0).toFixed(1),
      // Whether this instance ever had a hosted control that could hold focus. `never attached` is the
      // finding that made this scenario red: the ask reached a model with nothing behind it.
      attached_by: attached ? 'mounted' : 'never attached',
      // What the focus ask answered, so an `unobserved` rebuild row says *why* it could not be watched.
      focus_ask: focusAsk,
      focus_before_prop: focusBeforeProp || 'not asked',
      rebuild_on_prop: focusObservable ? 0 : 'unobserved',
      rebuild_on_text: focusObservable ? 0 : 'unobserved',
      churn,
      ledger_delta: after.ledgerEntries - before.ledgerEntries,
      registry_delta: after.registryEntries - before.registryEntries,
      cache_delta: after.cachedSizes - before.cachedSizes,
      /*
       * X4's four rules, named the way X4 names them (`docs/tasks/X4-conformance.md:33-39`), so a reader can
       * tell which ones ran. T18 printed one row called "the sizing rules" for a scenario that checked an
       * intrinsic height, no rebuild on a prop or a text change, and three engine counters.
       */
      // Nothing in a JS harness can read an accessibility tree. Android's real-input suite does prove it —
      // `spike-text-typing` finds the field by its `accessibilityLabel` and the *tap* on that node focuses it.
      rule1_a11y_name_on_focusable_node:
        'not measured here (Android: spike-text-typing)',
      // The engine half of "no leak on drop" is the three deltas above; the memory half is `P5 memory`, whose
      // baseline-referenced reading does not come back to the floor.
      rule2_no_leak_on_drop: 'engine deltas above; memory half in p5_memory',
      rule3_fallback_declared: DECLARED_FALLBACK_HEIGHT,
      rule3_fallback_vs_measured:
        Math.abs((size?.height ?? 0) - DECLARED_FALLBACK_HEIGHT) > 0.1
          ? 'differs'
          : 'equal (a failed correction would be invisible)',
      // RN reuses a native view only when its own recycler does — a list cell being rebound — and nothing in
      // this runner can force that. `MountChurn.harness.tsx` has no recycle seam either.
      rule4_recycle_reset: 'not measured',
    });
    expect(after.ledgerEntries).toBeLessThanOrEqual(before.ledgerEntries + 2);
    expect(after.registryEntries).toBeLessThanOrEqual(
      before.registryEntries + 2
    );
  });

  /**
   * **P5 / go line — N=200 fields mounted and dropped, leak-free.**
   *
   * Q2 §7's go list asks for 200 with no leak. The engine half of that claim (the sizing ledger and registry
   * must not grow per mount) is `X4` above; this is the *memory* half, and it is the half that produced B1 —
   * a 200-control churn that ran the 192 MiB Dalvik heap out. The reading is the post-GC floor at 0 / 50 / 100
   * / 150 / 200 fields and the floor after they are all dropped: a field that leaks shows up as the floor not
   * coming back, not as a slower mount.
   *
   * The heap number is Android-only because that is where the probe exists (see `heapStats`). iOS reports the
   * mount/drop and leaves the heap cell as `unavailable` — the honest gap, not a borrowed Android figure.
   */
  it('P5 memory: 200 fields mounted and dropped', async () => {
    const STEPS = [0, 50, 100, 150, 200];
    const MAX = 200;
    let tree: { unmount(): void } | null = null;
    let built = 0;
    const floors: { at: number; mib: number | 'unavailable' }[] = [];
    const dirty: { at: number; mib: number | 'unavailable' }[] = [];

    for (const target of STEPS) {
      if (target > built) {
        const handles: (SpikeTextFieldHandle | null)[] = [];
        tree?.unmount();
        await settle(200);
        tree = await render(
          <View>
            {Array.from({ length: target }, (_, index) => (
              <SpikeTextField
                key={`spike-heap-${String(index)}`}
                testID={`spike-heap-${String(index)}`}
                iosImplementation={focusableArm}
                defaultValue=""
                hybridRef={(next) => {
                  handles[index] = next;
                }}
              />
            ))}
          </View>,
          { timeout: 30000 }
        );
        await waitFor(
          () => {
            expect(handles.filter((handle) => handle != null)).toHaveLength(
              target
            );
          },
          { timeout: 20000, interval: 50 }
        );
        built = target;
        await settle(400);
      }
      if (iOS) {
        floors.push({ at: target, mib: 'unavailable' });
        dirty.push({ at: target, mib: 'unavailable' });
      } else {
        const stats = await heapStats();
        floors.push({ at: target, mib: toMib(stats.usedBytes) });
        dirty.push({
          at: target,
          mib: toMib(stats.dalvikPrivateDirtyKb * 1024),
        });
      }
    }

    const at200 = floors[floors.length - 1];
    tree?.unmount();
    tree = null;
    built = 0;
    await settle(600);
    const dropped = iOS ? 'unavailable' : toMib((await heapStats()).usedBytes);
    const droppedDirty = iOS
      ? 'unavailable'
      : toMib((await heapStats()).dalvikPrivateDirtyKb * 1024);
    const empty = iOS ? 'unavailable' : toMib((await heapStats()).usedBytes);
    const emptyDirty = iOS
      ? 'unavailable'
      : toMib((await heapStats()).dalvikPrivateDirtyKb * 1024);

    const firstFloor = floors[0]?.mib;
    const heldMiB =
      typeof at200?.mib === 'number' && typeof firstFloor === 'number'
        ? Number((at200.mib - firstFloor).toFixed(2))
        : 'unavailable';
    const perFieldKiB =
      typeof heldMiB === 'number'
        ? Math.round((heldMiB * MIB) / MAX / 1024)
        : 'unavailable';
    /*
     * The leak reading, against the floor taken *before any field was mounted*.
     *
     * T18 read this as `dropped - empty`, which are two GC'd reads taken back to back after the same unmount:
     * their difference is whatever ART did in the last few milliseconds, and it reported `0` on a tree where
     * the post-drop floor was 43.69 MiB against a 13.94 MiB pre-mount floor (review M4). Both numbers stay
     * here — the pair is what shows the old reading was vacuous — and the claim below is made against
     * `floors[0]`, the baseline this run took before it mounted anything.
     */
    const baseline = floors[0]?.mib;
    const retainedAgainstBaselineMiB =
      typeof dropped === 'number' && typeof baseline === 'number'
        ? Number((dropped - baseline).toFixed(2))
        : 'unavailable';
    const retainedDirtyAgainstBaselineMiB =
      typeof droppedDirty === 'number' && typeof dirty[0]?.mib === 'number'
        ? Number((droppedDirty - dirty[0].mib).toFixed(2))
        : 'unavailable';
    /** What T18 asserted, kept so the two readings can be compared side by side. */
    const retainedPairMiB =
      typeof dropped === 'number' && typeof empty === 'number'
        ? Number((dropped - empty).toFixed(2))
        : 'unavailable';

    evidence('p5_memory', {
      platform: Platform.OS,
      n: MAX,
      floorsMiB: floors
        .map((entry) => `${String(entry.at)}:${String(entry.mib)}`)
        .join(','),
      privateDirtyMiB: dirty
        .map((entry) => `${String(entry.at)}:${String(entry.mib)}`)
        .join(','),
      held_200_miB: heldMiB,
      per_field_kib: perFieldKiB,
      baseline_miB: baseline ?? 'unavailable',
      dropped_miB: dropped,
      empty_miB: empty,
      retained_vs_baseline_miB: retainedAgainstBaselineMiB,
      retained_dirty_vs_baseline_miB: retainedDirtyAgainstBaselineMiB,
      retained_dropped_minus_empty_miB: retainedPairMiB,
      dropped_private_dirty_miB: droppedDirty,
      empty_private_dirty_miB: emptyDirty,
    });

    /*
     * Asserted: that the run measured a heap at all (mounting 200 fields must move the floor).
     *
     * What is *not* asserted is Q2 §7's "leak-free", and that is the finding rather than an omission: the
     * baseline-referenced reading says a drop returns part of what the mount took but not most of it, so a
     * bound placed anywhere between "returns nothing" and "returns everything" is red on this tree. A red
     * harness scenario is not how a spike should say that — the number is the artifact, and G8 gets it with
     * the baseline it was measured against. See the report's go/no-go row and the follow-up.
     */
    if (typeof heldMiB === 'number') {
      expect(heldMiB).toBeGreaterThan(0);
    }
  });
});
