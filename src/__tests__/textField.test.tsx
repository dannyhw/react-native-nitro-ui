import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, type RenderResult } from '@testing-library/react-native';
import { Activity, createRef } from 'react';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  TextField,
  type TextFieldHandle,
} from '../components/TextField/TextField';

let mockIds = 0;
function nextMockId(): number {
  return ++mockIds;
}

beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: nextMockId });
});

type Props = Record<string, unknown>;

function nativeProps(view: RenderResult, testId: string): Props {
  return view.getByTestId(testId).props as unknown as Props;
}

/** Call a Nitro callback prop the way native would: through its `{ f }` wrapper. */
function fire(props: Props, name: string, ...args: unknown[]): void {
  const prop = props[name] as { f: (...a: unknown[]) => void } | undefined;
  if (prop == null) throw new Error(`${name} was not sent`);
  prop.f(...args);
}

describe('TextField · props', () => {
  it('sends every native prop, with null for what the app did not set', async () => {
    const view = await render(<TextField testID="field" />);
    const props = nativeProps(view, 'field');
    expect(props).toMatchObject({
      value: null,
      defaultValue: '',
      mostRecentEventCount: 0,
      placeholder: null,
      multiline: false,
      keyboardType: 'default',
      autoCapitalize: 'sentences',
      autoCorrect: true,
      secureTextEntry: false,
      maxLength: null,
      returnKeyType: 'default',
      editable: true,
      testID: 'field',
      accessibilityLabel: null,
      nuiPerfId: null,
    });
    for (const name of [
      'onValueChange',
      'onFocusChange',
      'onSubmitEditing',
      'hybridRef',
    ]) {
      expect(typeof (props[name] as { f?: unknown } | undefined)?.f).toBe(
        'function'
      );
    }
  });

  it('passes what the app set, in RN spellings', async () => {
    const view = await render(
      <TextField
        testID="field"
        value="hello"
        placeholder="Name"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        maxLength={12}
        returnKeyType="next"
        editable={false}
        accessibilityLabel="Email"
      />
    );
    expect(nativeProps(view, 'field')).toMatchObject({
      value: 'hello',
      placeholder: 'Name',
      keyboardType: 'email-address',
      autoCapitalize: 'none',
      autoCorrect: false,
      secureTextEntry: true,
      maxLength: 12,
      returnKeyType: 'next',
      editable: false,
      accessibilityLabel: 'Email',
    });
  });

  it('turns a spelling it does not know into the default, and a bad limit into none', async () => {
    const view = await render(
      <TextField
        testID="field"
        keyboardType={'visible-password' as never}
        autoCapitalize={'shout' as never}
        returnKeyType={'emergency-call' as never}
        maxLength={-3}
      />
    );
    expect(nativeProps(view, 'field')).toMatchObject({
      keyboardType: 'default',
      autoCapitalize: 'sentences',
      returnKeyType: 'default',
      maxLength: null,
    });
    const fractional = await render(
      <TextField testID="fraction" maxLength={4.7} />
    );
    expect(nativeProps(fractional, 'fraction').maxLength).toBe(4);
    const zero = await render(<TextField testID="zero" maxLength={0} />);
    expect(nativeProps(zero, 'zero').maxLength).toBe(0);
  });
});

describe('TextField · sizing key', () => {
  it('is the default configuration for every single-line field', async () => {
    const view = await render(
      <>
        <TextField testID="a" value="short" />
        <TextField testID="b" secureTextEntry placeholder="Password" />
      </>
    );
    expect(nativeProps(view, 'a').nuiSizingKey).toBe('');
    expect(nativeProps(view, 'b').nuiSizingKey).toBe('');
  });

  it('gives each multi-line field a configuration of its own', async () => {
    const view = await render(
      <>
        <TextField testID="a" multiline />
        <TextField testID="b" multiline />
      </>
    );
    const a = nativeProps(view, 'a');
    const b = nativeProps(view, 'b');
    expect(a.nuiSizingKey).toBe(`m|${String(a.nuiSizingId)}`);
    expect(b.nuiSizingKey).toBe(`m|${String(b.nuiSizingId)}`);
    expect(a.nuiSizingKey).not.toBe(b.nuiSizingKey);
  });
});

