import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
import {
  TextField,
  nitroUiCore,
  type TextFieldKeyboardType,
  type TextFieldHandle,
} from 'react-native-nitro-ui';
import { waitForHandle } from './handles';

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
    kind: 'commit' | 'compose' | 'finish' | 'cancel' | 'action' | 'connect',
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
  /** The caret's UTF-16 offset in `text`, or `-1`. */
  caret: number;
  /** `'offered' | 'refused' | 'unknown'`: what the keyboard in use was told. */
  suggestions: string;
};

/** The `hybridRef` handle; the library exports no Hybrid View types. */
type FieldHandle = {
  measureContent(): { width: number; height: number };
  focus(): void;
  blur(): void;
  nuiTestState(): FieldState;
  nuiTestSetMarkedText(text: string): void;
  nuiTestCancelMarkedText(): void;
  nuiTestPaste(text: string, at: number): void;
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
 * Types one code point per key (Hermes has no `Intl.Segmenter`). Android commits
 * through the probe's `InputConnection`, as an IME does: `HarnessUI.typeChar` only
 * reaches an `EditText`, and a Compose field has none.
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

async function compose(id: string, text: string) {
  if (iOS) {
    (await handleOf(id)).nuiTestSetMarkedText(text);
  } else {
    await probe().imeInput('connect', '');
    await probe().imeInput('compose', text);
  }
}

async function finishComposition(id: string) {
  if (iOS) {
    (await handleOf(id)).nuiTestSetMarkedText('');
  } else {
    await probe().imeInput('finish', '');
  }
}

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

/** UTF-16 code units, so a space UIKit substituted for another space still compares. */
const codeUnits = (text: string) =>
  Array.from(text, (c) => c.charCodeAt(0)).join(',');

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN
  );
}

