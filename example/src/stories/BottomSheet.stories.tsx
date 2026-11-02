/**
 * BottomSheet stories (G14): a modal sheet whose content is React Native. Props and
 * events: `docs/components/bottom-sheet.md`.
 *
 * A sheet has no box in the screen that renders it - its content lives in the
 * platform's window (UIKit's sheet presentation on iOS, Material 3's
 * `ModalBottomSheet` on Android) - so every story pairs it with a plain button that
 * opens it and a readout of the events it reported.
 *
 * `detents` gets no Controls row: it is a list of strings and objects, which the
 * on-device Controls panel cannot type, so the Playground picks between lists on
 * chips. The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness
 * and benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet, type BottomSheetDetent } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Showcase } from './showcase';

/** Module-level so `detents` keeps one identity across renders. */
const DETENT_LISTS = {
  fit: ['fit'],
  mediumLarge: ['medium', 'large'],
  large: ['large'],
  fraction: ['medium', { fraction: 0.85 }],
  height: [{ height: 320 }],
} satisfies Record<string, BottomSheetDetent[]>;

type ListName = keyof typeof DETENT_LISTS;
const LIST_NAMES = Object.keys(DETENT_LISTS) as ListName[];

const meta = {
  component: BottomSheet,
  args: {
    isPresented: false,
    dismissible: true,
    showsGrabber: true,
    cornerRadius: undefined,
    containerColor: undefined,
    accessibilityLabel: 'Story sheet',
    onIsPresentedChange: fn(),
    onDetentChange: fn(),
    onDismiss: fn(),
  },
  argTypes: {
    isPresented: {
      control: false,
      description:
        'Required: a sheet is controlled only. Each story owns it in state and opens it from its button; every native close comes back through `onIsPresentedChange`.',
    },
    detents: {
      control: false,
      table: { disable: true },
      description:
        "Where the sheet can rest, smallest first: `'fit'`, `'medium'`, `'large'`, `{ height }`, `{ fraction }`. The Playground picks a list from a chip.",
    },
    dismissible: {
      control: { type: 'boolean' },
      description:
        'Whether a swipe down, a tap outside and Back close the sheet.',
    },
    showsGrabber: {
      control: { type: 'boolean' },
      description: 'The grabber (iOS) or drag handle (Android).',
    },
    cornerRadius: {
      control: { type: 'number' },
      description: 'The top corner radius, in points.',
    },
    containerColor: {
      control: { type: 'color' },
      description: 'The sheet background.',
    },
    accessibilityLabel: {
      control: { type: 'text' },
      description: 'What screen readers call the sheet when it opens.',
    },
    onIsPresentedChange: {
      action: 'isPresentedChange',
      description:
        'A native close (swipe, outside tap, Back). Not called for a change the app made.',
    },
    onDetentChange: {
      action: 'detentChange',
      description:
        'The index into `detents` the user dragged to. The detent it opens at is not reported.',
    },
    onDismiss: {
      action: 'dismiss',
      description: 'The sheet has gone, however it was closed.',
    },
    children: { control: false, table: { disable: true } },
    testID: { control: false, table: { disable: true } },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof BottomSheet>;

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

/** The events a sheet reported, newest last. */
function useEventLog() {
  const [log, setLog] = useState<string[]>([]);
  const record = useCallback((entry: string) => {
    setLog((previous) => [...previous.slice(-5), entry]);
  }, []);
  return { log, record };
}

/** Every public prop on the Controls panel, the detent list on chips. */
export const Playground: Story = {
  render: function PlaygroundStory(props) {
    const { onIsPresentedChange, onDetentChange, onDismiss, ...rest } = props;
    const [open, setOpen] = useState(false);
    const [listName, setListName] = useState<ListName>('fit');
    const { log, record } = useEventLog();
    return (
      <View style={styles.playground}>
        <Opener label="Open the sheet" onPress={() => setOpen(true)} />
        <BottomSheet
          {...rest}
          isPresented={open}
          detents={DETENT_LISTS[listName]}
          onIsPresentedChange={(next) => {
            record(`presented:${String(next)}`);
            setOpen(next);
            onIsPresentedChange?.(next);
          }}
          onDetentChange={(index) => {
            record(`detent:${index}`);
            onDetentChange?.(index);
          }}
          onDismiss={() => {
            record('dismiss');
            onDismiss?.();
          }}
        >
          <View style={styles.sheet}>
            <Text style={styles.title}>{`detents: ${listName}`}</Text>
            <Opener label="Close" onPress={() => setOpen(false)} />
          </View>
        </BottomSheet>
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

/** A `fit` sheet that grows while it is up. */
export const FitsItsContent: Story = {
  render: function FitStory() {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState(1);
    return (
      <Showcase>
        <Column label="A fit sheet follows its content">
          <Opener label="Open" onPress={() => setOpen(true)} />
          <BottomSheet isPresented={open} onIsPresentedChange={setOpen}>
            <View style={styles.sheet}>
              <Text style={styles.title}>As tall as this</Text>
              {Array.from({ length: rows }, (_, index) => (
                <View key={index} style={styles.row}>
                  <Text>{`Row ${index + 1}`}</Text>
                </View>
              ))}
              <Opener label="Add a row" onPress={() => setRows((n) => n + 1)} />
            </View>
          </BottomSheet>
        </Column>
      </Showcase>
    );
  },
};

/** `medium` and `large`, with a list inside. */
export const MediumAndLarge: Story = {
  render: function MediumLargeStory() {
    const [open, setOpen] = useState(false);
    const { log, record } = useEventLog();
    return (
      <Showcase>
        <Column label="Two detents and a ScrollView">
          <Opener label="Open" onPress={() => setOpen(true)} />
          <BottomSheet
            isPresented={open}
            onIsPresentedChange={setOpen}
            detents={DETENT_LISTS.mediumLarge}
            onDetentChange={(index) => record(`detent:${index}`)}
          >
            <ScrollView
              nestedScrollEnabled
              contentContainerStyle={styles.sheet}
            >
              {Array.from({ length: 30 }, (_, index) => (
                <View key={index} style={styles.row}>
                  <Text>{`Row ${index + 1}`}</Text>
                </View>
              ))}
            </ScrollView>
          </BottomSheet>
          <Text style={styles.readout}>
            {log.join(' > ') || 'no drags yet'}
          </Text>
        </Column>
      </Showcase>
    );
  },
};

/** Only the sheet's own button closes it. */
export const NotDismissible: Story = {
  render: function StickyStory() {
    const [open, setOpen] = useState(false);
    return (
      <Showcase>
        <Column label="dismissible={false}">
          <Opener label="Open" onPress={() => setOpen(true)} />
          <BottomSheet
            isPresented={open}
            onIsPresentedChange={setOpen}
            dismissible={false}
            cornerRadius={28}
          >
            <View style={styles.sheet}>
              <Text style={styles.title}>
                Swipe, Back and outside do nothing
              </Text>
              <Opener label="Close" onPress={() => setOpen(false)} />
            </View>
          </BottomSheet>
        </Column>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  playground: { padding: 24, gap: 16, alignItems: 'flex-start' },
  sheet: { padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  row: { padding: 14, borderRadius: 10, backgroundColor: '#f2f2f7' },
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
