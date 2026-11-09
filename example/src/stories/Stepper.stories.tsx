/**
 * Stepper stories (G25). Props and behaviour: `docs/components/stepper.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 *
 * A Stepper draws no number — the app renders the value wherever it wants it —
 * so every story here pairs the control with the text that shows its value, which
 * is also the only way to *see* a step happen in a screenshot.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stepper } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Frame, Note, Row, Showcase } from './showcase';

const meta = {
  component: Stepper,
  args: {
    accessibilityLabel: 'Playground stepper',
    minimumValue: 0,
    maximumValue: 100,
    step: 1,
    disabled: false,
    defaultValue: 50,
    onValueChange: fn(),
  },
  argTypes: {
    accessibilityLabel: {
      control: { type: 'text' },
      description:
        'Names the control. The *value* is announced by the control itself, so this is the half it cannot work out.',
    },
    minimumValue: {
      control: { type: 'number' },
      description: 'Lower bound. Default `0`.',
    },
    maximumValue: {
      control: { type: 'number' },
      description: 'Upper bound. Default `100`.',
    },
    step: {
      control: { type: 'number' },
      description:
        'One step moves this much, snapped to multiples of it measured from `minimumValue`. Must be greater than `0` — anything else throws in development.',
    },
    defaultValue: {
      control: { type: 'number' },
      description:
        'Where an uncontrolled Stepper starts. Default: `minimumValue`. Ignored while `value` is set.',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Both halves take the disabled style and no event fires.',
    },
    value: {
      control: false,
      description:
        'Pass it to control the Stepper; leave it out and native owns the displayed value, so a step costs no React render.',
    },
    onValueChange: {
      description: 'Once per step, with the value native now displays.',
    },
    testID: { control: false },
    hybridRef: { control: false },
    nuiPerfId: { control: false },
  },
} satisfies Meta<typeof Stepper>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The story's own value, shown next to the control the way an app would. */
function Value({ value }: { value: number }) {
  return (
    <Text style={styles.value}>{value.toFixed(1).replace(/\.0$/, '')}</Text>
  );
}

/**
 * Every public prop on the Controls panel.
 *
 * Uncontrolled by default, which is how most apps use it: the read-out below
 * still follows every step, because `onValueChange` fires whatever the mode.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ onValueChange, ...props }) {
    const [value, setValue] = useState<number>(props.defaultValue ?? 0);
    const handleValueChange = useCallback(
      (next: number) => {
        setValue(next);
        onValueChange?.(next);
      },
      [onValueChange]
    );

    return (
      <View style={styles.playground}>
        <View style={styles.row}>
          <Stepper
            {...props}
            onValueChange={handleValueChange}
            testID="storybook-stepper-playground"
          />
          <Value value={value} />
        </View>
        <Text style={styles.note}>
          The control never draws the number: this text is the app&apos;s own.
        </Text>
      </View>
    );
  },
};

/**
 * The bounds and the two states a bound produces, plus a disabled control — the
 * row the README pair is taken from.
 *
 * At each end exactly one half goes inert, which is the whole difference between
 * &quot;disabled&quot; and &quot;at a bound&quot;: the last row is the control with
 * both halves inert, which is a different thing.
 */
export const States: Story = {
  render: function StatesStory() {
    const [quantity, setQuantity] = useState(1);
    return (
      <Showcase>
        <Row label="mid-range — both halves live">
          <Stepper
            accessibilityLabel="Mid-range stepper"
            defaultValue={50}
            testID="storybook-stepper-mid"
          />
        </Row>
        <Row label="at the minimum — the minus half is inert">
          <Stepper
            accessibilityLabel="At the minimum"
            defaultValue={0}
            maximumValue={3}
            testID="storybook-stepper-min"
          />
        </Row>
        <Row label="at the maximum — the plus half is inert">
          <Stepper
            accessibilityLabel="At the maximum"
            defaultValue={3}
            maximumValue={3}
            testID="storybook-stepper-max"
          />
        </Row>
        <Row label="disabled — both halves inert, and no event">
          <Stepper
            accessibilityLabel="Disabled stepper"
            defaultValue={50}
            disabled
            testID="storybook-stepper-disabled"
          />
        </Row>
        <Row label="with the app’s own number">
          <View style={styles.row}>
            <Stepper
              accessibilityLabel="Quantity"
              maximumValue={99}
              minimumValue={1}
              onValueChange={setQuantity}
              testID="storybook-stepper-quantity"
              value={quantity}
            />
            <Value value={quantity} />
          </View>
        </Row>
        <Note>
          iOS is SwiftUI&apos;s own `Stepper`, so the inert half at a bound is
          SwiftUI&apos;s. Android has no stepper: the control is composed from
          two Material 3 tonal icon buttons and each one is disabled at its own
          bound, which is the same rule applied by hand.
        </Note>
      </Showcase>
    );
  },
};

