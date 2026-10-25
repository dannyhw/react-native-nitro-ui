/**
 * Picker stories (S1). Props and events: `docs/components/picker.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Picker } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { ArgTypes, Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

/**
 * The comma-separated `array` control belongs to
 * `@storybook/addon-ondevice-controls` - its own `ControlTypes` union lists it,
 * core's `ControlType` union does not - so the one entry that needs it is widened
 * through the real `argTypes` shape rather than written loosely.
 */
type ListControl = NonNullable<
  ArgTypes<{ options: string[] }>['options']['control']
>;

const listControl = { type: 'array' } as unknown as ListControl;

const SIZES = ['Small', 'Medium', 'Large'];

const meta = {
  component: Picker,
  args: {
    options: SIZES,
    selectedIndex: 1,
    defaultSelectedIndex: 0,
    variant: 'menu',
    label: 'Size',
    disabled: false,
    tintColor: undefined,
    onChange: fn(),
  },
  argTypes: {
    options: {
      control: listControl,
      description:
        'The choices, typed as a comma-separated list. A menu picker is as wide as the title it shows, so these decide its size. Two choices may share a label: the value of the control is always the *index*.',
    },
    selectedIndex: {
      control: { type: 'number' },
      description:
        'Selected index. Set it to control the picker; unset it and native owns the selection (see `Uncontrolled`). Out-of-range is clamped into `options`.',
    },
    defaultSelectedIndex: {
      control: { type: 'number' },
      description:
        'Seed for an uncontrolled picker (default `0`). Ignored while `selectedIndex` is set, so this row does nothing in a controlled Playground.',
    },
    variant: {
      control: { type: 'inline-radio' },
      options: ['menu', 'wheel'],
      description:
        "`menu` (default) is the platform menu. `wheel` is a SwiftUI wheel on iOS; Android has no wheel, so it renders the same menu taking its caller's width - see the `Variants` story.",
    },
    label: {
      control: { type: 'text' },
      description:
        "The picker's label. Android draws it as the field's floating label; iOS uses it for the menu and for accessibility and draws no separate text next to the button.",
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'color' },
      description:
        "The control's accent: the menu title and chevron on iOS, the field's focused border and label on Android.",
    },
    onChange: {
      action: 'changed',
      description:
        'One call per user choice, with the new `index` and its `value` (the label). Not called for a choice React made itself, for opening or closing the menu, or while disabled.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Picker>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel.
 *
 * `selectedIndex` stays authoritative: choosing moves the local echo (so the
 * control feels alive) and reports to Actions, and moving the row moves the
 * selection.
 */
export const Playground: Story = {
  render: function PlaygroundStory({
    onChange,
    options,
    selectedIndex,
    ...props
  }) {
    const [current, setCurrent] = useState<number>(selectedIndex ?? 0);

    useEffect(() => {
      setCurrent(selectedIndex ?? 0);
    }, [selectedIndex]);

    const handleChange = useCallback(
      (event: { index: number; value: string }) => {
        setCurrent(event.index);
        onChange?.(event);
      },
      [onChange]
    );

    return (
      <View style={styles.playground}>
        <Picker
          {...props}
          accessibilityLabel="Playground picker"
          onChange={handleChange}
          options={options}
          selectedIndex={current}
          testID="storybook-picker-playground"
        />
        <Text style={styles.readout}>
          index: {current} - value: {options[current] ?? '(none)'}
        </Text>
      </View>
    );
  },
};

/**
 * The two variants, and what each one is on each platform.
 *
 * Worth reading on a device: iOS gets two different controls, Android gets the
 * same control twice under two different layout policies. That is the honest
 * mapping (Material 3 has no wheel), not a gap the library could close without
 * drawing its own wheel.
 */
export const Variants: Story = {
  render: function VariantsStory() {
    const [menu, setMenu] = useState(1);
    const [wheel, setWheel] = useState(1);
    return (
      <Showcase>
        <Row label='variant="menu"'>
          <Picker
            options={SIZES}
            selectedIndex={menu}
            onChange={(event) => setMenu(event.index)}
            label="Size"
            testID="storybook-variants-menu"
          />
        </Row>
        <Row label='variant="wheel"'>
          <Picker
            options={SIZES}
            selectedIndex={wheel}
            onChange={(event) => setWheel(event.index)}
            variant="wheel"
            label="Size"
            testID="storybook-variants-wheel"
          />
        </Row>
        <Note>
          iOS: `.pickerStyle(.menu)` and `.wheel`. Android: Material 3
          `ExposedDropdownMenuBox` for both - the wheel variant takes its
          caller&apos;s width instead of its own.
        </Note>
      </Showcase>
    );
  },
};

/**
 * Controlled selection, with the parent moving the index from outside.
 *
 * A picker whose `selectedIndex` the parent owns still paints a choice the moment
 * it is made and reverts it if the parent does not follow (`core.md` §4) - which
 * is what the `Refused choice` story below is for.
 */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [index, setIndex] = useState(0);
    const [events, setEvents] = useState(0);
    return (
      <Showcase>
        <Row label="Controlled">
          <Picker
            options={SIZES}
            selectedIndex={index}
            onChange={(event) => {
              setIndex(event.index);
              setEvents((current) => current + 1);
            }}
            label="Size"
            testID="storybook-controlled"
          />
        </Row>
        <Row label="Parent writes">
          <View style={styles.buttonRow}>
            {SIZES.map((size, option) => (
              <Pressable
                key={size}
                onPress={() => setIndex(option)}
                style={styles.chip}
                testID={`storybook-controlled-to-${String(option)}`}
              >
                <Text style={styles.chipLabel}>{size}</Text>
              </Pressable>
            ))}
          </View>
        </Row>
        <Note>
          index {index} - changes reported to JS: {events}. Writing from the
          buttons is not a user choice, so it reports nothing.
        </Note>
      </Showcase>
    );
  },
};

