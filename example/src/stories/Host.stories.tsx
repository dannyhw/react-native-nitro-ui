/**
 * Host stories (H1, H2a). What it is and what it refuses: `docs/components/host.md`.
 *
 * The story is the comparison, because that is the only thing a Host changes: the
 * same controls, drawn by one composition or by N of them. `style.height` on the
 * Host is not decoration — a hosted control reports no size, so the box is the
 * height the app gives it (D24).
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Host, Progress, Slider, Switch } from 'react-native-nitro-ui';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Showcase } from './showcase';

/** Switches per side. Enough to be a batch, few enough to fit the device. */
const ROWS = 8;

/** The pitch a hosted `Switch` draws at — the engine's box for that configuration. */
const ROW = 48;

const meta = {
  component: Host,
  args: {},
  argTypes: {
    children: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Host>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Hosted and unhosted, side by side, same count.
 *
 * The two columns look identical on purpose — that is the trade: nothing about the
 * control changes, only who composes it. On iOS both sides are ordinary React
 * Native views, because a Host is a passthrough there.
 */
export const HostedVsNot: Story = {
  render: function HostedVsNotStory() {
    const [events, setEvents] = useState(0);
    const count = useCallback(() => {
      setEvents((current) => current + 1);
    }, []);
    const switches = Array.from({ length: ROWS }, (_, index) => (
      <Switch
        key={index}
        defaultValue={index % 3 === 0}
        onValueChange={count}
        accessibilityLabel={`Switch ${String(index)}`}
      />
    ));
    return (
      <Showcase>
        <Column label={`one Host · ${ROWS} Switches`}>
          <View style={styles.card}>
            <Host style={styles.host}>{switches}</Host>
          </View>
        </Column>
        <Column label={`${ROWS} Switches · ${ROWS} compositions`}>
          <View style={styles.card}>{switches}</View>
        </Column>
        <Note>
          {events === 0
            ? 'Toggle either side: the events land in the same handler, from a composition or from ' +
              ROWS +
              ' of them.'
            : `${events} change${events === 1 ? '' : 's'} reported — the same handler either way.`}
        </Note>
        <Note>
          The Host has a height, its children do not need one. A style on a
          hosted child moves the frame React Native computes, not what is drawn
          (D24).
        </Note>
      </Showcase>
    );
  },
};

/**
 * The same batch, rebuilt: what a screen does when a settings page closes and opens.
 *
 * `Rebuild` unmounts the tree and mounts it again, which is the loop the leak gate
 * measures (`example/__tests__/MountChurn.harness.tsx`) — on a screen where it is a
 * button rather than a number.
 */
export const Churn: Story = {
  render: function ChurnStory() {
    const [generation, setGeneration] = useState(0);
    const [events, setEvents] = useState(0);
    const count = useCallback(() => {
      setEvents((current) => current + 1);
    }, []);
    return (
      <Showcase>
        <Pressable onPress={() => setGeneration((current) => current + 1)}>
          <Text style={styles.link}>rebuild the batch</Text>
        </Pressable>
        <View style={styles.card}>
          <Host key={String(generation)} style={styles.host}>
            {Array.from({ length: ROWS }, (_, index) => (
              <Switch
                key={index}
                defaultValue={index % 2 === 0}
                onValueChange={count}
                accessibilityLabel={`Churned switch ${String(index)}`}
              />
            ))}
          </Host>
        </View>
        <Note>
          Generation {generation} · {events} changes reported by this batch.
        </Note>
      </Showcase>
    );
  },
};

/**
 * Four kinds of control, one composition (H2a).
 *
 * A `Switch`, a `Slider`, both `Progress` variants and a `Button` in one `Column`,
 * which is where the per-control sizing rule shows itself: the Slider stretches to
 * the Host's width, the Button and the circular indicator keep their own width at the
 * leading edge, and none of them was asked how big it is.
 */
export const Mixed: Story = {
  render: function MixedStory() {
    const [on, setOn] = useState(false);
    const [value, setValue] = useState(0.4);
    const [presses, setPresses] = useState(0);
    return (
      <Showcase>
        <View style={styles.card}>
          <Host style={styles.mixedHost}>
            <Switch
              value={on}
              onValueChange={setOn}
              accessibilityLabel="Mixed switch"
            />
            <Slider
              value={value}
              onValueChange={setValue}
              accessibilityLabel="Mixed slider"
            />
            <Progress value={0.35} accessibilityLabel="Mixed linear progress" />
            <Progress
              variant="circular"
              value={0.65}
              accessibilityLabel="Mixed circular progress"
            />
            <Button
              title="Mixed action"
              onPress={() => setPresses((current) => current + 1)}
              accessibilityLabel="Mixed button"
            />
          </Host>
        </View>
        <Note>
          {`${on ? 'on' : 'off'} · slider ${value.toFixed(2)} · ${presses} press${
            presses === 1 ? '' : 'es'
          } — five controls, one composition, and each one still answers for itself.`}
        </Note>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  host: { width: '100%', height: ROWS * ROW },
  // Four kinds of control draw their own heights, and RN is not told any of them, so
  // this is room rather than a measurement (D24). A Host that is too short clips.
  mixedHost: { width: '100%', height: 280 },
  link: { color: '#3b82f6', paddingVertical: 6 },
});
