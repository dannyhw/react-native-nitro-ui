import { useCallback, useMemo, useState } from 'react';
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
 * The `<Host>` screen.
 *
 * A Host gives its children **one** Compose composition instead of one each, and that
 * is the only thing this screen demonstrates: the same controls, batched and not
 * batched, on one screen, so the difference is something a person can toggle and feel
 * rather than a number in a report. `Host` is opt-in and Android-only - iOS is the
 * documented passthrough, permanently (D23's outcome) - so nothing here is hidden.
 *
 * It is also the screen the real-input suite taps: `host-switch-*` carries an
 * accessibility label and the two `host-*` texts are the echoes it reads, so those
 * testIDs are part of a gate (`scripts/real-input/`) and not decoration. The harness
 * cases for the same behaviour are in `example/__tests__/Host.harness.tsx`.
 */

/** Switches in the batch. Enough to see a composition's cost, few enough to scroll. */
const BATCH = 24;

/**
 * The row pitch a hosted `Switch` occupies, in dp.
 *
 * This is the sizing engine's answer for a Switch on Android, and a Host's `Column`
 * draws one row per child at that pitch. A Host with no `height` would be the sum of
 * its children's boxes (D24) — which for a batch this size means the layout is only
 * right while the declared sizes match what Compose draws, so the screen says the
 * height out loud the way `docs/components/host.md` tells apps to.
 */
const ROW = 48;

/** Text colours - `Text` has no dynamic default colour in RN. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    box: dark ? '#141414' : '#f2f2f4',
    link: dark ? '#7aa2ff' : '#3b82f6',
  };
}

export default function HostScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const [values, setValues] = useState<boolean[]>([false, true, false]);
  const [events, setEvents] = useState(0);

  // The batch: one counter for all of it, because the point is the batch, not a row.
  const [batchHosted, setBatchHosted] = useState(true);
  const [batchGeneration, setBatchGeneration] = useState(0);
  const [batchEvents, setBatchEvents] = useState(0);

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

  const onBatchChange = useCallback(() => {
    setBatchEvents((count) => count + 1);
  }, []);

  // Both halves of the comparison mount the same number of controls, at the same
  // pitch, in the same box - the only difference is who composes them.
  const batch = useMemo(
    () =>
      Array.from({ length: BATCH }, (_, index) => (
        <Switch
          key={index}
          defaultValue={index % 3 === 0}
          onValueChange={onBatchChange}
          testID={`batch-switch-${index}`}
          accessibilityLabel={`Batch switch ${String(index)}`}
        />
      )),
    [onBatchChange]
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
        <Text style={[styles.note, { color: ink.muted }]}>
          Everything inside a Host is one Compose composition: N Switches, one
          AndroidComposeView, one LayoutNode tree. Outside a Host every Switch
          brings its own. On iOS a Host is a plain view today.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Three Switches, one composition
        </Text>
        <View style={[styles.hostBox, { backgroundColor: ink.box }]}>
          <Host style={styles.threeRows}>
            {values.map((value, index) => (
              <Switch
                key={index}
                value={value}
                onValueChange={(next) => {
                  setHosted(index, next);
                }}
                testID={`host-switch-${index}`}
                accessibilityLabel={`Hosted switch ${String(index)}`}
              />
            ))}
          </Host>
        </View>
        <Text style={[styles.note, { color: ink.muted }]}>
          The Host has a height; its children do not need one. A style on a
          hosted child moves the frame React Native computes, not what Compose
          draws.
        </Text>

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
          <Text style={[styles.link, { color: ink.link }]}>
            flip the first from JS
          </Text>
        </Pressable>

        <Text style={[styles.section, { color: ink.ink }]}>
          {BATCH} Switches, {batchHosted ? 'in one Host' : 'each on its own'}
        </Text>
        <View style={[styles.actions, { borderColor: ink.box }]}>
          <Pressable
            onPress={() => setBatchHosted((current) => !current)}
            testID="host-batch-toggle"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>
              {batchHosted ? 'render unhosted' : 'render in a Host'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setBatchGeneration((generation) => generation + 1);
              setBatchEvents(0);
            }}
            testID="host-batch-rebuild"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>rebuild</Text>
          </Pressable>
        </View>
        {batchHosted ? (
          <View
            key={`hosted-${String(batchGeneration)}`}
            style={[styles.hostBox, { backgroundColor: ink.box }]}
          >
            <Host style={styles.batchRows}>{batch}</Host>
          </View>
        ) : (
          <View
            key={`plain-${String(batchGeneration)}`}
            style={[styles.hostBox, { backgroundColor: ink.box }]}
          >
            {batch}
          </View>
        )}
        <Row label="switches on screen">
          <Text style={[styles.value, { color: ink.ink }]}>{BATCH}</Text>
        </Row>
        <Row label="compositions they cost">
          <Text
            testID="host-batch-compositions"
            style={[styles.value, { color: ink.ink }]}
          >
            {batchHosted ? '1' : String(BATCH)}
          </Text>
        </Row>
        <Row label="changes since the last rebuild">
          <Text
            testID="host-batch-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {batchEvents}
          </Text>
        </Row>
        <Text style={[styles.note, { color: ink.muted }]}>
          Rebuild unmounts the batch and mounts it again: the loop the leak gate
          measures, on a screen where you can watch it.
        </Text>
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
  // Only the box is Yoga's. What is inside it is placed by Compose, so these heights
  // are the one number RN gets right about a hosted control (D24) - module-level so a
  // re-render never hands the Host a style object with a new identity.
  threeRows: { width: '100%', height: 3 * ROW },
  batchRows: { width: '100%', height: BATCH * ROW },
  hostBox: { borderRadius: 10, paddingVertical: 4 },
  actions: {
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 6,
  },
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
