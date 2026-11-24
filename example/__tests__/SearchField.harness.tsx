import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, TurboModuleRegistry, View } from 'react-native';
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
import { screen } from '@react-native-harness/ui';
import {
  SearchField,
  TextField,
  nitroUiCore,
  type NitroUiSizingTraceEvent,
  type SearchFieldHandle,
  type TextFieldAutoCapitalize,
  type TextFieldKeyboardType,
} from 'react-native-nitro-ui';
import { waitForHandle } from './handles';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  typeChar(character: string): Promise<void>;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type ProbeModule = {
  imeInput(
    kind: 'commit' | 'compose' | 'finish' | 'cancel' | 'action' | 'connect',
    text: string
  ): Promise<string>;
  /** Android only: `NitroUiProbeModule.searchGlyphPixels`. */
  searchGlyphPixels(): Promise<string>;
  /** Android only: `NitroUiProbeModule.searchFieldStrings`. */
  searchFieldStrings(localeTag: string): Promise<{
    appHint: string;
    appClear: string;
    localeHint: string;
    localeClear: string;
    deviceHint: string;
    deviceClear: string;
    appLocale: string;
    deviceLocale: string;
    requestedLocale: string;
    hostHint: string;
    hostClear: string;
  }>;
};
const probe = (): ProbeModule =>
  TurboModuleRegistry.getEnforcing('NitroUiProbe') as unknown as ProbeModule;

const iOS = Platform.OS === 'ios';

/** Per-channel-sum distance between two `#RRGGBB` colours. */
const colourDistance = (a: string, b: string) => {
  let total = 0;
  for (const offset of [1, 3, 5]) {
    total += Math.abs(
      Number.parseInt(a.slice(offset, offset + 2), 16) -
        Number.parseInt(b.slice(offset, offset + 2), 16)
    );
  }
  return total;
};

/** What the field reports about itself (`NitroUiSearchFieldTestState`). */
type FieldState = {
  text: string;
  focused: boolean;
  composing: boolean;
  nativeEvents: number;
  jsEvents: number;
  lastWrite: string;
  editable: boolean;
  maxLength: number;
  placeholder: string;
  accessibilityLabel: string;
  returnKeyType: string;
  keyboardType: string;
  autoCapitalize: string;
  autoCorrect: boolean;
  expanded: boolean;
  canClear: boolean;
  suggestions: string;
};

/**
 * The `hybridRef` handle. `nuiSizingId` is read by the poisoned-sizing test to pick its
 * own events out of the engine's trace.
 */
type FieldHandle = {
  /** This instance's sizing id: a prop on the native object, which the wrapper's
   * handle type does not list. */
  readonly nuiSizingId?: number;
  measureContent(): { width: number; height: number };
  focus(): void;
  blur(): void;
  nuiTestState(): FieldState;
  nuiTestClear(): void;
  nuiTestSubmit(): void;
  nuiTestLifetimeReport(): string;
};

const handles = new Map<string, FieldHandle>();
/** A handle this file only measures: the TextField's, for the test that puts it next
 * to a SearchField. */
type Measurable = { measureContent(): { width: number; height: number } };
const measurableHandles = new Map<string, Measurable>();
const capture = (id: string) => (view: FieldHandle) => {
  handles.set(id, view);
};
const captureMeasured = (id: string) => (view: Measurable) => {
  measurableHandles.set(id, view);
};
const handleOf = (id: string) =>
  waitForHandle(() => handles.get(id), { what: `SearchField ${id}` });

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
        `SearchField ${id}: ${what} never happened; last report ${JSON.stringify(state)}`
      );
    }
    await sleep(20);
  }
}

/**
 * Wait until the app has been told everything the field published: `jsEvents` is the
 * event count JS echoes back with the commit that ran its callbacks, so the counts
 * agreeing means the log holds every event up to this report. A report can be readable
 * a moment before the event that produced it reaches JS.
 */
async function reportedWhen(
  id: string,
  check: (state: FieldState) => boolean,
  what: string
): Promise<FieldState> {
  return stateWhen(
    id,
    (state) => state.jsEvents === state.nativeEvents && check(state),
    `${what}, and every event reported to JS`
  );
}

/**
 * Wait until the app's log for `id` holds as many entries after the first `before` of
 * them as `expected` has, then return that slice. A field's native report settles as the
 * event is sent, so a log read as soon as native looks done can still be short of the
 * events that are on their way to JS.
 */
