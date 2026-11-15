import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SegmentedControl } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { ArgTypes, Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

/**
 * The comma-separated `array` control belongs to the on-device controls addon;
 * Storybook core's `ControlType` union does not list it.
 */
type ListControl = NonNullable<
  ArgTypes<{ options: string[] }>['options']['control']
>;

const listControl = { type: 'array' } as unknown as ListControl;

const meta = {
  component: SegmentedControl,
  args: {
    options: ['Day', 'Week', 'Month'],
    selectedIndex: 1,
    defaultSelectedIndex: 0,
    disabled: false,
    tintColor: undefined,
    onChange: fn(),
  },
  argTypes: {
    options: {
      control: listControl,
      description:
        'The segment labels, typed as a comma-separated list. The control is as wide as these labels, so this is the prop that decides its size. Two segments may share a label: the value of the control is always the *index*.',
    },
    selectedIndex: {
      control: { type: 'number' },
      description:
        'Selected index. Set it to control the control; unset it and native owns the selection (see `Uncontrolled`). Out-of-range is clamped into `options`.',
    },
    defaultSelectedIndex: {
      control: { type: 'number' },
      description:
        'Seed for an uncontrolled control (default `0`). Ignored while `selectedIndex` is set, so this row does nothing in a controlled Playground.',
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'color' },
      description:
        'Container and border of the selected segment on **Android**. iOS ignores it: a SwiftUI segmented `Picker` does not answer `.tint()`.',
    },
    onChange: {
      action: 'changed',
      description:
        'One call per user selection, with the new `index` and its `value` (the label). Not called for a selection React made itself, and not called while disabled.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof SegmentedControl>;

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
        <SegmentedControl
          {...props}
          accessibilityLabel="Playground segmented control"
          onChange={handleChange}
          options={options}
          selectedIndex={current}
          testID="storybook-segmented-control-playground"
        />
        <Text style={styles.readout}>
          index: {current} - value: {options[current] ?? '(none)'}
        </Text>
      </View>
    );
  },
};

export const Uncontrolled: Story = {
  render: ({ options }) => (
    <Showcase>
      <Row label="defaultSelectedIndex unset (starts at 0)">
        <SegmentedControl options={options} />
      </Row>
      <Row label="defaultSelectedIndex 2">
        <SegmentedControl defaultSelectedIndex={2} options={options} />
      </Row>
      <Note>
        These have no `selectedIndex` prop, so they keep their own selection and
        no React render happens when you tap them. `onChange` is unset here too
        - the events are still emitted, they just have nowhere to go.
      </Note>
    </Showcase>
  ),
};

export const Controlled: Story = {
  render: function ControlledStory({ options }) {
    const [index, setIndex] = useState(0);
    const handleChange = useCallback(
      (event: { index: number; value: string }) => setIndex(event.index),
      []
    );
    return (
      <Showcase>
        <Row label="controlled">
          <SegmentedControl
            onChange={handleChange}
            options={options}
            selectedIndex={index}
            testID="storybook-segmented-control-controlled"
          />
        </Row>
        <Text style={styles.readout}>
          index: {index} - value: {options[index] ?? '(none)'}
        </Text>
        <Note>
          `selectedIndex` is React state, so the label can only ever read what
          was committed - the event-count handshake is what returns the control
          to the prop when JS rejects a change.
        </Note>
      </Showcase>
    );
  },
};

export const OptionSets: Story = {
  render: () => (
    <Showcase>
      <Column label="two short segments">
        <SegmentedControl options={['On', 'Off']} />
      </Column>
      <Column label="five segments">
        <SegmentedControl options={['Hour', 'Day', 'Week', 'Month', 'Year']} />
      </Column>
      <Column label="long labels">
        <SegmentedControl
          options={['Last 24 hours', 'Last 7 days', 'Last 30 days']}
        />
      </Column>
      <Column label="one segment">
        <SegmentedControl options={['Only']} />
      </Column>
      <Column label="duplicate labels (the value is the index)">
        <SegmentedControl options={['Same', 'Same', 'Same']} />
      </Column>
      <Note>
        The width is the labels: this is the only prop that changes the
        control&apos;s size, so a new option set is a new sizing configuration.
      </Note>
    </Showcase>
  ),
};

export const States: Story = {
  render: ({ options }) => (
    <Showcase>
      <Column label="uncontrolled, enabled">
        <Row label="defaultSelectedIndex unset">
          <SegmentedControl options={options} />
        </Row>
        <Row label="defaultSelectedIndex 1">
          <SegmentedControl defaultSelectedIndex={1} options={options} />
        </Row>
      </Column>
      <Column label="uncontrolled, disabled (emits nothing)">
        <Row label="defaultSelectedIndex 1">
          <SegmentedControl
            defaultSelectedIndex={1}
            disabled
            options={options}
          />
        </Row>
      </Column>
      <Column label="tinted (Android container + border; iOS ignores it)">
        <Row label="#ff375f">
          <SegmentedControl
            defaultSelectedIndex={2}
            options={options}
            tintColor="#ff375f"
          />
        </Row>
        <Row label="#30d158">
          <SegmentedControl
            defaultSelectedIndex={2}
            options={options}
            tintColor="#30d158"
          />
        </Row>
      </Column>
    </Showcase>
  ),
};

export const Sizing: Story = {
  render: ({ options }) => (
    <Showcase>
      <Row label="intrinsic">
        <SegmentedControl options={options} />
        <Text style={styles.baseline}>measured box, baseline-aligned</Text>
      </Row>
      <Frame label="inside a 240-wide parent (dashed)" width={240}>
        <SegmentedControl options={options} />
      </Frame>
      <Frame label="inside a 240-wide parent, alignSelf: stretch" width={240}>
        <SegmentedControl options={options} style={styles.stretch} />
      </Frame>
      <Note>
        The third row is wider than its siblings: measured sizes leave Yoga
        nothing to stretch, so a parent&apos;s `alignItems` does not widen an
        intrinsic control.
      </Note>
    </Showcase>
  ),
};

function AppearancePanel({ options }: { options: string[] }) {
  const scheme = useColorScheme();
  return (
    <Showcase>
      <Column
        label={`palette as drawn on the ${scheme == null ? 'light' : scheme} appearance`}
      >
        <SegmentedControl options={options} />
        <SegmentedControl defaultSelectedIndex={2} options={options} />
        <SegmentedControl
          accessibilityLabel="Disabled group"
          disabled
          options={options}
        />
      </Column>
      <Note>
        Order: unselected, third selected, the group disabled. These are drawn
        by the toolkit in the appearance the device is in. This is one
        appearance, not two surfaces: React Native cannot override the
        appearance for a subtree, so a black card behind a light-scheme row is a
        black card, not dark mode - the unselected segments and their hairlines
        disappear into it. Switch the device to Dark Mode to see this story dark
        - `xcrun simctl ui &lt;udid&gt; appearance dark` on iOS, `adb -s
        &lt;serial&gt; shell cmd uimode night yes` on Android.
      </Note>
    </Showcase>
  );
}

/**
 * React Native has no per-subtree appearance override, so this story shows only the
 * appearance the device is set to.
 */
export const Appearances: Story = {
  render: ({ options }) => <AppearancePanel options={options} />,
};

const styles = StyleSheet.create({
  baseline: {
    fontSize: 13,
    opacity: 0.7,
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
  stretch: {
    alignSelf: 'stretch',
  },
});
