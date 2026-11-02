/**
 * On-device tests for the TextField (G13).
 *
 * The typing here is IME-level on both platforms, never a write into the field's
 * state:
 * - **iOS**: `HarnessUI.typeChar` calls `insertText(_:)` on the first responder -
 *   the `UITextInput` call a keyboard makes - so it runs the field's delegate
 *   (`maxLength`) and its `editingChanged`.
 * - **Android**: `HarnessUI.typeChar` only reaches an `EditText`, and a Compose
 *   field has none (Q2 §4), so the example app's `NitroUiProbe.imeInput` commits the
 *   text through the focused view's own `InputConnection`, as an IME does. The edit
 *   runs the field's `InputTransformation` like a keyboard's would.
 * The OS-level oracle - keystrokes from outside the app - is the real-input suite
 * (`CHECKS['text-field']`, `testRealInputTextField`).
 *
 * A composition (marked text) is opened the same two ways: `setMarkedText` on the
 * iOS first responder (`nuiTestSetMarkedText`), `setComposingText` on the Android
 * connection.
 *
 * @file Gates: `harness:ios`, `harness:android`.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
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
import { screen, userEvent } from '@react-native-harness/ui';
import { TextField, nitroUiCore } from 'react-native-nitro-ui';
import { waitForHandle } from './handles';
import { expectTimingBudget } from './timingGate';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  typeChar(character: string): Promise<void>;
  blur(options: { submitEditing?: boolean }): Promise<void>;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type ProbeModule = {
  imeInput(
    kind: 'commit' | 'compose' | 'finish' | 'action',
    text: string
  ): Promise<string>;
};
const probe = (): ProbeModule =>
  TurboModuleRegistry.getEnforcing('NitroUiProbe') as unknown as ProbeModule;

const iOS = Platform.OS === 'ios';

/** What the field reports about itself (`NitroUiTextFieldTestState`). */
type FieldState = {
  text: string;
  focused: boolean;
  composing: boolean;
  nativeEvents: number;
  jsEvents: number;
  lastWrite: string;
  editable: boolean;
  multiline: boolean;
  secure: boolean;
  keyboardType: string;
  returnKeyType: string;
  autoCapitalize: string;
  autoCorrect: boolean;
  maxLength: number;
  placeholder: string;
  accessibilityLabel: string;
};

/** The `hybridRef` handle, declared here (D14: no public Hybrid View types). */
type FieldHandle = {
  measureContent(): { width: number; height: number };
  focus(): void;
  blur(): void;
  nuiTestState(): FieldState;
  nuiTestSetMarkedText(text: string): void;
  nuiTestLifetimeReport(): string;
};

const handles = new Map<string, FieldHandle>();
const capture = (id: string) => (view: FieldHandle) => {
  handles.set(id, view);
};
const handleOf = (id: string) =>
  waitForHandle(() => handles.get(id), { what: `TextField ${id}` });

/** Everything the app was told, per field, in order. */
const events = new Map<string, string[]>();
const log = (id: string, entry: string) => {
  const list = events.get(id) ?? [];
  list.push(entry);
  events.set(id, list);
};
const eventsOf = (id: string) => events.get(id) ?? [];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForTestId(testId: string, timeoutMs = 10000) {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    if (harnessUi.queryByTestId(testId) != null) {
      return screen.findByTestId(testId);
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(`testID ${testId} never appeared`);
    }
    await sleep(50);
  }
}

/** Wait until the field's own report satisfies `check`, and return it. */
async function stateWhen(
  id: string,
  check: (state: FieldState) => boolean,
  what: string,
  timeoutMs = 5000
): Promise<FieldState> {
  const handle = await handleOf(id);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = handle.nuiTestState();
    if (check(state)) return state;
    if (Date.now() > deadline) {
      throw new Error(
        `TextField ${id}: ${what} never happened; last report ${JSON.stringify(state)}`
      );
    }
    await sleep(20);
  }
}

