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
 * Both platforms draw the third state now (DECISIONS D47 item 3): Material 3's dash on
 * Android and `minus.circle.fill` on iOS, so the middle column is a pair of pictures on
 * either platform and not one platform's column. The iOS picture is the checkmark glyph;
 * `iosStyle='switch'` is the old look and has its own story.
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
      <Column label="Third state">
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

/**
 * `iosStyle`: the three pictures iOS can draw (DECISIONS D47).
 *
 * The circle is the default - Apple's own checklist symbol, the one Reminders and Notes
 * draw - because a Checkbox that looked exactly like a Switch read as the wrong
 * component. The square is the same glyph squared. `'switch'` is what this shipped with
 * under DECISIONS D38 item 1, kept because it is the look some callers chose: the
 * system's own control, at its own size, with its own thumb.
 *
 * It is one prop with three pictures and not three controls: the same `Toggle`, the same
 * binding, the same tap target, the same accessibility element, the same value. Android
 * ignores it entirely - Material 3 has a checkbox - and draws its box for all three rows.
 */
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
