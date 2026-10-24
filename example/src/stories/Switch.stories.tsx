/**
 * Switch stories (S1). Props and events: `docs/components/switch.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`, `nuiTestWidth`) are hidden: they
 * are harness/benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Switch } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Row, Showcase } from './showcase';

const meta = {
  component: Switch,
  args: {
    value: true,
    defaultValue: false,
    disabled: false,
    tintColor: undefined,
    onValueChange: fn(),
  },
  argTypes: {
    value: {
      control: { type: 'boolean' },
      description:
        'Selected state. Set it to control the Switch; unset it and native owns the value.',
    },
    defaultValue: {
      control: { type: 'boolean' },
      description:
        'Initial value of an uncontrolled Switch. Ignored while `value` is set, so this row does nothing in a controlled Playground.',
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'color' },
      description:
        'Accent of the on state: SwiftUI `.tint()` on iOS, the checked track colour on Android. Unset uses the platform accent.',
    },
    onValueChange: {
      action: 'value changed',
      description: 'Fired with the new value after every user interaction.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
    nuiTestWidth: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel.
 *
 * `value` stays authoritative: taps move the local echo of it (so the control
 * feels alive) and report to the Actions panel, and moving the `value` row moves
 * the control.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ onValueChange, value, ...props }) {
    const [current, setCurrent] = useState<boolean>(value ?? false);

    useEffect(() => {
      setCurrent(value ?? false);
    }, [value]);

    const handleChange = useCallback(
      (next: boolean) => {
        setCurrent(next);
        onValueChange?.(next);
      },
      [onValueChange]
    );

    return (
      <Switch
        {...props}
        accessibilityLabel="Playground switch"
        onValueChange={handleChange}
        testID="storybook-switch-playground"
        value={current}
      />
    );
  },
};

/**
 * No `value` anywhere: native owns each Switch, so a tap costs no React render
 * and `defaultValue` is what decides the starting position.
 */
export const Uncontrolled: Story = {
  render: () => (
    <Showcase>
      <Row label="defaultValue unset (off)">
        <Switch />
      </Row>
      <Row label="defaultValue true (on)">
        <Switch defaultValue />
      </Row>
      <Note>
        These have no `value` prop, so they keep their own state and no React
        render happens when you tap them.
      </Note>
    </Showcase>
  ),
};

/** The controlled contract: the Text is the prop, the Switch follows it. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [value, setValue] = useState(false);
    return (
      <Showcase>
        <Row label="controlled">
          <View style={styles.pair}>
            <Switch
              onValueChange={setValue}
              testID="storybook-switch-controlled"
              value={value}
            />
            <Text style={styles.echo}>value: {String(value)}</Text>
          </View>
        </Row>
        <Note>
          `value` is React state, so the label can only ever read what was
          committed - the event-count handshake is what returns the control to
          the prop when JS rejects a change.
        </Note>
      </Showcase>
    );
  },
};

/** The whole state grid at once: on/off x enabled/disabled, plus a tint. */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="Uncontrolled, enabled">
        <Row label="off">
          <Switch defaultValue={false} />
        </Row>
        <Row label="on">
          <Switch defaultValue />
        </Row>
      </Column>
      <Column label="Uncontrolled, disabled">
        <Row label="off">
          <Switch defaultValue={false} disabled />
        </Row>
        <Row label="on">
          <Switch defaultValue disabled />
        </Row>
      </Column>
      <Column label="Tinted (iOS `.tint()`, Android checked track)">
        <Row label="on, red">
          <Switch defaultValue tintColor="#ff375f" />
        </Row>
        <Row label="on, green">
          <Switch defaultValue tintColor="#30d158" />
        </Row>
      </Column>
    </Showcase>
  ),
};

/**
 * Sizing (README "Sizing"): a Switch measures itself. `alignSelf: stretch` is
 * the only way to make it wider than its own measurement, and a parent width
 * alone leaves it at its measured size.
 */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Row label="intrinsic">
        <Switch defaultValue />
        <Text style={styles.baseline}>measured box, baseline-aligned</Text>
      </Row>
      <Column label="inside a 240-wide parent (dashed)">
        <View style={styles.parent}>
          <Switch defaultValue />
        </View>
      </Column>
      <Column label="alignSelf: stretch">
        <View style={styles.parent}>
          <Switch defaultValue style={styles.stretch} />
        </View>
      </Column>
      <Note>
        Measured sizes leave Yoga nothing to stretch, so a parent&apos;s
        alignItems does not widen an intrinsic control - the third row asks for
        the fill on the control itself.
      </Note>
    </Showcase>
  ),
};

/**
 * Both appearances on one screen. The controls resolve their own colours from
 * the OS appearance (so they look right on a user&apos;s light or dark screen);
 * the two cards are the same row drawn on each surface for comparison.
 */
export const Appearances: Story = {
  render: () => (
    <Showcase>
      <Column label="on a light surface">
        <View style={[styles.card, styles.light]}>
          <Switch defaultValue />
          <Switch />
          <Switch disabled />
        </View>
      </Column>
      <Column label="on a dark surface">
        <View style={[styles.card, styles.dark]}>
          <Switch defaultValue />
          <Switch />
          <Switch disabled />
        </View>
      </Column>
      <Note>
        Order in every card: on, off, disabled off. Flip the device appearance
        to change the controls&apos; own palette; the cards only change what is
        behind them.
      </Note>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  baseline: {
    fontSize: 13,
    opacity: 0.7,
  },
  echo: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  pair: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  parent: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#8e8e93',
    padding: 10,
    width: 240,
  },
  stretch: {
    alignSelf: 'stretch',
  },
  card: {
    borderRadius: 12,
    gap: 12,
    padding: 14,
  },
  dark: {
    backgroundColor: '#000000',
  },
  light: {
    backgroundColor: '#ffffff',
  },
});
