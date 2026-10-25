import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { DatePicker } from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance — the same helper the other screens
 * use. `Text` gets no dynamic default colour from React Native and the screen has
 * to read in both appearances, because it is where the screenshots in
 * `docs/components/date-picker.md` are taken from.
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
 * A date as `2026-10-25`, written by hand.
 *
 * `toLocaleDateString()` would be shorter and is wrong here: what the real-input
 * suite asserts is a piece of on-screen text, and a locale-dependent string makes
 * that assertion depend on the simulator's region. Y-M-D is the same on every
 * device and is readable in a screenshot.
 */
function dayOf(date: Date | null): string {
  if (date == null) {
    return '-';
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** {@link dayOf} plus `HH:mm`, for the `time` and `datetime` echoes. */
function instantOf(date: Date | null): string {
  if (date == null) {
    return '-';
  }
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${dayOf(date)} ${hours}:${minutes}`;
}

/**
 * Every DatePicker configuration G5 has to prove, on one screen: a real tap pair,
 * each `mode` × `variant`, a range, disabled, tinted, and a controlled value the
 * screen resets from outside the picker.
 *
 * The on-device assertions live in
 * `example/__tests__/DatePicker.harness.tsx`, which renders its own trees; this
 * screen is for screenshots and for `scripts/real-input`, which can only read
 * text the app paints.
 */
export default function DatePickerScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // The pair `scripts/real-input` reads, at the top of the page because
  // `uiautomator dump` lists no off-screen nodes on Android.
  const [realDate, setRealDate] = useState<Date | null>(null);
  const [realEvents, setRealEvents] = useState(0);
  const [rejectEvents, setRejectEvents] = useState(0);
  // Pinned: the parent never moves it, so a date chosen in the dialog has to
  // snap back. The counter is what proves the pick was seen at all - which only
  // happens once native has reverted, because the same value twice reports nothing.
  const [rejectDate] = useState(() => new Date(2024, 5, 15, 9, 0));

  const [controlled, setControlled] = useState(
    () => new Date(2026, 0, 1, 8, 30)
  );
  const [changes, setChanges] = useState(0);

  const countRealChange = useCallback((date: Date) => {
    setRealEvents((current) => current + 1);
    setRealDate(date);
  }, []);

  const countRejectChange = useCallback(() => {
    setRejectEvents((current) => current + 1);
  }, []);

  const acceptChange = useCallback((date: Date) => {
    setChanges((current) => current + 1);
    setControlled(date);
  }, []);

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
          react-native-nitro-ui · DatePicker
        </Text>
        <Text style={styles.note}>
          SwiftUI DatePicker on iOS, Material 3 DatePicker / TimePicker and
          their dialogs on Android. Values are instants; the device&apos;s time
          zone and locale decide how they read.
        </Text>

        {/*
          The real-input suite's pair: one picker whose parent accepts the pick and
          one whose parent refuses it. Both echo through React's own render, so the
          text only moves if a real touch opened the dialog, reached a day cell, and
          the new instant came back to JS. The refusing one's counter is the
          snap-back proof, exactly as on the SegmentedControl screen.
        */}
        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <DatePicker
          onChange={countRealChange}
          accessibilityLabel="Real-input date picker"
          testID="real-input-date"
        />
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            day reported (uncontrolled)
          </Text>
          <Text
            testID="real-input-date-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {dayOf(realDate)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            changes reported (uncontrolled)
          </Text>
          <Text
            testID="real-input-date-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {realEvents}
          </Text>
        </View>
        <DatePicker
          value={rejectDate}
          onChange={countRejectChange}
          accessibilityLabel="Real-input rejecting date picker"
          testID="real-input-date-reject"
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
            day the parent keeps sending
          </Text>
          <Text
            testID="real-input-reject-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {dayOf(rejectDate)}
          </Text>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          Controlled, with a reset from outside the picker
        </Text>
        <DatePicker
          value={controlled}
          onChange={acceptChange}
          variant="inline"
          mode="datetime"
          testID="controlled-datetime"
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
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>value</Text>
          <Text
            testID="controlled-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {instantOf(controlled)}
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => {
              // A new Date object, not the same one: a parent that "resets" to the
              // identical object sends no prop change, and native would be right to
              // ignore it.
              setControlled(new Date(2026, 0, 1, 8, 30));
            }}
            testID="reset-controlled"
            style={[styles.button, dark ? null : styles.buttonLight]}
          >
            <Text style={[styles.buttonLabel, { color: ink.ink }]}>
              Reset to 2026-01-01 08:30
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              // A value the picker must clamp: `maximumDate` is 2027-01-01, and a
              // controlled value past it is not a bug the caller gets to keep.
              setControlled(new Date(2030, 0, 1, 12, 0));
            }}
            testID="clamp-controlled"
            style={[styles.button, dark ? null : styles.buttonLight]}
          >
            <Text style={[styles.buttonLabel, { color: ink.ink }]}>
              Send 2030 (past maximumDate)
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          A range (2026-01-01 … 2027-01-01)
        </Text>
        <DatePicker
          defaultValue={new Date(2026, 3, 1)}
          minimumDate={new Date(2026, 0, 1)}
          maximumDate={new Date(2027, 0, 1)}
          variant="inline"
          testID="ranged-inline"
        />
        <DatePicker
          defaultValue={new Date(2026, 3, 1)}
          minimumDate={new Date(2026, 0, 1)}
          maximumDate={new Date(2027, 0, 1)}
          testID="ranged-compact"
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          Modes, compact (the field opens the platform&apos;s picker)
        </Text>
        <View style={styles.column}>
          <DatePicker
            defaultValue={new Date(2026, 6, 4)}
            testID="compact-date"
          />
          <DatePicker
            defaultValue={new Date(2026, 6, 4, 13, 45)}
            mode="time"
            testID="compact-time"
          />
          <DatePicker
            defaultValue={new Date(2026, 6, 4, 13, 45)}
            mode="datetime"
            testID="compact-datetime"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          Modes, inline (the picker itself)
        </Text>
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          variant="inline"
          testID="inline-date"
        />
        <DatePicker
          defaultValue={new Date(2026, 6, 4, 13, 45)}
          variant="inline"
          mode="time"
          testID="inline-time"
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          Wheel (iOS&apos;s wheel picker; Android has none and renders the
          inline picker)
        </Text>
        <DatePicker
          defaultValue={new Date(2026, 6, 4, 13, 45)}
          variant="wheel"
          mode="datetime"
          testID="wheel-datetime"
        />

        <Text style={[styles.section, { color: ink.ink }]}>Disabled</Text>
        <DatePicker
          value={new Date(2026, 6, 4)}
          disabled
          testID="disabled-compact"
        />
        <DatePicker
          value={new Date(2026, 6, 4)}
          variant="inline"
          disabled
          testID="disabled-inline"
        />

        <Text style={[styles.section, { color: ink.ink }]}>Tinted</Text>
        <DatePicker
          defaultValue={new Date(2026, 6, 4, 13, 45)}
          tintColor="#FF5733"
          testID="tinted-compact"
        />
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          variant="inline"
          mode="datetime"
          tintColor="#FF5733"
          testID="tinted-inline"
        />

        {/*
          Deliberately the last row of the page, and deliberately labelled.

          Two things are proved from one field, both by
          `example/ios/NitroUiExampleUITests/RealInputTests.swift`:

          - **the presentation fits.** A `compact` field's popover is 336 pt wide and
            300-420 pt tall. With only one arrow direction permitted, UIKit caps the
            bubble at the room on that side of the field, so the *last row of a form* -
            this row - gets a clipped calendar. Whatever the field's y ends up being
            after the page is scrolled to the bottom, it is the worst case a real
            screen can hand a date picker, and that is the case worth a check.
          - **the announcement is complete.** The label is on the control here, so the
            value has to arrive next to it rather than be replaced by it - the
            accessibility half of M2/M3, read from the accessibility tree a screen
            reader actually walks.

          Android is not ignored by this row, it is just not checkable from here: its
          `compact` field opens a dialog, which is centred and never squeezed, and the
          label/value/disabled state is read from a `uiautomator dump` instead (the
          report records those dumps).
        */}
        <Text style={[styles.section, { color: ink.ink }]}>
          Last row (a popover has to fit above this one)
        </Text>
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          accessibilityLabel="Departure date"
          testID="low-date"
        />
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
  column: {
    gap: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#333',
  },
  buttonLight: {
    backgroundColor: '#d5d5d8',
  },
  buttonLabel: {
    fontSize: 13,
  },
});
