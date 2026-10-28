import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { nitroUiCore } from 'react-native-nitro-ui';

import {
  KEYBOARD_SECURE,
  KEYBOARD_SUBMITS,
} from '../../src/spike/TextField/keyboard';
import type { SpikeTextFieldHandle } from '../../src/spike/TextField/SpikeTextField';
import { SpikeTextField } from '../../src/spike/TextField/SpikeTextField';

/*
 * T18 spike screen — the TextField prototypes, on the example app's real view hierarchy
 * (`docs/tasks/T18-textfield-spike.md`).
 *
 * Not a component showcase: every control exists because a check reads it, and every assertion reads
 * **on-screen `Text`**, because that is all `uiautomator dump` and XCUITest's a11y query can see. That is
 * what lets the same scenario be proved on both platforms by the real-input runners, which are not allowed
 * to use a test hook — what they have to prove is that a keystroke delivered by the operating system
 * reaches a hosted Compose / SwiftUI field and comes back out through the handshake.
 *
 * The `spike-*` testIDs are the contract with `scripts/real-input/{android.mjs,controls.mjs}`,
 * `example/ios/NitroUiExampleUITests/RealInputTests.swift` (the typing oracle) and
 * `example/__tests__/TextFieldSpike.harness.tsx` (P1–P5).
 *
 * The spike itself is not imported from `react-native-nitro-ui` — it is not exported — so it is reached by
 * relative path, which Metro resolves through the package's source condition (`example/metro.config.js`).
 */

const iOS = Platform.OS === 'ios';

function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    border: dark ? '#3a3a3f' : '#d5d5da',
  };
}

function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/**
 * One spike field plus the on-screen line a real-input check reads.
 *
 * The line is `key=value` pairs: `typed=` is what JS was told, and the rest is `nuiTestState()`'s mirror —
 * native's own view of the same moment. A check that matched only `typed=` would pass a field that echoed
 * JS's state back at itself without native having been involved, which is exactly the failure mode Q2 §7's
 * P2 exists to catch, so the checks assert on the mirror keys as well.
 *
 * The mirror is refreshed from the events that change it rather than on a timer: `nuiTestState()` answers
 * from a cached string on the JS thread, so this is free, and a polling loop would keep a screen the perf
 * runs watch for idle from ever idling.
 */
function Field(props: {
  testID: string;
  echoID: string;
  label: string;
  arm: 'swiftui' | 'textfield';
  multiline?: boolean;
  maxLines?: number | null;
  maxLength?: number | null;
  keyboardHints?: number;
  defaultValue?: string;
  width?: number;
}) {
  const ref = useRef<SpikeTextFieldHandle | null>(null);
  const [mirror, setMirror] = useState('');
  const [text, setText] = useState(props.defaultValue ?? '');
  const [events, setEvents] = useState(0);
  const [focusEvents, setFocusEvents] = useState(0);
  const [blurEvents, setBlurEvents] = useState(0);
  const [submits, setSubmits] = useState(0);
  /*
   * Wall-clock of the last `onValueChange`, rendered into the echo line.
   *
   * P5's keystroke→commit number needs a timestamp from the app's own clock: the runner types from the device
   * shell, so host time and device time are two clocks and the difference between them is not a latency. The
   * echo is the only thing the runner can read, so the timestamp has to be in it — and the same number is
   * rendered for RN's `TextInput` below, which is what makes the two fields' numbers comparable.
   */
  const [lastChangeAt, setLastChangeAt] = useState(0);
  /*
   * The last few `onValueChange` timestamps, in one comma-joined list.
   *
   * P5's keystroke→commit number is per keystroke, and a runner that dumped the accessibility tree after every
   * character would spend longer in `uiautomator dump` (~300 ms on this emulator) than the thing it measures.
   * So the screen keeps the list and the runner types a whole burst, waits once, and dumps once. The timestamps
   * are the app's own clock, which on an emulator is the host's clock — the number is therefore
   * "keystroke sent → JS told", with the `adb shell input text` round trip inside it (the runner measures that
   * floor and prints it next to the result).
   */
  const [changeTimes, setChangeTimes] = useState<number[]>([]);

  const refresh = useCallback(() => {
    const view = ref.current;
    if (view != null) {
      setMirror(view.nuiTestState());
    }
  }, []);

  /*
   * One refresh shortly after mount, because the two halves of a hosted view do not become ready at the same
   * moment: `hybridRef` fires in the commit that creates the Fabric node, while the hosted SwiftUI / Compose
   * subtree — the thing that publishes the mirror — is composed on a later pass. So the mirror `hybridRef`'s
   * own `refresh()` reads is the empty string, and every check that reads the echo *before* the first
   * keystroke ("is this field actually hosted by Compose?") reads a line with no `impl=` in it. A wait is
   * not a hook: nothing is written, this only re-reads the cached line one beat later, which is the same
   * thing a person's first tap does.
   */
  useEffect(() => {
    const timer = setTimeout(refresh, 120);
    return () => clearTimeout(timer);
  }, [refresh]);

  return (
    <View
      style={
        props.width == null
          ? styles.field
          : { ...styles.field, width: props.width }
      }
    >
      <SpikeTextField
        testID={props.testID}
        iosImplementation={props.arm}
        accessibilityLabel={props.label}
        defaultValue={props.defaultValue ?? ''}
        multiline={props.multiline ?? false}
        maxLines={props.maxLines ?? null}
        maxLength={props.maxLength ?? null}
        keyboardHints={props.keyboardHints ?? 0}
        layoutWidth={props.width ?? null}
        onValueChange={(next) => {
          const at = Date.now();
          setText(next);
          setEvents((count) => count + 1);
          setLastChangeAt(at);
          setChangeTimes((previous) => [...previous.slice(-7), at]);
          refresh();
        }}
        onFocus={() => {
          setFocusEvents((count) => count + 1);
          refresh();
        }}
        onBlur={() => {
          setBlurEvents((count) => count + 1);
          refresh();
        }}
        onSubmitEditing={() => {
          setSubmits((count) => count + 1);
          refresh();
        }}
        hybridRef={(view) => {
          ref.current = view;
          refresh();
        }}
      />
      <Text testID={props.echoID} style={styles.mono} numberOfLines={4}>
        {`${props.testID} typed=${text} events=${String(events)} focus=${String(focusEvents)} blur=${String(blurEvents)} submits=${String(submits)} at=${String(lastChangeAt)} ats=${changeTimes.join(',')} ${mirror}`}
      </Text>
    </View>
  );
}

