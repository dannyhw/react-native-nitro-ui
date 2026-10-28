import { useCallback, useRef, useState } from 'react';
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

  const refresh = useCallback(() => {
    const view = ref.current;
    if (view != null) {
      setMirror(view.nuiTestState());
    }
  }, []);

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
          setText(next);
          setEvents((count) => count + 1);
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
        {`${props.testID} typed=${text} events=${String(events)} focus=${String(focusEvents)} blur=${String(blurEvents)} submits=${String(submits)} ${mirror}`}
      </Text>
    </View>
  );
}

export default function SpikeTextFieldScreen() {
  const ink = useInk();
  const topInset = useTopInset();

  const writeRef = useRef<SpikeTextFieldHandle | null>(null);
  const [writeEcho, setWriteEcho] = useState('write=');
  const multilineRef = useRef<SpikeTextFieldHandle | null>(null);
  const [sizeEcho, setSizeEcho] = useState('sizes h=0.0 cache=0 spike=0');

  const readWriteMirror = useCallback(() => {
    const view = writeRef.current;
    if (view != null) {
      setWriteEcho(`write=${view.nuiTestState()}`);
    }
  }, []);

  const reportSizes = useCallback(() => {
    const stats = nitroUiCore.sizingStats();
    const keys = Object.keys(stats.cachedSizes ?? {});
    const spike = keys.filter((key) => key.includes('NitroUiSpikeTextField'));
    const height = multilineRef.current?.measureContent().height ?? 0;
    setSizeEcho(
      `sizes h=${height.toFixed(1)} cache=${String(keys.length)} spike=${String(spike.length)}`
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
      <ScrollView
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
          style={[styles.field, { borderColor: ink.border, borderWidth: 1 }]}
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
        <TextInput
          testID="rn-type-target"
          accessibilityLabel="rn typing target"
          style={[styles.rn, { color: ink.ink, borderColor: ink.border }]}
          defaultValue=""
        />
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
  button: { padding: 8, fontSize: 14 },
  mono: { fontSize: 11 },
  rn: { borderWidth: 1, paddingHorizontal: 8, minHeight: 40, fontSize: 16 },
});
