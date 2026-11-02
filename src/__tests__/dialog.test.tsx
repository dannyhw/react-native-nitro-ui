import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, render, type RenderResult } from '@testing-library/react-native';
import { useState } from 'react';

import { AlertDialog, type DialogAction } from '../components/Dialog/Dialog';

/**
 * Wrapper-level tests for the dialogs (task G11).
 *
 * The device suite (`example/__tests__/Dialog.harness.tsx`) owns presentation,
 * events and the native half of a refused dismissal (D33). What it cannot pin
 * down is *when the wrapper warns*: a warning is the developer's half of the
 * refusal, and it has to fire for a refusal and for nothing else - a parent
 * that follows `onIsPresentedChange` and opens the dialog again later is the
 * ordinary case, and a warning there tells the developer they did something
 * wrong when they did not.
 */
const ACTIONS: DialogAction[] = [
  { id: 'cancel', title: 'Cancel', role: 'cancel' },
  { id: 'ok', title: 'OK' },
];

const REFUSAL = 'dismissed by the user';

let warn: jest.SpiedFunction<typeof console.warn>;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

function refusalWarnings(): number {
  return warn.mock.calls.filter((call) => String(call[0]).includes(REFUSAL))
    .length;
}

/** The parent's `isPresented` setter, so a test can play the app. */
let setOpen: (next: boolean) => void = () => {};

function Parent({ refuse }: { refuse: boolean }) {
  const [open, setter] = useState(false);
  setOpen = setter;
  return (
    <AlertDialog
      testID="dialog"
      isPresented={open}
      onIsPresentedChange={(next) => {
        if (!refuse) setter(next);
      }}
      title="Title"
      actions={ACTIONS}
    />
  );
}

/** Play native: the user closed the dialog, and this is native event `count`. */
function nativeDismissal(view: RenderResult, count: number): void {
  const props = view.getByTestId('dialog').props as unknown as {
    onPresentedChange: { f: (presented: boolean, eventCount: number) => void };
  };
  props.onPresentedChange.f(false, count);
}

describe('Dialog · refused-dismissal warning (D33)', () => {
  it('stays quiet when the parent follows a dismissal and opens the dialog again', async () => {
    const view = await render(<Parent refuse={false} />);
    await act(async () => setOpen(true));
    // The user cancels; the parent follows to `false`.
    await act(async () => nativeDismissal(view, 1));
    expect(
      (view.getByTestId('dialog').props as { presented: boolean }).presented
    ).toBe(false);
    // Later, the app opens it again. Nothing was refused.
    await act(async () => setOpen(true));
    expect(
      (view.getByTestId('dialog').props as { presented: boolean }).presented
    ).toBe(true);
    expect(refusalWarnings()).toBe(0);
  });

  it('warns once when the parent keeps `isPresented` true after a dismissal', async () => {
    // The barrier: the channel the test above reads does carry the warning.
    const view = await render(<Parent refuse />);
    await act(async () => setOpen(true));
    await act(async () => nativeDismissal(view, 1));
    expect(refusalWarnings()).toBe(1);
    // A second refusal does not warn again.
    await act(async () => nativeDismissal(view, 2));
    expect(refusalWarnings()).toBe(1);
  });
});
