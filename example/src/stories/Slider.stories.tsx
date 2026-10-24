/**
 * Slider stories (S1). Props and events: `docs/components/slider.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Slider } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

const meta = {
  component: Slider,
  args: {
    value: 0.4,
    defaultValue: undefined,
    minimumValue: 0,
    maximumValue: 1,
    step: 0,
    disabled: false,
    tintColor: undefined,
    onValueChange: fn(),
    onSlidingStart: fn(),
    onSlidingComplete: fn(),
  },
  argTypes: {
    value: {
      control: { type: 'number' },
      description:
        'The value. Set it to control the Slider; unset it and native owns the displayed value.',
    },
    defaultValue: {
      control: { type: 'number' },
      description:
        'Initial value of an uncontrolled Slider (defaults to `minimumValue`). Ignored while `value` is set.',
    },
    minimumValue: { control: { type: 'number' } },
    maximumValue: { control: { type: 'number' } },
    step: {
      control: { type: 'number' },
      description:
        "Increment the value snaps to, in the Slider's own units. `0` (the default) is continuous. Quantising happens natively, before any event is emitted.",
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'color' },
      description:
        'Accent of the filled track and thumb: SwiftUI `.tint()` on iOS, the M3 active track + thumb on Android.',
    },
    onValueChange: {
      action: 'value changed',
      description:
        'During a drag, at most once per frame, with the value native now displays.',
    },
    onSlidingStart: {
      action: 'sliding started',
      description: 'When a drag begins, with the value it began at.',
    },
    onSlidingComplete: {
      action: 'sliding completed',
      description: 'When a drag ends, always with the final value.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel, with the three events logging to
 * Actions.
 *
 * The drag writes into a local echo of `value` so the thumb follows the finger
 * and the `value` row keeps the authority - move the row and the thumb moves.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ onValueChange, value, ...props }) {
    const [current, setCurrent] = useState<number>(value ?? 0);

    useEffect(() => {
      setCurrent(value ?? 0);
    }, [value]);

    const handleChange = useCallback(
      (next: number) => {
        setCurrent(next);
        onValueChange?.(next);
      },
      [onValueChange]
    );

    return (
      <View style={styles.playground}>
        <Slider
          {...props}
          accessibilityLabel="Playground slider"
          onValueChange={handleChange}
          testID="storybook-slider-playground"
          value={current}
        />
        <Text style={styles.readout}>value: {current.toFixed(3)}</Text>
      </View>
    );
  },
};

/**
 * Continuous vs quantised, side by side. `step` snaps natively, so what the
 * Actions panel logs is always exactly what the thumb shows.
 */
export const Steps: Story = {
  render: () => (
    <Showcase>
      <Column label="step 0 (continuous)">
        <Slider defaultValue={0.35} />
      </Column>
      <Column label="step 0.1">
        <Slider defaultValue={0.4} step={0.1} />
      </Column>
      <Column label="whole numbers, 0-10, step 1">
        <Slider defaultValue={3} maximumValue={10} minimumValue={0} step={1} />
      </Column>
      <Column label="disabled">
        <Slider defaultValue={0.6} disabled />
      </Column>
      <Column label="tinted">
        <Slider defaultValue={0.55} tintColor="#ff9f0a" />
      </Column>
      <Note>
        Drag each one: a quantised Slider emits only the values it can land on,
        because the quantising happens natively before anything is sent to JS.
      </Note>
    </Showcase>
  ),
};

/** Controlled: the readout is React state, so it can never disagree. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [value, setValue] = useState(0.5);
    return (
      <Showcase>
        <Row label="controlled">
          <View style={styles.pair}>
            <Slider
              onValueChange={setValue}
              style={styles.fill}
              testID="storybook-slider-controlled"
              value={value}
            />
            <Text style={styles.readout}>{value.toFixed(2)}</Text>
          </View>
        </Row>
        <Note>
          Drag it: every frame native emits, React re-renders, the prop comes
          back. `onValueChange` is coalesced natively to at most one emission
          per frame, so this is the expensive path - `onSlidingComplete` is the
          one to hand a server.
        </Note>
      </Showcase>
    );
  },
};

/** Uncontrolled: no `value`, so a drag costs no React render at all. */
export const Uncontrolled: Story = {
  render: () => (
    <Showcase>
      <Column label="uncontrolled, defaultValue 0.25">
        <Slider defaultValue={0.25} />
      </Column>
      <Column label="uncontrolled, no defaultValue">
        <Slider />
      </Column>
      <Note>
        With no `value` prop native keeps the position it is dragged to, and
        React is only told through the events.
      </Note>
    </Showcase>
  ),
};

/**
 * Sizing (README "Sizing"): a Slider is a `fillWidth` control, so its width is
 * the box its parent gives it and only its height is its own.
 */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Column label="default (fills the story width)">
        <Slider defaultValue={0.5} />
      </Column>
      <Frame label="inside a 160-wide parent" width={160}>
        <Slider defaultValue={0.5} />
      </Frame>
      <Frame label="inside a 160-wide parent, width 90" width={160}>
        <Slider defaultValue={0.5} style={styles.narrow} />
      </Frame>
      <Note>
        The measured box is the height; the width comes from the layout above
        it, which is why the same control fills one parent and stops inside a
        narrower one.
      </Note>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  narrow: {
    alignSelf: 'center',
    width: 90,
  },
  pair: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  playground: {
    alignSelf: 'stretch',
    gap: 10,
    padding: 12,
  },
  readout: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
});
