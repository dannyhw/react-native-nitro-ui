import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { Switch } from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance.
 *
 * `Text` gets no dynamic default colour from React Native, so a screen that has
 * to read in both light and dark mode picks its own.
 */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
  };
}

/**
 * Every Switch configuration T10 has to prove, on one screen:
 * controlled, uncontrolled, disabled, tinted, a change JS rejects, and 200
 * switches in a scrolling list (the case `RecyclableView` exists for).
 *
 * `react-native-harness` drives the same screen in `__tests__/Switch.harness.tsx`
 * through these testIDs.
 */
export default function SwitchScreen() {
  const ink = useInk();
  const [controlled, setControlled] = useState(false);
  const [rejections, setRejections] = useState(0);
  const [tinted, setTinted] = useState(true);

  // Native flips the Switch, then reverts it: JS never accepts the change, so the
  // event-count handshake is what brings it back to `false`.
  const rejectChange = useCallback(() => {
    setRejections((count) => count + 1);
  }, []);

  // Changes the prop without touching the control, to prove a JS-driven write
  // reaches the hosted view.
  const flipFromJs = useCallback(
    () => setControlled((current) => !current),
    []
  );

  const list = useMemo(
    () =>
      Array.from({ length: 200 }, (_, index) => ({
        id: `row-${index}`,
        on: index % 3 === 0,
      })),
    []
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: ink.background }]}>
      <ScrollView contentContainerStyle={styles.page}>
      <Text style={[styles.title, { color: ink.ink }]} >react-native-nitro-ui · Switch</Text>
      <Text style={styles.note}>
        SwiftUI Toggle (.switch) on iOS, Material 3 Switch on Android.
      </Text>

      <Text style={[styles.section, { color: ink.ink }]}>Controlled</Text>
      <Row label="value + onValueChange">
        <Switch
          value={controlled}
          onValueChange={setControlled}
          testID="switch-controlled"
          accessibilityLabel="Controlled switch"
        />
      </Row>
      <Row label="value shown to JS">
        <Text testID="switch-controlled-value" style={[styles.value, { color: ink.ink }]}>
          {controlled ? 'on' : 'off'}
        </Text>
      </Row>
      <Pressable onPress={flipFromJs} testID="js-toggle" hitSlop={8}>
        <Text style={styles.link}>flip from JS</Text>
      </Pressable>

      <Text style={[styles.section, { color: ink.ink }]}>Uncontrolled</Text>
      <Row label="defaultValue={false}">
        <Switch testID="switch-uncontrolled" />
      </Row>
      <Row label="defaultValue={true}">
        <Switch defaultValue testID="switch-default-on" />
      </Row>

      <Text style={[styles.section, { color: ink.ink }]}>Rejected change</Text>
      <Row label="value={false}, handler never accepts">
        <Switch
          value={false}
          onValueChange={rejectChange}
          testID="switch-rejected"
        />
      </Row>
      <Row label="events JS saw">
        <Text testID="switch-rejected-count" style={[styles.value, { color: ink.ink }]}>
          {rejections}
        </Text>
      </Row>

      <Text style={[styles.section, { color: ink.ink }]}>Styles</Text>
      <Row label="disabled">
        <Switch disabled value testID="switch-disabled" />
      </Row>
      <Row label="tintColor">
        <Switch
          value={tinted}
          onValueChange={setTinted}
          tintColor="#7C4DFF"
          testID="switch-tinted"
        />
      </Row>
      <Row label="custom size">
        <Switch
          defaultValue
          testID="switch-big"
          style={styles.bigSwitch}
          onValueChange={() => {}}
        />
      </Row>
      <Row label="measureContent()">
        <Text testID="switch-measured-size" style={[styles.value, { color: ink.ink }]}>
          {'(logged by the harness)'}
        </Text>
      </Row>

      <Text style={[styles.section, { color: ink.ink }]}>200 in a list</Text>
      <View style={styles.list}>
        {list.map((row, index) => (
          <View key={row.id} style={styles.row}>
            <Text style={[styles.label, { color: ink.muted }]}>row {index}</Text>
            <Switch
              defaultValue={row.on}
              testID={`switch-list-${index}`}
              nuiPerfId={null}
            />
          </View>
        ))}
      </View>
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
  link: {
    color: '#3b82f6',
  },
  // A user style wins over the platform default box; the control stays centred
  // in it (docs/components/switch.md).
  bigSwitch: {
    width: 90,
    height: 50,
  },
  list: {
    gap: 2,
  },
});
