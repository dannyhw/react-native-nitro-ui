/**
 * ContextMenu stories (G16). Props and events: `docs/components/context-menu.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 *
 * `group` gets no Controls row, for Menu's reason: it is a tree, and the on-device
 * Controls panel cannot type one. Every story hands it a module-level list.
 *
 * Touch and hold a message to open its menu. A tap is the message's own (`Pressable`),
 * and a hold that opens the menu never presses it.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ContextMenu, type MenuGroup } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Note, Row, Showcase } from './showcase';

/** Module-level so `group`'s identity never changes between renders. */
const MESSAGE: MenuGroup = {
  actions: [
    { id: 'reply', title: 'Reply', systemImage: 'arrowshape.turn.up.left' },
    { id: 'copy', title: 'Copy text', systemImage: 'doc.on.doc' },
    { id: 'pin', title: 'Pin', systemImage: 'pin', disabled: true },
  ],
  sections: [
    {
      id: 'danger',
      items: [
        {
          id: 'delete',
          title: 'Delete',
          destructive: true,
          systemImage: 'trash',
        },
      ],
    },
  ],
};

const PHOTO: MenuGroup = {
  actions: [
    {
      id: 'save',
      title: 'Save to Photos',
      systemImage: 'square.and.arrow.down',
    },
    { id: 'share', title: 'Share…', systemImage: 'square.and.arrow.up' },
  ],
};

const OUTER: MenuGroup = {
  actions: [{ id: 'outer', title: 'Thread actions' }],
};
const INNER: MenuGroup = {
  actions: [{ id: 'inner', title: 'Message actions' }],
};

