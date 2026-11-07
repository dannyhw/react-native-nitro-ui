import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  useColorScheme,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Switch, TextField } from 'react-native-nitro-ui';

// The spike prototype, not a shipped component: no manifest and no export from the
// entry point, so this is the one screen that imports a component by path. It exists
// because `real-input` can only prove what the example app actually renders - and
// S6's iOS taps had nothing to tap. See docs/tasks/S6b-form-spike-ios.md.
import { Form } from '../../src/components/Form/Form';

/**
 * Text colours for the current appearance, like every other example screen: `Text` gets
 * no dynamic colour from React Native, and the counters have to be readable in dark mode
 * for the accessibility tree to say something a screen reader could also hear.
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
 * One on-screen value the real-input suite reads.
 *
 * A separate `Text` per value, and not a nested one: on Android a nested `<Text>` is a
 * span of its parent's string, not a view, so it carries no `resource-id` for
 * `uiautomator` to find - which is why every other example screen does this too.
 */
function Echo({
  label,
  testID,
  value,
  ink,
}: {
  label: string;
  testID: string;
  value: string;
  ink: ReturnType<typeof useInk>;
}) {
  return (
    <View style={styles.echoRow}>
      <Text style={[styles.echoLabel, { color: ink.muted }]}>{label}</Text>
      <Text testID={testID} style={[styles.echoValue, { color: ink.ink }]}>
        {value}
      </Text>
    </View>
  );
}

/**
 * The `Form` screen: a grouped form whose rows carry React Native content.
 *
 * Every count is rendered as an on-screen `Text` above the list, because that is the
 * only thing `real-input` is allowed to read (no test hook, no in-app tracer). They
 * sit *above* the Form rather than below it so the runner can read a counter without
 * scrolling - the list scrolls, this bar does not.
 *
 * What each control is here for, one per question:
 *
 * - `form-row` - a row with `onPress`. Ten real taps must be ten presses, no more
 *   (a recogniser that double-fires) and no fewer (S6's iOS list swallowed them all).
 * - `form-row-plain` - a row with no `onPress`. Tapping it must move no counter:
 *   the row is inert, and a Form that presses whatever it last saw fails here.
 * - `form-inner` - a `Pressable` inside a row. Ten taps, ten presses: the row's own
 *   press must not steal the touch from its content.
 * - `form-switch` - a `Switch` inside a row. Ten taps, ten changes and ten flips:
 *   the hosted control still gets its own touches.
 * - `form-outside` - a `Pressable` outside the Form. It answers whether input is
 *   alive at all, and its own counter is what proves a Form tap was a Form tap.
 * - `form-note-field` - a `TextField` several screens down, so question 5 has a
 *   field near the bottom of a long form to focus with a real tap.
 */
