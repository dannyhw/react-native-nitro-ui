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
      options: ['menu', 'wheel', 'radio'],
      description:
        "`menu` (default) is the platform menu. `wheel` is the platform wheel on both platforms: SwiftUI's `.wheel` on iOS, Material 3 1.5's `ScrollField` drum on Android, where one roll that comes to rest is one event. `radio` shows every option at once on Android; iOS has no radio-group picker style, so it renders the menu - see the `Variants` and `Radio` stories.",
    },
    label: {
      control: { type: 'text' },
      description:
        "The picker's label. Android draws it as the field's floating label; iOS uses it for the menu and for accessibility and draws no separate text next to the button. The `radio` variant never draws it on either platform: it names the group for a screen reader.",
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
 * iOS has SwiftUI's menu and wheel; Android has Material 3's exposed dropdown
 * and, for the wheel, a `ScrollField` drum.
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
          iOS: `.pickerStyle(.menu)` and `.wheel`. Android: Material 3&apos;s
          `ExposedDropdownMenuBox` for the menu and a `ScrollField` drum for the
          wheel - each measures itself, so the wheel is a drum here rather than
          a field that takes its caller&apos;s width.
        </Note>
      </Showcase>
    );
  },
};

/**
 * `variant="radio"`: Android draws Material's radio group. iOS has no
 * radio-group picker style (`RadioGroupPickerStyle` is unavailable there), so
 * this variant renders the menu on iOS.
 */
export const Radio: Story = {
  render: function RadioStory() {
    const [index, setIndex] = useState(1);
    return (
      <Showcase>
        <Row label='variant="radio"'>
          <Picker
            options={SIZES}
            selectedIndex={index}
            onChange={(event) => setIndex(event.index)}
            variant="radio"
            accessibilityLabel="Size"
            testID="storybook-radio"
          />
        </Row>
        <Row label="radio, disabled">
          <Picker
            options={SIZES}
            selectedIndex={1}
            variant="radio"
            disabled
            accessibilityLabel="Size, locked"
            testID="storybook-radio-disabled"
          />
        </Row>
        <Row label="radio, tinted">
          <Picker
            options={SIZES}
            defaultSelectedIndex={2}
            variant="radio"
            tintColor="#AF52DE"
            accessibilityLabel="Size, tinted"
            testID="storybook-radio-tinted"
          />
        </Row>
        <Note>
          index {index}. Android: one 48 dp row per option, the whole row
          pressable, and the group is as tall as its options - a cold group is
          laid out at the component&apos;s declared box (280 x 56 dp) and
          corrected the turn it measures. iOS: the menu. Picking the row already
          chosen reports nothing, and `label` is not drawn: it names the group.
        </Note>
      </Showcase>
    );
  },
};

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
