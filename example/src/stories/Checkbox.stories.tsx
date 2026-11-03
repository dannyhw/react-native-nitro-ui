/**
 * Checkbox stories (G15). Props and events: `docs/components/checkbox.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Checkbox } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Showcase, useShowcaseInk } from './showcase';

const meta = {
  component: Checkbox,
  args: {
    label: 'Email me offers',
    checked: false,
    defaultChecked: false,
    indeterminate: false,
    disabled: false,
    tintColor: undefined,
    onCheckedChange: fn(),
  },
  argTypes: {
    label: {
      control: { type: 'text' },
      description:
        'Text beside the box, part of the control and its size. Also its default accessibility label.',
    },
    checked: {
      control: { type: 'boolean' },
      description: 'The checked state. Unset it for an uncontrolled checkbox.',
    },
    defaultChecked: {
      control: { type: 'boolean' },
      description:
        'Initial state of an uncontrolled checkbox. Ignored while `checked` is set.',
    },
    indeterminate: {
      control: { type: 'boolean' },
      description:
        'Android only: Material 3 `TriStateCheckbox`, which draws a dash. A display, not a value - iOS has no checkbox and reads it as off.',
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'text' },
      description:
        'The "on" accent: SwiftUI `.tint()` / Compose checked colors.',
    },
    onCheckedChange: {
      action: 'checked changed',
      description: 'Fired with the new state after a tap.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel.
 *
 * `checked` stays authoritative: taps move the local echo of it and report to the
 * Actions panel, and moving the `checked` row moves the box.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ onCheckedChange, checked, ...props }) {
    const [current, setCurrent] = useState<boolean>(checked ?? false);

    useEffect(() => {
      setCurrent(checked ?? false);
    }, [checked]);

    const handleChange = useCallback(
      (next: boolean) => {
        setCurrent(next);
        onCheckedChange?.(next);
      },
      [onCheckedChange]
    );

    return (
      <Checkbox
        {...props}
        checked={current}
        onCheckedChange={handleChange}
        testID="storybook-checkbox-playground"
      />
    );
  },
};

/**
 * The states a checkbox has: off, on, a bare box, disabled in both, and the third
 * state in both of its values - a dash while the value is off, a check mark while it is
 * on, which is the row whose press reports `false`.
 *
 * The third column is Android's: on iOS the box is a switch, `indeterminate` draws
 * nothing, and the two rows read as off and on. That is what the note says and what the
 * picture shows.
 *
 * This is the README screenshot.
 */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="Uncontrolled">
        <View style={styles.stack}>
          <Checkbox label="Email me offers" />
          <Checkbox label="Order confirmation" defaultChecked />
          {/* Bare: no label at all, so the name has to come from `accessibilityLabel`. */}
          <Checkbox accessibilityLabel="Bare box" />
        </View>
      </Column>
      <Column label="Third state (Android)">
        <View style={styles.stack}>
          <Checkbox label="Select all" indeterminate />
          {/*
            The state a caller has to handle: `indeterminate` while `checked` is true
            shows a check mark, and the press that empties it reports `false`.
          */}
          <Checkbox label="Select all, checked" checked indeterminate />
        </View>
      </Column>
      <Column label="Disabled">
        <View style={styles.stack}>
          <Checkbox label="Off, disabled" disabled />
          <Checkbox label="On, disabled" disabled checked />
        </View>
      </Column>
    </Showcase>
  ),
};

/** The controlled contract: the text is the prop, the box follows it. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const ink = useShowcaseInk();
    const [checked, setChecked] = useState(false);
    const [refused, setRefused] = useState(0);
    return (
      <Showcase>
        <Column label="controlled">
          <View style={styles.pair}>
            <Checkbox
              label="I accept the terms"
              checked={checked}
              onCheckedChange={setChecked}
              testID="storybook-checkbox-controlled"
            />
            <Text style={[styles.echo, { color: ink.ink }]}>
              checked: {String(checked)}
            </Text>
          </View>
        </Column>
        <Column label="refusing (checked stays false)">
          <View style={styles.pair}>
            <Checkbox
              label="Never on"
              checked={false}
              onCheckedChange={() => setRefused((count) => count + 1)}
            />
            <Text style={[styles.echo, { color: ink.ink }]}>
              refused: {refused}
            </Text>
          </View>
        </Column>
        <Note>
          `checked` is React state, so the text can only read what was
          committed. The refusing checkbox snaps back after every tap: the
          event-count handshake returns the control to the prop when JS rejects
          a change.
        </Note>
      </Showcase>
    );
  },
};

/**
 * Sizing: a bare box, and the same box with a label - the label is the whole
 * width difference, and checking it changes nothing on either platform.
 */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Column label="bare, labelled, labelled + checked">
        <View style={styles.stack}>
          <Checkbox accessibilityLabel="Bare box" />
          <Checkbox label="Sized" />
          <Checkbox label="Sized" checked />
        </View>
      </Column>
      <Column label="a longer label">
        <Checkbox label="Send me a reminder the day before" />
      </Column>
      <Note>
        The box is measured, not declared: the first checkbox of a configuration
        is laid out at a fallback and corrected the turn it measures.
      </Note>
    </Showcase>
  ),
};

/** A caller's accent, and what a checkbox looks like with nothing beside it. */
export const Tint: Story = {
  render: () => (
    <Showcase>
      <Column label="tintColor">
        <View style={styles.stack}>
          <Checkbox label="Default" defaultChecked />
          <Checkbox label="#b3005c" defaultChecked tintColor="#b3005c" />
        </View>
      </Column>
      {Platform.OS === 'ios' ? (
        <Note>
          On iOS the accent is `.tint()`, which colours the switch knob; on
          Android it replaces Material 3&apos;s checked box and check.
        </Note>
      ) : null}
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  stack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  pair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  echo: {
    fontSize: 13,
  },
});
