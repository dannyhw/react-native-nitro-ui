import { useCallback, useMemo, useRef, useState } from 'react';
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
import { Slider } from 'react-native-nitro-ui';

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
 * iOS safe area, so the top inset has to be added by hand.
 */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/** Busy-wait the JS thread, to make the app's handler slower than a drag. */
function blockJs(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Deliberately spinning: the point is that JS is not available to React.
  }
}

/**
 * Every Slider configuration this task has to prove, on one screen:
 * controlled, uncontrolled, stepped, a range that does not end on a step,
 * disabled, tinted, a handler slower than the drag, and 200 sliders in a
 * scrolling list (the case `RecyclableView` exists for).
 *
 * `react-native-harness` drives the same screen in `__tests__/Slider.harness.tsx`
 * through these testIDs.
 */
export default function SliderScreen() {
  const ink = useInk();
  const [controlled, setControlled] = useState(0.25);
  const [rejections, setRejections] = useState(0);
  const [slowMs, setSlowMs] = useState(0);
  const [events, setEvents] = useState(0);
  const [lastComplete, setLastComplete] = useState<number | null>(null);

  // Native moves the thumb, then reverts it: JS never accepts the change, so the
  // event-count handshake is what brings the value back.
  const rejectChange = useCallback(() => {
    setRejections((count) => count + 1);
  }, []);

  // The slow handler is the case frame coalescing exists for: native keeps the
  // thumb under the finger and emits at most one event per frame however long JS
  // takes to get through the last one.
  const slowChange = useCallback(
    (value: number) => {
      setEvents((count) => count + 1);
      setLastComplete(value);
      if (slowMs > 0) blockJs(slowMs);
    },
    [slowMs]
  );

  const list = useMemo(
    () =>
      Array.from({ length: 200 }, (_, index) => ({
        id: `row-${index}`,
        value: (index % 11) / 10,
      })),
    []
  );

  const shown = useRef(0);
  shown.current = controlled;

  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

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
          react-native-nitro-ui · Slider
        </Text>
        <Text style={styles.note}>
          SwiftUI Slider on iOS, Material 3 Slider on Android. The drag is owned
          natively: the thumb never waits for JS.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>Controlled</Text>
        <Slider
          value={controlled}
          onValueChange={setControlled}
          testID="slider-controlled"
          accessibilityLabel="Controlled slider"
        />
        <Row label="value JS has">
          <Text
            testID="slider-controlled-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {controlled.toFixed(3)}
          </Text>
        </Row>
        <Pressable
          onPress={() => setControlled(0.5)}
          testID="js-set-half"
          hitSlop={8}
        >
          <Text style={styles.link}>set 0.5 from JS</Text>
        </Pressable>

        <Text style={[styles.section, { color: ink.ink }]}>Uncontrolled</Text>
        <Slider defaultValue={0.4} testID="slider-uncontrolled" />
        <Row label="defaultValue={0.4} · JS renders">
          <Text style={[styles.value, { color: ink.muted }]}>never</Text>
        </Row>

        <Text style={[styles.section, { color: ink.ink }]}>Range and step</Text>
        <Slider
          minimumValue={-5}
          maximumValue={5}
          step={1}
          defaultValue={2}
          testID="slider-stepped"
        />
        <Row label="-5...5 step 1">
          <Text style={[styles.value, { color: ink.muted }]}>whole only</Text>
        </Row>
        <Slider
          minimumValue={0}
          maximumValue={1}
          step={0.3}
          testID="slider-uneven-step"
        />
        <Row label="0...1 step 0.3 · maximum stays reachable">
          <Text style={[styles.value, { color: ink.muted }]}>
            0 · 0.3 · 0.6 · 1
          </Text>
        </Row>
        <Slider
          minimumValue={0}
          maximumValue={120}
          step={5}
          defaultValue={72}
          tintColor="#E0457B"
          testID="slider-bounded"
        />
        <Row label="0...120 step 5, tinted">
          <Text style={[styles.value, { color: ink.muted }]}>72</Text>
        </Row>

        <Text style={[styles.section, { color: ink.ink }]}>
          Rejected change
        </Text>
        <Slider
          value={0.2}
          onValueChange={rejectChange}
          testID="slider-rejected"
        />
        <Row label="events JS saw">
          <Text
            testID="slider-rejected-count"
            style={[styles.value, { color: ink.ink }]}
          >
            {rejections}
          </Text>
        </Row>

        <Text style={[styles.section, { color: ink.ink }]}>Styles</Text>
        <Slider disabled defaultValue={0.6} testID="slider-disabled" />
        <Row label="disabled">
          <Text style={[styles.value, { color: ink.muted }]}>inert</Text>
        </Row>
        <Slider defaultValue={0.5} tintColor="#7C4DFF" testID="slider-tinted" />
        <Row label="tintColor">
          <Text style={[styles.value, { color: ink.muted }]}>#7C4DFF</Text>
        </Row>
        <View style={styles.sizedBox}>
          <Slider
            defaultValue={0.3}
            testID="slider-sized"
            style={styles.sizedSlider}
          />
        </View>
        <Row label="style width 180, height 60">
          <Text style={[styles.value, { color: ink.muted }]}>box wins</Text>
        </Row>

        <Text style={[styles.section, { color: ink.ink }]}>Slow JS</Text>
        <Slider
          defaultValue={0.5}
          onValueChange={slowChange}
          testID="slider-slow"
        />
        <Row label="handler cost">
          <Pressable
            onPress={() => setSlowMs((ms) => (ms > 0 ? 0 : 120))}
            testID="js-toggle-slow"
            hitSlop={8}
          >
            <Text style={styles.link}>
              {slowMs > 0 ? `${slowMs}ms — turn off` : '0ms — make it 120ms'}
            </Text>
          </Pressable>
        </Row>
        <Row label="events JS handled">
          <Text
            testID="slider-slow-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {events}
          </Text>
        </Row>
        <Row label="last value">
          <Text
            testID="slider-slow-last"
            style={[styles.value, { color: ink.ink }]}
          >
            {lastComplete === null ? '—' : lastComplete.toFixed(3)}
          </Text>
        </Row>

        <Text style={[styles.section, { color: ink.ink }]}>200 in a list</Text>
        <View style={styles.list}>
          {list.map((row, index) => (
            <View key={row.id} style={styles.listRow}>
              <Text style={[styles.listLabel, { color: ink.muted }]}>
                {index}
              </Text>
              <Slider
                defaultValue={row.value}
                testID={`slider-list-${index}`}
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
    minHeight: 22,
    gap: 12,
  },
  label: {
    flex: 1,
    color: '#666',
    fontSize: 12,
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  link: {
    color: '#3b82f6',
  },
  // A user style wins over the platform default box; the control fills the width
  // it is given and keeps its own height (docs/components/slider.md).
  sizedBox: {
    alignItems: 'flex-start',
  },
  sizedSlider: {
    width: 180,
    height: 60,
  },
  list: {
    gap: 2,
  },
  listRow: {
    gap: 2,
  },
  listLabel: {
    fontSize: 11,
  },
});
