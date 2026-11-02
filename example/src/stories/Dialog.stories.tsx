/**
 * Dialog stories (G11): `AlertDialog` and `ConfirmationDialog`, the two exports
 * over one native view. Props and events: `docs/components/dialog.md`.
 *
 * A dialog has no box: the view React Native lays out is a `0 x 0` anchor, and the
 * window is the platform's (UIKit's `UIAlertController` on iOS, Material 3's
 * `AlertDialog` / `ModalBottomSheet` on Android). So every story pairs the dialog
 * with a plain button that opens it, and a readout of the events it reported.
 *
 * `actions` gets no Controls row: it is a list of objects, which the on-device
 * Controls panel cannot type, so the Playground picks between action lists on chips.
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness and
 * benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AlertDialog,
  ConfirmationDialog,
  type DialogAction,
} from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Showcase } from './showcase';

/** Module-level so `actions` keeps one identity across renders. */
const ACTION_LISTS = {
  deleteOrKeep: [
    { id: 'keep', title: 'Keep', role: 'cancel' },
    { id: 'delete', title: 'Delete', role: 'destructive' },
  ],
  withDisabled: [
    { id: 'cancel', title: 'Cancel', role: 'cancel' },
    { id: 'save', title: 'Save' },
    { id: 'publish', title: 'Publish', disabled: true },
  ],
  single: [{ id: 'ok', title: 'OK' }],
  three: [
    { id: 'copy', title: 'Copy link' },
    { id: 'share', title: 'Share…' },
    { id: 'remove', title: 'Remove', role: 'destructive' },
  ],
} satisfies Record<string, DialogAction[]>;

type ListName = keyof typeof ACTION_LISTS;
const LIST_NAMES = Object.keys(ACTION_LISTS) as ListName[];

