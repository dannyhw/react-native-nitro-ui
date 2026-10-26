/**
 * DatePicker stories (S1's layout, for G5). Props and the per-platform variant
 * matrix: `docs/components/date-picker.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 *
 * The date rows use the controls addon's `date` control, which hands back a
 * `YYYY-MM-DD` string rather than a `Date`, so every date the panel supplies goes
 * through `toDate()` below. `undefined` means "this prop is not set", which for
 * `value` is the difference between a controlled and an uncontrolled picker.
 */
import { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { DatePicker } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { DatePickerMode } from 'react-native-nitro-ui';
import type { ArgTypes, Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase, useShowcaseInk } from './showcase';

/** What the `date` control hands back, plus what `args` may hold. */
type DateArg = Date | string | null | undefined;

/** A `date` control's string, a `Date`, or nothing - as a `Date | undefined`. */
function toDate(value: DateArg): Date | undefined {
  if (value == null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `2026-10-25 14:05`, written by hand: a readout must not change with the region. */
function showDate(date: Date | undefined): string {
  if (date == null) {
    return '(not set)';
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * The `select` control needs its options in `argTypes`, and core's `ControlType`
 * union is narrower than the on-device addon's - so the two entries that use
 * options are widened through the real `argTypes` shape rather than written
 * loosely (the same dance `SegmentedControl.stories.tsx` does for `array`).
 */
type OptionsControl = NonNullable<
  ArgTypes<{ mode: DatePickerMode }>['mode']['control']
>;

const modeControl = {
  type: 'select',
  options: ['date', 'time', 'datetime'],
} as unknown as OptionsControl;

const variantControl = {
  type: 'select',
  options: ['compact', 'inline', 'wheel'],
} as unknown as OptionsControl;

const meta = {
  component: DatePicker,
  args: {
    value: new Date(2026, 9, 25, 14, 5),
    defaultValue: undefined,
    mode: 'date',
    variant: 'compact',
    minimumDate: undefined,
    maximumDate: undefined,
    disabled: false,
    tintColor: undefined,
    onChange: fn(),
  },
  argTypes: {
    value: {
      control: { type: 'date' },
      description:
        'The selected instant. Set it to control the picker; clear it and native owns the date (see `Uncontrolled`). A `date` row in this panel has no clock, so the time is midnight local.',
    },
    defaultValue: {
      control: { type: 'date' },
      description:
        'Seed for an uncontrolled picker. Ignored while `value` is set, so this row does nothing in a controlled Playground.',
    },
    mode: {
      control: modeControl,
      description:
        '`date`, `time` or `datetime`. Size-affecting: a time field is narrower than a date field, and a clock is not as tall as a calendar.',
    },
    variant: {
      control: variantControl,
      description:
        "`compact` is a field that opens the platform presentation (iOS popover, Android dialog), `inline` is the picker laid out in the app, `wheel` is SwiftUI's wheel - Android has no wheel, so there it renders the inline picker.",
    },
    minimumDate: {
      control: { type: 'date' },
      description: 'Earliest selectable instant. Unset means no lower bound.',
    },
    maximumDate: {
      control: { type: 'date' },
      description: 'Latest selectable instant. Unset means no upper bound.',
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'color' },
      description:
        "Accent colour: SwiftUI's tint (selection, wheel highlight, field label) and Material 3's primary (headline, selected day, clock, the compact field's outline).",
    },
    onChange: {
      control: false,
      description:
        'Fires once per user selection with the new `Date`. Not for a change React made, not for a selection that lands on the date already showing, and not while `disabled`.',
    },
    style: { control: false },
    testID: { control: false },
    accessibilityLabel: { control: false },
    hybridRef: { control: false },
    nuiPerfId: { control: false },
  },
} satisfies Meta<typeof DatePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every prop, on one picker, with the instant it currently holds. */
export const Playground: Story = {
  render: function PlaygroundStory(props) {
    const [selected, setSelected] = useState(
      toDate(props.value) ?? new Date(2026, 9, 25, 14, 5)
    );
    const [events, setEvents] = useState(0);
    const handleChange = useCallback(
      (date: Date) => {
        setSelected(date);
        setEvents((count) => count + 1);
        props.onChange?.(date);
      },
      [props]
    );

    return (
      <View style={styles.playground}>
        <DatePicker
          {...props}
          accessibilityLabel="Playground date picker"
          defaultValue={toDate(props.defaultValue)}
          maximumDate={toDate(props.maximumDate)}
          minimumDate={toDate(props.minimumDate)}
          onChange={handleChange}
          testID="storybook-date-picker-playground"
          value={toDate(props.value)}
        />
        <Text style={styles.readout}>
          selected: {showDate(selected)} - events: {events}
        </Text>
        <Note>
          `value` is set here, so the picker is controlled: the readout can only
          ever show what React committed. Clear `value` in the panel and native
          keeps the date itself, without a render per tap.
        </Note>
      </View>
    );
  },
};

/** The three modes, as fields and as inline pickers. */
export const Modes: Story = {
  render: ({ tintColor }) => (
    <Showcase>
      <Column label="mode=date">
        <DatePicker mode="date" tintColor={tintColor} />
      </Column>
      <Column label="mode=time">
        <DatePicker mode="time" tintColor={tintColor} />
      </Column>
      <Column label="mode=datetime">
        <DatePicker mode="datetime" tintColor={tintColor} />
      </Column>
      <Note>
        The fields are the `compact` variant: on iOS the popover holds the
        `.compact` picker, on Android the field is a Material 3 button that
        opens the date/time dialog. Each is as wide as the widest date its mode
        can format, which is why the three differ.
      </Note>
    </Showcase>
  ),
};

/** The three variants, in a 320-wide parent so the policies are visible. */
export const Variants: Story = {
  render: ({ tintColor }) => (
    <Showcase>
      <Frame label="compact (intrinsic width)" width={320}>
        <DatePicker variant="compact" tintColor={tintColor} />
      </Frame>
      <Frame label="inline (fills 320, measures its height)" width={320}>
        <DatePicker variant="inline" tintColor={tintColor} />
      </Frame>
      <Frame label="wheel (fills 320)" width={320}>
        <DatePicker mode="datetime" variant="wheel" tintColor={tintColor} />
      </Frame>
      <Note>
        `wheel` is SwiftUI&apos;s `.wheel` style. Jetpack Compose has no wheel
        picker, so on Android both `wheel` and `inline` render Material 3&apos;s
        calendar (a clock for `mode="time"`) - see the matrix in
        `docs/components/date-picker.md`.
      </Note>
    </Showcase>
  ),
};

/** Uncontrolled / controlled / disabled / tinted, at the same time. */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="uncontrolled, enabled">
        <Row label="no defaultValue (starts today)">
          <DatePicker />
        </Row>
        <Row label="defaultValue 2026-07-04">
          <DatePicker defaultValue={new Date(2026, 6, 4)} />
        </Row>
      </Column>
      <Column label="uncontrolled, disabled (emits nothing)">
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          disabled
          mode="datetime"
        />
      </Column>
      <Column label="tinted">
        <Row label="#ff375f">
          <DatePicker defaultValue={new Date(2026, 6, 4)} tintColor="#ff375f" />
        </Row>
        <Row label="#30d158">
          <DatePicker
            defaultValue={new Date(2026, 6, 4)}
            mode="datetime"
            tintColor="#30d158"
            variant="inline"
          />
        </Row>
      </Column>
    </Showcase>
  ),
};

/**
 * A controlled value the story moves from outside the picker, which is the part
 * of the contract a `date` control cannot show: a write React did not come from a
 * tap, and a write the parent refuses.
 */
export const Controlled: Story = {
  render: function ControlledStory() {
    const ink = useShowcaseInk();
    const [value, setValue] = useState(new Date(2026, 0, 1, 9, 0));
    const [events, setEvents] = useState(0);
    const handleChange = useCallback((date: Date) => {
      setValue(date);
      setEvents((count) => count + 1);
    }, []);
    return (
      <Showcase>
        <Row label="controlled">
          <DatePicker
            mode="datetime"
            onChange={handleChange}
            tintColor={undefined}
            value={value}
          />
        </Row>
        <Text style={styles.readout}>
          value: {showDate(value)} - events: {events}
        </Text>
        <Row label="moved from outside">
          <Pressable
            onPress={() => {
              setValue(new Date(2030, 11, 24, 18, 30));
            }}
            style={[styles.button, { borderColor: ink.hairline }]}
            testID="storybook-date-picker-reset"
          >
            <Text style={[styles.buttonText, { color: ink.ink }]}>
              Set 2030-12-24 18:30
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setValue(new Date(2026, 0, 1, 9, 0));
            }}
            style={[styles.button, { borderColor: ink.hairline }]}
            testID="storybook-date-picker-jan1"
          >
            <Text style={[styles.buttonText, { color: ink.ink }]}>
              Back to 2026-01-01
            </Text>
          </Pressable>
        </Row>
        <Note>
          The picker is `value`, so the buttons move it and a pick only sticks
          because this story commits it in `onChange`. A parent that ignored the
          event would snap the field back on its own - the event-count handshake
          is what makes that snap-back happen without a flicker.
        </Note>
      </Showcase>
    );
  },
};

