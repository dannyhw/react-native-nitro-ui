import { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch as RNSwitch,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { Switch } from 'react-native-nitro-ui';
import { SWITCH_SCREEN_VARIANT } from './probeVariant';

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
 * Status bar height the system reserves for itself on Android.
 *
 * Android draws every app edge to edge, and RN's `SafeAreaView` only applies the
 * iOS safe area, so the top inset has to be added by hand. `StatusBar` is the
 * only built-in source for it; `react-native-safe-area-context` would be the
 * portable answer.
 */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
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

  // F7 probe pair: two switches that are as identical as two controls can be —
  // same place on the screen, same controlled shape, same "count what JS was
  // told" witness — except that one is this library's hosted SwiftUI `Toggle`
  // and the other is React Native's own native `Switch`.
  //
  // The pair exists because the earlier cells of the matrix could not tell those
  // two apart: a control's accessibility `value:` and a rendered count are
  // different witnesses, and reading a busy tree through the first is itself
  // expensive. Here both switches are read the same way, in the same launch, so
  // which of them loses a 50 ms press is a fact about the control and not about
  // the probe.
  const [probeHosted, setProbeHosted] = useState(false);
  const [probeHostedEvents, setProbeHostedEvents] = useState(0);
  const [probeNative, setProbeNative] = useState(false);
  const [probeNativeEvents, setProbeNativeEvents] = useState(0);
  // A counting witness for the probe's own positive control. `js-toggle` flips a
  // boolean, so "how many of twelve presses landed" cannot be read from it as a
  // delta — an even number looks identical to none. This one counts, which is what
  // the quiet probe shape needs: press twelve times, read once, the delta is the
  // answer.
  const [probePressEvents, setProbePressEvents] = useState(0);
  const countProbePress = useCallback(() => {
    setProbePressEvents((count) => count + 1);
  }, []);
  const acceptHosted = useCallback((next: boolean) => {
    setProbeHosted(next);
    setProbeHostedEvents((count) => count + 1);
  }, []);
  const acceptNative = useCallback((next: boolean) => {
    setProbeNative(next);
    setProbeNativeEvents((count) => count + 1);
  }, []);

  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();
  // F7 dwell probe only — see `./probeVariant`. Variant 3 drops the 200-row
  // list, variant 4 puts it in a plain View, 5 swaps the hosted Switch for RN's
  // own, 6 swaps it for a plain box of the same size.
  const variant = SWITCH_SCREEN_VARIANT;
  const showList = variant !== 3;
  const page = (
    <>
      <Text style={[styles.title, { color: ink.ink }]}>
        react-native-nitro-ui · Switch
      </Text>
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
      <Text style={[styles.section, { color: ink.ink }]}>Probe pair</Text>
      <Row label="hosted · events JS saw">
        <Switch
          value={probeHosted}
          onValueChange={acceptHosted}
          testID="probe-hosted-switch"
        />
      </Row>
      <Row label="">
        <Text
          testID="probe-hosted-events"
          style={[styles.value, { color: ink.ink }]}
        >
          {probeHostedEvents}
        </Text>
      </Row>
      <Row label="react native · events JS saw">
        <RNSwitch
          value={probeNative}
          onValueChange={acceptNative}
          testID="probe-native-switch"
        />
      </Row>
      <Row label="">
        <Text
          testID="probe-native-events"
          style={[styles.value, { color: ink.ink }]}
        >
          {probeNativeEvents}
        </Text>
      </Row>
      <Row label="pressable · events JS saw">
        <Pressable
          onPress={countProbePress}
          testID="probe-pressable"
          hitSlop={8}
        >
          <Text style={styles.link}>count me</Text>
        </Pressable>
      </Row>
      <Row label="">
        <Text
          testID="probe-press-events"
          style={[styles.value, { color: ink.ink }]}
        >
          {probePressEvents}
        </Text>
      </Row>
      <Row label="value shown to JS">
        <Text
          testID="switch-controlled-value"
          style={[styles.value, { color: ink.ink }]}
        >
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
        <Text
          testID="switch-rejected-count"
          style={[styles.value, { color: ink.ink }]}
        >
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
        <Text
          testID="switch-measured-size"
          style={[styles.value, { color: ink.ink }]}
        >
          {'(logged by the harness)'}
        </Text>
      </Row>

      {showList ? (
        <>
          <Text style={[styles.section, { color: ink.ink }]}>
            200 in a list
          </Text>
          <List
            rows={list}
            kind={
              variant === 5 ? 'rn-switch' : variant === 6 ? 'box' : 'hosted'
            }
          />
        </>
      ) : null}
    </>
  );

  return (
    <SafeAreaView
      style={[
        styles.root,
        { backgroundColor: ink.background, paddingTop: topInset },
      ]}
    >
      {/* Edge to edge draws the screen behind the status bar, so only the icon
          colour has to follow the appearance. */}
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      {/* F7 dwell probe only: the screen says which variant it is rendering, so a
          cell of the matrix can be thrown out when Metro served somebody else's
          JS. Not a status the product has a use for, and it goes with the probe. */}
      <Text testID="probe-variant" style={[styles.note, { color: ink.muted }]}>
        probe variant-{variant}
      </Text>
      {/* Variant 4 keeps all 200 hosted Switches mounted but takes the scroll
          view away, which is the difference between "a control inside a busy
          scroller drops the touch" and "a control drops the touch". */}
      {variant === 4 ? (
        <View style={styles.page}>{page}</View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.page}
          canCancelContentTouches={variant === 1 ? false : undefined}
          scrollEnabled={variant === 2 ? false : undefined}
        >
          {page}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * The 200-row block, in the three shapes the probe compares: this library's
 * hosted Switch, React Native's own `Switch`, and a plain box of the same
 * geometry. Row testIDs are stable across the three so the probe's aim does not
 * change when the shape does.
 */
function List({
  rows,
  kind,
}: {
  rows: ReadonlyArray<{ id: string; on: boolean }>;
  kind: 'hosted' | 'rn-switch' | 'box';
}) {
  return (
    <View style={styles.list}>
      {rows.map((row, index) => (
        <View key={row.id} style={styles.row}>
          <Text style={[styles.label, { color: '#666' }]}>row {index}</Text>
          {kind === 'hosted' ? (
            <Switch
              defaultValue={row.on}
              testID={`switch-list-${index}`}
              nuiPerfId={null}
            />
          ) : kind === 'rn-switch' ? (
            <RNSwitch value={row.on} testID={`switch-list-${index}`} />
          ) : (
            <View testID={`switch-list-${index}`} style={styles.fauxSwitch} />
          )}
        </View>
      ))}
    </View>
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
  // F7 probe variant 6 only: a box the size of a hosted Switch on this iOS, so
  // the row's geometry and the scroll view's hit-test cost are as close to the
  // real thing as a plain `View` can be — with no hosting controller inside it.
  fauxSwitch: {
    width: 61,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#d1d1d6',
  },
});
