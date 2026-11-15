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
    iosStyle: 'circle',
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
        "The third state: Material 3 `TriStateCheckbox`'s dash on Android, `minus.circle.fill` on iOS. A display, not a value - and `checked` outranks it on both.",
    },
    iosStyle: {
      control: { type: 'select' },
      options: ['circle', 'square', 'switch'],
      description:
        'iOS only: which picture to draw - the checklist circle (default), the square, or the switch this component shipped with. Android ignores it: Material 3 has a checkbox.',
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

/** The README screenshot. */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="Uncontrolled">
        <View style={styles.stack}>
          <Checkbox label="Email me offers" />
          <Checkbox label="Order confirmation" defaultChecked />
          {/* No label, so the name comes from `accessibilityLabel`. */}
          <Checkbox accessibilityLabel="Bare box" />
        </View>
      </Column>
      <Column label="Third state">
        <View style={styles.stack}>
          <Checkbox label="Select all" indeterminate />
          {/* `indeterminate` while `checked` is true shows a check mark, and
              pressing it reports `false`. */}
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

/** Android ignores `iosStyle` and draws the Material 3 checkbox in all three columns. */
export const IosStyles: Story = {
  render: () => (
    <Showcase>
      <Column label="circle (default)">
        <View style={styles.stack}>
          <Checkbox label="Email me offers" />
          <Checkbox label="Order confirmation" defaultChecked />
          <Checkbox label="Some items selected" indeterminate />
        </View>
      </Column>
      <Column label="square">
        <View style={styles.stack}>
          <Checkbox label="Email me offers" iosStyle="square" />
          <Checkbox
            label="Order confirmation"
            defaultChecked
            iosStyle="square"
          />
          <Checkbox
            label="Some items selected"
            indeterminate
            iosStyle="square"
          />
        </View>
      </Column>
      <Column label="switch">
        <View style={styles.stack}>
          <Checkbox label="Email me offers" iosStyle="switch" />
          <Checkbox
            label="Order confirmation"
            defaultChecked
            iosStyle="switch"
          />
          <Checkbox
            label="Some items selected"
            indeterminate
            iosStyle="switch"
          />
        </View>
      </Column>
      {Platform.OS === 'ios' ? (
        <Note>
          Three pictures, one control: the glyph styles still toggle from a
          press anywhere on the row, still report one change per press, and are
          still one accessibility element with the label as its name.
        </Note>
      ) : null}
    </Showcase>
  ),
};

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
          On iOS the accent colours the filled glyph - the check mark or the
          dash - and the switch knob in `iosStyle='switch'`; on Android it
          replaces Material 3&apos;s checked box and check. The empty box stays
          the system&apos;s secondary label colour, whichever accent is set.
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