const meta = {
  component: AlertDialog,
  args: {
    isPresented: false,
    title: 'Delete the draft?',
    message: 'The draft and its photos go for good.',
    actions: ACTION_LISTS.deleteOrKeep,
    dismissible: true,
    tintColor: undefined,
    onIsPresentedChange: fn(),
    onAction: fn(),
  },
  argTypes: {
    isPresented: {
      control: false,
      description:
        'Required: a dialog is controlled only. Each story owns it in state and opens it from its button; every native open or close comes back through `onIsPresentedChange`.',
    },
    title: {
      control: { type: 'text' },
      description:
        'The title. Also the dialog’s accessibility name - there is no separate label.',
    },
    message: {
      control: { type: 'text' },
      description: 'The body text under the title.',
    },
    actions: {
      control: false,
      table: { disable: true },
      description:
        'The buttons, as data: `{ id, title, role?, disabled? }`, at least one, at most one `cancel`. The Playground picks a list from a chip.',
    },
    dismissible: {
      control: { type: 'boolean' },
      description:
        'Whether a tap outside, Back or a swipe closes it. An action always closes it. iOS alerts have no outside tap at all.',
    },
    tintColor: {
      control: { type: 'color' },
      description:
        'The buttons’ colour: the alert view’s `tintColor` on iOS; the action text on Android.',
    },
    onIsPresentedChange: {
      action: 'isPresentedChange',
      description:
        'Every native open or close. An action tap reports `onAction` first (DECISIONS D32). Not called for a change the app made.',
    },
    onAction: {
      action: 'action',
      description: 'The id of the tapped action, before the close it causes.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof AlertDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A plain RN button, so the opener is not itself a nitro-ui control. */
function Opener({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.opener}
    >
      <Text style={styles.openerLabel}>{label}</Text>
    </Pressable>
  );
}

/** The events a dialog reported, newest last. */
function useEventLog() {
  const [log, setLog] = useState<string[]>([]);
  const record = useCallback((entry: string) => {
    setLog((previous) => [...previous.slice(-5), entry]);
  }, []);
  return { log, record };
}

/** Every public prop on the Controls panel, the action list on chips. */
export const Playground: Story = {
  render: function PlaygroundStory(props) {
    const { onIsPresentedChange, onAction, ...rest } = props;
    const [open, setOpen] = useState(false);
    const [listName, setListName] = useState<ListName>('deleteOrKeep');
    const [confirmation, setConfirmation] = useState(false);
    const { log, record } = useEventLog();
    const Dialog = confirmation ? ConfirmationDialog : AlertDialog;
    return (
      <View style={styles.playground}>
        <Opener
          label={confirmation ? 'Open the confirmation' : 'Open the alert'}
          onPress={() => setOpen(true)}
        />
        <Dialog
          {...rest}
          isPresented={open}
          actions={ACTION_LISTS[listName]}
          onIsPresentedChange={(next) => {
            record(`presented:${String(next)}`);
            setOpen(next);
            onIsPresentedChange?.(next);
          }}
          onAction={(id) => {
            record(`action:${id}`);
            onAction?.(id);
          }}
        />
        <View style={styles.chipRow}>
          {LIST_NAMES.map((name) => (
            <Pressable
              key={name}
              onPress={() => setListName(name)}
              style={styles.chip}
            >
              <Text style={styles.chipLabel}>{name}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setConfirmation((value) => !value)}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>
              {confirmation ? 'as an alert' : 'as a confirmation'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.readout}>{log.join(' > ') || 'no events yet'}</Text>
      </View>
    );
  },
};

/** An alert with a cancel, a destructive and a disabled action. */
export const Alert: Story = {
  render: function AlertStory() {
    const [open, setOpen] = useState(false);
    const { log, record } = useEventLog();
    return (
      <Showcase>
        <Column label="An alert, with a disabled action">
          <Opener label="Save changes?" onPress={() => setOpen(true)} />
          <AlertDialog
            isPresented={open}
            onIsPresentedChange={(next) => {
              record(`presented:${String(next)}`);
              setOpen(next);
            }}
            title="Save changes?"
            message="Publishing is off until the draft has a title."
            actions={ACTION_LISTS.withDisabled}
            onAction={(id) => record(`action:${id}`)}
          />
          <Text style={styles.readout}>
            {log.join(' > ') || 'no events yet'}
          </Text>
          <Note>
            The disabled action is drawn disabled and takes no tap. An action
            reports its id before the close.
          </Note>
        </Column>
      </Showcase>
    );
  },
};

/**
 * A confirmation: an action sheet on iOS (with the Cancel UIKit adds when none is
 * given), a Material bottom sheet of rows on Android.
 */
export const Confirmation: Story = {
  render: function ConfirmationStory() {
    const [open, setOpen] = useState(false);
    const { log, record } = useEventLog();
    return (
      <Showcase>
        <Column label="A confirmation sheet">
          <View>
            <Opener label="Share the photo" onPress={() => setOpen(true)} />
            {/* Over its opener: on iPad the action sheet points at this box. */}
            <ConfirmationDialog
              isPresented={open}
              onIsPresentedChange={(next) => {
                record(`presented:${String(next)}`);
                setOpen(next);
              }}
              title="Share the photo"
              titleVisibility="visible"
              actions={ACTION_LISTS.three}
              onAction={(id) => record(`action:${id}`)}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <Text style={styles.readout}>
            {log.join(' > ') || 'no events yet'}
          </Text>
          <Note>
            A tap outside is a dismissal without an action: only the close is
            reported.
          </Note>
        </Column>
      </Showcase>
    );
  },
};

/** Only an action closes it: Back and a tap outside do nothing. */
export const NotDismissible: Story = {
  render: function NotDismissibleStory() {
    const [open, setOpen] = useState(false);
    return (
      <Showcase>
        <Column label="Only an action closes it">
          <Opener label="Accept the terms" onPress={() => setOpen(true)} />
          <AlertDialog
            isPresented={open}
            onIsPresentedChange={setOpen}
            title="Accept the terms to continue"
            actions={ACTION_LISTS.single}
            dismissible={false}
          />
        </Column>
      </Showcase>
    );
  },
};

/**
 * The app refuses a dismissal: it ignores `onIsPresentedChange(false)`, so the
 * dialog comes back (DECISIONS D33) and a development build warns once.
 */
export const RefusedDismissal: Story = {
  render: function RefusedDismissalStory() {
    const [open, setOpen] = useState(false);
    const [refusals, setRefusals] = useState(0);
    return (
      <Showcase>
        <Column label="A refused dismissal">
          <Opener label="Open, then dismiss it" onPress={() => setOpen(true)} />
          <AlertDialog
            isPresented={open}
            onIsPresentedChange={(next) => {
              // `Close` set `open` to false before this arrives (the action is
              // reported first), so only a dismissal the app refuses counts.
              if (next || !open) return;
              setRefusals((count) => count + 1);
            }}
            title="Still here"
            message="This app keeps isPresented true, so a dismissal presents the dialog again."
            actions={[
              { id: 'close', title: 'Close', role: 'cancel' },
              { id: 'again', title: 'Again' },
            ]}
            onAction={(id) => {
              if (id === 'close') setOpen(false);
            }}
          />
          <Text style={styles.readout}>
            dismissals refused: {String(refusals)}
          </Text>
        </Column>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  playground: { padding: 24, gap: 16, alignItems: 'flex-start' },
  opener: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#e5e5ea',
  },
  openerLabel: { color: '#000' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#d0d0d5',
  },
  chipLabel: { fontSize: 12 },
  readout: { fontSize: 12, color: '#8a8a8f' },
});
