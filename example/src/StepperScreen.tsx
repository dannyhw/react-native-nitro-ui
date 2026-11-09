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
import { Stepper } from 'react-native-nitro-ui';

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
 * The Stepper's example screen: the real-input block first, then a quantity row
 * (the shape the control exists for: a stepper beside a number the app renders),
 * the controlled pair with a refusing parent, tenths, and the disabled pair.
 *
 * The README screenshots come from the Storybook story, not this screen. The
 * on-device assertions live in `example/__tests__/Stepper.harness.tsx`, which
 * renders its own trees.
 */
export default function StepperScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // The real-input suite's controls (`scripts/real-input`). The echo is React's own
  // render, so it only moves if a real touch reached the hosted control, the control
  // told Nitro, and Nitro told JS. The range is deliberately two steps wide: the
  // suite taps each half, then taps a half at its bound.
  const [realValue, setRealValue] = useState(1);
  const [realEvents, setRealEvents] = useState(0);
  const onRealValueChange = useCallback((next: number) => {
    setRealValue(next);
    setRealEvents((count) => count + 1);
  }, []);
  // The refusing parent: `value` never moves, so every step is refused and has to
  // snap back. The last *requested* value is the oracle - a stepper that kept the
  // refused value would ask for the next one, not repeat the refused one.
  const [refusedLast, setRefusedLast] = useState('-');
  const [refusedEvents, setRefusedEvents] = useState(0);
  const onRefusedValueChange = useCallback((next: number) => {
    setRefusedLast(String(next));
    setRefusedEvents((count) => count + 1);
  }, []);
  // The hold-to-repeat control, and the only stepper on this page that is wide
  // enough for one: `0...10` leaves five steps in the direction the check presses,
  // so "one press, several steps" is countable. The two-step stepper above is the
  // bounds fixture and cannot show a repeat at all — it runs out of range after one
  // step, which is the behaviour its own assertions are about.
  const [held, setHeld] = useState(5);
  const onHeldValueChange = useCallback((next: number) => {
    setHeld(next);
  }, []);
  // Shared by the enabled and the disabled stepper, so a stray tap on the disabled
  // one is a number on screen rather than the absence of a callback.
  const [disabledEvents, setDisabledEvents] = useState(0);
  const onDisabledValueChange = useCallback(() => {
    setDisabledEvents((count) => count + 1);
  }, []);

  const [quantity, setQuantity] = useState(2);
  const [volume, setVolume] = useState(5);
  const [tenths, setTenths] = useState(0);

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
          react-native-nitro-ui · Stepper
        </Text>
        <Text style={styles.note}>
          SwiftUI Stepper on iOS; two Material 3 tonal icon buttons on Android,
          which has no stepper control.
        </Text>

        {/*
          The real-input suite's block (`scripts/real-input`): a controlled stepper
          over a two-step range, a refusing one, and a disabled one wired to its own
          counter - so an OS tap on the disabled one is a number that did not move.
          It is first on the page because `uiautomator dump` lists no off-screen nodes.
        */}
        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <View style={styles.column}>
          <Stepper
            value={realValue}
            onValueChange={onRealValueChange}
            minimumValue={0}
            maximumValue={2}
            accessibilityLabel="Real-input stepper"
            testID="real-input-stepper"
          />
          <Stepper
            value={held}
            onValueChange={onHeldValueChange}
            minimumValue={0}
            maximumValue={10}
            accessibilityLabel="Real-input hold stepper"
            testID="real-input-stepper-hold"
          />
          <Stepper
            value={1}
            onValueChange={onRefusedValueChange}
            minimumValue={0}
            maximumValue={2}
            accessibilityLabel="Real-input refusing stepper"
            testID="real-input-stepper-refusing"
          />
          <Stepper
            value={realValue}
            onValueChange={onDisabledValueChange}
            disabled
            minimumValue={0}
            maximumValue={2}
            accessibilityLabel="Real-input disabled stepper"
            testID="real-input-stepper-disabled"
          />
        </View>
        <View style={styles.echoes}>
          <Echo
            label="stepper value"
            testID="real-input-stepper-value"
            value={String(realValue)}
            ink={ink}
          />
          <Echo
            label="hold stepper value"
            testID="real-input-stepper-hold-value"
            value={String(held)}
            ink={ink}
          />
          <Echo
            label="stepper changes"
            testID="real-input-stepper-events"
            value={String(realEvents)}
            ink={ink}
          />
          <Echo
            label="refused: last request"
            testID="real-input-stepper-refused-last"
            value={refusedLast}
            ink={ink}
          />
          <Echo
            label="refused: requests"
            testID="real-input-stepper-refused-events"
            value={String(refusedEvents)}
            ink={ink}
          />
          <Echo
            label="disabled: requests"
            testID="real-input-stepper-disabled-events"
            value={String(disabledEvents)}
            ink={ink}
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          A value the app shows
        </Text>
        <View style={styles.row}>
          <Text style={[styles.value, { color: ink.ink }]}>{quantity}</Text>
          <Stepper
            value={quantity}
            onValueChange={setQuantity}
            minimumValue={1}
            maximumValue={12}
            accessibilityLabel="Quantity"
            testID="quantity"
          />
        </View>
        <Text style={styles.note}>
          The control never draws the number - the app does, the way iOS apps do
          it.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>Controlled</Text>
        <View style={styles.column}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: ink.ink }]}>Volume</Text>
            <Stepper
              value={volume}
              onValueChange={setVolume}
              minimumValue={0}
              maximumValue={10}
              accessibilityLabel="Controlled stepper"
              testID="stepper-controlled"
            />
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: ink.ink }]}>
              Tenths (step 0.1)
            </Text>
            <Stepper
              value={tenths}
              onValueChange={setTenths}
              minimumValue={0}
              maximumValue={1}
              step={0.1}
              accessibilityLabel="Tenths stepper"
              testID="stepper-tenths"
            />
            <Text style={[styles.value, { color: ink.ink }]}>
              {tenths.toFixed(1)}
            </Text>
          </View>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Disabled</Text>
        <View style={styles.row}>
          <Stepper
            value={5}
            disabled
            minimumValue={0}
            maximumValue={10}
            accessibilityLabel="Disabled stepper"
            testID="stepper-disabled"
          />
          <Text style={[styles.muted, { color: ink.muted }]}>
            Both halves take the disabled style and report nothing.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Echo({
  label,
  testID,
  value,
  ink,
}: {
  label: string;
  testID: string;
  value: string;
  ink: { ink: string; muted: string };
}) {
  return (
    <View style={styles.echo}>
      <Text style={[styles.echoLabel, { color: ink.muted }]}>{label}</Text>
      <Text testID={testID} style={[styles.echoValue, { color: ink.ink }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { padding: 16, gap: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  note: { fontSize: 13 },
  section: { marginTop: 16, fontSize: 15, fontWeight: '600' },
  column: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 15 },
  value: { fontSize: 22, fontWeight: '600', minWidth: 44 },
  muted: { fontSize: 13 },
  echoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  echo: { gap: 2 },
  echoLabel: { fontSize: 11 },
  echoValue: { fontSize: 15, fontWeight: '600' },
});
