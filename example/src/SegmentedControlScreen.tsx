import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SegmentedControl } from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance — same helper `ButtonScreen` uses.
 * `Text` gets no dynamic default colour from React Native, and the screen has to
 * read in both light and dark mode for the screenshots in `docs/components/`.
 */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
  };
}

/** Android draws every app edge to edge and RN's `SafeAreaView` is iOS-only. */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/**
 * The option list that rotates on a timer: three different widths, so the
 * control's measured width has to follow the labels (`nuiSizingKey`).
 *
 * Every set here fits the screen on purpose. A row that has to be squeezed into a
 * narrower box still fits it now, but Material 3 shares the row's width equally, so
 * its labels collapse to ellipses (`docs/components/segmented-control.md`, Limits) -
 * worth demoing once, on the "Long labels" row below, under a width the caller asked
 * for, and not as the ordinary state of this screen.
 */
const OPTION_SETS: readonly string[][] = [
  ['One', 'Two', 'Three'],
  ['January', 'February'],
  ['Yes', 'No', 'Ok', 'Later'],
];

/**
 * The real-input controls' options.
 *
 * Three single digits on purpose: digit advances are tabular in both SF Pro and
 * Roboto, and the segments share the row's width, so these three segments are
 * the same width and `scripts/real-input` can aim a tap at the middle of the
 * second one as a fraction of the control. Labels of different lengths would put
 * that fraction wherever the font happened to decide.
 */
const REAL_INPUT_OPTIONS = ['1', '2', '3'];

/**
 * Every SegmentedControl configuration G4 has to prove, on one screen: a real
 * tap pair, controlled and uncontrolled selection, a rejecting parent, options
 * changing on a timer, disabled, tinted, a long label, and 200 controls in a
 * scrolling list.
 *
 * This is also the screen the screenshots in
 * `docs/components/segmented-control.md` come from. The on-device assertions
 * live in `example/__tests__/SegmentedControl.harness.tsx`, which renders its
 * own trees.
 */
