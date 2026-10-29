/**
 * Progress stories (S1). Props and events: `docs/components/progress.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 *
 * Progress is the library's only non-interactive component, so it has no events
 * and the Actions panel stays empty - the readouts below are what a caller can
 * observe instead.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Progress } from 'react-native-nitro-ui';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

const meta = {
  component: Progress,
  args: {
    variant: 'linear',
    value: 0.4,
    tintColor: undefined,
    trackColor: undefined,
  },
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['linear', 'circular'],
      description:
        "Which indicator to draw. It is also the control's size configuration, so switching it remounts the native view and costs the usual one-frame measurement correction.",
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

/**
 * Every public prop on the Controls panel.
 *
 * There is nothing to tap, so the readout is the story: it prints what React
 * last sent, which for a Progress is also what native shows - React always owns
 * `value`.
 */
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
        value: {value === null || value === undefined ? 'indeterminate' : value}
      </Text>
    </View>
  ),
};

/** The whole shape grid: both variants x determinate, indeterminate, tinted. */
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

/**
 * The 60 Hz case from `docs/components/progress.md`: a sawtooth fraction written
 * on every frame, which is the shape of a download callback.
 *
 * The commit count beside it is the proof of cost - one `number` prop and one
 * commit per frame, with no round trip to wait for, because nothing on a
 * Progress can be changed by the user.
 */
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

/**
 * Sizing (README "Sizing"): the two variants use the two different policies.
 * `linear` is `fillWidth`, so its width is the box; `circular` is `intrinsic`
 * and adds `alignSelf: 'flex-start'` so a stretching parent cannot turn the ring
 * into an ellipse.
 */
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
      <Note>
        A bar is 4 pt tall on iOS (4.19 dp on Android) and a ring measures its
        own square (20 pt on iOS, 40 dp on Android). The last row asks the ring
        to stretch and it stays a circle - the wrapper answers that for you.
      </Note>
    </Showcase>
  ),
};

/**
 * The bars as the current appearance draws them, plus the note about why a story
 * cannot show two appearances at once. A component (not an inline `render`)
 * because it reads the appearance with a hook.
 */
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
 * The progress palette comes from the OS appearance, and this story shows the
 * one the device is set to.
 *
 * It used to draw the same row twice, the second time on a black card labelled
 * "on a dark surface". That was not dark mode: only the card's background
 * changed, so the light-palette tracks were near-invisible against the black.
 * React Native 0.88 has no per-subtree appearance override (no
 * `overrideAppearance` prop; `Appearance.setColorScheme()` is app-wide), so a
 * story cannot honestly paint a dark panel. Change the device appearance
 * instead - `xcrun simctl ui <udid> appearance dark` on iOS, `adb -s <serial>
 * shell cmd uimode night yes` on Android - and this screen follows. Among the
 * component docs only `docs/components/button.md` carries a captured light/dark
 * pair; this control's doc does not.
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