const meta = {
  component: ContextMenu,
  args: {
    // Required by the component type, so it is in `args`; `control: false` keeps it
    // off the Controls panel.
    group: MESSAGE,
    title: undefined,
    disabled: false,
    onSelect: fn(),
    onOpen: fn(),
    onClose: fn(),
  },
  argTypes: {
    group: {
      control: false,
      table: { disable: true },
      description:
        'The rows, as data: Menu’s `MenuGroup` (actions, submenus, sections). No on-device control can type a tree.',
    },
    title: {
      control: { type: 'text' },
      description:
        'A header over the rows: the `UIMenu` title on iOS, a header row on Android.',
    },
    disabled: {
      control: { type: 'boolean' },
      description:
        'No menu; the children keep every gesture. An open menu closes, on both platforms.',
    },
    onSelect: {
      action: 'select',
      description: 'The picked row’s `id`. Fires before `onClose`.',
    },
    onOpen: {
      action: 'open',
      description: 'The menu opened - on both platforms, unlike Menu’s.',
    },
    onClose: {
      action: 'close',
      description:
        'Once for every `onOpen`: a pick, an outside tap, Back, `disabled`, a layout move (Android) or a drop.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof ContextMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every public prop on the Controls panel, around one message. */
export const Playground: Story = {
  render: function PlaygroundStory(props) {
    const { onSelect, ...rest } = props;
    const [picked, setPicked] = useState<string | null>(null);
    const [taps, setTaps] = useState(0);
    const handleSelect = useCallback(
      (id: string) => {
        setPicked(id);
        onSelect?.(id);
      },
      [onSelect]
    );
    const handleTap = useCallback(() => setTaps((n) => n + 1), []);

    return (
      <View style={styles.page}>
        <ContextMenu
          {...rest}
          onSelect={handleSelect}
          style={styles.bubble}
          testID="storybook-context-playground"
        >
          <Pressable onPress={handleTap} style={styles.press}>
            <Text style={styles.from}>Ada Lovelace</Text>
            <Text style={styles.body}>
              Touch and hold this message for its menu.
            </Text>
          </Pressable>
        </ContextMenu>
        <Text style={styles.readout}>
          last pick: {picked ?? '(nothing)'} - taps on the message: {taps}
        </Text>
        <Note>
          A tap presses the message; a hold opens the menu and never presses it.
          `onOpen` and `onClose` reach Actions on both platforms.
        </Note>
      </View>
    );
  },
};

/**
 * A short conversation, the shape the README photographs: hold the second message.
 *
 * iOS lifts the bubble itself as the preview (its corners are the style's
 * `borderRadius`); Android opens a Material menu at the finger.
 */
export const Conversation: Story = {
  render: function ConversationStory() {
    const [picked, setPicked] = useState('nothing yet');
    return (
      <View style={styles.page}>
        <View style={[styles.bubble, styles.theirs]}>
          <Text style={styles.body}>Did the engine finish the table?</Text>
        </View>
        <ContextMenu
          group={MESSAGE}
          onSelect={setPicked}
          style={[styles.bubble, styles.mine]}
          testID="storybook-context-message"
        >
          <Text style={[styles.body, styles.mineText]}>
            Yes - the Bernoulli numbers are done. Hold this message.
          </Text>
        </ContextMenu>
        <ContextMenu
          group={PHOTO}
          onSelect={setPicked}
          style={[styles.bubble, styles.theirs, styles.photo]}
          testID="storybook-context-photo"
        >
          <Text style={styles.body}>A photo of the notes</Text>
        </ContextMenu>
        <Text style={styles.readout}>last pick: {picked}</Text>
      </View>
    );
  },
};

/** Nested ContextMenus: a hold opens the innermost one under the finger. */
export const Nested: Story = {
  render: function NestedStory() {
    const [picked, setPicked] = useState('nothing yet');
    return (
      <Showcase>
        <ContextMenu
          group={OUTER}
          onSelect={setPicked}
          style={styles.outer}
          testID="storybook-context-outer"
        >
          <Text style={styles.body}>The thread (hold here)</Text>
          <ContextMenu
            group={INNER}
            onSelect={setPicked}
            style={styles.bubble}
            testID="storybook-context-inner"
          >
            <Text style={styles.body}>A message in it (hold here)</Text>
          </ContextMenu>
        </ContextMenu>
        <Note>Last pick: {picked}. The inner menu wins inside its box.</Note>
      </Showcase>
    );
  },
};

/** Disabled, next to an enabled one: no menu, and the hold stays the child's. */
export const Disabled: Story = {
  render: function DisabledStory() {
    const [taps, setTaps] = useState(0);
    const handleTap = useCallback(() => setTaps((n) => n + 1), []);
    return (
      <Showcase>
        <Row label="disabled">
          <ContextMenu
            group={MESSAGE}
            disabled
            style={styles.bubble}
            testID="storybook-context-disabled"
          >
            <Pressable onPress={handleTap} style={styles.press}>
              <Text style={styles.body}>Hold me: I press instead</Text>
            </Pressable>
          </ContextMenu>
        </Row>
        <Row label="enabled">
          <ContextMenu
            group={MESSAGE}
            style={styles.bubble}
            testID="storybook-context-enabled"
          >
            <Text style={styles.body}>Hold me for the menu</Text>
          </ContextMenu>
        </Row>
        <Note>Presses of the disabled one: {taps}.</Note>
      </Showcase>
    );
  },
};

/**
 * `accessible` and an `accessibilityLabel` make the ContextMenu one screen-reader
 * element that carries the menu: the view with its context-menu interaction on iOS,
 * a node with a long-click action labelled "Show menu" on Android.
 */
export const Accessible: Story = {
  render: function AccessibleStory() {
    return (
      <Showcase>
        <ContextMenu
          group={MESSAGE}
          accessible
          accessibilityLabel="Message from Grace"
          style={styles.bubble}
          testID="storybook-context-accessible"
        >
          <Text style={styles.from}>Grace Hopper</Text>
          <Text style={styles.body}>One element, with the menu on it.</Text>
        </ContextMenu>
        <Note>
          Without `accessible`, the children stay separate elements and keep
          their own actions.
        </Note>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  bubble: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#f2f2f7',
    gap: 4,
  },
  theirs: { alignSelf: 'flex-start', maxWidth: '80%' },
  mine: { alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: '#2f6fde' },
  mineText: { color: '#fff' },
  photo: { height: 120, justifyContent: 'flex-end' },
  press: { gap: 2 },
  from: { fontWeight: '600', color: '#1c1c1e' },
  body: { color: '#1c1c1e' },
  readout: { color: '#555' },
  outer: {
    padding: 12,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c8c8d0',
  },
});
