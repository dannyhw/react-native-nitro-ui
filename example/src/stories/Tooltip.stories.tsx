/**
 * Tooltip stories (G18). Props and events: `docs/components/tooltip.md`.
 *
 * A tooltip's children are its anchor, laid out in place; the tooltip is a window the
 * platform draws next to them (Material 3's `PlainTooltip` / `RichTooltip` on Android, a
 * UIKit popover on iOS). The app opens it, so every story pairs it with a way to open it
 * again, and a readout of the events it reported.
 *
 * `actions` gets no Controls row: it is a list of objects, which the on-device Controls
 * panel cannot type, so the Playground picks between action lists on chips. The
 * internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness and benchmark
 * handles, not app API (DECISIONS D14).
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tooltip, type TooltipAction } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Showcase } from './showcase';

/** Module-level so `actions` keeps one identity across renders. */
const ACTION_LISTS = {
  none: [],
  gotIt: [{ id: 'ok', title: 'Got it' }],
  two: [
    { id: 'later', title: 'Later' },
    { id: 'try', title: 'Try it' },
  ],
} satisfies Record<string, TooltipAction[]>;

type ListName = keyof typeof ACTION_LISTS;
const LIST_NAMES = Object.keys(ACTION_LISTS) as ListName[];

const meta = {
  component: Tooltip,
  args: {
    isPresented: false,
    title: 'Saved searches',
    message: 'Tap the star to keep this search.',
    placement: 'auto',
    onIsPresentedChange: fn(),
    onAction: fn(),
  },
  argTypes: {
    isPresented: {
      control: false,
      description:
        'Required: a tooltip is controlled only. Each story owns it in state; every close the user causes comes back through `onIsPresentedChange`.',
    },
    title: {
      control: { type: 'text' },
      description:
        'A title above the message. With a title or an action, Android draws Material’s rich tooltip.',
    },
    message: {
      control: { type: 'text' },
      description: 'The text. Also what screen readers announce.',
    },
    placement: {
      control: { type: 'select' },
      options: ['auto', 'above', 'below'],
      description:
        'The side it prefers. Both platforms flip when that side has no room.',
    },
    actions: {
      control: false,
      table: { disable: true },
      description:
        'Up to two buttons, as data: `{ id, title }`. The Playground picks a list from a chip.',
    },
    onIsPresentedChange: {
      action: 'isPresentedChange',
      description:
        'Every close the user causes. An action tap reports `onAction` first (DECISIONS D32). Not called for a change the app made.',
    },
    onAction: {
      action: 'action',
      description: 'The id of the tapped action, before the close it causes.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Tooltip>;

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

/** The anchor most stories point at: a round icon button. */
function Star({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Star this search"
      onPress={onPress}
      style={styles.star}
    >
      <Text style={styles.starGlyph}>★</Text>
    </Pressable>
  );
}

/** The events a tooltip reported, newest last. */
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
    const [listName, setListName] = useState<ListName>('gotIt');
    const { log, record } = useEventLog();
    return (
      <View style={styles.playground}>
        <Opener label="Show the tooltip" onPress={() => setOpen(true)} />
        <View style={styles.anchorSpace}>
          <Tooltip
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
          >
            <Star />
          </Tooltip>
        </View>
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
        </View>
        <Text style={styles.readout}>{log.join(' > ') || 'no events yet'}</Text>
      </View>
    );
  },
};

/**
 * A coach mark: a title, a message and one action, open when the story loads. This is
 * the story `docs/images/components/tooltip-{ios,android}.png` is taken from - one
 * anchor in the middle of an empty page, with room on both sides.
 */
export const CoachMark: Story = {
  render: function CoachMarkStory() {
    const [open, setOpen] = useState(true);
    return (
      <View style={styles.centred}>
        <Tooltip
          isPresented={open}
          onIsPresentedChange={setOpen}
          title="Saved searches"
          message="Tap the star to keep this search."
          actions={ACTION_LISTS.gotIt}
        >
          <Star onPress={() => setOpen(true)} />
        </Tooltip>
      </View>
    );
  },
};

/** A message alone: Material's plain tooltip on Android, the same popover on iOS. */
export const Plain: Story = {
  render: function PlainStory() {
    const [open, setOpen] = useState(false);
    const { log, record } = useEventLog();
    return (
      <Showcase>
        <Column label="A message alone">
          <Opener label="Show a plain tip" onPress={() => setOpen(true)} />
          <View style={styles.anchorSpace}>
            <Tooltip
              isPresented={open}
              onIsPresentedChange={(next) => {
                record(`presented:${String(next)}`);
                setOpen(next);
              }}
              message="Copied to the clipboard"
            >
              <View style={styles.label}>
                <Text>Copy link</Text>
              </View>
            </Tooltip>
          </View>
          <Text style={styles.readout}>
            {log.join(' > ') || 'no events yet'}
          </Text>
          <Note>
            It stays up until a tap outside closes it: Material&apos;s timeout
            is off, so it means the same on both platforms.
          </Note>
        </Column>
      </Showcase>
    );
  },
};

/** The two placements, side by side. */
export const Placement: Story = {
  render: function PlacementStory() {
    const [above, setAbove] = useState(false);
    const [below, setBelow] = useState(false);
    return (
      <Showcase>
        <Column label="above and below">
          <View style={styles.chipRow}>
            <Opener label="Above" onPress={() => setAbove(true)} />
            <Opener label="Below" onPress={() => setBelow(true)} />
          </View>
          <View style={[styles.anchorSpace, styles.chipRow]}>
            <Tooltip
              isPresented={above}
              onIsPresentedChange={setAbove}
              placement="above"
              message="Above its anchor"
            >
              <Star />
            </Tooltip>
            <Tooltip
              isPresented={below}
              onIsPresentedChange={setBelow}
              placement="below"
              message="Below its anchor"
            >
              <Star />
            </Tooltip>
          </View>
        </Column>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  playground: { padding: 24, gap: 16, alignItems: 'flex-start' },
  anchorSpace: { paddingVertical: 80, alignSelf: 'stretch' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  opener: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#e5e5ea',
  },
  openerLabel: { color: '#000' },
  star: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e5ea',
  },
  starGlyph: { fontSize: 22, color: '#000' },
  label: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8a8a8f',
  },
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
