/**
 * Button stories (S1). Props and events: `docs/components/button.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

const VARIANTS = ['filled', 'tonal', 'outlined', 'text', 'elevated'] as const;
const SIZES = ['small', 'medium', 'large'] as const;

const meta = {
  component: Button,
  args: {
    title: 'Download',
    variant: 'filled',
    size: 'medium',
    disabled: false,
    tintColor: undefined,
    systemImage: undefined,
    onPress: fn(),
  },
  argTypes: {
    title: {
      control: { type: 'text' },
      description:
        'The label. It is also one of the props that decide the width, and the default accessibility label.',
    },
    variant: {
      control: { type: 'select' },
      options: [...VARIANTS],
      description:
        'The style. iOS has five button styles but not these three Material roles, so `elevated` and `filled` are the same control there and `outlined` is `.bordered` plus a stroke.',
    },
    size: {
      control: { type: 'select' },
      options: [...SIZES],
      description:
        'SwiftUI `.controlSize` on iOS; content padding and label typography on Android.',
    },
    disabled: {
      control: { type: 'boolean' },
      description:
        'Disabled natively: the tap is swallowed and JS receives nothing at all, so a disabled Playground logs no action.',
    },
    tintColor: {
      control: { type: 'color' },
      description:
        "SwiftUI `.tint()` on iOS; the variant's container or label colour on Android.",
    },
    systemImage: {
      control: { type: 'text' },
      description:
        'Leading SF Symbol name. **iOS only in v0.1** - Android ignores it, so the label stays the `title` text there.',
    },
    onPress: {
      action: 'pressed',
      description: 'One call per tap.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every public prop on the Controls panel, with `onPress` logging to Actions. */
export const Playground: Story = {
  render: function PlaygroundStory({ onPress, ...props }) {
    const handlePress = useCallback(() => onPress?.(), [onPress]);
    return (
      <Button
        {...props}
        accessibilityLabel="Playground button"
        onPress={handlePress}
        testID="storybook-button-playground"
      />
    );
  },
};

/**
 * The five variants and the three sizes, side by side, then all five disabled.
 *
 * Every row takes the `title` row from the Controls panel, because the label is
 * part of what decides each button's width.
 */
export const Variants: Story = {
  render: ({ title }) => (
    <Showcase>
      <Column label="variants (medium)">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            <Button title={title} variant={variant} />
          </Row>
        ))}
      </Column>
      <Column label="sizes (filled)">
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <Button size={size} title={title} />
          </Row>
        ))}
      </Column>
      <Column label="disabled (emits nothing)">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            <Button disabled title={title} variant={variant} />
          </Row>
        ))}
      </Column>
      <Note>
        Text size does move this control: the label is text, so Dynamic Type /
        `font_scale` change the measured box - unlike the Switch, which keeps
        its platform size.
      </Note>
    </Showcase>
  ),
};

/** Tints, and what a tint means per variant on each platform. */
export const Tints: Story = {
  render: ({ title }) => (
    <Showcase>
      <Column label="untinted (platform accent / M3 scheme)">
        <Row label="filled">
          <Button title={title} />
        </Row>
        <Row label="text">
          <Button title={title} variant="text" />
        </Row>
      </Column>
      <Column label="#ff375f">
        <Row label="filled (container)">
          <Button tintColor="#ff375f" title={title} />
        </Row>
        <Row label="tonal (container)">
          <Button tintColor="#ff375f" title={title} variant="tonal" />
        </Row>
        <Row label="outlined (label + border)">
          <Button tintColor="#ff375f" title={title} variant="outlined" />
        </Row>
        <Row label="text (label)">
          <Button tintColor="#ff375f" title={title} variant="text" />
        </Row>
      </Column>
      <Column label="a tint with too little contrast">
        <Row label="#3a3a3c filled (each platform keeps its own rules)">
          <Button tintColor="#3a3a3c" title={title} />
        </Row>
      </Column>
    </Showcase>
  ),
};

