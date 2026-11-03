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
import { Chip } from 'react-native-nitro-ui';

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

/** The uncontrolled filter row: each chip owns its own selection. */
const DIETS = ['Vegan', 'Vegetarian', 'Gluten-free', 'Nut-free'] as const;

/**
 * The Chip's example screen: the real-input block first, then filter chips
 * (controlled and not), assist chips with SF Symbols, the disabled pair, and a
 * caller's width that truncates the label.
 *
 * The README screenshots come from the top of this screen. The on-device
 * assertions live in `example/__tests__/Chip.harness.tsx`, which renders its own
 * trees.
 */
export default function ChipScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // The real-input suite's controls (`scripts/real-input`). Each echo is React's own
  // render, so it only moves if a real touch reached the hosted control, the control
  // told Nitro, and Nitro told JS.
  const [realSelected, setRealSelected] = useState(false);
  const [realEvents, setRealEvents] = useState(0);
  const onRealSelectedChange = useCallback((next: boolean) => {
    setRealSelected(next);
    setRealEvents((count) => count + 1);
  }, []);
  // The refusing parent: `selected` stays false, so every toggle is refused and has to
  // snap back. The last *requested* value is the oracle - a chip that kept the refused
  // selection would request `false` on the next tap, not `true` again.
  const [refusedLast, setRefusedLast] = useState('-');
  const [refusedEvents, setRefusedEvents] = useState(0);
  const onRefusedChange = useCallback((next: boolean) => {
    setRefusedLast(String(next));
    setRefusedEvents((count) => count + 1);
  }, []);
  // Shared by the enabled and the disabled assist chip, so a stray press on the
  // disabled one is a number on screen rather than the absence of a callback.
  const [realPresses, setRealPresses] = useState(0);
  const onRealPress = useCallback(() => {
    setRealPresses((count) => count + 1);
  }, []);

  const [sort, setSort] = useState(true);

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
          react-native-nitro-ui · Chip
        </Text>
        <Text style={styles.note}>
          SwiftUI Toggle(.button) and a bordered capsule Button on iOS, Material
          3 FilterChip and AssistChip on Android.
        </Text>

        {/*
          The real-input suite's block (`scripts/real-input`): a controlled filter chip,
          a refusing one, an assist chip, and a disabled chip of each kind wired to the
          same counters - so an OS tap on a disabled chip is a number that did not move.
          It is first on the page because `uiautomator dump` lists no off-screen nodes.
        */}
        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <View style={styles.wrapRow}>
          <Chip
            label="Real input"
            selected={realSelected}
            onSelectedChange={onRealSelectedChange}
            accessibilityLabel="Real-input chip"
            testID="real-input-chip"
          />
          <Chip
            label="Refusing"
            selected={false}
            onSelectedChange={onRefusedChange}
            accessibilityLabel="Real-input refusing chip"
            testID="real-input-chip-refusing"
          />
          <Chip
            label="Real input, disabled"
            disabled
            selected={realSelected}
            onSelectedChange={onRealSelectedChange}
            accessibilityLabel="Real-input disabled chip"
            testID="real-input-chip-disabled"
          />
        </View>
        <View style={styles.wrapRow}>
          <Chip
            variant="assist"
            label="Assist"
            onPress={onRealPress}
            accessibilityLabel="Real-input assist chip"
            testID="real-input-chip-assist"
          />
          <Chip
            variant="assist"
            label="Assist, disabled"
            disabled
            onPress={onRealPress}
            accessibilityLabel="Real-input disabled assist chip"
            testID="real-input-chip-assist-disabled"
          />
        </View>
        <View style={styles.echoes}>
          <Echo
            label="filter chip selected"
            testID="real-input-chip-value"
            value={realSelected ? 'on' : 'off'}
            ink={ink}
          />
          <Echo
            label="filter chip changes"
            testID="real-input-chip-events"
            value={String(realEvents)}
            ink={ink}
          />
          <Echo
            label="refused chip: last request"
            testID="real-input-chip-refused-last"
            value={refusedLast}
            ink={ink}
          />
          <Echo
            label="refused chip: requests"
            testID="real-input-chip-refused-events"
            value={String(refusedEvents)}
            ink={ink}
          />
          <Echo
            label="assist chip presses"
            testID="real-input-chip-presses"
            value={String(realPresses)}
            ink={ink}
          />
        </View>
        <Text style={[styles.section, { color: ink.ink }]}>Filter</Text>
        <View style={styles.wrapRow}>
          {DIETS.map((diet, index) => (
            <Chip
              key={diet}
              label={diet}
              defaultSelected={index === 0}
              testID={`diet-${diet}`}
            />
          ))}
        </View>
        <View style={styles.wrapRow}>
          <Chip
            label="Sort by distance"
            selected={sort}
            onSelectedChange={setSort}
            testID="filter-controlled"
          />
          <Text style={[styles.label, { color: ink.muted }]}>
            {sort ? 'sorted by distance' : 'sorted by name'}
          </Text>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Assist</Text>
        <View style={styles.wrapRow}>
          <Chip
            variant="assist"
            label="Add to calendar"
            systemImage="calendar.badge.plus"
            testID="assist-calendar"
          />
          <Chip
            variant="assist"
            label="Directions"
            systemImage="map"
            testID="assist-directions"
          />
          <Chip variant="assist" label="Share" testID="assist-share" />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Disabled</Text>
        <View style={styles.wrapRow}>
          <Chip label="Off" disabled testID="disabled-off" />
          <Chip label="On" disabled defaultSelected testID="disabled-on" />
          <Chip
            variant="assist"
            label="Assist"
            disabled
            testID="disabled-assist"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          Long label (truncates into a caller&apos;s box)
        </Text>
        <Chip
          label="Only show places that are open late on weekends"
          testID="long-label"
          style={styles.capped}
        />
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
  wrapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
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
    flex: 1,
    color: '#666',
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  // A caller's width wins over the measured size; the label truncates instead of
  // painting outside the box (docs/components/chip.md).
  capped: {
    width: 200,
  },
});