/** Focus `id` through its `ref`-backed native method, and wait for it to land. */
async function focusField(id: string) {
  const handle = await handleOf(id);
  handle.focus();
  await stateWhen(id, (state) => state.focused, 'focus');
}

/**
 * Type `text` into the focused field one key at a time, as a keyboard does: one code
 * point per key (Hermes has no `Intl.Segmenter`), which is what a single-code-point
 * emoji key sends. A ZWJ sequence is only ever sent whole (`insertAtOnce`).
 */
async function typeText(text: string) {
  for (const grapheme of Array.from(text)) {
    if (iOS) {
      await harnessUi.typeChar(grapheme);
    } else {
      await probe().imeInput('commit', grapheme);
    }
    await sleep(30);
  }
}

/** Insert `text` in one edit - what a paste or a long autocomplete does. */
async function insertAtOnce(text: string) {
  if (iOS) {
    await harnessUi.typeChar(text);
  } else {
    await probe().imeInput('commit', text);
  }
  await sleep(30);
}

/** Open (or update) an IME composition holding `text`. */
async function compose(id: string, text: string) {
  if (iOS) {
    (await handleOf(id)).nuiTestSetMarkedText(text);
  } else {
    await probe().imeInput('compose', text);
  }
}

/** Commit the open composition. */
async function finishComposition(id: string) {
  if (iOS) {
    (await handleOf(id)).nuiTestSetMarkedText('');
  } else {
    await probe().imeInput('finish', '');
  }
}

/** Press Return on the focused field. */
async function pressReturn() {
  if (iOS) {
    await harnessUi.blur({ submitEditing: true });
  } else {
    await probe().imeInput('action', '');
  }
}

/** The JS side's own copy of a controlled field's text, for each test to read. */
const jsValues = new Map<string, string>();
/** Writers a test calls to send a new `value`, as an app's `setState` would. */
const writers = new Map<string, (text: string) => void>();

/**
 * A controlled field. `accept` false is the frozen field: every edit is reported and
 * refused, so the handshake has to revert it.
 */
function Controlled({
  id,
  initial,
  accept = true,
  maxLength,
  multiline = false,
  secureTextEntry = false,
  width,
}: {
  id: string;
  initial: string;
  accept?: boolean;
  maxLength?: number;
  multiline?: boolean;
  secureTextEntry?: boolean;
  width?: number;
}) {
  const [value, setValue] = useState(initial);
  jsValues.set(id, value);
  writers.set(id, setValue);
  const onChangeText = useCallback(
    (text: string) => {
      log(id, `change:${text}`);
      if (accept) setValue(text);
    },
    [id, accept]
  );
  const onFocus = useCallback(() => log(id, 'focus'), [id]);
  const onBlur = useCallback(() => log(id, 'blur'), [id]);
  const onSubmit = useCallback(
    (text: string) => log(id, `submit:${text}`),
    [id]
  );
  return (
    <View style={width != null ? { width } : undefined}>
      <TextField
        testID={id}
        accessibilityLabel={`Field ${id}`}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onSubmitEditing={onSubmit}
        maxLength={maxLength}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        autoCorrect={false}
        autoCapitalize="none"
        hybridRef={capture(id)}
      />
    </View>
  );
}

/** One commit of a latency arm: which text React committed, and when. */
const commits: Array<{ arm: string; text: string; at: number }> = [];

/**
 * One arm of the keystroke-to-commit comparison: a controlled field whose commit
 * is stamped in a layout effect - the moment React has committed the new text.
 */
function LatencyArm({ arm }: { arm: 'nitro' | 'rn' }) {
  const [text, setText] = useState('');
  const rnRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  if (arm === 'rn') rnFocus.current = () => rnRef.current?.focus();
  useLayoutEffect(() => {
    if (text !== '') commits.push({ arm, text, at: nitroUiCore.now() });
  }, [arm, text]);
  return arm === 'nitro' ? (
    <TextField
      testID="latency-nitro"
      value={text}
      onChangeText={setText}
      autoCorrect={false}
      autoCapitalize="none"
      hybridRef={capture('latency-nitro')}
    />
  ) : (
    <TextInput
      ref={rnRef}
      testID="latency-rn"
      value={text}
      onChangeText={setText}
      autoCorrect={false}
      autoCapitalize="none"
      style={{ height: 40 }}
    />
  );
}
const rnFocus: { current: (() => void) | null } = { current: null };

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN
  );
}