describe('TextField · callbacks and ref', () => {
  it('splits native focus changes into onFocus and onBlur', async () => {
    const seen: string[] = [];
    const view = await render(
      <TextField
        testID="field"
        onFocus={() => seen.push('focus')}
        onBlur={() => seen.push('blur')}
      />
    );
    const props = nativeProps(view, 'field');
    await act(async () => {
      fire(props, 'onFocusChange', true);
      fire(props, 'onFocusChange', false);
    });
    expect(seen).toEqual(['focus', 'blur']);
  });

  it('keeps one callback identity when the app passes a new handler', async () => {
    const view = await render(
      <TextField testID="field" onSubmitEditing={() => {}} />
    );
    const before = nativeProps(view, 'field').onSubmitEditing;
    const submitted: string[] = [];
    await view.rerender(
      <TextField
        testID="field"
        onSubmitEditing={(text) => submitted.push(text)}
      />
    );
    const after = nativeProps(view, 'field');
    expect(after.onSubmitEditing).toBe(before);
    await act(async () => fire(after, 'onSubmitEditing', 'sent'));
    expect(submitted).toEqual(['sent']);
  });

  it('reports a user edit to onChangeText and echoes its count', async () => {
    const changes: string[] = [];
    const view = await render(
      <TextField
        testID="field"
        value=""
        onChangeText={(text) => changes.push(text)}
      />
    );
    await act(async () =>
      fire(nativeProps(view, 'field'), 'onValueChange', 'a', 1)
    );
    expect(changes).toEqual(['a']);
    // The edit is refused (the value stays `''`), but the event count still moves.
    expect(nativeProps(view, 'field')).toMatchObject({
      value: '',
      mostRecentEventCount: 1,
    });
  });

  it('focuses and blurs through the native view the ref reaches', async () => {
    const ref = createRef<TextFieldHandle>();
    const focus = jest.fn();
    const blur = jest.fn();
    const internal: unknown[] = [];
    const view = await render(
      <TextField
        ref={ref}
        testID="field"
        hybridRef={(handle) => internal.push(handle)}
      />
    );
    const native = { focus, blur };
    await act(async () =>
      fire(nativeProps(view, 'field'), 'hybridRef', native)
    );
    ref.current?.focus();
    ref.current?.blur();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(internal).toEqual([native]);
  });

  it('keeps a focus() asked for before the native view arrived, and runs it then', async () => {
    // `ref` is attached at mount; `hybridRef` reaches JS later.
    const ref = createRef<TextFieldHandle>();
    const focus = jest.fn();
    const blur = jest.fn();
    const view = await render(<TextField ref={ref} testID="field" />);
    ref.current?.focus();
    expect(focus).not.toHaveBeenCalled();
    await act(async () =>
      fire(nativeProps(view, 'field'), 'hybridRef', { focus, blur })
    );
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).not.toHaveBeenCalled();
  });

  it('runs only the newest of several early asks', async () => {
    const ref = createRef<TextFieldHandle>();
    const focus = jest.fn();
    const blur = jest.fn();
    const view = await render(<TextField ref={ref} testID="field" />);
    ref.current?.focus();
    ref.current?.blur();
    await act(async () =>
      fire(nativeProps(view, 'field'), 'hybridRef', { focus, blur })
    );
    expect(focus).not.toHaveBeenCalled();
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('drops a queued focus() when the field unmounted before its view arrived', async () => {
    // Nitro can deliver `hybridRef` after the field has unmounted.
    const ref = createRef<TextFieldHandle>();
    const focus = jest.fn();
    const blur = jest.fn();
    const view = await render(<TextField ref={ref} testID="field" />);
    const handedOver = nativeProps(view, 'field').hybridRef as {
      f: (handle: unknown) => void;
    };
    ref.current?.focus();
    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      handedOver.f({ focus, blur });
    });
    expect(focus).not.toHaveBeenCalled();
    expect(blur).not.toHaveBeenCalled();
  });
  it('still focuses after <Activity> hid and showed it again', async () => {
    // Hiding runs effect cleanups and showing runs the effects again, but the
    // native view stays, and Nitro delivers `hybridRef` once per native view.
    const ref = createRef<TextFieldHandle>();
    const focus = jest.fn();
    const blur = jest.fn();
    const field = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <TextField ref={ref} testID="field" />
      </Activity>
    );
    const view = await render(field('visible'));
    await act(async () =>
      fire(nativeProps(view, 'field'), 'hybridRef', { focus, blur })
    );
    await act(async () => {
      view.rerender(field('hidden'));
    });
    await act(async () => {
      view.rerender(field('visible'));
    });
    ref.current?.focus();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