export default function SegmentedControlScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // The pair `scripts/real-input` reads. Both are at the top of the page because
  // `uiautomator dump` lists no off-screen nodes, so a control near the bottom
  // would have nothing to aim a tap at.
  const [realIndex, setRealIndex] = useState('-');
  const [realEvents, setRealEvents] = useState(0);
  const [rejectEvents, setRejectEvents] = useState(0);
  // Pinned: the parent never moves it, so a tap on the rejecting control has to
  // snap back natively. `rejectEvents` is what proves the second tap was seen as
  // a change at all, which only happens once native has reverted.
  const [rejectIndex] = useState(0);

  const [controlled, setControlled] = useState(1);
  const [changes, setChanges] = useState(0);
  const [optionsTick, setOptionsTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setOptionsTick((current) => (current + 1) % OPTION_SETS.length);
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const countRealChange = useCallback((event: { index: number }) => {
    setRealEvents((current) => current + 1);
    setRealIndex(String(event.index));
  }, []);

  const countRejectChange = useCallback(() => {
    setRejectEvents((current) => current + 1);
  }, []);

  const acceptChange = useCallback((event: { index: number }) => {
    setChanges((current) => current + 1);
    setControlled(event.index);
  }, []);

  const options = OPTION_SETS[optionsTick] ?? OPTION_SETS[0]!;

  // 200 controls, cycling option lists, so a recycled row is a different
  // configuration than its neighbour (the case `RecyclableView` exists for).
  const list = useMemo(
    () =>
      Array.from({ length: 200 }, (_, index) => ({
        id: `row-${index}`,
        options: OPTION_SETS[index % OPTION_SETS.length]!,
        selectedIndex: index % 3,
        disabled: index % 17 === 0,
      })),
    []
  );

  return (
    <SafeAreaView
      style={[
        styles.root,
        { backgroundColor: ink.background, paddingTop: topInset },
      ]}
    >
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={[styles.title, { color: ink.ink }]}>
          react-native-nitro-ui · SegmentedControl
        </Text>
        <Text style={styles.note}>
          SwiftUI Picker (.pickerStyle(.segmented)) on iOS, Material 3
          SingleChoiceSegmentedButtonRow on Android.
        </Text>

        {/*
          The real-input suite's pair (`scripts/real-input`): one control whose
          parent accepts the change and one whose parent refuses it. Both echo
          through React's own render, so a number only moves if the touch reached
          the hosted control and the new index came back to JS. The refusing one's
          counter is the snap-back proof: a tap on the segment that is already
          selected reports no change on either platform, so the counter can only
          reach 2 if native put the selection back where the parent kept it.
        */}
        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <SegmentedControl
          options={REAL_INPUT_OPTIONS}
          onChange={countRealChange}
          accessibilityLabel="Real-input segmented control"
          testID="real-input-segmented"
        />
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            last index reported (uncontrolled)
          </Text>
          <Text
            testID="real-input-segmented-index"
            style={[styles.value, { color: ink.ink }]}
          >
            {realIndex}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            changes reported (uncontrolled)
          </Text>
          <Text
            testID="real-input-segmented-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {realEvents}
          </Text>
        </View>
        <SegmentedControl
          options={REAL_INPUT_OPTIONS}
          selectedIndex={rejectIndex}
          onChange={countRejectChange}
          accessibilityLabel="Real-input rejecting segmented control"
          testID="real-input-segmented-reject"
        />
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            changes reported (refused by the parent)
          </Text>
          <Text
            testID="real-input-reject-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {rejectEvents}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            selectedIndex the parent keeps sending
          </Text>
          <Text
            testID="real-input-reject-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {rejectIndex}
          </Text>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Controlled</Text>
        <SegmentedControl
          options={['Off', 'On', 'Auto']}
          selectedIndex={controlled}
          onChange={acceptChange}
          testID="controlled-basic"
        />
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            changes accepted
          </Text>
          <Text
            testID="change-count"
            style={[styles.value, { color: ink.ink }]}
          >
            {changes}
          </Text>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Uncontrolled</Text>
        <SegmentedControl
          options={['Small', 'Medium', 'Large']}
          defaultSelectedIndex={2}
          testID="uncontrolled-default"
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          Options change on a timer (the width follows the labels)
        </Text>
        <SegmentedControl options={options} testID="ticker-options" />

        <Text style={[styles.section, { color: ink.ink }]}>Disabled</Text>
        <SegmentedControl
          options={['Locked', 'Unlocked']}
          selectedIndex={1}
          disabled
          testID="disabled-pair"
        />

        <Text style={[styles.section, { color: ink.ink }]}>Tinted</Text>
        <SegmentedControl
          options={['Tinted', 'segments', 'here']}
          tintColor="#FF5733"
          testID="tinted-trio"
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          Long labels under a caller&apos;s width (both platforms truncate them)
        </Text>
        <SegmentedControl
          options={[
            'A very long segment label',
            'Another extremely long segment label',
          ]}
          testID="long-labels"
          style={styles.capped}
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          200 in a scrolling list
        </Text>
        <View style={styles.list}>
          {list.map((row) => (
            <SegmentedControl
              key={row.id}
              options={row.options}
              selectedIndex={row.selectedIndex}
              disabled={row.disabled}
              testID={row.id}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  page: {
    padding: 16,
    gap: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  note: {
    color: '#888',
    marginBottom: 8,
  },
  section: {
    marginTop: 14,
    marginBottom: 2,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 34,
    gap: 12,
  },
  label: {
    flex: 1,
    color: '#666',
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  // A caller's width wins over the measured size; the labels truncate instead of
  // painting outside the box (docs/components/segmented-control.md).
  capped: {
    width: 260,
  },
  list: {
    alignItems: 'flex-start',
    gap: 2,
  },
});
