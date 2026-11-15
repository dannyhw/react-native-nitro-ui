import { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Progress } from 'react-native-nitro-ui';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

const meta = {
  component: Progress,
  args: {
    variant: 'linear',
    appearance: 'flat',
    contained: false,
    value: 0.4,
    tintColor: undefined,
    trackColor: undefined,
  },
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['linear', 'circular', 'loading'],
      description:
        "Which indicator to draw. It is also the control's size configuration, so switching it remounts the native view and costs the usual one-frame measurement correction. `loading` is Material 3 Expressive's morphing indicator on Android and a circular `ProgressView` on iOS.",
    },
    appearance: {
      control: { type: 'select' },
      options: ['flat', 'wavy'],
      description:
        '`wavy` is Material 3\'s wavy bar and ring, with Material\'s own amplitude, wavelength and speed. **Android only**: SwiftUI has no wavy indicator, so iOS paints flat. Says nothing about `variant="loading"`, which has no wavy form.',
    },
    contained: {
      control: { type: 'boolean' },
      description:
        'Draw `variant="loading"` inside Material\'s tonal container (`ContainedLoadingIndicator`). Only `loading` reads it.',
    },
    value: {
      control: { type: 'select', labels: { null: 'indeterminate' } },
      options: [null, 0, 0.25, 0.5, 0.75, 1, 1.5],
      description:
        'The fraction shown, `0…1`. `null` (labelled "indeterminate") is the working animation, and out-of-range values are clamped natively rather than rejected - `1.5` is in the list so you can watch that. `Live` covers the continuous case. A `circular` indicator does not draw it on iOS.',
    },
    tintColor: {
      control: { type: 'color' },
      description:
        'Indicator colour: SwiftUI `.tint()` on iOS, the M3 `color` on Android.',
    },
    trackColor: {
      control: { type: 'color' },
      description:
        'Track colour. **Android only today** - SwiftUI has nothing that addresses a `ProgressView` track, so iOS accepts this and ignores it.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Progress>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: ({ value, ...props }) => (
    <View style={styles.playground}>
      <Progress
        {...props}
        accessibilityLabel="Playground progress"
        testID="storybook-progress-playground"
        value={value}
      />
      <Text style={styles.readout}>
        value: {value === null || value === undefined ? 'indeterminate' : value}{' '}
        - {props.variant ?? 'linear'}
        {props.appearance === 'wavy' ? ' wavy' : ''}
        {props.contained ? ' contained' : ''}
      </Text>
    </View>
  ),
};

export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="linear">
        <Row label="0.4">
          <Progress value={0.4} variant="linear" />
        </Row>
        <Row label="indeterminate">
          <Progress variant="linear" />
        </Row>
      </Column>
      <Column label="circular">
        <Row label="0.4 (Android fills, iOS keeps spinning)">
          <Progress value={0.4} variant="circular" />
        </Row>
        <Row label="indeterminate (the ActivityIndicator look)">
          <Progress variant="circular" />
        </Row>
      </Column>
      <Column label="tinted (indicator + track)">
        <Row label="tint only">
          <Progress tintColor="#ff9f0a" value={0.55} variant="linear" />
        </Row>
        <Row label="tint + track (track is Android-only)">
          <Progress
            tintColor="#ff9f0a"
            trackColor="#48484a"
            value={0.55}
            variant="linear"
          />
        </Row>
      </Column>
      <Column label="loading (Material 3 Expressive; a ring on iOS)">
        <Row label="0.4 (Android morphs, iOS keeps spinning)">
          <Progress value={0.4} variant="loading" />
        </Row>
        <Row label="indeterminate">
          <Progress variant="loading" />
        </Row>
        <Row label="contained (Android only)">
          <Progress variant="loading" contained />
        </Row>
      </Column>
      <Column label='appearance="wavy" (Android; iOS draws flat)'>
        <Row label="linear 0.4">
          <Progress value={0.4} appearance="wavy" />
        </Row>
        <Row label="linear indeterminate">
          <Progress appearance="wavy" />
        </Row>
        <Row label="circular 0.4">
          <Progress value={0.4} variant="circular" appearance="wavy" />
        </Row>
        <Row label="circular indeterminate">
          <Progress variant="circular" appearance="wavy" />
        </Row>
      </Column>
      <Column label="clamped, not rejected">
        <Row label="1.5 draws as full">
          <Progress value={1.5} variant="linear" />
        </Row>
        <Row label="-0.2 draws as empty">
          <Progress value={-0.2} variant="linear" />
        </Row>
        <Row label="NaN (an unfinished division) draws as empty">
          <Progress value={Number.NaN} variant="linear" />
        </Row>
      </Column>
    </Showcase>
  ),
};