/**
 * A controlled field whose `value` JS never changes — the reject case, drivable by a keyboard.
 *
 * Q2 §2.1's "a rejected change reverts" is the handshake's central promise and the one case this harness
 * cannot create: a *programmatic* write is not an edit the control made, so applying one against a frozen
 * `value` exercises the control rule, not the revert. The revert needs an edit the field made itself, and the
 * only thing that makes one is a keystroke. So this field exists for the real-input runner to type into, and
 * it renders every counter the check reads: what JS was told, what native displays, and both event counters.
 * The revert is visible as `displayed` returning to `frozen` while `typed` stays what JS last accepted.
 */
function FrozenField() {
  const ref = useRef<SpikeTextFieldHandle | null>(null);
  const [mirror, setMirror] = useState('');
  const [text, setText] = useState('frozen');
  const [rejects, setRejects] = useState(0);

  const refresh = useCallback(() => {
    const view = ref.current;
    if (view != null) {
      setMirror(view.nuiTestState());
    }
  }, []);

  /*
   * Re-read the mirror a few times after an edit, because the thing the reject check waits for does not exist
   * yet at the moment the edit's own callback runs.
   *
   * `refresh()` inside `onValueChange` reads native's mirror *during* the callback: React has not committed,
   * so the line it caches still says `jsEvents=1` and `displayed=frozenq` — the pre-revert state — and nothing
   * else ever re-reads it. The revert happens in the commit that callback triggers, and a check watching the
   * echo would wait forever on a snapshot that can only get staler. Polling for a moment after each edit is
   * how the screen already handles the same thing on mount, and it is example-screen plumbing, not a native
   * seam.
   */
  const refreshSoon = useCallback(() => {
    for (const delay of [80, 200, 500, 1000]) {
      setTimeout(refresh, delay);
    }
  }, [refresh]);

  useEffect(() => {
    const timer = setTimeout(refresh, 120);
    return () => clearTimeout(timer);
  }, [refresh]);

  return (
    <View style={styles.field}>
      <SpikeTextField
        testID="spike-frozen"
        iosImplementation={iOS ? 'textfield' : 'swiftui'}
        accessibilityLabel="frozen field"
        value="frozen"
        onValueChange={() => {
          // The reject: state does not move, so React's next commit carries the same `value` plus a new
          // `mostRecentEventCount`, which is what tells native to put its own text back.
          setRejects((count) => count + 1);
          setText('frozen');
          refresh();
          refreshSoon();
        }}
        onFocus={refresh}
        onBlur={refresh}
        hybridRef={(view) => {
          ref.current = view;
          refresh();
        }}
      />
      <Text testID="spike-frozen-echo" style={styles.mono} numberOfLines={4}>
        {`spike-frozen typed=${text} events=${String(rejects)} ${mirror}`}
      </Text>
    </View>
  );
}