beforeAll(async () => {
  // Pay the first mount's one-time costs (the font, the hosting controller class,
  // Compose's text stack) outside any test's timeout.
  render(<Controlled id="warmup" initial="warm" />);
  await waitForTestId('warmup', 20000);
  await handleOf('warmup');
  cleanup();
});

afterEach(async () => {
  // A field left focused keeps the keyboard up for the next test.
  for (const handle of handles.values()) {
    handle.blur();
  }
  cleanup();
  handles.clear();
  events.clear();
  jsValues.clear();
  writers.clear();
  await sleep(150);
});

describe('TextField', () => {
  it('round-trips typed text to JS, one event per keystroke', async () => {
    render(<Controlled id="typing" initial="" />);
    await waitForTestId('typing');
    await focusField('typing');
    await typeText('abc');
    await waitFor(() => expect(jsValues.get('typing')).toBe('abc'), {
      timeout: 5000,
    });
    expect(eventsOf('typing').filter((e) => e.startsWith('change:'))).toEqual([
      'change:a',
      'change:ab',
      'change:abc',
    ]);
    const state = await stateWhen(
      'typing',
      (s) => s.jsEvents === 3,
      'the third echo'
    );
    expect(state.text).toBe('abc');
    expect(state.nativeEvents).toBe(3);
    // A write equal to what the field shows is no write at all.
    expect(state.lastWrite).toBe('none');
  });

  it('reverts an edit JS refuses, and the next edit starts from the refused text', async () => {
    render(<Controlled id="frozen" initial="frozen" accept={false} />);
    await waitForTestId('frozen');
    await focusField('frozen');
    await typeText('x');
    // The edit was reported...
    await waitFor(
      () => expect(eventsOf('frozen')).toContain('change:frozenx'),
      {
        timeout: 5000,
      }
    );
    // ...and taken back: the echo made the unchanged `value` a write again.
    const reverted = await stateWhen(
      'frozen',
      (s) => s.text === 'frozen' && s.jsEvents === 1,
      'the revert'
    );
    expect(reverted.lastWrite).toBe('applied');
    // The oracle that cannot be faked by a report: the next keystroke lands on the
    // reverted text. Without the revert this would report `frozenxy`.
    await typeText('y');
    await waitFor(
      () => expect(eventsOf('frozen')).toContain('change:frozeny'),
      {
        timeout: 5000,
      }
    );
    expect(eventsOf('frozen')).not.toContain('change:frozenxy');
    await stateWhen('frozen', (s) => s.text === 'frozen', 'the second revert');
  });

  it('holds maxLength in UTF-16 units and never splits an emoji', async () => {
    render(<Controlled id="capped" initial="" maxLength={5} />);
    await waitForTestId('capped');
    await focusField('capped');
    await typeText('abcd');
    // An emoji is two UTF-16 units and one more would make six: refused whole, not
    // cut to a lone surrogate.
    await typeText('😀');
    await typeText('e');
    await typeText('f');
    const capped = await stateWhen(
      'capped',
      (s) => s.text === 'abcde' && s.jsEvents === s.nativeEvents,
      'the cap'
    );
    expect(capped.maxLength).toBe(5);
    expect(jsValues.get('capped')).toBe('abcde');
    expect(eventsOf('capped').some((e) => e.includes('\uD83D'))).toBe(false);
  });

  it('keeps the part of an insertion that fits, cut at a grapheme boundary', async () => {
    render(<Controlled id="paste" initial="ab" maxLength={6} />);
    await waitForTestId('paste');
    await focusField('paste');
    // A ZWJ family is eight UTF-16 units: four fit, but four would split it, so none
    // of it does - and the rest of the insertion is still judged on its own.
    await insertAtOnce('👨‍👩‍👧');
    await insertAtOnce('xyz😀w');
    // `xyz` fits; the emoji after it would need two units where one is left, so the
    // cut falls before it, and `w` after it goes with the rest of that insertion.
    const state = await stateWhen(
      'paste',
      (s) => s.text === 'abxyz' && s.jsEvents === s.nativeEvents,
      'the cut'
    );
    expect(state.nativeEvents).toBe(1);
    expect(jsValues.get('paste')).toBe('abxyz');
    expect(eventsOf('paste').some((e) => e.includes('👨'))).toBe(false);
  });

  /*
   * iOS only, as the brief scopes it. Android drops a write under an open
   * `TextFieldState.composition` the same way (`HybridNitroUiTextField.kt`,
   * `afterUpdate`), but a composition opened through an `InputConnection` from
   * outside the IME is committed again before a write can reach it on the emulator
   * (measured: `composing` never reads true after `setComposingText`, with the soft
   * keyboard up or down), so there is no composition to write into.
   */
  const itComposes = iOS ? it : it.skip;
  itComposes(
    'drops a JS write while a composition is open, and keeps the composition',
    async () => {
      render(<Controlled id="ime" initial="abc" />);
      await waitForTestId('ime');
      await focusField('ime');
      await compose('ime', 'か');
      const open = await stateWhen(
        'ime',
        (s) => s.composing,
        'the composition to open'
      );
      expect(open.text).toBe('abcか');
      // Nothing is reported for a composition step: the text is not the user's yet.
      expect(eventsOf('ime').filter((e) => e.startsWith('change:'))).toEqual(
        []
      );

      // React writes while the composition is open: dropped, not applied over it.
      writers.get('ime')?.('zzz');
      const held = await stateWhen(
        'ime',
        (s) => s.lastWrite === 'composing',
        'the dropped write'
      );
      expect(held.composing).toBe(true);
      expect(held.text).toBe('abcか');

      // The composition commits as one edit, and the next commit decides again: the
      // app takes the committed text, so `zzz` - superseded - never reaches the field.
      await finishComposition('ime');
      await waitFor(() => expect(eventsOf('ime')).toContain('change:abcか'), {
        timeout: 5000,
      });
      const settled = await stateWhen(
        'ime',
        (s) => !s.composing && s.jsEvents === s.nativeEvents,
        'the commit'
      );
      expect(settled.text).toBe('abcか');
      expect(jsValues.get('ime')).toBe('abcか');
    }
  );

  it('applies a JS write that arrives with no composition open', async () => {
    render(<Controlled id="write" initial="one" />);
    await waitForTestId('write');
    await handleOf('write');
    writers.get('write')?.('two');
    const state = await stateWhen(
      'write',
      (s) => s.text === 'two',
      'the write'
    );
    expect(state.lastWrite).toBe('applied');
    // A write is not an edit: nothing was reported back.
    expect(state.nativeEvents).toBe(0);
    expect(eventsOf('write')).toEqual([]);
  });

  it('obscures a secure field, still reports its text, and ignores secure when multi-line', async () => {
    render(
      <>
        <Controlled id="secure" initial="" secureTextEntry />
        <Controlled id="secure-multi" initial="" secureTextEntry multiline />
      </>
    );
    await waitForTestId('secure');
    await waitForTestId('secure-multi');
    await stateWhen(
      'secure',
      (s) => s.secure,
      'the field to be drawn obscured'
    );
    await focusField('secure');
    await typeText('pw1');
    await waitFor(() => expect(jsValues.get('secure')).toBe('pw1'), {
      timeout: 5000,
    });
    const multi = await stateWhen(
      'secure-multi',
      (s) => s.multiline,
      'the multi-line control'
    );
    expect(multi.secure).toBe(false);
  });

  it('reports focus and blur, focuses on a tap, and submits on Return', async () => {
    render(
      <>
        <Controlled id="focus" initial="go" />
        <Controlled id="other" initial="" />
      </>
    );
    await waitForTestId('focus');
    await waitForTestId('other');
    // Imperative focus and blur, through the native methods `ref` calls.
    await focusField('focus');
    await waitFor(() => expect(eventsOf('focus')).toEqual(['focus']), {
      timeout: 5000,
    });
    (await handleOf('focus')).blur();
    await stateWhen('focus', (s) => !s.focused, 'the blur');
    await waitFor(() => expect(eventsOf('focus')).toEqual(['focus', 'blur']), {
      timeout: 5000,
    });

    // A tap on the field focuses it, and a tap on another moves focus there.
    await userEvent.press(await screen.findByTestId('focus'));
    await stateWhen('focus', (s) => s.focused, 'focus from a tap');
    await userEvent.press(await screen.findByTestId('other'));
    await stateWhen(
      'other',
      (s) => s.focused,
      'focus moving to the other field'
    );
    await stateWhen('focus', (s) => !s.focused, 'the first field letting go');
    expect(eventsOf('focus')).toEqual(['focus', 'blur', 'focus', 'blur']);
    expect(eventsOf('other')).toEqual(['focus']);

    // Return on a single-line field submits its text, then gives focus up.
    await focusField('focus');
    await pressReturn();
    await waitFor(() => expect(eventsOf('focus')).toContain('submit:go'), {
      timeout: 5000,
    });
    await stateWhen('focus', (s) => !s.focused, 'the blur after submit');
  });

  it('takes no focus while not editable', async () => {
    function ReadOnly() {
      const onFocus = useCallback(() => log('readonly', 'focus'), []);
      return (
        <>
          <TextField
            testID="readonly"
            defaultValue="look, don't touch"
            editable={false}
            onFocus={onFocus}
            hybridRef={capture('readonly')}
          />
          <Controlled id="barrier" initial="" />
        </>
      );
    }
    render(<ReadOnly />);
    await waitForTestId('readonly');
    await waitForTestId('barrier');
    const state = await stateWhen('readonly', (s) => s.text !== '', 'its text');
    expect(state.editable).toBe(false);
    expect(state.text).toBe("look, don't touch");
    (await handleOf('readonly')).focus();
    await userEvent.press(await screen.findByTestId('readonly'));
    // The barrier: an editable field's focus is awaited, so a focus the read-only
    // field was going to report has had the same time to arrive.
    await focusField('barrier');
    expect(eventsOf('readonly')).toEqual([]);
    expect((await handleOf('readonly')).nuiTestState().focused).toBe(false);
  });

  it('sizes a single-line field to one line, at its parent width, whatever its text', async () => {
    render(
      <>
        <Controlled
          id="single"
          initial="Some text, quite a lot of it"
          width={300}
        />
        <Controlled id="single-empty" initial="" width={300} />
      </>
    );
    await waitForTestId('single');
    await waitForTestId('single-empty');
    const handle = await handleOf('single');
    const empty = await handleOf('single-empty');
    await waitFor(
      () => {
        expect(handle.measureContent().height).toBeGreaterThan(0);
        expect(empty.measureContent().height).toBeGreaterThan(0);
      },
      { timeout: 5000 }
    );
    await sleep(200);
    const box = harnessUi.queryByTestId('single');
    const emptyBox = harnessUi.queryByTestId('single-empty');
    const measured = handle.measureContent();
    expect(box).not.toBeNull();
    expect(emptyBox).not.toBeNull();
    // The width is the parent's, not the text's (`fillWidth`).
    expect(box?.width).toBeCloseTo(300, 0);
    expect(emptyBox?.width).toBeCloseTo(300, 0);
    // The box is what the field measured...
    expect(Math.abs((box?.height ?? 0) - measured.height)).toBeLessThan(1);
    // ...and a field with no text measures the same one line: two fields measured on
    // their own, so a height that followed the text could not hide behind a cache.
    expect(
      Math.abs(empty.measureContent().height - measured.height)
    ).toBeLessThan(1);
    expect(Math.abs((emptyBox?.height ?? 0) - (box?.height ?? 0))).toBeLessThan(
      1
    );
  });

  it('grows a multi-line field with its text, one correction a step, and keeps two fields apart', async () => {
    render(
      <>
        <Controlled id="grow" initial="" multiline width={240} />
        <Controlled id="tall" initial={'1\n2\n3\n4'} multiline width={240} />
      </>
    );
    await waitForTestId('grow');
    await waitForTestId('tall');
    const grow = await handleOf('grow');
    const tall = await handleOf('tall');
    await waitFor(
      () => expect(grow.measureContent().height).toBeGreaterThan(0),
      {
        timeout: 5000,
      }
    );
    await waitFor(
      () => expect(tall.measureContent().height).toBeGreaterThan(0),
      {
        timeout: 5000,
      }
    );
    const line = grow.measureContent().height;
    const boxHeight = (id: string) => harnessUi.queryByTestId(id)?.height ?? 0;
    await waitFor(() => expect(boxHeight('tall')).toBeGreaterThan(line * 3.5), {
      timeout: 5000,
    });

    const heights: number[] = [];
    for (const text of ['a', 'a\nb', 'a\nb\nc']) {
      const before = nitroUiCore.sizingStats();
      writers.get('grow')?.(text);
      const lines = text.split('\n').length;
      await waitFor(
        () => expect(boxHeight('grow')).toBeGreaterThan(line * (lines - 0.5)),
        { timeout: 5000 }
      );
      await sleep(100);
      const after = nitroUiCore.sizingStats();
      const corrections =
        after.correctionsImmediate +
        after.correctionsBatched -
        before.correctionsImmediate -
        before.correctionsBatched;
      heights.push(boxHeight('grow'));
      expect(corrections).toBeLessThanOrEqual(1);
    }
    console.log(
      `textfield grow: line=${line} heights=${heights.join(',')} tall=${boxHeight('tall')}`
    );
    expect(heights[2]).toBeGreaterThan(heights[0] ?? 0);
    // The four-line field kept its own height through every re-measure of the other:
    // one shared cache entry would have handed it the growing field's.
    expect(boxHeight('tall')).toBeGreaterThan(line * 3.5);
    expect(
      Math.abs(boxHeight('tall') - tall.measureContent().height)
    ).toBeLessThan(1);

    // Typing a newline grows it too - the user's edit, not a React write.
    await focusField('grow');
    await typeText('\nd');
    await waitFor(() => expect(boxHeight('grow')).toBeGreaterThan(line * 3.5), {
      timeout: 5000,
    });
  });

  /*
   * Keystroke-to-commit against React Native's own `TextInput`, the two arms
   * interleaved block by block so both see the same machine in the same seconds
   * (T19's lesson). A keystroke is the same IME-level call into either field
   * (`insertText` on iOS, `InputConnection.commitText` on Android); the clock starts
   * in JS before that call and stops in the layout effect that commits the new text,
   * so both arms pay the same JS -> UI hop and the difference is the field. Every key
   * must commit on both arms; the duration is D21's (`expectTimingBudget`).
   */
  it('commits a keystroke about as fast as RN TextInput', async () => {
    commits.length = 0;
    render(
      <>
        <LatencyArm arm="nitro" />
        <LatencyArm arm="rn" />
      </>
    );
    await waitForTestId('latency-nitro');
    await waitForTestId('latency-rn');
    const BLOCKS = 4;
    const KEYS = 4;
    const samples: Record<'nitro' | 'rn', number[]> = { nitro: [], rn: [] };
    const typed: Record<'nitro' | 'rn', string> = { nitro: '', rn: '' };
    for (let block = 0; block < BLOCKS; block += 1) {
      for (const arm of ['nitro', 'rn'] as const) {
        // Both arms get the same settle after focus: the first key otherwise lands
        // while the keyboard is still animating in, and measures that.
        if (arm === 'nitro') {
          await focusField('latency-nitro');
        } else {
          rnFocus.current?.();
        }
        await sleep(400);
        for (let key = 0; key < KEYS; key += 1) {
          const letter = String.fromCharCode(97 + ((block * KEYS + key) % 26));
          typed[arm] += letter;
          const want = typed[arm];
          const started = nitroUiCore.now();
          if (iOS) {
            await harnessUi.typeChar(letter);
          } else {
            await probe().imeInput('commit', letter);
          }
          const deadline = Date.now() + 3000;
          let commit = commits.find((c) => c.arm === arm && c.text === want);
          while (commit == null && Date.now() < deadline) {
            await sleep(5);
            commit = commits.find((c) => c.arm === arm && c.text === want);
          }
          if (commit == null) {
            throw new Error(`${arm}: "${want}" never committed`);
          }
          samples[arm].push(commit.at - started);
          await sleep(120);
        }
      }
    }
    expect(samples.nitro.length).toBe(BLOCKS * KEYS);
    expect(samples.rn.length).toBe(BLOCKS * KEYS);
    const summary = {
      nitro: {
        p50: percentile(samples.nitro, 0.5),
        p95: percentile(samples.nitro, 0.95),
      },
      rn: {
        p50: percentile(samples.rn, 0.5),
        p95: percentile(samples.rn, 0.95),
      },
    };
    await expectTimingBudget({
      label: 'TextField keystroke->commit p95 (1.5x RN TextInput p95)',
      measuredMs: summary.nitro.p95,
      limitMs: summary.rn.p95 * 1.5,
      note: `nitro p50 ${summary.nitro.p50.toFixed(1)} / p95 ${summary.nitro.p95.toFixed(1)}, rn p50 ${summary.rn.p50.toFixed(1)} / p95 ${summary.rn.p95.toFixed(1)}`,
    });
  });

  it('comes back from the pool with none of its previous owner', async () => {
    function Owner({ second }: { second: boolean }) {
      return second ? (
        <TextField
          key="owner"
          testID="pooled"
          defaultValue="second"
          hybridRef={capture('pooled')}
        />
      ) : (
        <TextField
          key="owner"
          testID="pooled"
          defaultValue=""
          placeholder="first owner"
          secureTextEntry
          maxLength={9}
          keyboardType="email-address"
          returnKeyType="send"
          editable
          accessibilityLabel="First owner"
          hybridRef={capture('pooled')}
        />
      );
    }
    let recycled = false;
    for (let round = 0; round < 3 && !recycled; round += 1) {
      render(<Owner second={false} />);
      await waitForTestId('pooled');
      await focusField('pooled');
      await typeText('residue');
      await stateWhen('pooled', (s) => s.text === 'residue', 'the residue');
      cleanup();
      handles.clear();
      await sleep(200);
      render(<Owner second />);
      await waitForTestId('pooled');
      const handle = await handleOf('pooled');
      const state = await stateWhen(
        'pooled',
        (s) => s.text === 'second',
        'the second owner’s default'
      );
      expect(state.focused).toBe(false);
      expect(state.secure).toBe(false);
      expect(state.placeholder).toBe('');
      expect(state.maxLength).toBe(-1);
      expect(state.keyboardType).toBe('default');
      expect(state.returnKeyType).toBe('default');
      expect(state.accessibilityLabel).toBe('');
      expect(state.nativeEvents).toBe(0);
      const lifetime = handle.nuiTestLifetimeReport();
      recycled = /recycles=[1-9]/.test(lifetime);
      console.log(`textfield recycle round ${round}: ${lifetime}`);
      cleanup();
      handles.clear();
      await sleep(200);
    }
    // The assertions above only test a reset if the second owner *was* the first
    // owner's view; a fresh instance passes them all trivially.
    expect(recycled).toBe(true);
  });
});
