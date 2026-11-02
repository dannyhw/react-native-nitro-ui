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
import { TextField, type TextFieldHandle } from 'react-native-nitro-ui';

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

/** The text a field refuses to leave: every edit is reverted by the handshake. */
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

/** One labelled field in a grey well, the way a form draws an undecorated field. */
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
      <View style={[styles.well, { backgroundColor: ink.well }]}>
        {children}
      </View>
    </View>
  );
}

/**
 * Every TextField configuration G13 has to show, and the fields the real-input
 * suite types into (`CHECKS['text-field']` in `scripts/real-input/android.mjs`,
 * `testRealInputTextField` in `RealInputTests.swift`). Those checks find a field
 * by its `accessibilityLabel` and read only the `Text` below it, so every echo
 * has a testID and says what JS saw.
 */
export default function TextFieldScreen() {
  const ink = useInk();
  const topInset = useTopInset();

  const [typed, setTyped] = useState('');
  const [frozenEdits, setFrozenEdits] = useState(0);
  const [capped, setCapped] = useState('');
  const [focusCount, setFocusCount] = useState(0);
  const [blurCount, setBlurCount] = useState(0);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const focusRef = useRef<TextFieldHandle>(null);

  // Every edit is refused: JS keeps `FROZEN`, so the echo is what brings the
  // text back (docs/architecture/core.md §4).
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
        <Text style={[styles.title, { color: ink.ink }]}>TextField</Text>

        <Row title="Controlled">
          <TextField
            testID="text-typing"
            accessibilityLabel="Typing field"
            placeholder="Type here"
            autoCorrect={false}
            autoCapitalize="none"
            value={typed}
            onChangeText={setTyped}
          />
        </Row>
        <Text testID="text-typing-echo" style={{ color: ink.ink }}>
          {`typed: ${typed} (${String(typed.length)})`}
        </Text>

        <Row title="Refuses every edit">
          <TextField
            testID="text-frozen"
            accessibilityLabel="Frozen field"
            autoCorrect={false}
            autoCapitalize="none"
            value={FROZEN}
            onChangeText={refuseEdit}
          />
        </Row>
        <Text testID="text-frozen-echo" style={{ color: ink.ink }}>
          {`frozen: ${String(frozenEdits)} edits refused`}
        </Text>

        <Row title="maxLength 5">
          <TextField
            testID="text-capped"
            accessibilityLabel="Capped field"
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={5}
            value={capped}
            onChangeText={setCapped}
          />
        </Row>
        <Text testID="text-capped-echo" style={{ color: ink.ink }}>
          {`capped: ${capped} (${String(capped.length)})`}
        </Text>

        <Row title="Focus, blur and submit">
          <TextField
            ref={focusRef}
            testID="text-focus"
            accessibilityLabel="Focus field"
            placeholder="Return submits"
            returnKeyType="done"
            onFocus={noteFocus}
            onBlur={noteBlur}
            onSubmitEditing={setSubmitted}
          />
        </Row>
        <Text testID="text-focus-echo" style={{ color: ink.ink }}>
          {`focus: ${String(focusCount)} blur: ${String(blurCount)} submitted: ${
            submitted ?? '-'
          }`}
        </Text>
        <View style={styles.actions}>
          <Action
            label="Focus from JS"
            testID="text-focus-js"
            onPress={focusFromJs}
          />
          <Action
            label="Blur from JS"
            testID="text-blur-js"
            onPress={blurFromJs}
          />
        </View>

        <Row title="Password">
          <TextField
            testID="text-secure"
            accessibilityLabel="Password field"
            placeholder="Password"
            secureTextEntry
            defaultValue="hunter2"
          />
        </Row>

        <Row title="Email keyboard, no autocorrect">
          <TextField
            testID="text-email"
            accessibilityLabel="Email field"
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </Row>

        <Row title="Multi-line, grows with its text">
          <TextField
            testID="text-notes"
            accessibilityLabel="Notes field"
            placeholder="Notes"
            multiline
            value={notes}
            onChangeText={setNotes}
          />
        </Row>
        <Text testID="text-notes-echo" style={{ color: ink.muted }}>
          {`notes: ${String(notes.split('\n').length)} line(s)`}
        </Text>

        <Row title="Not editable">
          <TextField
            testID="text-readonly"
            accessibilityLabel="Read-only field"
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
  well: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
});