/** Bounds: a range that clamps, and a range too narrow to leave. */
export const Bounds: Story = {
  render: ({ tintColor }) => (
    <Showcase>
      <Row label="2026-01-01 … 2026-12-31">
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          maximumDate={new Date(2026, 11, 31)}
          minimumDate={new Date(2026, 0, 1)}
          tintColor={tintColor}
        />
      </Row>
      <Row label="… 2026-06-30 (starts past the bound)">
        <DatePicker
          defaultValue={new Date(2030, 0, 1)}
          maximumDate={new Date(2026, 5, 30)}
          tintColor={tintColor}
        />
      </Row>
      <Frame label="the same range, inline" width={320}>
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          maximumDate={new Date(2026, 11, 31)}
          minimumDate={new Date(2026, 0, 1)}
          tintColor={tintColor}
          variant="inline"
        />
      </Frame>
      <Note>
        The second field starts on 2026-06-30: a value outside the bounds is
        clamped in JavaScript and again in native, so the picker never shows a
        date it will not accept. In the inline calendar the days outside the
        range are unselectable rather than missing.
      </Note>
    </Showcase>
  ),
};

/** Sizing (README "Sizing"): a field measures itself, a calendar takes the width. */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Row label="compact, intrinsic">
        <DatePicker defaultValue={new Date(2288, 10, 28)} />
        <Text style={styles.baseline}>measured box, baseline-aligned</Text>
      </Row>
      <Frame label="the same date in a 240-wide parent" width={240}>
        <DatePicker defaultValue={new Date(2288, 10, 28)} />
      </Frame>
      <Frame label="mode=time in a 240-wide parent" width={240}>
        <DatePicker defaultValue={new Date(2288, 10, 28)} mode="time" />
      </Frame>
      <Note>
        A field is as wide as the widest date its mode can format, not as wide
        as the date it shows - two pickers with different dates share one box,
        and a `mode` change is a different sizing configuration. A calendar or
        wheel takes the parent width and measures its own height.
      </Note>
    </Showcase>
  ),
};

