/**
 * ListItem stories (G30). Props and events: `docs/components/list-item.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness and
 * benchmark handles, not app API (DECISIONS D14).
 *
 * Every row with an icon names both glyphs — `systemImage` for iOS and `androidIcon`
 * for Android — because each platform ignores the other's, and a row that names only
 * one is a row with half its icons missing on half the devices.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Form, ListItem, type ListItemProps } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Showcase, useShowcaseInk } from './showcase';

/** A drawable the example app ships in `res/drawable/` — the resource-name form. */
const DRAWABLE = 'nitroui_test_star';

const meta = {
  component: ListItem,
  args: {
    title: 'Push notifications',
    subtitle: 'Only while the app is open',
    value: null,
    systemImage: 'bell.badge',
    androidIcon: DRAWABLE,
    accessory: 'none',
    disabled: false,
    onPress: fn(),
  },
  argTypes: {
    title: {
      control: { type: 'text' },
      description: 'The headline. One line, tail-truncated.',
    },
    subtitle: {
      control: { type: 'text' },
      description:
        'The supporting line under the headline. The one prop that changes the row’s height.',
    },
    value: {
      control: { type: 'text' },
      description:
        'Trailing text on the headline’s own line — “Off”, “1.2.3”. Costs no height.',
    },
    systemImage: {
      control: { type: 'text' },
      description: 'Leading SF Symbol name. iOS only.',
    },
    androidIcon: {
      control: { type: 'text' },
      description:
        'Leading glyph on Android: a drawable name, a `require()` id or a `{ uri }` source.',
    },
    accessory: {
      control: { type: 'select' },
      options: ['none', 'disclosure'],
      description:
        'The trailing chevron every platform puts on a row that goes somewhere.',
    },
    disabled: {
      control: { type: 'boolean' },
      description:
        'No press, no highlight, no button role, and the platform’s own grey.',
    },
    onPress: {
      action: 'item pressed',
      description:
        'Set it and the row is a button; leave it and the row is a label.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof ListItem>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every public prop on the Controls panel. */
export const Playground: Story = {
  render: function PlaygroundStory({ onPress, ...props }) {
    const [last, setLast] = useState('never');
    const handlePress = useCallback(() => {
      setLast('just now');
      onPress?.();
    }, [onPress]);
    return (
      <View>
        <ListItem
          {...(props as ListItemProps)}
          onPress={handlePress}
          testID="storybook-listitem-playground"
        />
        <Text style={styles.echo}>last press: {last}</Text>
      </View>
    );
  },
};

/**
 * The slots, one row each: a bare headline, a headline with its supporting line, a
 * trailing value, and the row that has all three plus a leading glyph and a chevron.
 *
 * This is the README screenshot.
 */
export const Slots: Story = {
  render: () => (
    <Showcase>
      <Column label="Headline only">
        <ListItem title="General" />
      </Column>
      <Column label="With a subtitle">
        <ListItem
          subtitle="Language, formats and regions"
          title="Language & Region"
        />
      </Column>
      <Column label="With a value">
        <ListItem title="Version" value="1.2.3" />
      </Column>
      <Column label="All of it, and a chevron">
        <ListItem
          accessory="disclosure"
          androidIcon={DRAWABLE}
          subtitle="Alerts, sounds and badges"
          systemImage="bell.badge"
          title="Notifications"
          value="On"
        />
      </Column>
      <Note>
        The value sits on the headline’s own line and the subtitle keeps the
        line below it, on both platforms.
      </Note>
    </Showcase>
  ),
};

/**
 * Pressable, disabled, and a label: three rows that differ only in `onPress` and
 * `disabled`.
 *
 * A row with no `onPress` is not a button to a screen reader and a tap on it goes to
 * whatever is behind the row. A disabled row keeps its shape and takes nothing: no
 * press, no highlight, and no event.
 */
export const Pressing: Story = {
  render: function PressingStory() {
    const ink = useShowcaseInk();
    const [pressed, setPressed] = useState(0);
    const [refused, setRefused] = useState(0);
    return (
      <Showcase>
        <Column label="Pressable">
          <ListItem
            accessory="disclosure"
            onPress={() => setPressed((count) => count + 1)}
            subtitle="Highlights as the platform’s row does"
            title="Open the editor"
          />
        </Column>
        <Column label="Not pressable">
          <ListItem
            subtitle="A label, not a button: no highlight, no role"
            title="Read only"
          />
        </Column>
        <Column label="Disabled">
          <ListItem
            accessory="disclosure"
            disabled
            onPress={() => setRefused((count) => count + 1)}
            subtitle="A tap does nothing at all"
            title="Change password"
            value="Soon"
          />
        </Column>
        <Note>
          <Text style={{ color: ink.ink }}>
            presses={pressed} refused={refused}
          </Text>
        </Note>
      </Showcase>
    );
  },
};

/**
 * Every slot capped to one line, which is what makes a row’s height a function of
 * *which* slots are filled rather than of what was typed into them.
 *
 * The row is the same height at every width it can be drawn at, so a `FlashList` row
 * keeps its pitch and a warm mount needs no correction. Wrap-to-fit rows are a
 * follow-up, not an oversight.
 */
export const Truncation: Story = {
  render: () => (
    <Showcase>
      <Frame label="In a 240 pt column" width={240}>
        <ListItem
          subtitle="A supporting line long enough to need an ellipsis of its own"
          title="A headline long enough to need an ellipsis"
          value="Last synced eleven minutes ago"
        />
      </Frame>
      <Column label="Full width">
        <ListItem
          subtitle="A supporting line long enough to need an ellipsis of its own"
          title="A headline long enough to need an ellipsis at this width"
          value="On"
        />
      </Column>
    </Showcase>
  ),
};

/**
 * The leaf inside a `Form`, which is what it was built for.
 *
 * `Form.Row` is the cell, and a cell has already paid for its insets, its shape and its
 * press, so the item drops all three inside one and draws its content edge-to-edge in
 * the box the row gives it. The context does that: nothing here is configured by hand,
 * and the same `<ListItem>` standalone is the same component with its own insets back.
 *
 * This is the second README screenshot.
 */
export const InsideAForm: Story = {
  render: function InsideAFormStory() {
    const [account, setAccount] = useState('Work');
    const [sync, setSync] = useState('Every hour');
    const [pressed, setPressed] = useState(0);
    return (
      <View style={styles.formPage}>
        <Form style={styles.form}>
          <Form.Section footer="The row owns the cell; the item draws the content.">
            <Form.Row>
              <ListItem
                accessory="disclosure"
                androidIcon={DRAWABLE}
                onPress={() => setPressed((count) => count + 1)}
                subtitle="Alerts, sounds and badges"
                systemImage="bell.badge"
                title="Notifications"
                value="On"
              />
            </Form.Row>
            <Form.Row>
              <ListItem
                accessory="disclosure"
                onPress={() =>
                  setAccount(account === 'Work' ? 'Personal' : 'Work')
                }
                title="Account"
                value={account}
              />
            </Form.Row>
            <Form.Row>
              <ListItem
                onPress={() =>
                  setSync(sync === 'Every hour' ? 'Manually' : 'Every hour')
                }
                subtitle="Background refresh costs battery"
                title="Sync"
                value={sync}
              />
            </Form.Row>
            <Form.Row>
              <ListItem
                disabled
                subtitle="Greyed by the platform, not by us"
                systemImage="lock"
                title="Change password"
                value="Soon"
              />
            </Form.Row>
          </Form.Section>
        </Form>
        <Text style={styles.echo}>row presses: {pressed}</Text>
      </View>
    );
  },
};

/**
 * `fillWidth`: the row is as wide as the list it is in, and only its height is its own.
 *
 * Inside a box narrower than the screen the row takes the box — and the value still
 * sits at its trailing edge, because that edge is the box’s, not the screen’s.
 */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Frame label="In a 200 pt box" width={200}>
        <ListItem title="Narrow" value="1.2.3" />
        <ListItem subtitle="Two lines of its own" title="Narrow" value="On" />
      </Frame>
      <Column label="Full width">
        <ListItem title="Wide" value="1.2.3" />
        <ListItem subtitle="Two lines of its own" title="Wide" value="On" />
      </Column>
      <Note>
        The height comes from which slots are filled — one line, or a headline
        over a supporting line — and not from the width or the text.
      </Note>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  echo: {
    fontSize: 12,
    marginTop: 8,
    opacity: 0.7,
  },
  formPage: {
    flex: 1,
    padding: 8,
  },
  form: {
    flex: 1,
    minHeight: 320,
  },
});
