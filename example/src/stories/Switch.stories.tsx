/**
 * Switch stories (S1). Props and events: `docs/components/switch.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`, `nuiTestWidth`) are hidden: they
 * are harness/benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Switch } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Row, Showcase } from './showcase';

const meta = {
  component: Switch,
  args: {
    value: true,
    defaultValue: false,
    disabled: false,
    tintColor: undefined,
    onValueChange: fn(),
  },
  argTypes: {
    value: {
      control: { type: 'boolean' },
      description:
        'Selected state. Set it to control the Switch; unset it and native owns the value.',
    },
    defaultValue: {
      control: { type: 'boolean' },
      description:
        'Initial value of an uncontrolled Switch. Ignored while `value` is set, so this row does nothing in a controlled Playground.',
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'color' },
      description:
        'Accent of the on state: SwiftUI `.tint()` on iOS, the checked track colour on Android. Unset uses the platform accent.',
    },
    onValueChange: {
      action: 'value changed',
      description: 'Fired with the new value after every user interaction.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
    nuiTestWidth: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel.
 *
 * `value` stays authoritative: taps move the local echo of it (so the control
 * feels alive) and report to the Actions panel, and moving the `value` row moves
 * the control.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ onValueChange, value, ...props }) {
    const [current, setCurrent] = useState<boolean>(value ?? false);

    useEffect(() => {
      setCurrent(value ?? false);
    }, [value]);

    const handleChange = useCallback(
      (next: boolean) => {
        setCurrent(next);
        onValueChange?.(next);
      },
      [onValueChange]
    );

    return (
      <Switch
        {...props}
        accessibilityLabel="Playground switch"
        onValueChange={handleChange}
        testID="storybook-switch-playground"
        value={current}
      />
    );
  },
};

/**
 * No `value` anywhere: native owns each Switch, so a tap costs no React render
 * and `defaultValue` is what decides the starting position.
 */
export const Uncontrolled: Story = {
  render: () => (
    <Showcase>
      <Row label="defaultValue unset (off)">
        <Switch />
      </Row>
      <Row label="defaultValue true (on)">
        <Switch defaultValue />
      </Row>
      <Note>
        These have no `value` prop, so they keep their own state and no React
        render happens when you tap them.
      </Note>
    </Showcase>
  ),
};

/** The controlled contract: the Text is the prop, the Switch follows it. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [value, setValue] = useState(false);
    return (
      <Showcase>
        <Row label="controlled">
          <View style={styles.pair}>
            <Switch
              onValueChange={setValue}
              testID="storybook-switch-controlled"
              value={value}
            />
            <Text style={styles.echo}>value: {String(value)}</Text>
          </View>
        </Row>
        <Note>
          `value` is React state, so the label can only ever read what was
          committed - the event-count handshake is what returns the control to
          the prop when JS rejects a change.
        </Note>
      </Showcase>
    );
  },
};

/** The whole state grid at once: on/off x enabled/disabled, plus a tint. */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="Uncontrolled, enabled">
        <Row label="off">
          <Switch defaultValue={false} />
        </Row>
        <Row label="on">
          <Switch defaultValue />
        </Row>
      </Column>
      <Column label="Uncontrolled, disabled">
        <Row label="off">
          <Switch defaultValue={false} disabled />
        </Row>
        <Row label="on">
          <Switch defaultValue disabled />
        </Row>
      </Column>
      <Column label="Tinted (iOS `.tint()`, Android checked track)">
        <Row label="on, red">
          <Switch defaultValue tintColor="#ff375f" />
        </Row>
        <Row label="on, green">
          <Switch defaultValue tintColor="#30d158" />
        </Row>
      </Column>
    </Showcase>
  ),
};

/**
 * Sizing (README "Sizing"): a Switch measures itself. `alignSelf: stretch` is
 * the only way to make it wider than its own measurement, and a parent width
 * alone leaves it at its measured size.
 */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Row label="intrinsic">
        <Switch defaultValue />
        <Text style={styles.baseline}>measured box, baseline-aligned</Text>
      </Row>
      <Column label="inside a 240-wide parent (dashed)">
        <View style={styles.parent}>
          <Switch defaultValue />
        </View>
      </Column>
      <Column label="alignSelf: stretch">
        <View style={styles.parent}>
          <Switch defaultValue style={styles.stretch} />
        </View>
      </Column>
      <Note>
        Measured sizes leave Yoga nothing to stretch, so a parent&apos;s
        alignItems does not widen an intrinsic control - the third row asks for
        the fill on the control itself.
      </Note>
    </Showcase>
  ),
};

/**
 * The switches as the current appearance draws them, plus the note about why a
 * story cannot show two appearances at once. A component (not an inline
 * `render`) because it reads the appearance with a hook.
 */
function AppearancePanel() {
  const scheme = useColorScheme();
  return (
    <Showcase>
      <Column
        label={`palette as drawn on the ${scheme == null ? 'light' : scheme} appearance`}
      >
        <Switch defaultValue />
        <Switch />
        <Switch disabled />
      </Column>
      <Note>
        Order: on, off, disabled off. These are drawn by the toolkit in the
        appearance the device is in. This is one appearance, not two surfaces:
        React Native cannot override the appearance for a subtree, so a black
        card behind a light-scheme switch is a black card, not dark mode - and a
        disabled switch painted light-on-light against it is invisible rather
        than dark. Switch the device to Dark Mode to see this story dark -
        `xcrun simctl ui &lt;udid&gt; appearance dark` on iOS, `adb -s
        &lt;serial&gt; shell cmd uimode night yes` on Android.
      </Note>
    </Showcase>
  );
}

/**
 * The switch palette comes from the OS appearance, and this story shows the one
 * the device is set to.
 *
 * It used to draw the same row twice, the second time on a black card labelled
 * "on a dark surface". That was not dark mode: only the card's background
 * changed, so the light-palette switches - a *disabled* one most of all - were
 * near-invisible against the black. React Native 0.88 has no per-subtree
 * appearance override (no `overrideAppearance` prop;
 * `Appearance.setColorScheme()` is app-wide), so a story cannot honestly paint
 * a dark panel. Change the device appearance instead - `xcrun simctl ui <udid>
 * appearance dark` on iOS, `adb -s <serial> shell cmd uimode night yes` on
 * Android - and this screen follows. Among the component docs only
 * `docs/components/button.md` carries a captured light/dark pair; this control's
 * doc does not.
 */
export const Appearances: Story = {
  render: () => <AppearancePanel />,
};

const styles = StyleSheet.create({
  baseline: {
    fontSize: 13,
    opacity: 0.7,
  },
  echo: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  pair: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  parent: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#8e8e93',
    padding: 10,
    width: 240,
  },
  stretch: {
    alignSelf: 'stretch',
  },
});
