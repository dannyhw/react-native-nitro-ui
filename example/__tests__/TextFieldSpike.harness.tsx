/**
 * On-device spike tests for the TextField prototypes (task T18, `docs/tasks/Q2-textfield-research.md` §7).
 *
 * These are **evidence, not a component's test suite**: the spike exports nothing and has no `component.json`,
 * so nothing here can quietly become a shipped contract. What they do is run P1, P3, P4 and the X4 rules
 * against the real hosting path — `NitroSwiftUIHost`, `NitroComposeHost`, a hosted `UITextField` — and print
 * the numbers the go/no-go table is built from.
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
 * `@FocusState` is private to the SwiftUI subtree, so on iOS the SwiftUI arm has no imperative focus path at
 * all — `focus()` is a no-op there and the scenario below asserts that rather than waiting for an event that
 * never comes. Android's one shape takes focus through `FocusRequester`, so the distinction is iOS-only, and
 * it is a G8 cost of choosing the SwiftUI shape: an app cannot focus a field from a method.
 */
const focusableArm: 'swiftui' | 'textfield' = iOS ? 'textfield' : 'swiftui';

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
        style={props.width == null ? undefined : { width: props.width }}
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

describe('T18 spike — TextField', () => {
  afterEach(cleanup);

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

    // Focus latency is only measurable on the arm that can take focus on command; the finding that the other
    // arm cannot is `spike_focus_swiftui_noop` below.
    const field = await mountSpike(
      { arm: focusableArm, defaultValue: '' },
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
    // The other arm, measured rather than asserted from a comment: on iOS, focusing the SwiftUI shape is a
    // no-op, so a shipped `focus()` would silently do nothing for half the library's fields.
    const swiftUIArmNoop = await mountSpike({
      arm: 'swiftui',
      defaultValue: '',
    });
    const noopFocusBefore = swiftUIArmNoop.log.focus;
    swiftUIArmNoop.handle()?.focus();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const noopFocused = swiftUIArmNoop.mirror().focused ?? '';
    swiftUIArmNoop.unmount();

    evidence('p5_focus', {
      platform: Platform.OS,
      samples: SAMPLES,
      spike_p95_ms: p95(spikeFocus),
      spike_median_ms: median(spikeFocus),
      rn_p95_ms: p95(rnFocus),
      rn_median_ms: median(rnFocus),
      ratio: ratio.toFixed(2),
      swiftui_imperative_focus: iOS ? 'noop' : 'same arm',
      swiftui_focus_events: swiftUIArmNoop.log.focus - noopFocusBefore,
      swiftui_mirror_focused: noopFocused,
    });
    if (iOS) {
      // Asserted so it cannot rot into a silent behaviour change: the SwiftUI arm has no imperative focus.
      expect(swiftUIArmNoop.log.focus - noopFocusBefore).toBe(0);
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
  it('X4 the sizing rules hold for a text field', async () => {
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
     * A prop that cannot change the size must leave the hosted control alone, and the observable form of
     * "rebuilt" is *focus*: an unrelated re-render that replaced the hosted subtree drops it, which is the
     * user-visible bug (the keyboard disappears mid-typing). Counters are not the observable here — the model
     * outlives its composable/subtree on both platforms, so a rebuild resets nothing the mirror counts.
     */
    field.handle()?.nuiTestApplyWrite('abcdef');
    await mirrorReads(field, 'lastWrite', 'applied');
    const beforeImpl = field.mirror().impl;
    field.handle()?.focus();
    await mirrorReads(field, 'focused', '1');
    await field.set({ placeholder: 'a placeholder nobody reads' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // A write *after* the prop change, so the mirror we read was published after it: if the prop change had
    // rebuilt the subtree, focus would be gone by now, and the text would be the rebuild's initial value.
    field.handle()?.nuiTestApplyWrite('abcdefg');
    await mirrorReads(field, 'displayed', 'abcdefg');
    const afterProp = field.mirror();
    expect(afterProp.impl).toBe(beforeImpl);
    mirrorIs(field, 'focused', '1');
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
      rebuild_on_prop: 0,
      rebuild_on_text: 0,
      churn,
      ledger_delta: after.ledgerEntries - before.ledgerEntries,
      registry_delta: after.registryEntries - before.registryEntries,
      cache_delta: after.cachedSizes - before.cachedSizes,
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
    // `dropped` vs `empty` is the leak reading: what the process still holds after every field is gone,
    // against what it held before any field existed.
    const retainedMiB =
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
      dropped_miB: dropped,
      empty_miB: empty,
      retained_after_drop_miB: retainedMiB,
      dropped_private_dirty_miB: droppedDirty,
      empty_private_dirty_miB: emptyDirty,
    });

    // Leak-free in the sense the go line means: after the drop the heap is back near the empty floor. Two MiB
    // of slack for the tree the harness itself still holds, and the Dalvik private-dirty floor is the stricter
    // of the two readings.
    if (typeof retainedMiB === 'number') {
      expect(retainedMiB).toBeLessThanOrEqual(2);
      expect(
        typeof droppedDirty === 'number' && typeof emptyDirty === 'number'
          ? droppedDirty - emptyDirty
          : Number.POSITIVE_INFINITY
      ).toBeLessThanOrEqual(2);
    }
  });
});
