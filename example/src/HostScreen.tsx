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
import { Host, Switch } from 'react-native-nitro-ui';

/**
 * The `<Host>` spike's screen (T16, `docs/tasks/T16-host-spike.md`).
 *
 * Deliberately *not* a `react-native-harness` suite: a harness file has to run on
 * both platforms before it is reported, and this spike builds Android only. What
 * the real-input evidence needs is a control a finger can hit and text JS rendered,
 * so the checks read this screen with `adb shell input` and `uiautomator dump` -
 * see the report's "Correctness evidence" section for the exact commands.
 */

/** Text colours - `Text` has no dynamic default colour in RN. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    box: dark ? '#141414' : '#f2f2f4',
  };
}

export default function HostScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const [values, setValues] = useState<boolean[]>([false, true, false]);
  const [events, setEvents] = useState(0);

  const setHosted = useCallback((index: number, next: boolean) => {
    setEvents((count) => count + 1);
    setValues((current) =>
      current.map((value, position) => (position === index ? next : value))
    );
  }, []);

  // A prop write with no touch at all: it has to reach a control that has no view
  // of its own to update, which is the other half of the handshake.
  const flipFirstFromJs = useCallback(
    () => setValues((current) => current.map((v, i) => (i === 0 ? !v : v))),
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
          react-native-nitro-ui · Host
        </Text>
        <Text style={styles.note}>
          Everything inside the box below is one Compose composition: three
          Switches, one AndroidComposeView, one LayoutNode tree. Outside a Host
          each Switch brings its own. On iOS a Host is a plain view today.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Three Switches, one composition
        </Text>
        <View style={[styles.hostBox, { backgroundColor: ink.box }]}>
          <Host style={styles.host}>
            {values.map((value, index) => (
              <Switch
                key={index}
                value={value}
                onValueChange={(next) => {
                  setHosted(index, next);
                }}
                testID={`host-switch-${index}`}
                accessibilityLabel={`Hosted switch ${String(index)}`}
                style={styles.hostedRow}
              />
            ))}
          </Host>
        </View>

        <Row label="first switch, as JS sees it">
          <Text
            testID="host-controlled-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {values[0] ? 'on' : 'off'}
          </Text>
        </Row>
        <Row label="changes JS has accepted">
          <Text
            testID="host-events-count"
            style={[styles.value, { color: ink.ink }]}
          >
            {events}
          </Text>
        </Row>
        <Pressable
          onPress={flipFirstFromJs}
          testID="host-js-toggle"
          hitSlop={8}
        >
          <Text style={styles.link}>flip the first from JS</Text>
        </Pressable>

        <Text style={[styles.section, { color: ink.ink }]}>
          Outside a Host, for comparison
        </Text>
        <Row label="its own composition">
          <Switch
            defaultValue
            testID="plain-switch"
            accessibilityLabel="Plain switch"
          />
        </Row>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const ink = useInk();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { padding: 16, gap: 6 },
  title: { fontSize: 18, fontWeight: '600' },
  note: { color: '#888', marginBottom: 8 },
  section: {
    marginTop: 14,
    marginBottom: 2,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  // Only the box is Yoga's. The children inside it are placed by Compose, so this
  // height is the one number RN gets right about a hosted control.
  host: { width: '100%', height: 3 * 44 },
  hostBox: { borderRadius: 10, paddingVertical: 4 },
  hostedRow: { width: '100%', height: 44 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 34,
    gap: 12,
  },
  label: { flex: 1, color: '#666' },
  value: { fontVariant: ['tabular-nums'] },
  link: { color: '#3b82f6' },
});