/**
 * Uncontrolled: native owns the selection, so a choice costs no React render.
 *
 * `defaultSelectedIndex` seeds it once and is then ignored; the parent is not
 * told the value unless it passes `onChange`, and it cannot read it back from
 * props because it never had it.
 */
export const Uncontrolled: Story = {
  render: function UncontrolledStory() {
    return (
      <Showcase>
        <Row label="Seeded at 2">
          <Picker
            options={SIZES}
            defaultSelectedIndex={2}
            label="Size"
            testID="storybook-uncontrolled"
          />
        </Row>
        <Row label="Seeded at 0">
          <Picker
            options={SIZES}
            label="Size"
            testID="storybook-uncontrolled-zero"
          />
        </Row>
        <Note>Neither row passes `selectedIndex`, so neither re-renders.</Note>
      </Showcase>
    );
  },
};

/**
 * What an out-of-range index does, and what a shrinking list does.
 *
 * Past the end goes to the last choice, junk goes to the first, and a list that
 * shrinks under a selection clamps the selection instead of clearing it - the same
 * rules as `SegmentedControl`, so the same story.
 */
export const Clamped: Story = {
  render: function ClampedStory() {
    const [index, setIndex] = useState(0);
    return (
      <Showcase>
        <Row label="Index 9 of 3">
          <Picker options={SIZES} selectedIndex={9} label="Size" />
        </Row>
        <Row label="Index -3">
          <Picker options={SIZES} selectedIndex={-3} label="Size" />
        </Row>
        <Row label="Shrink under index 2">
          <Picker
            options={index === 0 ? SIZES : ['Small']}
            selectedIndex={2}
            label="Size"
            testID="storybook-shrink"
          />
          <Pressable
            onPress={() => setIndex((current) => (current === 0 ? 1 : 0))}
            style={styles.chip}
            testID="storybook-shrink-toggle"
          >
            <Text style={styles.chipLabel}>Toggle options</Text>
          </Pressable>
        </Row>
        <Note>
          Every row above shows a real choice, and the value JS gets is always a
          legal index - the clamp runs in JS and again natively.
        </Note>
      </Showcase>
    );
  },
};

/**
 * A parent that refuses the choice.
 *
 * Native paints the choice and then snaps back, because the parent kept sending
 * the same `selectedIndex`. The event still fires - that is how the parent would
 * have accepted it.
 */
