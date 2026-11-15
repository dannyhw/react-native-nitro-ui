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

type DateArg = Date | string | null | undefined;

/** The controls addon's `date` control hands back a `YYYY-MM-DD` string. */
function toDate(value: DateArg): Date | undefined {
  if (value == null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

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
 * Core's `ControlType` union is narrower than the on-device addon's, so the two
 * entries that use options are typed through the real `argTypes` shape.
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
        '`compact` is a field that opens the platform presentation (iOS popover, Android dialog), `inline` is the picker laid out in the app, `wheel` is SwiftUI\'s wheel on iOS; on Android it is Material 3 1.5\'s time drums for `mode="time"` and the inline calendar for `mode="date"`/`"datetime"`, which has no wheel to draw.',
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
        `wheel` is SwiftUI&apos;s `.wheel` style. There is no Material wheel
        calendar, so this `datetime` frame draws the same calendar `inline` does
        on Android; `mode="time"` is the exception, where the wheel is a drum
        per field (`ScrollField`) - see the matrix in
        `docs/components/date-picker.md`.
      </Note>
    </Showcase>
  ),
};

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

/** RN has no per-subtree appearance override, so a black card is not dark mode. */
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
        uimode night yes` on Android. Among the component docs only
        docs/components/button.md carries a captured light/dark pair; this
        control's doc does not.
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