async function logReached(
  id: string,
  expected: readonly string[],
  before = 0,
  timeoutMs = 5000
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const logged = eventsOf(id).slice(before);
    if (logged.length >= expected.length) return logged;
    if (Date.now() > deadline) {
      const missing = expected.filter((entry) => !logged.includes(entry));
      throw new Error(
        `SearchField ${id}: log holds ${JSON.stringify(
          logged
        )} after ${String(timeoutMs)}ms; still missing ${JSON.stringify(
          missing
        )}`
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
 * Move the field's focus away and back, then wait for its report to satisfy `check`,
 * so the value is read from an input session that started with it.
 */
async function refocusAndRead(
  id: string,
  check: (state: FieldState) => boolean,
  what: string
): Promise<FieldState> {
  const handle = await handleOf(id);
  handle.blur();
  await stateWhen(id, (state) => !state.focused, 'the field to give up focus');
  // The session ends with the focus and starts a frame later; a blur and a focus in the
  // same turn are one frame, and the second session has to be a new one.
  await sleep(150);
  handle.focus();
  await stateWhen(id, (state) => state.focused, 'the field to take focus back');
  // `pending` is Android's "focused, and the IME's editor info not read yet": never an
  // answer, so a check that only looks at `autoCorrect` cannot pass on it.
  return stateWhen(
    id,
    (state) => state.keyboardType !== 'pending' && check(state),
    what,
    8000
  );
}

/**
 * Type `text` into the focused field one key at a time, as a keyboard does: one code
 * point per key, which is what a single-code-point emoji key sends. A ZWJ sequence is
 * only ever sent whole (`insertAtOnce`).
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
  await sleep(40);
}

/** Wait until the field has a real measured box, and return it. */
async function measuredBox(id: string) {
  return boxOf(await handleOf(id));
}

/** The same, for a handle filed by {@link captureMeasured}. */
async function measuredTextBox(id: string) {
  return boxOf(
    await waitForHandle(() => measurableHandles.get(id), {
      what: `TextField ${id}`,
    })
  );
}

async function boxOf(handle: Measurable) {
  await waitFor(
    () => expect(handle.measureContent().height).toBeGreaterThan(0),
    { timeout: 5000 }
  );
  return handle.measureContent();
}

/** The JS side's own copy of a controlled field's text, for each test to read. */
const jsValues = new Map<string, string>();

/**
 * A controlled search field, with every callback logged. `accept` false is the frozen
 * field: every edit is reported and refused, so the handshake has to revert it.
 */
function Controlled({
  id,
  initial,
  accept = true,
  maxLength,
  placeholder,
  editable = true,
  width,
}: {
  id: string;
  initial: string;
  accept?: boolean;
  maxLength?: number;
  placeholder?: string;
  editable?: boolean;
  width?: number;
}) {
  const [value, setValue] = useState(initial);
  jsValues.set(id, value);
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
      <SearchField
        testID={id}
        accessibilityLabel={`Field ${id}`}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onSubmitEditing={onSubmit}
        maxLength={maxLength}
        placeholder={placeholder}
        editable={editable}
        hybridRef={capture(id)}
      />
    </View>
  );
}

/**
 * A field whose three keyboard props come from the test, so one `rerender` can move
 * them while the field holds the keyboard.
 */
function Keyboard({
  keyboardType,
  autoCapitalize,
  autoCorrect,
}: {
  keyboardType?: TextFieldKeyboardType;
  autoCapitalize?: TextFieldAutoCapitalize;
  autoCorrect?: boolean;
}) {
  return (
    <SearchField
      testID="keyboard"
      accessibilityLabel="Keyboard search field"
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      hybridRef={capture('keyboard')}
    />
  );
}

/**
 * What each `keyboardType` is expected to read back as. The platforms differ in one
 * row: Android offers one keyboard for both `numeric` and `decimal-pad`, so there the
 * read-back names the keyboard the IME was handed.
 */
const KEYBOARD_READ_BACK: Record<TextFieldKeyboardType, string> = iOS
  ? {
      'default': 'default',
      'number-pad': 'number-pad',
      'decimal-pad': 'decimal-pad',
      'numeric': 'numeric',
      'email-address': 'email-address',
      'phone-pad': 'phone-pad',
      'url': 'url',
    }
  : {
      'default': 'default',
      'number-pad': 'number-pad',
      'decimal-pad': 'decimal-pad',
      'numeric': 'decimal-pad',
      'email-address': 'email-address',
      'phone-pad': 'phone-pad',
      'url': 'url',
    };

/**
 * A field focused from its parent's mount effect - the way an app opens a search screen
 * with the caret already in the field. `hybridRef` arrives on a later turn than the
 * commit that mounted the field, so this asks the wrapper to hold the ask.
 */
function FocusOnMount() {
  const ref = useRef<SearchFieldHandle>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <SearchField
      ref={ref}
      testID="focus-on-mount"
      hybridRef={capture('focus-on-mount')}
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
  measurableHandles.clear();
  events.clear();
  jsValues.clear();
  await sleep(150);
});

describe('SearchField', () => {
  it('round-trips typed text to JS, one event per keystroke', async () => {
    render(<Controlled id="typed" initial="" />);
    await waitForTestId('typed');
    await focusField('typed');
    await typeText('abc');
    const state = await stateWhen(
      'typed',
      (current) => current.text === 'abc',
      'the three keystrokes'
    );
    expect(eventsOf('typed')).toEqual([
      'focus',
      'change:a',
      'change:ab',
      'change:abc',
    ]);
    // One native event per keystroke, and the echo the wrapper sent back for each.
    expect(state.nativeEvents).toBe(3);
    expect(state.jsEvents).toBe(3);
    expect(jsValues.get('typed')).toBe('abc');
  });

  it('reverts an edit JS refuses, and the next edit starts from the refused text', async () => {
    render(<Controlled id="frozen" initial="frozen" accept={false} />);
    await waitForTestId('frozen');
    await focusField('frozen');
    await typeText('x');
    const state = await stateWhen(
      'frozen',
      (current) => current.text === 'frozen',
      'the revert'
    );
    expect(eventsOf('frozen')).toEqual(['focus', 'change:frozenx']);
    // The revert is an *applied* write: JS's `value` won, because native had reported
    // the edit and JS had echoed the count.
    expect(state.lastWrite).toBe('applied');
    expect(jsValues.get('frozen')).toBe('frozen');
    // A second key starts from the reverted text, not from the refused one.
    await typeText('y');
    const after = await stateWhen(
      'frozen',
      (current) => current.text === 'frozen',
      'the second revert'
    );
    expect(eventsOf('frozen').slice(2)).toEqual(['change:frozeny']);
    expect(after.nativeEvents).toBe(2);
  });

  it('holds maxLength in UTF-16 units and never splits an emoji', async () => {
    // On Android the limit runs through Material's `inputTransformation` here, a
    // different input path from TextField's.
    render(<Controlled id="capped" initial="" maxLength={5} />);
    await waitForTestId('capped');
    await focusField('capped');
    // 'ab👍cd' is 6 code units; 5 fit, and the 5th is a grapheme boundary.
    await insertAtOnce('ab👍cd');
    const state = await stateWhen(
      'capped',
      (current) => current.text.length === 5,
      'the cut to 5 code units'
    );
    expect(state.text).toBe('ab👍c');
    expect(state.text.length).toBe(5);
    expect(eventsOf('capped').at(-1)).toBe('change:ab👍c');
    // One more key does not fit: nothing is inserted and nothing is reported.
    await typeText('d');
    await sleep(120);
    expect(handles.get('capped')?.nuiTestState().text).toBe('ab👍c');
    expect(eventsOf('capped').at(-1)).toBe('change:ab👍c');
  });

  it('cuts an insertion at a grapheme boundary rather than leaving half an emoji', async () => {
    // 👩‍👩‍👦 is one cluster over 8 code units, so a cap of 3 cannot hold any of it. A cut
    // that ignored clusters would leave a lone surrogate and a ZWJ in the field - text
    // no platform can draw and JS cannot compare.
    render(<Controlled id="family" initial="" maxLength={3} />);
    await waitForTestId('family');
    await focusField('family');
    await insertAtOnce('👩‍👩‍👦');
    await sleep(150);
    const state = handles.get('family')?.nuiTestState();
    expect(state?.text).toBe('');
    expect(
      eventsOf('family').filter((entry) => entry.startsWith('change:'))
    ).toEqual([]);
    // The cap still lets ordinary text through afterwards: the refusal was about size,
    // not a stuck field.
    await typeText('ab');
    const after = await stateWhen(
      'family',
      (current) => current.text === 'ab',
      'text after the refused cluster'
    );
    expect(after.text).toBe('ab');
  });

  it('reports the clear button as one empty edit and keeps the focus', async () => {
    render(<Controlled id="cleared" initial="" />);
    await waitForTestId('cleared');
    await focusField('cleared');
    await typeText('hi');
    const typed = await stateWhen(
      'cleared',
      (current) => current.text === 'hi',
      'the text to clear'
    );
    expect(typed.canClear).toBe(true);
    const before = eventsOf('cleared').length;
    // The control's own clear handler, not a write into its state.
    (await handleOf('cleared')).nuiTestClear();
    const cleared = await reportedWhen(
      'cleared',
      (current) => current.text === '',
      'the clear'
    );
    // The native report settles as the event is sent, so the log can still be a moment
    // short of the clear's own event here.
    const reported = await logReached('cleared', ['change:'], before);
    expect(reported).toEqual(['change:']);
    expect(cleared.nativeEvents).toBe(typed.nativeEvents + 1);
    // Focus stays: clearing a query is not leaving the field.
    expect(cleared.focused).toBe(true);
    expect(eventsOf('cleared').filter((entry) => entry === 'blur')).toEqual([]);
  });

  it('refuses to clear a field that is not editable', async () => {
    render(<Controlled id="uncleared" initial="shown" editable={false} />);
    await waitForTestId('uncleared');
    const before = await handleOf('uncleared');
    expect(before.nuiTestState().canClear).toBe(false);
    before.nuiTestClear();
    await sleep(150);
    expect(handles.get('uncleared')?.nuiTestState().text).toBe('shown');
    expect(eventsOf('uncleared')).toEqual([]);
  });

  it('submits on the Search key, then blurs - and never on an empty field', async () => {
    render(<Controlled id="submitted" initial="" />);
    await waitForTestId('submitted');
    await focusField('submitted');
    await typeText('tea');
    (await handleOf('submitted')).nuiTestSubmit();
    const after = await stateWhen(
      'submitted',
      (current) => !current.focused,
      'the blur after the submit'
    );
    const submitted = [
      'focus',
      'change:t',
      'change:te',
      'change:tea',
      'submit:tea',
      'blur',
    ];
    expect(await logReached('submitted', submitted)).toEqual(submitted);
    expect(after.returnKeyType).toBe('search');

    // A fresh empty field, not this one: submitting does not clear the query, so "tea"
    // is still in the box here. iOS refuses an empty submit through
    // `enablesReturnKeyAutomatically`, Android through a guard on the Search handler,
    // and the seam runs that same guard either way.
    render(<Controlled id="unsubmitted" initial="" />);
    await waitForTestId('unsubmitted');
    await focusField('unsubmitted');
    expect((await handleOf('unsubmitted')).nuiTestState().text).toBe('');
    (await handleOf('unsubmitted')).nuiTestSubmit();
    await sleep(150);
    // Exactly one event, and it is the focus: no `submit:`, and no `blur` either -
    // refusing a submit from an empty query does not send the field away.
    expect(eventsOf('unsubmitted')).toEqual(['focus']);
  });

  it('takes no submit from a Return pressed on a query it has just cleared', async () => {
    // `nuiTestSubmit` runs the field's own `textFieldShouldReturn` (iOS) and `onSearch`
    // handler (Android), the route a hardware Return takes. UIKit greys out the
    // software key on an empty field but still delivers a hardware Return.
    render(<Controlled id="recleared" initial="" />);
    await waitForTestId('recleared');
    await focusField('recleared');
    await typeText('ru');
    (await handleOf('recleared')).nuiTestClear();
    // The clear's own event has to be in the log before the count is taken, or a later
    // event is mistaken for it.
    await reportedWhen(
      'recleared',
      (current) => current.text === '',
      'the clear'
    );
    const before = eventsOf('recleared').length;
    (await handleOf('recleared')).nuiTestSubmit();
    await sleep(150);
    // No `submit:` carrying an empty query, and no `blur` either.
    expect(eventsOf('recleared').slice(before)).toEqual([]);
    expect((await handleOf('recleared')).nuiTestState().focused).toBe(true);
  });

  it('sizes itself to its parent width and its own height, whatever its text', async () => {
    render(
      <>
        <Controlled
          id="wide"
          initial="a query long enough to want two lines"
          width={300}
        />
        <Controlled id="empty" initial="" width={300} />
        {/* A TextField in the same column: the two are different controls, and
            their heights differ. */}
        <View style={{ width: 300 }}>
          <TextField
            testID="plain-field"
            defaultValue="same words here"
            hybridRef={captureMeasured('plain-field')}
          />
        </View>
      </>
    );
    await waitForTestId('wide');
    await waitForTestId('empty');
    await waitForTestId('plain-field');
    const wide = await measuredBox('wide');
    const empty = await measuredBox('empty');
    const box = harnessUi.queryByTestId('wide');
    const emptyBox = harnessUi.queryByTestId('empty');
    expect(box).not.toBeNull();
    expect(emptyBox).not.toBeNull();
    // The width is the parent's, not the text's (`fillWidth`).
    expect(box?.width).toBeCloseTo(300, 0);
    expect(emptyBox?.width).toBeCloseTo(300, 0);
    // The box is what the field measured, and text does not move it.
    expect(Math.abs((box?.height ?? 0) - wide.height)).toBeLessThan(1);
    expect(Math.abs(empty.height - wide.height)).toBeLessThan(1);
    // Two fields measured on their own agree.
    expect(Math.abs((emptyBox?.height ?? 0) - (box?.height ?? 0))).toBeLessThan(
      1
    );
    // And it is not TextField's height (22 pt / 24 dp), which a SearchField that
    // composed TextField's control would measure here.
    const plain = await measuredTextBox('plain-field');
    console.log(
      `search field height ${wide.height.toFixed(2)} vs text field ${plain.height.toFixed(2)}`
    );
    expect(Math.abs(wide.height - plain.height)).toBeGreaterThan(2);
  });

  it('focuses from its parent’s mount effect', async () => {
    render(<FocusOnMount />);
    await waitForTestId('focus-on-mount');
    // No `await handleOf` first: the point is that the ask was made before the handle
    // existed, and the wrapper held it.
    const state = await stateWhen(
      'focus-on-mount',
      (current) => current.focused,
      'the focus asked for in a mount effect'
    );
    expect(state.editable).toBe(true);
  });

  it('keeps its box while focused: the search bar does not expand', async () => {
    render(<Controlled id="steady" initial="" width={320} />);
    await waitForTestId('steady');
    const before = await measuredBox('steady');
    const boxBefore = harnessUi.queryByTestId('steady');
    await focusField('steady');
    await typeText('growing query that a bar might want to make room for');
    await sleep(200);
    const handle = await handleOf('steady');
    const after = handle.measureContent();
    const boxAfter = harnessUi.queryByTestId('steady');
    // On Android `expanded` is the state the bar is drawn from, and a docked bar keeps
    // its height whatever that flag says, so the flag is asserted directly. iOS reports
    // no expanded state, so the height checks below are its oracle.
    expect(handle.nuiTestState().expanded).toBe(false);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
    expect(
      Math.abs((boxAfter?.height ?? 0) - (boxBefore?.height ?? 0))
    ).toBeLessThan(1);
    expect(handle.nuiTestState().focused).toBe(true);
  });

  it('shows the placeholder it was given, and what the platform brings when given none', async () => {
    render(
      <>
        <Controlled id="prompted" initial="" placeholder="Search recipes" />
        <Controlled id="unprompted" initial="" />
      </>
    );
    await waitForTestId('prompted');
    await waitForTestId('unprompted');
    const prompted = await stateWhen(
      'prompted',
      (current) => current.placeholder === 'Search recipes',
      'the placeholder it was given'
    );
    expect(prompted.placeholder).toBe('Search recipes');
    // Material 3's search input answers with the framework's localized hint. UIKit's
    // standalone `UISearchTextField` has no prompt of its own (UIKit only writes
    // "Search" inside a search bar), so an unset `placeholder` draws nothing there.
    const unprompted = handles.get('unprompted')?.nuiTestState();
    if (iOS) {
      expect(unprompted?.placeholder).toBe('');
    } else {
      expect(unprompted?.placeholder ?? '').not.toBe('');
    }
    expect(unprompted?.placeholder).not.toBe('Search recipes');
  });

  /*
   * The default prompt and the clear button's label are the framework's private strings,
   * so the question is which configuration they are read from: the app's views are drawn
   * in one, the device in another, and a per-app language on Android 13 and later makes
   * them differ. German is what the framework translates both strings into.
   */
  it('reads its prompt and clear label in the app’s language', async () => {
    // Android only: the strings are Android framework resources, and iOS draws no prompt.
    if (iOS) return;
    render(<Controlled id="localized" initial="" />);
    await waitForTestId('localized');
    const drawn = await stateWhen(
      'localized',
      (current) => current.placeholder !== '',
      'the framework prompt'
    );

    const inGerman = await probe().searchFieldStrings('de');
    expect(inGerman.requestedLocale).toBe('de');
    // The check only means something if the emulator itself is not in German.
    expect(inGerman.requestedLocale).not.toBe(inGerman.appLocale);
    expect(inGerman.localeHint).toBe('Suchen…');
    expect(inGerman.localeClear).toBe('Anfrage löschen');
    expect(inGerman.localeHint).not.toBe(inGerman.deviceHint);
    expect(inGerman.localeClear).not.toBe(inGerman.deviceClear);

    // Reading a language leaves every other answer alone, and reading it again gives the
    // same words: the strings belong to a configuration, not to the process.
    const readAgain = await probe().searchFieldStrings('de');
    expect(readAgain.localeHint).toBe(inGerman.localeHint);
    expect(readAgain.localeClear).toBe(inGerman.localeClear);
    expect(readAgain.appHint).toBe(inGerman.appHint);
    expect(readAgain.appClear).toBe(inGerman.appClear);

    // What the mounted field draws is what its own context resolves.
    expect(drawn.placeholder).toBe(inGerman.appHint);
    expect(inGerman.hostHint).toBe(inGerman.appHint);
    expect(inGerman.hostClear).toBe(inGerman.appClear);
    console.log(
      `search field strings: app ${inGerman.appLocale} prompt ` +
        `"${inGerman.appHint}", de prompt "${inGerman.localeHint}"`
    );
  });

  it('draws its search glyph as a magnifier: a painted ring around an unpainted lens', async () => {
    // Android only: reads the pixels the search glyph paints, which no other test
    // looks at. iOS draws UIKit's own glyph.
    if (iOS) return;
    render(<Controlled id="glyph" initial="" />);
    await waitForTestId('glyph');
    await measuredBox('glyph');
    // Until the composition has laid the icon out the probe answers why it found nothing;
    // only that is retried, never a reading.
    const deadline = nitroUiCore.now() + 5000;
    let answer = await probe().searchGlyphPixels();
    while (!answer.startsWith('box=') && nitroUiCore.now() < deadline) {
      await sleep(50);
      answer = await probe().searchGlyphPixels();
    }
    const point = (name: string) => {
      const match = new RegExp(`\\|${name}=(#[0-9A-F]{6})`).exec(answer);
      if (match == null) throw new Error(`no ${name} in "${answer}"`);
      return match[1]!;
    };
    const bg = point('bg');
    // The lens centre is the backdrop; both points on the ring's stroke are the glyph.
    // A distance under 40 is the backdrop and over 120 is the glyph: the icon's
    // onSurfaceVariant and the field's container are far apart in both schemes, and the
    // sampled points sit at least 1 dp inside an edge, clear of antialiasing.
    const painted = (name: string) => {
      const distance = colourDistance(point(name), bg);
      if (distance < 40) return 'clear';
      return distance > 120 ? 'painted' : `between(${distance})`;
    };
    const verdict = `lens=${painted('centre')} ring=${painted('ring')} ringTop=${painted('ringTop')}`;
    if (verdict !== 'lens=clear ring=painted ringTop=painted') {
      throw new Error(
        `the search glyph is not a magnifier: ${verdict} (${answer})`
      );
    }
    expect(verdict).toBe('lens=clear ring=painted ringTop=painted');
  });

  it('gives the field the keyboard the app asked for, Search key included', async () => {
    const { rerender } = await render(<Keyboard />);
    await waitForTestId('keyboard');
    await focusField('keyboard');

    // 1. The defaults, read back from a focused field: what an app that passes no
    // keyboard prop gets.
    const asFound = await stateWhen(
      'keyboard',
      (current) => current.keyboardType !== 'pending',
      'the focused field to read its keyboard back'
    );
    expect(asFound.focused).toBe(true);
    expect(asFound.keyboardType).toBe('default');
    expect(asFound.autoCapitalize).toBe('none');
    expect(asFound.autoCorrect).toBe(true);
    expect(asFound.returnKeyType).toBe('search');

    // 2. A keyboard change while the keyboard is up reaches the focused field, with
    // focus never moving. iOS: a `UITextInputTraits` setter does not reach a visible
    // keyboard, so the field reloads its input views. Android: Compose restarts the
    // input session when a focused field's keyboard options change; this reads the
    // `EditorInfo` the field now hands the IME.
    await rerender(<Keyboard keyboardType="number-pad" />);
    const reloaded = await stateWhen(
      'keyboard',
      (current) =>
        current.keyboardType === KEYBOARD_READ_BACK['number-pad'] &&
        current.focused,
      'a focused field to reload its own keyboard',
      8000
    );
    expect(reloaded.focused).toBe(true);
    expect(reloaded.returnKeyType).toBe('search');

    // 3. Every keyboard type, one at a time, each with the field taking focus again.
    // iOS reads the traits back off the `UITextField`; Android asks the focused field
    // for the `EditorInfo` it hands the IME.
    for (const type of Object.keys(
      KEYBOARD_READ_BACK
    ) as TextFieldKeyboardType[]) {
      const expected = KEYBOARD_READ_BACK[type];
      await rerender(<Keyboard keyboardType={type} />);
      const applied = await refocusAndRead(
        'keyboard',
        (current) => current.keyboardType === expected,
        `the ${type} keyboard to reach the field`
      );
      console.log(
        `search field keyboardType="${type}" read back "${applied.keyboardType}" ` +
          `(return key "${applied.returnKeyType}", focused ${String(applied.focused)})`
      );
      expect(applied.keyboardType).toBe(expected);
      // Whatever the keys are, the key that submits a query stays Search.
      expect(applied.returnKeyType).toBe('search');
      expect(applied.focused).toBe(true);
    }

    // 4. The two remaining props, each moved on its own on a text keyboard: they are
    // flags of Android's text input class.
    for (const capitalisation of [
      'words',
      'characters',
      'sentences',
    ] as TextFieldAutoCapitalize[]) {
      await rerender(
        <Keyboard keyboardType="default" autoCapitalize={capitalisation} />
      );
      const moved = await refocusAndRead(
        'keyboard',
        (current) => current.autoCapitalize === capitalisation,
        `the ${capitalisation} capitalisation to reach the field`
      );
      console.log(
        `search field autoCapitalize="${capitalisation}" read back ` +
          `"${moved.autoCapitalize}"`
      );
      expect(moved.autoCapitalize).toBe(capitalisation);
    }
    await rerender(<Keyboard keyboardType="default" autoCorrect={false} />);
    const refused = await refocusAndRead(
      'keyboard',
      (current) => current.autoCorrect === false,
      'autocorrection to be refused'
    );
    console.log(
      `search field autoCorrect=false read back ${String(refused.autoCorrect)}`
    );
    expect(refused.autoCorrect).toBe(false);

    // 5. All three at once, on a number keyboard.
    await rerender(
      <Keyboard
        keyboardType="number-pad"
        autoCorrect={false}
        autoCapitalize="characters"
      />
    );
    const together = await refocusAndRead(
      'keyboard',
      (current) =>
        current.keyboardType === KEYBOARD_READ_BACK['number-pad'] &&
        current.autoCorrect === false,
      'a field to take all three keyboard props at once'
    );
    console.log(`search field all three read back ${JSON.stringify(together)}`);
    expect(together.keyboardType).toBe(KEYBOARD_READ_BACK['number-pad']);
    expect(together.autoCorrect).toBe(false);
    // Android's capitalisation flags belong to the text input class, so a number
    // keyboard reports none whatever was asked; iOS has one trait either way.
    expect(together.autoCapitalize).toBe(iOS ? 'characters' : 'none');
    expect(together.returnKeyType).toBe('search');
  });

  /*
   * What the keyboard was told about suggestions and autocorrections, read back rather than
   * from the prop that asked for it: on Android the `EditorInfo` a focused field hands the
   * IME, on iOS the autocorrection trait it carries. `'unknown'` means nothing has been read
   * yet, so every wait below goes past it and never reads a wish as an answer.
   */
  it('tells the keyboard what autoCorrect asked for', async () => {
    const { rerender } = await render(<Keyboard />);
    await waitForTestId('keyboard');
    await focusField('keyboard');

    const asFound = await stateWhen(
      'keyboard',
      (current) => current.suggestions !== 'unknown',
      'the focused field to read its keyboard back'
    );
    expect(asFound.focused).toBe(true);
    expect(asFound.suggestions).toBe('offered');

    // `autoCorrect={false}` has to send Android's `TYPE_TEXT_FLAG_NO_SUGGESTIONS`: a text
    // keyboard left without the autocorrect flag alone still draws its suggestion strip.
    await rerender(<Keyboard autoCorrect={false} />);
    const refused = await stateWhen(
      'keyboard',
      (current) => current.suggestions === 'refused',
      'the keyboard to be told no suggestions',
      8000
    );
    expect(refused.focused).toBe(true);
    expect(refused.autoCorrect).toBe(false);
    console.log(
      `search field autoCorrect=false read back ${refused.suggestions}`
    );

    // On a field that never lost focus: the change reaches the keyboard that is already up.
    await rerender(<Keyboard autoCorrect />);
    const offered = await stateWhen(
      'keyboard',
      (current) => current.suggestions === 'offered',
      'the keyboard to be told suggestions are back',
      8000
    );
    expect(offered.focused).toBe(true);
    expect(offered.autoCorrect).toBe(true);
  });

  it('comes back from the pool with none of its previous owner', async () => {
    function Owner({ second }: { second: boolean }) {
      return second ? (
        <SearchField
          key="owner"
          testID="pooled"
          defaultValue="second"
          hybridRef={capture('pooled')}
        />
      ) : (
        <SearchField
          key="owner"
          testID="pooled"
          defaultValue="first"
          placeholder="first owner"
          maxLength={9}
          keyboardType="number-pad"
          autoCapitalize="words"
          autoCorrect={false}
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
      // Short on purpose: `maxLength={9}` caps the field, and an insertion that would
      // pass it is truncated.
      await typeText('due');
      await stateWhen('pooled', (s) => s.text === 'firstdue', 'the residue');
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
      // The platform's own prompt, not the first owner's.
      expect(state.placeholder).not.toBe('first owner');
      expect(state.maxLength).toBe(-1);
      expect(state.accessibilityLabel).toBe('');
      expect(state.editable).toBe(true);
      expect(state.nativeEvents).toBe(0);
      expect(state.jsEvents).toBe(0);
      expect(state.returnKeyType).toBe('search');
      // The previous owner's keyboard goes with the rest of its configuration.
      expect(state.keyboardType).toBe('default');
      expect(state.autoCapitalize).toBe('none');
      expect(state.autoCorrect).toBe(true);
      const lifetime = handle.nuiTestLifetimeReport();
      recycled = /recycles=[1-9]/.test(lifetime);
      console.log(`search field recycle round ${round}: ${lifetime}`);
      if (recycled) {
        // The reset itself, recorded by `prepareForRecycle` before the second owner's
        // props land. The assertions above cannot see it: every prop is always passed,
        // so the second owner's defaults would mask a reset that kept the number pad.
        expect(lifetime).toContain('resetKeyboard=default/none/true');
      }
      cleanup();
      handles.clear();
      await sleep(200);
    }
    // The assertions above only test a reset if the second owner *was* the first
    // owner's view; a fresh instance passes them all trivially.
    expect(recycled).toBe(true);
  });

  it('lays out at its declared fallback and corrects to what it measures', async () => {
    // Last, because poisoning is process-wide: `seedSizingSize` writes the component's
    // declared size as well as its cached guess, so this puts the number back before it
    // finishes.
    const POISON = iOS ? { width: 97, height: 11 } : { width: 111, height: 13 };
    // Must agree with the component's own declaration: `fallbackSize` in
    // `HybridNitroUiSearchField.swift`, `FALLBACK_HEIGHT_DP` in
    // `HybridNitroUiSearchField.kt`, and the table in `scripts/conformance-core.mjs`.
    const DECLARED = iOS
      ? { width: 200, height: 28 }
      : { width: 200, height: 56 };
    nitroUiCore.setSizingTraceEnabled(true);
    nitroUiCore.drainSizingTrace();
    nitroUiCore.seedSizingSize(
      'NitroUiSearchField',
      '',
      POISON.width,
      POISON.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    try {
      render(<Controlled id="poisoned" initial="" width={280} />);
      await waitForTestId('poisoned');
      const handle = await handleOf('poisoned');
      const measured = await measuredBox('poisoned');
      await sleep(300);
      const traced = nitroUiCore
        .drainSizingTrace()
        .filter((event) => event.instanceId === (handle.nuiSizingId ?? 0));
      const describeEvent = (event: NitroUiSizingTraceEvent) =>
        `${event.stage} ${String(event.width.toFixed(1))}x${String(event.height.toFixed(1))}`;
      console.log(
        `poisoned search field: ${traced.map(describeEvent).join(', ')}; measured ${String(measured.height.toFixed(2))}`
      );
      const laidOut = traced.filter((event) => event.stage === 'laidOut');
      const corrected = traced.filter((event) => event.stage === 'corrected');
      const firstFrame = laidOut[0];
      const lastCorrection = corrected.at(-1);
      if (firstFrame == null || lastCorrection == null) {
        throw new Error(
          `no ${firstFrame == null ? 'laidOut' : 'corrected'} event in this ` +
            `instance's trace: ${traced.map(describeEvent).join(', ') || '(empty)'}`
        );
      }
      // The first frame is the poison: only the declared size could have produced it.
      expect(Math.abs(firstFrame.height - POISON.height)).toBeLessThan(1);
      // And it was corrected, to the size the control really is.
      expect(Math.abs(lastCorrection.height - measured.height)).toBeLessThan(1);
      expect(Math.abs(measured.height - POISON.height)).toBeGreaterThan(2);
    } finally {
      nitroUiCore.seedSizingSize(
        'NitroUiSearchField',
        '',
        DECLARED.width,
        DECLARED.height
      );
      nitroUiCore.invalidateSizingEnvironment();
      nitroUiCore.setSizingTraceEnabled(false);
    }
  });
});
