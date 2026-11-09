import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  useColorScheme,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Form, Switch, TextField } from 'react-native-nitro-ui';

// The one thing this screen reads that app code has no business reading: the Form's own
// report, whose `keyboard=` field is UIKit's number for the keyboard. `hybridRef` and its
// test seams are internal (D14), so the handle is named by the methods this screen calls,
// the way `example/__tests__/Form.harness.tsx` names it.
type FormHandle = {
  nuiTestFormReport(): string;
};

/** How often the screen asks the Form's own report for its keyboard inset. */
const REPORT_POLL_MS = 150;

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
  const [keyboardInset, setKeyboardInset] = useState<number | null>(null);
  const [listGeometry, setListGeometry] = useState('-');
  const formRef = useRef<FormHandle | null>(null);

  // Question 5 needs the keyboard's own number, not a guess at it. UIKit tells the Form
  // how tall the keyboard is (it sets its list's bottom inset from
  // `keyboardWillChangeFrame`), and the Form says so in `nuiTestFormReport()` - which is
  // a test seam on a spike screen, so polling it from here is the cheapest way to put the
  // number where the runner can read it. It is also the only witness that survives a
  // simulator with a connected hardware keyboard: XCUITest sees no keyboard *window* in
  // that case, but UIKit still says what it thinks the keyboard's height is.
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const timer = setInterval(() => {
      const line = formRef.current?.nuiTestFormReport() ?? '';
      const field = line.match(/(?:^|;)keyboard=(-?[\d.]+)/);
      const value = field == null ? null : Number(field[1]);
      if (Number.isFinite(value ?? Number.NaN)) {
        setKeyboardInset((previous) => (previous === value ? previous : value));
      }
      // `kb` is what the Form *asked* UIKit to reserve; these are what its list is carrying:
      // its own bottom inset, the adjusted inset its keyboard decisions are measured against,
      // the offset, and the y of the box all of that is drawn in. A scroll that takes the
      // reservation back leaves `kb` alone, so without these it is invisible on screen.
      const picked = (name: string) =>
        (line.match(new RegExp(`(?:^|;)${name}=(-?[\\d.]+)`)) ?? [])[1] ?? '-';
      // `h`/`bh` are the content and the viewport, which the runner needs to know whether a
      // rest is the *end* of the content - the only rest a keyboard reservation can be judged
      // at. They ride in the report's `screen=` field, comma-joined.
      const screenFields =
        (line.match(/(?:^|;)screen=([^;]*)/) ?? [])[1]?.split(',') ?? [];
      const geometry =
        `ib=${picked('insetBottom')};ab=${picked(
          'adjBottom'
        )};off=${picked('offset')};y=${picked('listY')}` +
        `;bh=${screenFields[1] ?? '-'};h=${screenFields[2] ?? '-'}`;
      setListGeometry((previous) =>
        previous === geometry ? previous : geometry
      );
    }, REPORT_POLL_MS);
    return () => clearInterval(timer);
  }, []);

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
          {Platform.OS === 'ios' ? (
            // The keyboard inset the Form's own list is reserving, straight from UIKit.
            // `-` until the first report comes back, `0.0` for "no keyboard is up".
            <Echo
              ink={ink}
              label="kb"
              testID="form-keyboard-inset"
              value={keyboardInset == null ? '-' : keyboardInset.toFixed(1)}
            />
          ) : null}
          {Platform.OS === 'ios' ? (
            // The list's own geometry, four numbers the Form reports and nothing guesses.
            <Echo
              ink={ink}
              label="list"
              testID="form-list-geometry"
              value={listGeometry}
            />
          ) : null}
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

      <Form hybridRef={(view) => (formRef.current = view)} style={styles.form}>
        <Form.Section
          footer="These settings apply to this device only."
          title="Connectivity"
        >
          {/*
            The label and the `testID` go on `Form.Row` itself, because that is what the
            component promises: a row with `onPress` is *one* element, named, that a person can
            press. On the content `View` below, the name sat on a child of the thing that
            presses — which is the split the a11y table exists to catch, and on Android it also
            meant the named node was never the clickable one (fix round 1).
          */}
          <Form.Row
            accessibilityLabel="Row with onPress"
            onPress={countRow}
            testID="form-row"
          >
            <View style={styles.rowContent}>
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
