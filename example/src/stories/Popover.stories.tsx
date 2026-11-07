/**
 * Popover stories (G22). Props and events: `docs/components/popover.md`.
 *
 * A popover's `anchor` is laid out in place, in the app's own layout, and the wrapper
 * around it is what the platform points at; `children` are React Native views that the
 * popover shows. The app opens it, so every story pairs it with a way to open it again
 * and a readout of the events it reported.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness and
 * benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Popover } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Showcase } from './showcase';

const meta = {
  component: Popover,
  args: {
    isPresented: false,
    maxWidth: 320,
    anchor: <Anchor label="Share" />,
    onIsPresentedChange: fn(),
    onDismiss: fn(),
  },
  argTypes: {
    isPresented: {
      control: false,
      description:
        'Required: a popover is controlled only. Each story owns it in state; every close the user causes comes back through `onIsPresentedChange`.',
    },
    maxWidth: {
      control: { type: 'number' },
      description:
        'The widest the content may be, in points. Never more than the window less 32 either. Default 320.',
    },
    anchor: {
      control: false,
      description:
        'The element the popover points at. It stays in the app’s own layout; the wrapper around it is the anchor.',
    },
    children: {
      control: false,
      description:
        'Anything React Native renders. It is laid out in the app’s tree before the popover shows it, so the first frame is the final size.',
    },
    onIsPresentedChange: {
      action: 'isPresentedChange',
      description:
        'Every close the user causes. Not called for a change the app made itself.',
    },
    onDismiss: {
      action: 'dismiss',
      description: 'The popover has gone, however it was closed.',
    },
    testID: { control: { type: 'text' } },
    style: { control: false },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Popover>;

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

/** The element most stories point at. */
function Anchor({ label }: { label: string }) {
  return (
    <View style={styles.anchor}>
      <Text style={{ color: '#000' }}>{label}</Text>
    </View>
  );
}

/** Menu-like content: a title and rows that do something. */
function MenuContent({ onPick }: { onPick: (id: string) => void }) {
  return (
    <View style={styles.content}>
      <Text style={styles.title}>Share this list</Text>
      {['Copy link', 'AirDrop', 'Messages'].map((title) => (
        <Pressable
          key={title}
          accessibilityRole="button"
          onPress={() => onPick(title)}
          style={styles.row}
        >
          <Text style={{ color: '#000' }}>{title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The events a popover reported, newest last. */
function useEventLog() {
  const [log, setLog] = useState<string[]>([]);
  const record = useCallback((entry: string) => {
    setLog((previous) => [...previous.slice(-5), entry]);
  }, []);
  return { log, record };
}

/** Every public prop on the Controls panel. */
export const Playground: Story = {
  render: function PlaygroundStory(props) {
    const { onIsPresentedChange, onDismiss, ...rest } = props;
    const [open, setOpen] = useState(false);
    const { log, record } = useEventLog();
    return (
      <View style={styles.playground}>
        <Opener label="Show the popover" onPress={() => setOpen(true)} />
        <View style={styles.anchorSpace}>
          <Popover
            {...rest}
            isPresented={open}
            onIsPresentedChange={(next) => {
              record(`presented:${String(next)}`);
              setOpen(next);
              onIsPresentedChange?.(next);
            }}
            onDismiss={() => {
              record('dismiss');
              onDismiss?.();
            }}
            anchor={<Anchor label="Share" />}
          >
            <MenuContent onPick={(title) => record(`pick:${title}`)} />
          </Popover>
        </View>
        <Text style={styles.readout}>{log.join(' > ') || 'no events yet'}</Text>
      </View>
    );
  },
};

/**
 * A menu open over its anchor: one anchor in the middle of an empty page, with room
 * below it. This is the story `docs/images/components/popover-{ios,android}.png` is
 * taken from.
 */
export const OpenMenu: Story = {
  render: function OpenMenuStory() {
    const [open, setOpen] = useState(true);
    return (
      <View style={styles.centred}>
        {/* The wrapper's base `alignSelf: 'flex-start'` beats a parent's
            `alignItems`, so a centred anchor says so itself. */}
        <Popover
          isPresented={open}
          onIsPresentedChange={setOpen}
          style={styles.centredAnchor}
          anchor={<Anchor label="Share this list" />}
        >
          <MenuContent onPick={() => setOpen(false)} />
        </Popover>
      </View>
    );
  },
};

/** A field inside: the popover moves clear of the keyboard (DECISIONS D44 item 1). */
export const Rename: Story = {
  render: function RenameStory() {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('Weekend plans');
    return (
      <Showcase>
        <Column label="A field inside">
          <Opener label="Rename" onPress={() => setOpen(true)} />
          <View style={styles.anchorSpace}>
            <Popover
              isPresented={open}
              onIsPresentedChange={setOpen}
              anchor={<Anchor label="Weekend plans" />}
            >
              <View style={styles.content}>
                <Text style={styles.title}>Rename this list</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="New name"
                  style={styles.input}
                />
                <Text style={styles.hint}>
                  The popover sits above the keyboard, both platforms.
                </Text>
              </View>
            </Popover>
          </View>
          <Text style={styles.readout}>name: {name}</Text>
          <Note>
            It is a popover, not a dialog: a tap outside closes it and the list keeps
            the name it had.
          </Note>
        </Column>
      </Showcase>
    );
  },
};

/** Below the anchor when there is room, above it when there is not. */
export const Placement: Story = {
  render: function PlacementStory() {
    const [top, setTop] = useState(false);
    const [bottom, setBottom] = useState(false);
    return (
      <Showcase>
        <Column label="flips when there is no room">
          <View style={styles.chipRow}>
            <Opener label="Near the top" onPress={() => setTop(true)} />
            <Opener label="Near the bottom" onPress={() => setBottom(true)} />
          </View>
          <View style={styles.placeRow}>
            <Popover
              isPresented={top}
              onIsPresentedChange={setTop}
              anchor={<Anchor label="Up here" />}
            >
              <MenuContent onPick={() => setTop(false)} />
            </Popover>
          </View>
          <View style={[styles.placeRow, styles.pushDown]}>
            <Popover
              isPresented={bottom}
              onIsPresentedChange={setBottom}
              anchor={<Anchor label="Down here" />}
            >
              <MenuContent onPick={() => setBottom(false)} />
            </Popover>
          </View>
        </Column>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  playground: { padding: 24, gap: 16, alignItems: 'flex-start' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centredAnchor: { alignSelf: 'center' },
  anchorSpace: { paddingVertical: 90, alignSelf: 'stretch' },
  placeRow: { alignSelf: 'stretch', paddingVertical: 12 },
  pushDown: { marginTop: 120 },
  opener: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#e5e5ea',
  },
  openerLabel: { color: '#000' },
  anchor: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8a8a8f',
  },
  content: { padding: 14, gap: 8, width: 216 },
  title: { fontSize: 15, fontWeight: '600', color: '#000' },
  row: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#f2f2f7',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8a8a8f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#000',
  },
  hint: { fontSize: 12, color: '#8a8a8f' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  readout: { fontSize: 12, color: '#8a8a8f' },
});
