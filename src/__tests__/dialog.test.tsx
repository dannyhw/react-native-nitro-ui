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
    await act(async () => nativeDismissal(view, 1));
    expect(
      (view.getByTestId('dialog').props as { presented: boolean }).presented
    ).toBe(false);
    await act(async () => setOpen(true));
    expect(
      (view.getByTestId('dialog').props as { presented: boolean }).presented
    ).toBe(true);
    expect(refusalWarnings()).toBe(0);
  });

  it('warns once when the parent keeps `isPresented` true after a dismissal', async () => {
    const view = await render(<Parent refuse />);
    await act(async () => setOpen(true));
    await act(async () => nativeDismissal(view, 1));
    expect(refusalWarnings()).toBe(1);
    await act(async () => nativeDismissal(view, 2));
    expect(refusalWarnings()).toBe(1);
  });
});