export default function FormScreen() {
  const ink = useInk();
  const topInset = useTopInset();
  const [rowPresses, setRowPresses] = useState(0);
  const [innerPresses, setInnerPresses] = useState(0);
  const [outsidePresses, setOutsidePresses] = useState(0);
  const [switchChanges, setSwitchChanges] = useState(0);
  const [airplane, setAirplane] = useState(false);
  const [note, setNote] = useState('');
  const [focused, setFocused] = useState(false);

  // The counter is the evidence, so it counts what the platform reported and
  // nothing else: no clamping, no de-duping, no "already counted this frame".
  const countRow = useCallback(() => setRowPresses((n) => n + 1), []);
  const countInner = useCallback(() => setInnerPresses((n) => n + 1), []);
  const countOutside = useCallback(() => setOutsidePresses((n) => n + 1), []);
  const flipSwitch = useCallback((next: boolean) => {
    setAirplane(next);
    setSwitchChanges((n) => n + 1);
  }, []);

  return (
    <View
      style={[
        styles.page,
        { backgroundColor: ink.background, paddingTop: topInset },
      ]}
    >
      <View style={styles.echoBar}>
        <View style={styles.echoGrid}>
          <Echo
            ink={ink}
            label="screen"
            testID="form-screen-echo"
            value="form"
          />
          <Echo
            ink={ink}
            label="rows"
            testID="form-row-presses"
            value={String(rowPresses)}
          />
          <Echo
            ink={ink}
            label="inner"
            testID="form-inner-presses"
            value={String(innerPresses)}
          />
          <Echo
            ink={ink}
            label="outside"
            testID="form-outside-presses"
            value={String(outsidePresses)}
          />
          <Echo
            ink={ink}
            label="changes"
            testID="form-switch-changes"
            value={String(switchChanges)}
          />
          <Echo
            ink={ink}
            label="value"
            testID="form-switch-value"
            value={airplane ? 'on' : 'off'}
          />
          <Echo
            ink={ink}
            label="focus"
            testID="form-field-focus"
            value={focused ? 'yes' : 'no'}
          />
          <Echo
            ink={ink}
            label="field"
            testID="form-field-value"
            value={note === '' ? '-' : note}
          />
        </View>
        <Pressable
          accessibilityLabel="Outside the form"
          onPress={countOutside}
          style={[styles.outside, { borderColor: ink.ink }]}
          testID="form-outside"
        >
          <Text style={[styles.outsideText, { color: ink.ink }]}>
            Outside the form
          </Text>
        </Pressable>
      </View>

      <Form style={styles.form}>
        <Form.Section
          footer="These settings apply to this device only."
          title="Connectivity"
        >
          <Form.Row onPress={countRow}>
            <View
              accessibilityLabel="Row with onPress"
              style={styles.rowContent}
              testID="form-row"
            >
              <Text style={styles.label}>Notifications</Text>
              <Text style={styles.detail}>onPress: one press per tap</Text>
            </View>
          </Form.Row>
          <Form.Row>
            <View
              accessibilityLabel="Row with no onPress"
              style={styles.rowContent}
              testID="form-row-plain"
            >
              <Text style={styles.label}>Device name</Text>
              <Text style={styles.detail}>no onPress: taps go nowhere</Text>
            </View>
          </Form.Row>
          <Form.Row>
            <View style={styles.rowContent}>
              <Pressable
                accessibilityLabel="Press me inside a row"
                onPress={countInner}
                style={styles.inner}
                testID="form-inner"
              >
                <Text style={styles.innerText}>Press me inside this row</Text>
              </Pressable>
            </View>
          </Form.Row>
          <Form.Row>
            <View style={styles.rowContent}>
              <Text style={styles.label}>Airplane mode</Text>
              <Switch
                accessibilityLabel="Airplane mode"
                onValueChange={flipSwitch}
                testID="form-switch"
                value={airplane}
              />
            </View>
          </Form.Row>
        </Form.Section>

        <Form.Section title="Network">
          {FILLER.map((row) => (
            <Form.Row key={row}>
              <View style={styles.rowContent}>
                <Text style={styles.label}>{row}</Text>
              </View>
            </Form.Row>
          ))}
        </Form.Section>

        <Form.Section footer="Saved when the field loses focus." title="Notes">
          <Form.Row>
            <View style={styles.rowContent}>
              <TextField
                accessibilityLabel="Note"
                onBlur={() => setFocused(false)}
                onFocus={() => setFocused(true)}
                onChangeText={setNote}
                placeholder="Near the bottom of the list"
                testID="form-note-field"
                value={note}
              />
            </View>
          </Form.Row>
        </Form.Section>
      </Form>
    </View>
  );
}

/** Enough rows that the note field starts below the fold: question 5 needs a scroll. */
const FILLER = [
  'Wi-Fi',
  'Bluetooth',
  'Cellular data',
  'Hotspot',
  'VPN',
  'Local network',
  'AirDrop',
  'Downloads',
];

const styles = StyleSheet.create({
  page: { flex: 1 },
  echoBar: { gap: 4, paddingHorizontal: 12, paddingVertical: 6 },
  // The bar is the runner's evidence and must never scroll away, so it stays two lines
  // of small counters rather than seven rows of labelled ones.
  echoGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  echoRow: { alignItems: 'baseline', flexDirection: 'row', gap: 3 },
  echoLabel: { fontSize: 11 },
  echoValue: { fontSize: 11, fontWeight: '600' },
  outside: {
    borderRadius: 8,
    borderWidth: 2,
    paddingVertical: 10,
  },
  outsideText: { fontWeight: '600', textAlign: 'center' },
  form: { flex: 1 },
  rowContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
  },
  label: { fontSize: 17 },
  detail: { fontSize: 12, opacity: 0.6 },
  inner: {
    backgroundColor: '#e8def8',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  innerText: { fontWeight: '600' },
});