export const RefusedChoice: Story = {
  render: function RefusedStory() {
    const [refusals, setRefusals] = useState(0);
    return (
      <Showcase>
        <Row label="Pinned at 0">
          <Picker
            options={SIZES}
            selectedIndex={0}
            onChange={() => setRefusals((current) => current + 1)}
            label="Size"
            testID="storybook-refused"
          />
        </Row>
        <Note>
          Choices the parent refused: {refusals}. The picker still shows Small,
          because the parent never moved - pick anything and watch it come back.
        </Note>
      </Showcase>
    );
  },
};

/** Disabled, side by side with an enabled control of the same shape. */
export const Disabled: Story = {
  render: function DisabledStory() {
    return (
      <Showcase>
        <Row label="disabled">
          <Picker
            options={SIZES}
            selectedIndex={1}
            disabled
            label="Size"
            testID="storybook-disabled"
          />
        </Row>
        <Row label="enabled">
          <Picker
            options={SIZES}
            selectedIndex={1}
            label="Size"
            testID="storybook-enabled"
          />
        </Row>
        <Note>
          A disabled picker opens nothing and reports nothing. Disabling one
          whose menu is already open closes it.
        </Note>
      </Showcase>
    );
  },
};

/** The accent colour, on both variants. */
export const Tinted: Story = {
  render: function TintedStory() {
    return (
      <Showcase>
        <Column label="tintColor">
          <Picker
            options={SIZES}
            selectedIndex={2}
            tintColor="#FF3B30"
            label="Menu"
          />
          <Picker
            options={SIZES}
            selectedIndex={1}
            tintColor="#AF52DE"
            variant="wheel"
            label="Wheel"
          />
        </Column>
        <Note>
          iOS paints the menu title and chevron; Android paints the field&apos;s
          focused border and floating label. Unlike a segmented `Picker`, which
          ignores `.tint()` (G4 F1), these styles answer it.
        </Note>
      </Showcase>
    );
  },
};

/**
 * What the two layout policies do inside boxes the caller chose.
 *
 * A menu picker is `intrinsic`: it is as wide as the title it shows, and a title
 * too long for its box truncates inside it (C1) rather than spilling out. A wheel
 * is `fillWidth`: the box's width is its width and it measures only its height.
 */
export const Sizing: Story = {
  render: function SizingStory() {
    return (
      <Showcase>
        <Frame label="menu in a 180 box" width={180}>
          <Picker
            options={['A choice far too long for this box', 'Short']}
            selectedIndex={0}
            label="Long"
            testID="storybook-sizing-long"
          />
          <Picker options={SIZES} selectedIndex={1} label="Size" />
        </Frame>
        <Frame label="wheel in a 180 box" width={180}>
          <Picker
            options={['January', 'February', 'March']}
            variant="wheel"
            label="Month"
            testID="storybook-sizing-wheel"
          />
        </Frame>
        <Note>
          The long menu title is ellipsised at the box, not clipped and not
          allowed to widen the row. A longer *selection* is a different size
          configuration for this control, so the key it caches by moves with it.
        </Note>
      </Showcase>
    );
  },
};

/**
 * VoiceOver / TalkBack.
 *
 * The control is one element that opens a list; the selected row announces itself
 * as selected; `accessibilityLabel` replaces the visible `label` for a screen
 * reader, which is what both platforms' own controls do.
 */
export const Accessibility: Story = {
  render: function AccessibilityStory() {
    return (
      <Showcase>
        <Row label="Visible label only">
          <Picker options={SIZES} selectedIndex={1} label="Size" />
        </Row>
        <Row label="accessibilityLabel wins">
          <Picker
            options={SIZES}
            selectedIndex={1}
            label="Size"
            accessibilityLabel="Text size"
          />
        </Row>
        <Row label="No label at all">
          <Picker
            options={SIZES}
            selectedIndex={1}
            accessibilityLabel="Text size"
            testID="storybook-a11y-nolabel"
          />
        </Row>
        <Note>
          Turn a screen reader on: the control reads as a button that opens a
          list, and the row you chose is announced as selected.
        </Note>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  playground: {
    gap: 10,
    padding: 16,
  },
  readout: {
    fontSize: 13,
    opacity: 0.7,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipLabel: {
    fontSize: 14,
  },
});
