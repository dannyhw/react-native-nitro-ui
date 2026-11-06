import { useCallback, useRef, useState } from 'react';
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
import { SearchField, type SearchFieldHandle } from 'react-native-nitro-ui';

/** Text colours for the current appearance - the helper the other screens use. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    button: dark ? '#2c2c2e' : '#e5e5ea',
    well: dark ? '#1c1c1e' : '#f2f2f7',
  };
}

/** Android draws every app edge to edge and RN's `SafeAreaView` is iOS-only. */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/** The query a field refuses to leave: every edit is reverted by the handshake. */
const FROZEN = 'frozen';

/** A plain RN button, so a tap target is not itself a nitro-ui control. */
function Action({
  label,
  testID,
  onPress,
}: {
  label: string;
  testID: string;
  onPress: () => void;
}) {
  const ink = useInk();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={[styles.action, { backgroundColor: ink.button }]}
    >
      <Text style={{ color: ink.ink }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The search rows do not sit in a grey well: a search field brings its own
 * container with it (a Material 3 search bar, a bordered UIKit field), which a well
 * behind it would only muddy.
 */
function Row({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const ink = useInk();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowTitle, { color: ink.muted }]}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Every SearchField configuration G17 has to show, and the fields the real-input
 * suite types into (`CHECKS['search-field']` in `scripts/real-input/android.mjs`,
 * `testRealInputSearchField` in `RealInputTests.swift`). Those checks find a field by
 * its `accessibilityLabel` and read only the `Text` below it, so every echo has a
 * testID and says what JS saw.
 *
 * The focus row and its two buttons come first: a keyboard that is up covers the
 * lower half of the screen, and a button under it cannot be tapped.
 */
export default function SearchFieldScreen() {
  const ink = useInk();
  const topInset = useTopInset();

  const [typed, setTyped] = useState('');
  const [frozenEdits, setFrozenEdits] = useState(0);
  const [capped, setCapped] = useState('');
  const [focusCount, setFocusCount] = useState(0);
  const [blurCount, setBlurCount] = useState(0);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const focusRef = useRef<SearchFieldHandle>(null);

  // Every edit is refused: JS keeps `FROZEN`, so the echo is what brings the text
  // back (docs/architecture/core.md §4).
  const refuseEdit = useCallback(() => {
    setFrozenEdits((count) => count + 1);
  }, []);
  const noteFocus = useCallback(() => setFocusCount((count) => count + 1), []);
  const noteBlur = useCallback(() => setBlurCount((count) => count + 1), []);
  const focusFromJs = useCallback(() => focusRef.current?.focus(), []);
  const blurFromJs = useCallback(() => focusRef.current?.blur(), []);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ink.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: ink.ink }]}>SearchField</Text>

        <Row title="Focus, blur and submit">
          <SearchField
            ref={focusRef}
            testID="search-focus"
            accessibilityLabel="Focus search field"
            onFocus={noteFocus}
            onBlur={noteBlur}
            onSubmitEditing={setSubmitted}
          />
        </Row>
        <Text testID="search-focus-echo" style={{ color: ink.ink }}>
          {`focus: ${String(focusCount)} blur: ${String(blurCount)} submitted: ${
            submitted ?? '-'
          }`}
        </Text>
        <View style={styles.actions}>
          <Action
            label="Focus from JS"
            testID="search-focus-js"
            onPress={focusFromJs}
          />
          <Action
            label="Blur from JS"
            testID="search-blur-js"
            onPress={blurFromJs}
          />
        </View>

        <Row title="Controlled">
          <SearchField
            testID="search-typing"
            accessibilityLabel="Typing search field"
            value={typed}
            onChangeText={setTyped}
          />
        </Row>
        <Text testID="search-typing-echo" style={{ color: ink.ink }}>
          {`query: ${typed} (${String(typed.length)})`}
        </Text>

        <Row title="Refuses every edit">
          <SearchField
            testID="search-frozen"
            accessibilityLabel="Frozen search field"
            value={FROZEN}
            onChangeText={refuseEdit}
          />
        </Row>
        <Text testID="search-frozen-echo" style={{ color: ink.ink }}>
          {`frozen: ${String(frozenEdits)} edits refused`}
        </Text>

        <Row title="maxLength 5">
          <SearchField
            testID="search-capped"
            accessibilityLabel="Capped search field"
            maxLength={5}
            value={capped}
            onChangeText={setCapped}
          />
        </Row>
        <Text testID="search-capped-echo" style={{ color: ink.ink }}>
          {`capped: ${capped} (${String(capped.length)})`}
        </Text>

        <Row title="A placeholder of its own">
          <SearchField
            testID="search-custom"
            accessibilityLabel="Recipe search field"
            placeholder="Search recipes"
          />
        </Row>

        <Row title="Not editable">
          <SearchField
            testID="search-readonly"
            accessibilityLabel="Read-only search field"
            defaultValue="Shown, not editable"
            editable={false}
          />
        </Row>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 320, gap: 6 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  row: { gap: 4, marginTop: 8 },
  rowTitle: { fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
});
