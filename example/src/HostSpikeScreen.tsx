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
import { Host, Slider, Switch } from 'react-native-nitro-ui';

/**
 * The iOS `<Host>` spike's screen (T17, `docs/tasks/T17-ios-host-spike.md`).
 *
 * Deliberately *not* a `react-native-harness` suite: a harness file has to run on
 * both platforms before it is reported, and this spike builds iOS only. What the
 * evidence needs is a control a finger can hit and text JS rendered, so the checks
 * read this screen through XCUITest - a real tap on a hosted Switch and a real
 * drag on a hosted Slider - see the report's "Correctness evidence" section.
 *
 * The echo `Text`s below are the point of the screen. A hosted control has no view
 * of its own any more, so the only proof that a touch reached SwiftUI's copy and
 * came back out as an `onValueChange` is a string RN rendered from JS state.
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

const HOSTED_SWITCHES = 3;

export default function HostSpikeScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const [switches, setSwitches] = useState<boolean[]>([false, true, false]);
  const [slider, setSlider] = useState(0.25);
  const [events, setEvents] = useState(0);

  const setHostedSwitch = useCallback((index: number, next: boolean) => {
    setEvents((count) => count + 1);
    setSwitches((current) =>
      current.map((value, position) => (position === index ? next : value))
    );
  }, []);

  const setHostedSlider = useCallback((next: number) => {
    setEvents((count) => count + 1);
    setSlider(next);
  }, []);

  // A prop write with no touch at all: it has to reach a control that has no view
  // of its own to update, which is the other half of the handshake.
  const flipFirstFromJs = useCallback(
    () =>
      setSwitches((current) =>
        current.map((value, index) => (index === 0 ? !value : value))
      ),
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
          Everything inside the box below is one SwiftUI hosting controller:
          three Switches and a Slider in one `UIHostingController`, one
          AttributeGraph graph. Outside a Host each control brings its own. On
          Android a Host is a plain view on this branch.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Inside one host
        </Text>
        <View style={[styles.hostBox, { backgroundColor: ink.box }]}>
          <Host style={styles.host}>
            {switches.map((value, index) => (
              <Switch
                key={index}
                value={value}
                onValueChange={(next) => {
                  setHostedSwitch(index, next);
                }}
                testID={`host-switch-${index}`}
                accessibilityLabel={`Hosted switch ${String(index)}`}
                style={styles.hostedRow}
              />
            ))}
            <Slider
              value={slider}
              onValueChange={setHostedSlider}
              testID="host-slider"
              accessibilityLabel="Hosted slider"
              style={styles.hostedWideRow}
            />
          </Host>
        </View>

        <Row label="first hosted switch, as JS sees it">
          <Text
            testID="host-switch-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {switches[0] ? 'on' : 'off'}
          </Text>
        </Row>
        <Row label="hosted slider">
          <Text
            testID="host-slider-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {slider.toFixed(2)}
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
        <Row label="its own hosting controller">
          <Switch
            defaultValue
            testID="plain-switch"
            accessibilityLabel="Plain switch"
          />
        </Row>
        <Row label="its own hosting controller">
          <Slider defaultValue={0.5} testID="plain-slider" />
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
  // Only the box is Yoga's. The children inside it are placed by SwiftUI, so this
  // height is the one number RN gets right about a hosted control.
  host: {
    width: '100%',
    height: (HOSTED_SWITCHES + 1) * 44,
  },
  hostBox: { borderRadius: 10, paddingVertical: 4 },
  hostedRow: { width: '100%', height: 44 },
  hostedWideRow: { width: '100%', height: 44 },
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
