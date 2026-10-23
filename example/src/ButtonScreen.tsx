import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance — same helper `SwitchScreen` uses.
 * `Text` gets no dynamic default colour from React Native, and the screen has to
 * read in both light and dark mode for the screenshots in `docs/components/`.
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

const VARIANTS: readonly ButtonVariant[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];

const SIZES: readonly ButtonSize[] = ['small', 'medium', 'large'];

/** The title of the button that changes on a timer, in order. */
const TICKER = ['Save', 'Saving…', 'Saved ✓'] as const;

/**
 * Every Button configuration G2 has to prove, on one screen: each variant at
 * each size, disabled, tinted, a long title, a title that changes on a timer,
 * a row of different-width buttons, and 200 buttons in a scrolling list.
 *
 * This is also the screen the screenshots in `docs/components/button.md` come
 * from. The on-device assertions live in
 * `example/__tests__/Button.harness.tsx`, which renders its own trees.
 */
export default function ButtonScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();
  const [presses, setPresses] = useState(0);
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTicker((current) => (current + 1) % TICKER.length);
    }, 1200);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const countPress = useCallback(() => {
    setPresses((current) => current + 1);
  }, []);

  // 200 buttons, cycling variants and sizes, so a recycled row is a different
  // configuration than its neighbour (the case `RecyclableView` exists for).
  const list = useMemo(
    () =>
      Array.from({ length: 200 }, (_, index) => ({
        id: `row-${index}`,
        title: `Row ${String(index + 1)}`,
        variant: VARIANTS[index % VARIANTS.length]!,
        size: SIZES[index % SIZES.length]!,
        disabled: index % 17 === 0,
      })),
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
          react-native-nitro-ui · Button
        </Text>
        <Text style={styles.note}>
          SwiftUI Button (.buttonStyle) on iOS, Material 3 Button /
          FilledTonalButton / OutlinedButton / TextButton / ElevatedButton on
          Android.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>Variants</Text>
        <View style={styles.stack}>
          {VARIANTS.map((variant) => (
            <Button
              key={variant}
              title={variant}
              variant={variant}
              onPress={countPress}
              testID={`variant-${variant}`}
            />
          ))}
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Sizes</Text>
        <View style={styles.stack}>
          {SIZES.map((size) => (
            <Button
              key={size}
              title={`${size} button`}
              size={size}
              testID={`size-${size}`}
            />
          ))}
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Disabled</Text>
        <View style={styles.wrapRow}>
          <Button title="Disabled" disabled testID="disabled-filled" />
          <Button
            title="Disabled tonal"
            variant="tonal"
            disabled
            testID="disabled-tonal"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Tinted</Text>
        <View style={styles.wrapRow}>
          <Button title="Tinted" tintColor="#FF5733" testID="tinted-filled" />
          <Button
            title="Tinted text"
            variant="text"
            tintColor="#FF5733"
            testID="tinted-text"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          SF Symbol (iOS)
        </Text>
        <View style={styles.wrapRow}>
          <Button
            title="Download"
            systemImage="arrow.down.circle"
            testID="symbol-download"
          />
          <Button
            title="Not a symbol"
            systemImage="this-symbol-does-not-exist"
            testID="symbol-unknown"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          Long title (truncates into a caller's box)
        </Text>
        <Button
          title="Save the document with a very long label that will not fit"
          testID="long-title"
          style={styles.capped}
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          Title changes on a timer
        </Text>
        <Button title={TICKER[ticker]!} testID="ticker" />

        <Text style={[styles.section, { color: ink.ink }]}>
          A row — each button is its own width
        </Text>
        <View style={styles.wrapRow}>
          <Button title="OK" onPress={countPress} testID="row-ok" />
          <Button title="Cancel" variant="text" testID="row-cancel" />
          <Button title="Save and continue" variant="tonal" testID="row-long" />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Presses</Text>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.muted }]}>
            taps counted (every enabled button above)
          </Text>
          <Text testID="press-count" style={[styles.value, { color: ink.ink }]}>
            {presses}
          </Text>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          200 in a scrolling list
        </Text>
        <View style={styles.list}>
          {list.map((row) => (
            <Button
              key={row.id}
              title={row.title}
              variant={row.variant}
              size={row.size}
              disabled={row.disabled}
              testID={row.id}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
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
  stack: {
    alignItems: 'flex-start',
    gap: 8,
  },
  wrapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
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
  // A caller's width wins over the measured size; the label truncates instead of
  // painting outside the box (docs/components/button.md).
  capped: {
    width: 180,
  },
  list: {
    alignItems: 'flex-start',
    gap: 2,
  },
});
