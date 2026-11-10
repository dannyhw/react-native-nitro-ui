import { useCallback, useState } from 'react';
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
import { Checkbox } from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance - the helper the other screens use.
 * `Text` gets no dynamic default colour from React Native, and the screen has to
 * read in both light and dark mode for the README screenshots.
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
 * The Checkbox's example screen: the real-input block first, then labelled and
 * bare checkboxes, the three-state row (Android), the controlled pair with a
 * refusing parent, and the disabled pair.
 *
 * The README screenshots come from the Storybook story, not this screen. The
 * on-device assertions live in `example/__tests__/Checkbox.harness.tsx`, which
 * renders its own trees.
 */
export default function CheckboxScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // The real-input suite's controls (`scripts/real-input`). The echo is React's own
  // render, so it only moves if a real touch reached the hosted control, the control
  // told Nitro, and Nitro told JS.
  const [realChecked, setRealChecked] = useState(false);
  const [realEvents, setRealEvents] = useState(0);
  const onRealCheckedChange = useCallback((next: boolean) => {
    setRealChecked(next);
    setRealEvents((count) => count + 1);
  }, []);
  // The refusing parent: `checked` stays false, so every toggle is refused and has to
  // snap back. The last *requested* value is the oracle - a checkbox that kept the
  // refused value would request `false` on the next tap, not `true` again.
  const [refusedLast, setRefusedLast] = useState('-');
  const [refusedEvents, setRefusedEvents] = useState(0);
  const onRefusedChange = useCallback((next: boolean) => {
    setRefusedLast(String(next));
    setRefusedEvents((count) => count + 1);
  }, []);
  // The `iosStyle='switch'` fixture (G31): DECISIONS D47 keeps the old look behind a
  // prop, so a real tap has to prove it still toggles in both directions with one event
  // each - which the harness cannot do on iOS, where its touch reaches no SwiftUI gesture.
  const [realSwitchChecked, setRealSwitchChecked] = useState(false);
  const [realSwitchEvents, setRealSwitchEvents] = useState(0);
  const onRealSwitchChange = useCallback((next: boolean) => {
    setRealSwitchChecked(next);
    setRealSwitchEvents((count) => count + 1);
  }, []);
  // Shared by the enabled and the disabled checkbox, so a stray tap on the disabled
  // one is a number on screen rather than the absence of a callback.
  const [disabledEvents, setDisabledEvents] = useState(0);
  const onDisabledChange = useCallback(() => {
    setDisabledEvents((count) => count + 1);
  }, []);

  const [terms, setTerms] = useState(false);
  const [shipping, setShipping] = useState(true);

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
          react-native-nitro-ui · Checkbox
        </Text>
        <Text style={styles.note}>
          SwiftUI Toggle wearing Apple&apos;s checklist glyph on iOS - which has
          no checkbox control - and Material 3 Checkbox / TriStateCheckbox on
          Android. `iosStyle` picks the iOS picture: circle, square, or the
          switch it shipped with.
        </Text>

        {/*
          The real-input suite's block (`scripts/real-input`): a controlled checkbox,
          a refusing one, and a disabled one wired to its own counter - so an OS tap
          on the disabled one is a number that did not move. It is first on the page
          because `uiautomator dump` lists no off-screen nodes.
        */}
        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <View style={styles.column}>
          <Checkbox
            label="Real input"
            checked={realChecked}
            onCheckedChange={onRealCheckedChange}
            accessibilityLabel="Real-input checkbox"
            testID="real-input-checkbox"
          />
          <Checkbox
            label="Real input, switch"
            iosStyle="switch"
            checked={realSwitchChecked}
            onCheckedChange={onRealSwitchChange}
            accessibilityLabel="Real-input switch checkbox"
            testID="real-input-checkbox-switch"
          />
          {/*
            The third state, for the one question only a screen reader can answer: what a
            reader is *told* about a box showing a dash. iOS draws `minus.circle.fill` and
            sets `.accessibilityValue("mixed")` for exactly that state
            (`HybridNitroUiCheckbox.swift`), and Android publishes Material's
            `ToggleableState.Indeterminate` - so the element has to be read from outside
            the app, which is what `real-input` does. It is uncontrolled and has no echo:
            no test presses it, because the thing under test is the announcement and not
            the press.
          */}
          <Checkbox
            label="Real input, mixed"
            indeterminate
            accessibilityLabel="Real-input mixed checkbox"
            testID="real-input-checkbox-mixed"
          />
          <Checkbox
            label="Refusing"
            checked={false}
            onCheckedChange={onRefusedChange}
            accessibilityLabel="Real-input refusing checkbox"
            testID="real-input-checkbox-refusing"
          />
          <Checkbox
            label="Real input, disabled"
            disabled
            checked={realChecked}
            onCheckedChange={onDisabledChange}
            accessibilityLabel="Real-input disabled checkbox"
            testID="real-input-checkbox-disabled"
          />
        </View>
        <View style={styles.echoes}>
          <Echo
            label="checkbox checked"
            testID="real-input-checkbox-value"
            value={realChecked ? 'on' : 'off'}
            ink={ink}
          />
          <Echo
            label="checkbox changes"
            testID="real-input-checkbox-events"
            value={String(realEvents)}
            ink={ink}
          />
          <Echo
            label="refused: last request"
            testID="real-input-checkbox-refused-last"
            value={refusedLast}
            ink={ink}
          />
          <Echo
            label="refused: requests"
            testID="real-input-checkbox-refused-events"
            value={String(refusedEvents)}
            ink={ink}
          />
          <Echo
            label="disabled: requests"
            testID="real-input-checkbox-disabled-events"
            value={String(disabledEvents)}
            ink={ink}
          />
          <Echo
            label="switch: requests"
            testID="real-input-checkbox-switch-events"
            value={String(realSwitchEvents)}
            ink={ink}
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Labelled</Text>
        <View style={styles.column}>
          <Checkbox
            label="I accept the terms"
            checked={terms}
            onCheckedChange={setTerms}
            testID="terms"
          />
          <Checkbox
            label="Free shipping"
            defaultChecked
            testID="shipping-controlled"
            checked={shipping}
            onCheckedChange={setShipping}
          />
          {/* No `label`: a bare checkbox, which on Android has no accessible name
              of its own, so the name has to be given. */}
          <Checkbox testID="bare" accessibilityLabel="Bare box" />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Three state</Text>
        <View style={styles.column}>
          <Checkbox
            label="Select all"
            indeterminate
            accessibilityLabel="Select all, some items chosen"
            testID="select-all"
          />
          <Checkbox
            label="Select all, checked"
            checked
            accessibilityLabel="Select all, checked"
            testID="select-all-checked"
          />
        </View>
        {Platform.OS === 'ios' ? (
          <Text style={[styles.note, { color: ink.muted }]}>
            The dash is `minus.circle.fill` on iOS, and `checked` outranks it on
            both platforms: the row below draws a check mark, not a dash. Only
            `iosStyle='switch'` reads the prop as off - that control has two
            positions.
          </Text>
        ) : null}

        <Text style={[styles.section, { color: ink.ink }]}>iOS styles</Text>
        <View style={styles.column}>
          <Checkbox label="Circle (default)" testID="style-circle" />
          <Checkbox
            label="Square"
            iosStyle="square"
            defaultChecked
            testID="style-square"
          />
          <Checkbox
            label="Switch (the previous look)"
            iosStyle="switch"
            defaultChecked
            testID="style-switch"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Disabled</Text>
        <View style={styles.column}>
          <Checkbox label="Off, disabled" disabled testID="disabled-off" />
          <Checkbox
            label="On, disabled"
            disabled
            checked
            testID="disabled-on"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Tint</Text>
        <View style={styles.column}>
          <Checkbox
            label="Tinted"
            defaultChecked
            tintColor="#b3005c"
            testID="tinted"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** One on-screen value the real-input suite reads. */
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
    <View style={styles.row}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      <Text testID={testID} style={[styles.value, { color: ink.ink }]}>
        {value}
      </Text>
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
  column: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  echoes: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
    gap: 12,
  },
  label: {
    fontSize: 13,
    flexShrink: 1,
  },
  value: {
    fontSize: 13,
    fontWeight: '600',
  },
});