export default function SpikeTextFieldScreen() {
  const ink = useInk();
  const topInset = useTopInset();

  const [rnText, setRnText] = useState('');
  const [rnEvents, setRnEvents] = useState(0);
  const [rnLastAt, setRnLastAt] = useState(0);
  const [rnChangeTimes, setRnChangeTimes] = useState<number[]>([]);
  const [rnFocused, setRnFocused] = useState(0);

  const writeRef = useRef<SpikeTextFieldHandle | null>(null);
  const [writeEcho, setWriteEcho] = useState('write=');
  const multilineRef = useRef<SpikeTextFieldHandle | null>(null);
  const [sizeEcho, setSizeEcho] = useState(
    'sizes h=0.0 cache=0 meas=0 ledger=0'
  );

  const readWriteMirror = useCallback(() => {
    const view = writeRef.current;
    if (view != null) {
      setWriteEcho(`write=${view.nuiTestState()}`);
    }
  }, []);

  const reportSizes = useCallback(() => {
    // `cachedSizes` is a **count** of configurations (`NitroUiSizingStats`), not a map, so the cache's growth
    // is read as a delta across a known sequence of widths rather than by filtering keys — the engine does
    // not expose them. `measurements` and `ledgerEntries` travel with it because P4's claim is that the
    // bucketing bounds the *cache*, and a claim about the cache that quietly grew the ledger instead is
    // worth seeing in the same line.
    const stats = nitroUiCore.sizingStats();
    const height = multilineRef.current?.measureContent().height ?? 0;
    setSizeEcho(
      `sizes h=${height.toFixed(1)} cache=${String(stats.cachedSizes)} meas=${String(
        stats.measurements
      )} ledger=${String(stats.ledgerEntries)}`
    );
  }, []);

  return (
    <SafeAreaView
      style={[
        styles.root,
        { backgroundColor: ink.background, paddingTop: topInset },
      ]}
    >
      <StatusBar barStyle={iOS ? 'light-content' : 'dark-content'} />
      {/* `spike-screen` is the anchor every real-input check navigates by (`goToScreen` asks "am I already
          standing on the spike screen?" before tapping a tab), so it has to be on a node that is on-screen
          whatever else scrolled away. The ScrollView is that node; the root would work too, but the scroll
          view is the thing the checks actually interact with. */}
      <ScrollView
        testID="spike-screen"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---- 1. the typing targets: the oracle's subjects -------------------------------------- */}
        <Text style={[styles.section, { color: ink.ink }]}>Type here</Text>
        {/* SwiftUI's own `TextField` on iOS, and the one and only arm on Android. Q2 §7 P2's claim is that
            OS-level typing reaches *this* shape — the one no existing suite has ever typed into. */}
        <Field
          testID="spike-type-target"
          echoID="spike-type-target-echo"
          label="spike typing target"
          arm="swiftui"
        />
        {/* Arm B on iOS: a hosted `UITextField` beside it, in the same host type and the same screen, which
            is the coexistence half of P1. On Android the same prop value must give the same behaviour. */}
        <Field
          testID="spike-type-target-b"
          echoID="spike-type-target-b-echo"
          label="spike typing target b"
          arm={iOS ? 'textfield' : 'swiftui'}
        />

        {/* ---- 2. P3: a controlled write, and maxLength's boundary -------------------------------- */}
        <Text style={[styles.section, { color: ink.ink }]}>
          P3 — write + maxLength
        </Text>
        <View
          style={[styles.field, styles.bordered, { borderColor: ink.border }]}
        >
          <SpikeTextField
            testID="spike-write"
            iosImplementation={iOS ? 'textfield' : 'swiftui'}
            accessibilityLabel="write target"
            defaultValue=""
            maxLength={5}
            hybridRef={(view) => {
              writeRef.current = view;
            }}
          />
        </View>
        <Pressable
          testID="spike-apply-write"
          accessibilityLabel="apply write"
          onPress={() => {
            writeRef.current?.nuiTestApplyWrite('abcdef');
            // One hop for the main-thread write to land, then read the *cached* mirror. This is not a wait
            // on main: `nuiTestState()` is answered on the JS thread either way.
            setTimeout(readWriteMirror, 200);
          }}
        >
          <Text style={[styles.button, { color: ink.ink }]}>
            Apply write abcdef
          </Text>
        </Pressable>
        <Text
          testID="spike-write-echo"
          style={[styles.mono, { color: ink.muted }]}
        >
          {writeEcho}
        </Text>

        {/* ---- 2b. P3 §2.1: a rejected user edit, driven by the keyboard --------------------------- */}
        <Text style={[styles.section, { color: ink.ink }]}>
          P3 — rejected edit
        </Text>
        {/* Controlled with a value JS never changes, so anything the keyboard produces is an edit React
            rejects. The revert cannot be driven from JS (a programmatic write is not an edit the control made),
            so the real-input runner types into it with OS key events and reads the echo line. */}
        <FrozenField />

        {/* ---- 3. return key and secure entry ------------------------------------------------------ */}
        <Text style={[styles.section, { color: ink.ink }]}>Return key</Text>
        <Field
          testID="spike-submit"
          echoID="spike-submit-echo"
          label="submit field"
          arm={iOS ? 'textfield' : 'swiftui'}
          keyboardHints={KEYBOARD_SUBMITS}
        />
        <Text style={[styles.section, { color: ink.ink }]}>Secure</Text>
        <Field
          testID="spike-secure"
          echoID="spike-secure-echo"
          label="secure field"
          arm={iOS ? 'textfield' : 'swiftui'}
          keyboardHints={KEYBOARD_SECURE}
        />

        {/* ---- 4. P4: auto-grow and width-driven height ------------------------------------------- */}
        <Text style={[styles.section, { color: ink.ink }]}>P4 — sizing</Text>
        <Field
          testID="spike-multiline"
          echoID="spike-multiline-echo"
          label="multiline field"
          arm="swiftui"
          multiline
          maxLines={4}
        />
        {/* Four widths, each its own sizing-key bucket, so the cache's growth is countable rather than
            argued about (`sizingVariantFor` rounds the width to 16 units). */}
        {[120, 200, 280, 360].map((width) => (
          <Field
            key={width}
            testID={`spike-width-${String(width)}`}
            echoID={`spike-width-${String(width)}-echo`}
            label={`width ${String(width)} field`}
            arm="swiftui"
            multiline
            maxLines={5}
            width={width}
            defaultValue="the quick brown fox jumps over the lazy dog"
          />
        ))}
        <Pressable
          testID="spike-report-sizes"
          accessibilityLabel="report sizes"
          onPress={reportSizes}
        >
          <Text style={[styles.button, { color: ink.ink }]}>Report sizes</Text>
        </Pressable>
        <Text
          testID="spike-size-echo"
          style={[styles.mono, { color: ink.muted }]}
        >
          {sizeEcho}
        </Text>

        {/* ---- 5. P5: RN's own TextInput, in the same tree and the same run ----------------------- */}
        <Text style={[styles.section, { color: ink.ink }]}>
          P5 — RN TextInput control
        </Text>
        {/* Controlled, with its own echo, so the latency check can measure the same thing on both fields: the
            moment JS learned about a keystroke. RN's `TextInput` does not carry a native mirror, so `last=` is
            JS's own clock at the callback — which is exactly the number the spike field's `onValueChange`
            records, and why the two are comparable while a programmatic write would not be. */}
        <TextInput
          testID="rn-type-target"
          accessibilityLabel="rn typing target"
          style={[styles.rn, { color: ink.ink, borderColor: ink.border }]}
          value={rnText}
          onFocus={() => setRnFocused(1)}
          onBlur={() => setRnFocused(0)}
          onChangeText={(next) => {
            const at = Date.now();
            setRnText(next);
            setRnEvents((count) => count + 1);
            setRnLastAt(at);
            setRnChangeTimes((previous) => [...previous.slice(-7), at]);
          }}
        />
        <Text
          testID="rn-type-target-echo"
          style={[styles.mono, { color: ink.muted }]}
        >
          {`rn-type-target typed=${rnText} events=${String(rnEvents)} focused=${String(rnFocused)} at=${String(rnLastAt)} ats=${rnChangeTimes.join(',')}`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 12, gap: 8, paddingBottom: 320 },
  section: { fontSize: 12, fontWeight: '600', marginTop: 8 },
  field: { minHeight: 40 },
  bordered: { borderWidth: 1 },
  button: { padding: 8, fontSize: 14 },
  mono: { fontSize: 11 },
  rn: { borderWidth: 1, paddingHorizontal: 8, minHeight: 40, fontSize: 16 },
});
