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

/** `Text` gets no dynamic default colour from React Native. */
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
 * A date as `2026-10-25`. Not `toLocaleDateString()`: the real-input suite
 * asserts this text, and it must not depend on the device's region.
 */
function dayOf(date: Date | null): string {
  if (date == null) {
    return '-';
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function instantOf(date: Date | null): string {
  if (date == null) {
    return '-';
  }
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${dayOf(date)} ${hours}:${minutes}`;
}

export default function DatePickerScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // At the top of the page: `uiautomator dump` lists no off-screen nodes on
  // Android.
  const [realDate, setRealDate] = useState<Date | null>(null);
  const [realEvents, setRealEvents] = useState(0);
  const [rejectEvents, setRejectEvents] = useState(0);
  const [wheelTime, setWheelTime] = useState<Date | null>(null);
  const [wheelTimeEvents, setWheelTimeEvents] = useState(0);
  const [rejectWheelEvents, setRejectWheelEvents] = useState(0);
  const [rejectWheelTime] = useState(() => new Date(2024, 5, 15, 9, 20));
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

  const countWheelTimeChange = useCallback((date: Date) => {
    setWheelTimeEvents((current) => current + 1);
    setWheelTime(date);
  }, []);

  const countRejectWheelChange = useCallback(() => {
    setRejectWheelEvents((current) => current + 1);
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

        {/* One parent accepts the pick, the other refuses it. */}
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
        {/*
          Android only. Material 3 gives each of a calendar's seven weekday
          columns a 48 dp minimum, so the grid wants 360 dp: the narrow box is
          under that and the wide one over it.
        */}
        {Platform.OS === 'android' ? (
          <DatePicker
            defaultValue={new Date(2026, 9, 31)}
            variant="inline"
            accessibilityLabel="Wide inline calendar"
            testID="wide-inline"
            style={styles.wideBox}
          />
        ) : null}
        {Platform.OS === 'android' ? (
          <View style={styles.narrowBox}>
            <DatePicker
              defaultValue={new Date(2026, 9, 31)}
              variant="inline"
              accessibilityLabel="Narrow inline calendar"
              testID="narrow-inline"
            />
          </View>
        ) : null}

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
          The last row of the page on iOS: with one arrow direction permitted,
          UIKit caps a `compact` field's popover at the room on that side of
          the field, so this is the worst case for fitting the calendar.
        */}
        {/*
          Android `wheel` cases. Every echo sits above its control because
          `uiautomator dump` lists no off-screen node.
        */}
        <Text style={[styles.section, { color: ink.ink }]}>
          Real input · wheel
        </Text>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            wheel time reported (uncontrolled)
          </Text>
          <Text
            testID="real-input-wheel-time-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {instantOf(wheelTime)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            wheel changes reported (uncontrolled)
          </Text>
          <Text
            testID="real-input-wheel-time-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {wheelTimeEvents}
          </Text>
        </View>
        <DatePicker
          mode="time"
          variant="wheel"
          defaultValue={new Date(2024, 5, 15, 9, 20)}
          onChange={countWheelTimeChange}
          accessibilityLabel="Real-input wheel time picker"
          testID="real-input-wheel-time"
        />
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            wheel changes refused by the parent
          </Text>
          <Text
            testID="real-input-wheel-refuse-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {rejectWheelEvents}
          </Text>
        </View>
        <DatePicker
          mode="time"
          variant="wheel"
          value={rejectWheelTime}
          onChange={countRejectWheelChange}
          accessibilityLabel="Real-input wheel refusing picker"
          testID="real-input-wheel-refuse"
        />
        <DatePicker
          mode="date"
          variant="wheel"
          defaultValue={new Date(2024, 5, 15)}
          accessibilityLabel="Real-input wheel date picker"
          testID="real-input-wheel-date"
        />
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
  narrowBox: {
    width: 320,
    maxWidth: '100%',
  },
  /**
   * Reclaims the page's 16 dp of padding on both sides, so the wide inline
   * calendar is laid out at the screen's width.
   */
  wideBox: {
    marginHorizontal: -16,
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