export const Live: Story = {
  render: function LiveStory() {
    const [fraction, setFraction] = useState(0);
    const [commits, setCommits] = useState(0);

    useEffect(() => {
      const timer = setInterval(() => {
        setFraction((current) => (current + 0.011 > 1 ? 0 : current + 0.011));
        setCommits((current) => current + 1);
      }, 16);
      return () => clearInterval(timer);
    }, []);

    return (
      <Showcase>
        <Row label="linear, written every frame">
          <Progress testID="storybook-progress-live" value={fraction} />
        </Row>
        <Row label="circular, same prop">
          <Progress style={styles.centre} value={fraction} variant="circular" />
        </Row>
        <Text style={styles.readout}>
          value: {fraction.toFixed(3)} - {commits} commits
        </Text>
        <Note>
          There is no `animated` prop: interpolating between two fractions is
          the toolkit&apos;s decision, and the library does not override it in
          either direction.
        </Note>
      </Showcase>
    );
  },
};

export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Column label="linear default (fills the story width)">
        <Progress value={0.5} variant="linear" />
      </Column>
      <Frame label="linear inside a 160-wide parent" width={160}>
        <Progress value={0.5} variant="linear" />
      </Frame>
      <Frame label="circular inside a 160-wide parent" width={160}>
        <Progress value={0.5} variant="circular" />
      </Frame>
      <Frame label="circular with alignSelf: stretch" width={160}>
        <Progress style={styles.stretch} value={0.5} variant="circular" />
      </Frame>
      <Frame label="loading inside a 160-wide parent" width={160}>
        <Progress value={0.5} variant="loading" />
      </Frame>
      <Frame label="wavy bar (Android 10 dp; iOS 4 pt)" width={160}>
        <Progress value={0.5} appearance="wavy" />
      </Frame>
      <Note>
        Every shape measures its own box: a flat bar is 4 pt tall on iOS (4.19
        dp on Android) and a wavy one is 4 pt on iOS against Material&apos;s 10
        dp on Android; a ring is 20 pt on iOS (40 dp on Android) and a wavy ring
        20 pt against 48 dp; `variant=&quot;loading&quot;` is 20 pt on iOS and
        48 dp on Android. The last two rows of the first group ask the ring to
        stretch and it stays a circle - the wrapper answers that for you. The
        full table, with what each configuration falls back to before it is
        measured, is in `docs/components/progress.md`.
      </Note>
    </Showcase>
  ),
};

function AppearancePanel() {
  const scheme = useColorScheme();
  return (
    <Showcase>
      <Column
        label={`palette as drawn on the ${scheme == null ? 'light' : scheme} appearance`}
      >
        <Progress value={0.65} variant="linear" />
        <Progress variant="linear" />
        <Progress tintColor="#ff375f" value={0.65} variant="circular" />
      </Column>
      <Note>
        These are drawn by the toolkit in the appearance the device is in. This
        is one appearance, not two surfaces: React Native cannot override the
        appearance for a subtree, so a black card behind a light-scheme track is
        a black card, not dark mode - the unfilled track and the indeterminate
        bar all but vanish against it. Switch the device to Dark Mode to see
        this story dark - `xcrun simctl ui &lt;udid&gt; appearance dark` on iOS,
        `adb -s &lt;serial&gt; shell cmd uimode night yes` on Android.
      </Note>
    </Showcase>
  );
}

/**
 * React Native 0.88 has no per-subtree appearance override
 * (`Appearance.setColorScheme()` is app-wide), so this story shows the
 * appearance the device is set to.
 */
export const Appearances: Story = {
  render: () => <AppearancePanel />,
};

const styles = StyleSheet.create({
  centre: {
    alignSelf: 'center',
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
