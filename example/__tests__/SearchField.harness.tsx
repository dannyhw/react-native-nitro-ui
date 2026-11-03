/**
 * On-device tests for the SearchField (G17).
 *
 * The typing here is IME-level on both platforms, never a write into the field's state -
 * the same two seams `TextField.harness.tsx` documents and the reasons there still
 * apply: `HarnessUI.typeChar` on iOS (`insertText(_:)` on the first responder, which
 * runs the field's delegate and its `editingChanged`), and the example app's
 * `NitroUiProbe.imeInput` on Android (a Compose field has no `EditText` for
 * `typeChar` to reach, so the text goes in through the focused view's own
 * `InputConnection`, running the `InputTransformation` like a keyboard's would). The
 * field is `UISearchTextField` on iOS and Material 3's search input on Android, and
 * neither distinction changes what the seams do.
 *
 * The clear button and the Search key are this component's own two affordances, so they
 * have their own seams (`nuiTestClear`, `nuiTestSubmit`), each of which runs the control's
 * own handler and its own guard rather than writing the result.
 *
 * The OS-level oracle - keystrokes from outside the app - is the real-input suite
 * (`CHECKS['search-field']`, `testRealInputSearchField`). The "first frame at the
 * declared size, then one correction" half of the sizing rule runs in
 * `Conformance.harness.tsx`, which poisons every control's declaration from one shared
 * table; test 9 here poisons *this* component again on its own, so that a SearchField
 * laid out at a size that belongs to nothing is caught in the file that owns the
 * component too.
 *
 * @file Gates: `harness:ios`, `harness:android`.
 */
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
};
const probe = (): ProbeModule =>
  TurboModuleRegistry.getEnforcing('NitroUiProbe') as unknown as ProbeModule;

const iOS = Platform.OS === 'ios';

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
  expanded: boolean;
  canClear: boolean;
};

/**
 * The `hybridRef` handle, declared here (D14: no public Hybrid View types).
 * `nuiSizingId` is read by the poisoned-sizing test to pick its own events out of the
 * engine's trace.
 */
type FieldHandle = {
  /** This instance's sizing id, as sent. Read the way `ColdSizing.harness.tsx` reads
   * it: a prop on the native object, which the wrapper's handle type does not list. */
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
const capture = (id: string) => (view: FieldHandle) => {
  handles.set(id, view);
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

/** Focus `id` through its `ref`-backed native method, and wait for it to land. */
async function focusField(id: string) {
  const handle = await handleOf(id);
  handle.focus();
  await stateWhen(id, (state) => state.focused, 'focus');
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
  const handle = await handleOf(id);
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
    // The Android input path is new even though the rule is TextField's:
    // `NitroUiTextLimit` is reached through Material's `inputTransformation` here, not
    // through `BasicTextField`'s, so it is asserted again rather than trusted.
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
    const cleared = await stateWhen(
      'cleared',
      (current) => current.text === '',
      'the clear'
    );
    const reported = eventsOf('cleared').slice(before);
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
    expect(eventsOf('submitted')).toEqual([
      'focus',
      'change:t',
      'change:te',
      'change:tea',
      'submit:tea',
      'blur',
    ]);
    expect(after.returnKeyType).toBe('search');

    // The barrier twin: an empty field cannot submit. iOS gets this from
    // `enablesReturnKeyAutomatically`, Android from a guard on the Search handler, and
    // the seam runs the same guard either way.
    events.delete('submitted');
    (await handleOf('submitted')).nuiTestSubmit();
    await sleep(150);
    expect(eventsOf('submitted')).toEqual([]);
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
        {/* A TextField in the same column: the two are different controls, and the
            whole reason SearchField is its own Hybrid View is that their heights
            differ (docs/architecture/sizing.md §5, D38 item 2). */}
        <View style={{ width: 300 }}>
          <TextField testID="plain-field" defaultValue="same words here" />
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
    // One configuration: two fields measured on their own agree, so the key the wrapper
    // sends really is a constant.
    expect(Math.abs((emptyBox?.height ?? 0) - (box?.height ?? 0))).toBeLessThan(
      1
    );
    // And it is *not* TextField's height: a SearchField that composed TextField's
    // control would measure 22 pt / 24 dp here and pass every assertion above.
    const plain = await measuredBox('plain-field');
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
    expect(handle.nuiTestState().expanded).toBe(false);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
    expect(
      Math.abs((boxAfter?.height ?? 0) - (boxBefore?.height ?? 0))
    ).toBeLessThan(1);
    expect(handle.nuiTestState().focused).toBe(true);
  });

  it('shows the placeholder it was given, and the platform’s own when given none', async () => {
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
    // Nobody asked for English: both platforms answer with their own localized word,
    // which the report shows as what the control is drawing.
    const unprompted = handles.get('unprompted')?.nuiTestState();
    expect(unprompted?.placeholder ?? '').not.toBe('');
    expect(unprompted?.placeholder).not.toBe('Search recipes');
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
      await stateWhen(
        'pooled',
        (s) => s.text === 'firstresidue',
        'the residue'
      );
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
      // UIKit's own prompt, not the previous row's; Android's, likewise. Either way the
      // claim is "not the first owner's", which is the residue that matters.
      expect(state.placeholder).not.toBe('first owner');
      expect(state.maxLength).toBe(-1);
      expect(state.accessibilityLabel).toBe('');
      expect(state.editable).toBe(true);
      expect(state.nativeEvents).toBe(0);
      expect(state.jsEvents).toBe(0);
      expect(state.returnKeyType).toBe('search');
      const lifetime = handle.nuiTestLifetimeReport();
      recycled = /recycles=[1-9]/.test(lifetime);
      console.log(`search field recycle round ${round}: ${lifetime}`);
      cleanup();
      handles.clear();
      await sleep(200);
    }
    // The assertions above only test a reset if the second owner *was* the first
    // owner's view; a fresh instance passes them all trivially.
    expect(recycled).toBe(true);
  });

  it('lays out at its declared fallback and corrects to what it measures', async () => {
    // Last, because poisoning is a process-wide act: `seedSizingSize` writes the
    // component's declared size as well as its cached guess, so this leaves the number
    // back where `scripts/conformance-core.mjs` says it belongs before it finishes.
    const POISON = iOS ? { width: 97, height: 11 } : { width: 111, height: 13 };
    const DECLARED = iOS
      ? { width: 200, height: 37 }
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
      const events = nitroUiCore
        .drainSizingTrace()
        .filter((event) => event.instanceId === (handle.nuiSizingId ?? 0));
      const describe = (event: NitroUiSizingTraceEvent) =>
        `${event.stage} ${String(event.width.toFixed(1))}x${String(event.height.toFixed(1))}`;
      console.log(
        `poisoned search field: ${events.map(describe).join(', ')}; measured ${String(measured.height.toFixed(2))}`
      );
      const laidOut = events.filter((event) => event.stage === 'laidOut');
      const corrected = events.filter((event) => event.stage === 'corrected');
      const firstFrame = laidOut[0];
      const lastCorrection = corrected.at(-1);
      if (firstFrame == null || lastCorrection == null) {
        throw new Error(
          `no ${firstFrame == null ? 'laidOut' : 'corrected'} event in this ` +
            `instance's trace: ${events.map(describe).join(', ') || '(empty)'}`
        );
      }
      // The first frame is the poison: the engine answered for a cold configuration with
      // the size the component declared, and nothing else could have produced 11.
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