/**
 * The grid. Every value is a multiple of `step` measured from `minimumValue`, and
 * the maximum is always reachable, which is what a `0.1` step is really testing.
 */
export const Steps: Story = {
  render: function StepsStory() {
    const [tenths, setTenths] = useState(0);
    const [fives, setFives] = useState(0);
    const [odd, setOdd] = useState(1);
    return (
      <Showcase>
        <Row label="step 0.1 — no 0.30000000000000004">
          <Stepper
            accessibilityLabel="Tenths stepper"
            maximumValue={1}
            minimumValue={0}
            onValueChange={setTenths}
            step={0.1}
            testID="storybook-stepper-tenths"
            value={tenths}
          />
          <Value value={tenths} />
        </Row>
        <Row label="step 5">
          <Stepper
            accessibilityLabel="Fives stepper"
            maximumValue={100}
            onValueChange={setFives}
            step={5}
            testID="storybook-stepper-fives"
            value={fives}
          />
          <Value value={fives} />
        </Row>
        <Row label="1…10 by 3 — the maximum is still reachable">
          <Stepper
            accessibilityLabel="Odd grid stepper"
            defaultValue={1}
            maximumValue={10}
            minimumValue={1}
            onValueChange={setOdd}
            step={3}
            testID="storybook-stepper-odd"
            value={odd}
          />
          <Value value={odd} />
        </Row>
        <Note>
          The same rule `Slider` uses, in the same code: `1…10` by `3` steps 1,
          4, 7, 10 — the grid is measured from `minimumValue`, so this row's
          stops are `1 + 3n`, and the last step is a short one, because the
          maximum is a value like any other. (`0…10` by `3` would step 0, 3, 6,
          9, 10.)
        </Note>
      </Showcase>
    );
  },
};

/** Controlled, uncontrolled, and what a refused step does. */
export const Values: Story = {
  render: function ValuesStory() {
    const [controlled, setControlled] = useState(2);
    const [refused, setRefused] = useState(2);
    const [events, setEvents] = useState(0);
    // The app decides: every ask is counted, and nothing above 4 is accepted.
    const refuseAboveFour = useCallback((next: number) => {
      setEvents((count) => count + 1);
      if (next <= 4) setRefused(next);
    }, []);

    return (
      <Showcase>
        <Row label="controlled">
          <Stepper
            accessibilityLabel="Controlled stepper"
            maximumValue={10}
            onValueChange={setControlled}
            testID="storybook-stepper-controlled"
            value={controlled}
          />
          <Value value={controlled} />
        </Row>
        <Row label="uncontrolled — native owns the value, so a step costs no render">
          <Stepper
            accessibilityLabel="Uncontrolled stepper"
            defaultValue={4}
            maximumValue={10}
            testID="storybook-stepper-uncontrolled"
          />
        </Row>
        <Row label="a step the app refuses snaps back">
          <Stepper
            accessibilityLabel="Refusing stepper"
            maximumValue={10}
            minimumValue={0}
            onValueChange={refuseAboveFour}
            testID="storybook-stepper-refusing"
            value={refused}
          />
          <Value value={refused} />
        </Row>
        <Note>
          The refusing row accepts asks up to 4 and ignores every ask above it.
          The control steps optimistically, reports the step, and then puts its
          own value back — the same handshake `Switch`, `Checkbox` and `Slider`
          use, so a tap never waits for a React render and a refused change
          never sticks. Asks this row has seen: {events}.
        </Note>
      </Showcase>
    );
  },
};

/** The box, and the one thing that does not change it. */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Row label="intrinsic">
        <Stepper
          accessibilityLabel="Intrinsic stepper"
          testID="storybook-stepper-intrinsic"
        />
        <Text style={styles.baseline}>measured box, baseline-aligned</Text>
      </Row>
      <Row label="a different range, step and disabled flag — the same box">
        <Stepper
          accessibilityLabel="Wide range stepper"
          disabled
          maximumValue={2000}
          minimumValue={-500}
          step={0.5}
          testID="storybook-stepper-other-range"
        />
      </Row>
      <Frame label="inside a 240-wide parent (dashed)" width={240}>
        <Stepper
          accessibilityLabel="In a narrow parent"
          testID="storybook-stepper-narrow-parent"
        />
      </Frame>
      <Note>
        One box, whatever the caller sends: the two halves are fixed-width on
        both platforms, so `minimumValue`, `maximumValue`, `step` and `disabled`
        decide which numbers the control steps through and never how wide it is.
      </Note>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  baseline: {
    fontSize: 13,
    opacity: 0.7,
  },
  note: {
    fontSize: 13,
    opacity: 0.7,
  },
  playground: {
    alignSelf: 'stretch',
    gap: 10,
    padding: 12,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  value: {
    fontVariant: ['tabular-nums'],
    fontSize: 20,
    minWidth: 48,
  },
});