/**
 * `systemImage`, which is iOS-only in v0.1.
 *
 * It is in the sizing key on both platforms so the two cannot drift apart when
 * Android implements it - the icon'd button is the same sizing question on both,
 * even while only one answers it.
 */
export const Icons: Story = {
  render: () => (
    <Showcase>
      <Column label="systemImage">
        <Row label="arrow.down.circle">
          <Button systemImage="arrow.down.circle" title="Download" />
        </Row>
        <Row label="tray.and.arrow.down (tonal)">
          <Button
            systemImage="tray.and.arrow.down"
            title="Save"
            variant="tonal"
          />
        </Row>
        <Row label="cloud (with a long title)">
          <Button
            systemImage="cloud"
            title="Sync everything now"
            variant="outlined"
          />
        </Row>
        <Row label="sparkles (large, text)">
          <Button
            size="large"
            systemImage="sparkles"
            title="Generate"
            variant="text"
          />
        </Row>
      </Column>
      <Note>
        On Android these render as plain text buttons: `systemImage` is
        accepted, sent, and ignored in v0.1 (`docs/components/button.md`,
        Limits).
      </Note>
    </Showcase>
  ),
};

/**
 * The echo a caller actually builds: presses counted in React state, so the
 * label can only ever read taps that really arrived in JS.
 */
export const PressCounter: Story = {
  render: function PressCounterStory({ title }) {
    const [presses, setPresses] = useState(0);
    const handlePress = useCallback(
      () => setPresses((current) => current + 1),
      []
    );
    return (
      <Showcase>
        <Row label="enabled">
          <View style={styles.pair}>
            <Button
              onPress={handlePress}
              testID="storybook-button-counter"
              title={title}
            />
            <Text style={styles.readout}>presses: {presses}</Text>
          </View>
        </Row>
        <Row label="disabled">
          <View style={styles.pair}>
            <Button
              disabled
              onPress={handlePress}
              title={title}
              variant="tonal"
            />
            <Text style={styles.readout}>
              nothing arrives - native swallows the tap
            </Text>
          </View>
        </Row>
      </Showcase>
    );
  },
};

/**
 * Sizing (README "Sizing"): a Button measures itself, so a parent width leaves it
 * at its measured size and `alignSelf: 'stretch'` is what asks for the fill. A
 * `width` narrower than the label truncates it (one line, tail) instead of
 * painting outside the box.
 */
export const Sizing: Story = {
  render: ({ title }) => (
    <Showcase>
      <Row label="intrinsic">
        <Button title={title} />
        <Text style={styles.baseline}>measured box, baseline-aligned</Text>
      </Row>
      <Frame label="inside a 240-wide parent (dashed)" width={240}>
        <Button title={title} />
      </Frame>
      <Frame label="inside a 240-wide parent, alignSelf: stretch" width={240}>
        <Button style={styles.stretch} title={title} />
      </Frame>
      <Frame label="inside a 96-wide parent (truncates)" width={96}>
        <Button title="A title far too long for this box" />
      </Frame>
      <Note>
        The long title is a different sizing configuration too - the label text
        is part of the size key, so a new title costs one layout correction.
      </Note>
    </Showcase>
  ),
};

/**
 * Both surfaces on one screen. The buttons resolve their own colours from the OS
 * appearance; the cards only change what is behind them.
 */
export const Appearances: Story = {
  render: ({ title }) => (
    <Showcase>
      <Column label="on a light surface">
        <View style={[styles.card, styles.light]}>
          <Button title={title} />
          <Button title={title} variant="outlined" />
          <Button disabled title={title} />
        </View>
      </Column>
      <Column label="on a dark surface">
        <View style={[styles.card, styles.dark]}>
          <Button title={title} />
          <Button title={title} variant="outlined" />
          <Button disabled title={title} />
        </View>
      </Column>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  baseline: {
    fontSize: 13,
    opacity: 0.7,
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
  pair: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  readout: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  stretch: {
    alignSelf: 'stretch',
  },
});