/**
 * The picker as the current appearance draws it, plus why one story cannot show
 * two appearances (the same note `Button.stories.tsx` carries: RN 0.88 has no
 * per-subtree appearance override, so a black card is not dark mode).
 */
function AppearancePanel() {
  const scheme = useColorScheme();
  return (
    <Showcase>
      <Column
        label={`palette as drawn on the ${scheme == null ? 'light' : scheme} appearance`}
      >
        <DatePicker defaultValue={new Date(2026, 6, 4, 14, 5)} />
        <DatePicker defaultValue={new Date(2026, 6, 4, 14, 5)} mode="time" />
        <DatePicker
          defaultValue={new Date(2026, 6, 4, 14, 5)}
          disabled
          mode="datetime"
        />
        <DatePicker defaultValue={new Date(2026, 6, 4)} variant="inline" />
      </Column>
      <Note>
        These are drawn by the toolkit in the appearance the device is set to.
        Switch the device to Dark Mode to see this story dark - `xcrun simctl ui
        &lt;udid&gt; appearance dark` on iOS, `adb -s &lt;serial&gt; shell cmd
        uimode night yes` on Android - and the real light/dark pair lives in
        docs/components/date-picker.md.
      </Note>
    </Showcase>
  );
}

export const Appearances: Story = {
  render: () => <AppearancePanel />,
};

const styles = StyleSheet.create({
  baseline: {
    fontSize: 13,
    opacity: 0.7,
  },
  button: {
    borderColor: '#888',
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: {
    fontSize: 14,
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
