/**
 * Chip stories (G12). Props and events: `docs/components/chip.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Chip } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Showcase, useShowcaseInk } from './showcase';

const meta = {
  component: Chip,
  args: {
    label: 'Open now',
    variant: 'filter',
    selected: false,
    disabled: false,
    systemImage: undefined,
    onSelectedChange: fn(),
    onPress: fn(),
  },
  argTypes: {
    label: {
      control: { type: 'text' },
      description: 'The chip text. Also its default accessibility label.',
    },
    variant: {
      control: { type: 'radio' },
      options: ['filter', 'assist'],
      description:
        '`filter` has a selection (SwiftUI `Toggle(.button)`, M3 `FilterChip`); `assist` is an action (bordered capsule `Button`, M3 `AssistChip`).',
    },
    selected: {
      control: { type: 'boolean' },
      description:
        'Filter chips: the selection. Unset it for an uncontrolled chip. Ignored by an assist chip.',
    },
    defaultSelected: {
      control: { type: 'boolean' },
      description:
        'Initial selection of an uncontrolled filter chip. Ignored while `selected` is set.',
    },
    disabled: { control: { type: 'boolean' } },
    systemImage: {
      control: { type: 'text' },
      description:
        'iOS only: a leading SF Symbol name, e.g. `map`. Android ignores it.',
    },
    onSelectedChange: {
      action: 'selected changed',
      description: 'Filter chips: fired with the new selection after a tap.',
    },
    onPress: {
      action: 'pressed',
      description: 'Assist chips: fired once per tap.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Chip>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel.
 *
 * `selected` stays authoritative: taps move the local echo of it and report to
 * the Actions panel, and moving the `selected` row moves the chip.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ onSelectedChange, selected, ...props }) {
    const [current, setCurrent] = useState<boolean>(selected ?? false);

    useEffect(() => {
      setCurrent(selected ?? false);
    }, [selected]);

    const handleChange = useCallback(
      (next: boolean) => {
        setCurrent(next);
        onSelectedChange?.(next);
      },
      [onSelectedChange]
    );

    return (
      <Chip
        {...props}
        onSelectedChange={handleChange}
        selected={current}
        testID="storybook-chip-playground"
      />
    );
  },
};

const DIETS = ['Vegan', 'Vegetarian', 'Gluten-free', 'Nut-free'] as const;

/**
 * Both kinds and both states in one panel - the README screenshot. Filter chips
 * on top (one selected), assist chips below (two with SF Symbols on iOS), and a
 * disabled pair.
 */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="Filter">
        <View style={styles.wrap}>
          {DIETS.map((diet, index) => (
            <Chip key={diet} label={diet} defaultSelected={index < 2} />
          ))}
        </View>
      </Column>
      <Column label="Assist">
        <View style={styles.wrap}>
          <Chip
            variant="assist"
            label="Add to calendar"
            systemImage="calendar.badge.plus"
          />
          <Chip variant="assist" label="Directions" systemImage="map" />
          <Chip variant="assist" label="Share" />
        </View>
      </Column>
      <Column label="Disabled">
        <View style={styles.wrap}>
          <Chip label="Off" disabled />
          <Chip label="On" disabled defaultSelected />
          <Chip variant="assist" label="Assist" disabled />
        </View>
      </Column>
    </Showcase>
  ),
};

/** The controlled contract: the text is the prop, the chip follows it. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const ink = useShowcaseInk();
    const [selected, setSelected] = useState(false);
    const [refused, setRefused] = useState(0);
    return (
      <Showcase>
        <Column label="controlled">
          <View style={styles.pair}>
            <Chip
              label="Sort by distance"
              selected={selected}
              onSelectedChange={setSelected}
              testID="storybook-chip-controlled"
            />
            <Text style={[styles.echo, { color: ink.ink }]}>
              selected: {String(selected)}
            </Text>
          </View>
        </Column>
        <Column label="refusing (selected stays false)">
          <View style={styles.pair}>
            <Chip
              label="Never on"
              selected={false}
              onSelectedChange={() => setRefused((count) => count + 1)}
            />
            <Text style={[styles.echo, { color: ink.ink }]}>
              refused: {refused}
            </Text>
          </View>
        </Column>
        <Note>
          `selected` is React state, so the label can only read what was
          committed. The refusing chip snaps back after every tap: the
          event-count handshake returns the control to the prop when JS rejects
          a change.
        </Note>
      </Showcase>
    );
  },
};

/**
 * Sizing: a chip is its label's size. On Android a selected filter chip is
 * wider by its check mark; on iOS selection only changes the fill. A caller's
 * width truncates the label.
 */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Column label="intrinsic: unselected, then selected">
        <View style={styles.wrap}>
          <Chip label="Sized" />
          <Chip label="Sized" defaultSelected />
        </View>
      </Column>
      <Column label="width: 160 (truncates)">
        <Chip
          label="Only show places that are open late on weekends"
          style={styles.capped}
        />
      </Column>
      <Note>
        The measured box follows the label: no constant decides it. A user
        `style` width wins, and the label truncates inside it.
      </Note>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  pair: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  echo: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  capped: {
    width: 160,
  },
});
