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
 * `Text` gets no dynamic default colour from React Native, and the screen has to
 * read in both light and dark mode.
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

const OPTION_SETS: readonly string[][] = [
  ['One', 'Two', 'Three'],
  ['January', 'February'],
  ['Yes', 'No', 'Ok', 'Later'],
];

/**
 * Three single digits: digit advances are tabular in both SF Pro and Roboto, and
 * the segments share the row's width, so the three segments are the same width
 * and the real-input suite can aim a tap at a fraction of the control.
 */
const REAL_INPUT_OPTIONS = ['1', '2', '3'];

export default function SegmentedControlScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  const [realIndex, setRealIndex] = useState('-');
  const [realEvents, setRealEvents] = useState(0);
  const [rejectEvents, setRejectEvents] = useState(0);
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
          First on the page: `uiautomator dump` lists no off-screen nodes, so the
          controls the real-input suite taps have to be on screen when the tab opens.
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
  capped: {
    width: 260,
  },
  list: {
    alignItems: 'flex-start',
    gap: 2,
  },
});