/** A field whose keyboard props a test moves one at a time. */
function Keyboard({
  autoCorrect = true,
  keyboardType = 'default',
  secureTextEntry = false,
  testID = 'keyboard',
}: {
  autoCorrect?: boolean;
  keyboardType?: TextFieldKeyboardType;
  secureTextEntry?: boolean;
  testID?: string;
}) {
  const [value, setValue] = useState('');
  return (
    <TextField
      testID={testID}
      value={value}
      onChangeText={setValue}
      autoCorrect={autoCorrect}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      autoCapitalize="none"
      hybridRef={capture(testID)}
    />
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
    // The next keystroke lands on the reverted text; without the revert it would
    // report `frozenxy`.
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
   * iOS only: on the Android emulator a composition opened through an
   * `InputConnection` from outside the IME is committed before the app sees it, so
   * there is no composition to write into.
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

  itComposes(
    'settles a write a composition held back when the composition is deleted',
    async () => {
      render(<Controlled id="cancel" initial="abc" />);
      await waitForTestId('cancel');
      await focusField('cancel');
      await compose('cancel', 'か');
      await stateWhen('cancel', (s) => s.composing, 'the composition to open');
      writers.get('cancel')?.('zzz');
      await stateWhen(
        'cancel',
        (s) => s.lastWrite === 'composing',
        'the held write'
      );
      // The user deletes the whole composition: the text is `abc` again, which native
      // already counted, so no edit is reported - and the held write must still land.
      (await handleOf('cancel')).nuiTestCancelMarkedText();
      const settled = await stateWhen(
        'cancel',
        (s) => !s.composing && s.text === 'zzz',
        'the held write landing once the composition was gone'
      );
      expect(settled.lastWrite).toBe('applied');
      expect(jsValues.get('cancel')).toBe('zzz');
      expect(eventsOf('cancel').filter((e) => e.startsWith('change:'))).toEqual(
        []
      );
    }
  );

  it('focuses from its parent’s mount effect', async () => {
    function FocusOnMount() {
      const ref = useRef<TextFieldHandle>(null);
      const onFocus = useCallback(() => log('mount-focus', 'focus'), []);
      useEffect(() => {
        // Asked on mount, before the native view has reached JS.
        ref.current?.focus();
      }, []);
      return (
        <TextField
          ref={ref}
          testID="mount-focus"
          onFocus={onFocus}
          hybridRef={capture('mount-focus')}
        />
      );
    }
    render(<FocusOnMount />);
    await waitForTestId('mount-focus');
    await stateWhen(
      'mount-focus',
      (s) => s.focused,
      'focus from the mount effect'
    );
    await waitFor(() => expect(eventsOf('mount-focus')).toEqual(['focus']), {
      timeout: 5000,
    });
  });

  /*
   * iOS only: the paste hook is UIKit's. `insertText` (what `typeText` uses) skips
   * the `UITextField` delegate, so only a mid-text paste tells the delegate's
   * insertion cut from a cut at the tail. The paste goes between two spaces because
   * UIKit's smart insert pads a paste next to anything else with a space.
   */
  const itPastes = iOS ? it : it.skip;
  itPastes(
    'keeps the part of a mid-text paste that fits, and the text after it',
    async () => {
      render(<Controlled id="paste-mid" initial="ab  cd" maxLength={8} />);
      await waitForTestId('paste-mid');
      await focusField('paste-mid');
      (await handleOf('paste-mid')).nuiTestPaste('xyz', 3);
      const state = await stateWhen(
        'paste-mid',
        // Counted and echoed: a snapshot published mid-edit (the selection moving)
        // can show the new text before the edit is counted.
        (s) => s.nativeEvents >= 1 && s.jsEvents === s.nativeEvents,
        'the paste'
      );
      // Code units in the message: a space UIKit turned into another one prints alike.
      expect(Array.from(state.text, (c) => c.charCodeAt(0)).join(',')).toBe(
        Array.from('ab xy cd', (c) => c.charCodeAt(0)).join(',')
      );
      expect(jsValues.get('paste-mid')).toBe('ab xy cd');
    }
  );

  /*
   * iOS only: a composition opened by `setMarkedText` commits without the delegate's
   * `shouldChangeCharactersIn`, which is the edit native's backstop cuts. The caret the
   * backstop leaves behind is the half of that cut a text message cannot show.
   */
  itComposes(
    'keeps the caret after the part of a mid-field edit the backstop keeps',
    async () => {
      render(<Controlled id="cut-caret" initial="ab  cd" maxLength={8} />);
      await waitForTestId('cut-caret');
      await focusField('cut-caret');
      // The paste hook doubles as the seam that moves the caret: asked to paste nothing it
      // only puts the caret between the two spaces, so UIKit's smart insert of a real paste
      // gets no say about the text the cut is then made in.
      (await handleOf('cut-caret')).nuiTestPaste('', 3);
      const positioned = await stateWhen(
        'cut-caret',
        (s) => s.caret === 3 && codeUnits(s.text) === codeUnits('ab  cd'),
        'the caret between the two spaces'
      );
      expect(positioned.nativeEvents).toBe(0);

      // Three code units committed where one fits. The backstop keeps `xy`, and the caret
      // stays behind what it kept rather than going to the end of the field.
      await compose('cut-caret', 'xyz');
      await finishComposition('cut-caret');
      const cut = await stateWhen(
        'cut-caret',
        (s) =>
          codeUnits(s.text) === codeUnits('ab xy cd') &&
          s.jsEvents === s.nativeEvents,
        'the cut commit'
      );
      expect(cut.caret).toBe(5);
      expect(cut.caret).toBeLessThan(cut.text.length);
      expect(codeUnits(jsValues.get('cut-caret') ?? '')).toBe(
        codeUnits('ab xy cd')
      );
    }
  );

  /*
   * iOS only, and the same commit with room for one unit of a four-unit edit: here "just after
   * what was kept", "one past that" and "after the whole insertion" are three different offsets,
   * which a cut that drops a single unit cannot tell apart.
   */
  itComposes(
    'puts the caret after the kept unit when a cut drops most of the edit',
    async () => {
      render(<Controlled id="cut-long" initial="ab  cdef" maxLength={9} />);
      await waitForTestId('cut-long');
      await focusField('cut-long');
      (await handleOf('cut-long')).nuiTestPaste('', 3);
      await stateWhen(
        'cut-long',
        (s) => s.caret === 3 && codeUnits(s.text) === codeUnits('ab  cdef'),
        'the caret between the two spaces'
      );

      // `w` is kept, so the caret belongs at 4 - not at 5 (one past it), 7 (after the whole
      // `wxyz` insertion) or 9 (the end of the field).
      await compose('cut-long', 'wxyz');
      await finishComposition('cut-long');
      const cut = await stateWhen(
        'cut-long',
        (s) =>
          codeUnits(s.text) === codeUnits('ab w cdef') &&
          s.jsEvents === s.nativeEvents,
        'the cut commit'
      );
      expect(cut.caret).toBe(4);
      expect(codeUnits(jsValues.get('cut-long') ?? '')).toBe(
        codeUnits('ab w cdef')
      );
    }
  );

  /*
   * iOS only, and the same commit at the end of the field: the caret there is the end
   * either way, which is what makes the case above the one that says something.
   */
  itComposes(
    'leaves the caret at the end when the cut is at the end',
    async () => {
      const { rerender } = await render(
        <Controlled id="cut-tail" initial="abcd" maxLength={5} />
      );
      await waitForTestId('cut-tail');
      await focusField('cut-tail');
      await compose('cut-tail', 'xyz');
      await finishComposition('cut-tail');
      const cut = await stateWhen(
        'cut-tail',
        (s) => s.text === 'abcdx' && s.jsEvents === s.nativeEvents,
        'the cut at the tail'
      );
      expect(cut.caret).toBe(cut.text.length);
      expect(jsValues.get('cut-tail')).toBe('abcdx');

      /*
       * Nothing is owed at the end of the text: there is no later offset for UIKit's own
       * insertion point to arrive at, so a cut there never owns the caret. Raising
       * `maxLength` and carrying on typing puts the keys after the `x`.
       */
      await rerender(
        <Controlled id="cut-tail" initial="abcd" maxLength={10} />
      );
      await stateWhen(
        'cut-tail',
        (s) => s.maxLength === 10,
        'the field to take the longer limit'
      );
      const tail = await handleOf('cut-tail');
      await typeText('qr');
      await waitFor(() => expect(tail.nuiTestState().text).toBe('abcdxqr'), {
        timeout: 5000,
      });
      const typed = tail.nuiTestState();
      expect(typed.caret).toBe(7);
      expect(jsValues.get('cut-tail')).toBe('abcdxqr');
    }
  );

  /*
   * iOS only: a mid-field cut owns the caret only while UIKit ends the commit that cut was made
   * in. Another `maxLength` is not UIKit ending it: the offsets the cut reached for stop being
   * the caret's owner, and the keys typed after the change land where the person put them.
   */
  itComposes(
    'ends a mid-field cut claim on the caret when maxLength changes',
    async () => {
      const { rerender } = await render(
        <Controlled id="cut-limit" initial="ab   cd" maxLength={8} />
      );
      await waitForTestId('cut-limit');
      await focusField('cut-limit');
      (await handleOf('cut-limit')).nuiTestPaste('', 3);
      await stateWhen(
        'cut-limit',
        (s) => s.caret === 3 && codeUnits(s.text) === codeUnits('ab   cd'),
        'the caret in the middle of the field'
      );

      // One unit of a four-unit commit fits: the caret ends at 4, and the cut reaches up to 7 -
      // as far ahead as its three dropped units could have carried UIKit's insertion point.
      await compose('cut-limit', 'wxyz');
      await finishComposition('cut-limit');
      const cut = await stateWhen(
        'cut-limit',
        (s) =>
          codeUnits(s.text) === codeUnits('ab w  cd') &&
          s.jsEvents === s.nativeEvents,
        'the cut commit'
      );
      expect(cut.caret).toBe(4);

      await rerender(
        <Controlled id="cut-limit" initial="ab   cd" maxLength={12} />
      );
      await stateWhen(
        'cut-limit',
        (s) => s.maxLength === 12,
        'the field to take the longer limit'
      );

      // There is room now: the caret goes between the two spaces and the key lands there.
      (await handleOf('cut-limit')).nuiTestPaste('', 6);
      await sleep(200);
      await typeText('q');
      await sleep(300);
      const typed = (await handleOf('cut-limit')).nuiTestState();
      expect(codeUnits(typed.text)).toBe(codeUnits('ab w  qcd'));
      expect(typed.caret).toBe(7);
      expect(jsValues.get('cut-limit')).toBe('ab w  qcd');
    }
  );

  /*
   * iOS only: text that repeats the committed characters says nothing about where the
   * composition was - `aa` committed at offset 1 of `aaaa` compares like `aa` appended at the
   * end. The caret comes from what UIKit reports, not from the difference between the texts.
   */
  itComposes(
    'puts the caret after a composition that repeats the text around it',
    async () => {
      render(<Controlled id="cut-repeat" initial="aaaa" maxLength={5} />);
      await waitForTestId('cut-repeat');
      await focusField('cut-repeat');
      (await handleOf('cut-repeat')).nuiTestPaste('', 1);
      await stateWhen(
        'cut-repeat',
        (s) => s.caret === 1 && codeUnits(s.text) === codeUnits('aaaa'),
        'the caret after the first `a`'
      );

      // Two units committed where one fits, in text that is all `a`: the kept text is
      // `aaaaa` whichever way the edit is read, and the caret is 2 or the end.
      await compose('cut-repeat', 'aa');
      await finishComposition('cut-repeat');
      const cut = await stateWhen(
        'cut-repeat',
        (s) =>
          codeUnits(s.text) === codeUnits('aaaaa') &&
          s.jsEvents === s.nativeEvents,
        'the cut commit'
      );
      expect(cut.caret).toBe(2);
      expect(jsValues.get('cut-repeat')).toBe('aaaaa');
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
   * The two arms are interleaved block by block so both see the same machine load.
   * The clock starts in JS before the key and stops in the layout effect that commits
   * the text. The timings are printed, not judged: the test only requires that every
   * key commits on both arms.
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
            // What the field holds says which way it went: `b` alone means a key landed
            // on a composing region the keyboard opened, `a` that the key never arrived.
            const state =
              arm === 'nitro'
                ? JSON.stringify(
                    (await handleOf('latency-nitro')).nuiTestState()
                  )
                : 'not read';
            throw new Error(
              `${arm}: "${want}" never committed (field: ${state})`
            );
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
    console.log(
      `keystroke->commit: nitro p50 ${summary.nitro.p50.toFixed(1)} / p95 ` +
        `${summary.nitro.p95.toFixed(1)}, rn p50 ${summary.rn.p50.toFixed(1)} / p95 ` +
        `${summary.rn.p95.toFixed(1)}`
    );
  });

  /*
   * What the keyboard was told, read from it rather than from the props that asked for
   * it: on Android the `EditorInfo` the focused field hands the IME, on iOS the trait it
   * attaches with. `'unknown'` means the field has not been asked yet, so every wait
   * below goes past it and never reads a wish as an answer.
   */
  it('tells the keyboard what autoCorrect asked for', async () => {
    const { rerender, unmount } = await render(<Keyboard />);
    await waitForTestId('keyboard');
    await focusField('keyboard');

    const asFound = await stateWhen(
      'keyboard',
      (s) => s.suggestions !== 'unknown',
      'the focused field to read its keyboard back'
    );
    expect(asFound.focused).toBe(true);
    expect(asFound.suggestions).toBe('offered');

    // `autoCorrect={false}` has to send Android's `TYPE_TEXT_FLAG_NO_SUGGESTIONS`: a
    // keyboard left without the autocorrect flag alone still draws its suggestion strip.
    await rerender(<Keyboard autoCorrect={false} />);
    const refused = await stateWhen(
      'keyboard',
      (s) => s.suggestions === 'refused',
      'the keyboard to be told no suggestions'
    );
    expect(refused.focused).toBe(true);
    expect(refused.autoCorrect).toBe(false);

    // Back on a field that never lost focus: the change reaches the keyboard that is up.
    await rerender(<Keyboard autoCorrect />);
    await stateWhen(
      'keyboard',
      (s) => s.suggestions === 'offered',
      'the keyboard to be told suggestions are back'
    );

    // A phone keyboard, mounted rather than reloaded: what it is told is what its props say at
    // mount, with no keyboard restart in between to read half-applied. The refused flag belongs
    // to Android's text class, where in another class the same bit means something else; iOS
    // hands every keyboard the one corrections trait, so it reads refused whatever the keyboard.
    unmount();
    render(
      <Keyboard testID="phone" autoCorrect={false} keyboardType="phone-pad" />
    );
    await waitForTestId('phone');
    await focusField('phone');
    const phone = await stateWhen(
      'phone',
      (s) => s.suggestions !== 'unknown',
      'the phone keyboard to be read back'
    );
    expect(phone.keyboardType).toBe('phone-pad');
    expect(phone.autoCorrect).toBe(false);
    console.log(`phone keyboard told: ${phone.suggestions}`);
    expect(phone.suggestions).toBe(iOS ? 'refused' : 'offered');

    // A secure field with the default, mounted fresh too. Android's field sends no suggestions
    // flag of its own, so it reads as offered. iOS decides for itself that a secure field has
    // no corrections, whatever the prop says, so the answer there is only logged: the point is
    // that this prop being on adds nothing to what the field was already told.
    unmount();
    render(<Keyboard testID="secure" secureTextEntry />);
    await waitForTestId('secure');
    await focusField('secure');
    const secure = await stateWhen(
      'secure',
      (s) => s.suggestions !== 'unknown',
      'the secure field to be read back'
    );
    expect(secure.secure).toBe(true);
    console.log(`secure field told: ${secure.suggestions}`);
    if (!iOS) {
      expect(secure.suggestions).toBe('offered');
    }
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
