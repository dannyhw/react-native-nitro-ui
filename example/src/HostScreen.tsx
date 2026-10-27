import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  Button,
  DatePicker,
  Host,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
} from 'react-native-nitro-ui';

/**
 * The `<Host>` screen.
 *
 * A Host gives its children **one** Compose composition instead of one each, and that
 * is the only thing this screen demonstrates: the same controls, batched and not
 * batched, on one screen, so the difference is something a person can toggle and feel
 * rather than a number in a report. `Host` is opt-in and Android-only - iOS is the
 * documented passthrough, permanently (D23's outcome) - so nothing here is hidden.
 *
 * It is also the screen the real-input suite taps. Every `host-*` testID and every
 * accessibility label on it is part of a gate (`scripts/real-input/`), not decoration:
 * `host-switch-*` / `host-slider` / `host-button*` / `host-mixed-*` are how a check
 * aims a real touch (Android reads the labels, iOS the identifiers), and
 * `host-controlled-value`, `host-events-count`, `host-slider-value`,
 * `host-button-presses` and `host-mixed-state` are the echoes it reads back. Renaming
 * one fails a suite on two platforms. The harness cases for the same behaviour are in
 * `example/__tests__/Host.harness.tsx`.
 */

/** Switches in the batch. Enough to see a composition's cost, few enough to scroll. */
const BATCH = 24;

/**
 * How long the popup Host waits to unmount its `DatePicker` once asked (H2b review M2).
 *
 * A real tap cannot reach the button while the dialog is up: an outside tap dismisses the
 * dialog rather than pressing what is behind it. So the removal has to be the app's own
 * doing, on a delay long enough for `scripts/real-input` to open the dialog first - the
 * same shape `PickerScreen`'s drop picker uses for a menu. Only the Android check arms
 * this, which is why the delay is Android's number, and why it is a generous one: between
 * the arm press and the press that opens the dialog the check has to scroll the field back
 * on screen and read a dump, and one accessibility dump costs about a second on a loaded
 * emulator. At 2500 the timer won that race — the field left the tree while the check was
 * still looking for it, which fails as "no control with accessibilityLabel Hosted date
 * picker" and reads like a broken Host but is a stopwatch. The check now waits for this
 * screen's own `field unmounted` echo instead of a guessed delay, so the delay only has to
 * be long enough never to fire before the dialog is up.
 */
const POP_DATE_DROP_MS = 9000;

/**
 * The row pitch a hosted `Switch` occupies, in dp.
 *
 * This is the sizing engine's answer for a Switch on Android, and a Host's `Column`
 * draws one row per child at that pitch. A Host with no `height` would be the sum of
 * its children's boxes (D24) — which for a batch this size means the layout is only
 * right while the declared sizes match what Compose draws, so the screen says the
 * height out loud the way `docs/components/host.md` tells apps to.
 */
const ROW = 48;

/** Text colours - `Text` has no dynamic default colour in RN. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    box: dark ? '#141414' : '#f2f2f4',
    link: dark ? '#7aa2ff' : '#3b82f6',
  };
}

export default function HostScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const [values, setValues] = useState<boolean[]>([false, true, false]);
  const [events, setEvents] = useState(0);

  // The batch: one counter for all of it, because the point is the batch, not a row.
  const [batchHosted, setBatchHosted] = useState(true);
  const [batchGeneration, setBatchGeneration] = useState(0);
  const [batchEvents, setBatchEvents] = useState(0);

  const setHosted = useCallback((index: number, next: boolean) => {
    setEvents((count) => count + 1);
    setValues((current) =>
      current.map((value, position) => (position === index ? next : value))
    );
  }, []);

  // A prop write with no touch at all: it has to reach a control that has no view
  // of its own to update, which is the other half of the handshake.
  const flipFirstFromJs = useCallback(
    () => setValues((current) => current.map((v, i) => (i === 0 ? !v : v))),
    []
  );

  const onBatchChange = useCallback(() => {
    setBatchEvents((count) => count + 1);
  }, []);

  // The Slider + Button Host (H2a). The two Buttons share one counter and both are
  // given `onPress`, which is what makes the disabled half of the real-input check
  // mean something: a library that let a disabled control press would move the number.
  const [hostSlider, setHostSlider] = useState(0.4);
  const [buttonPresses, setButtonPresses] = useState(0);
  const countHostPress = useCallback(() => {
    setButtonPresses((count) => count + 1);
  }, []);

  // The mixed Host: four kinds of control in one composition (brief item 5). The one
  // echo below it is what both real-input suites read, so it shows all three kinds of
  // answer at once - a switch state, a controlled value, a press count.
  const [mixedOn, setMixedOn] = useState(false);
  const [mixedValue, setMixedValue] = useState(0.5);
  const [mixedPresses, setMixedPresses] = useState(0);
  const countMixedPress = useCallback(() => {
    setMixedPresses((count) => count + 1);
  }, []);

  // The popup Host (H2b): the three controls that reach outside the box for a
  // window of their own. Each echo above the box is what a gate reads back; the
  // two `disable while open` switches exist because the ask is what happens to a
  // window on a control that can no longer answer.
  const [popSegmented, setPopSegmented] = useState(0);
  const [popPicker, setPopPicker] = useState(1);
  const [popOptions, setPopOptions] = useState(0);
  const [popDate, setPopDate] = useState(
    () => new Date(2026, 4, 17, 0, 0, 0, 0)
  );
  const [popPickerDisabled, setPopPickerDisabled] = useState(false);
  const [popDateDisabled, setPopDateDisabled] = useState(false);
  // The child-removal case: one hosted child leaving while its window is up, the others
  // staying where they are. `popDateDropArmed` is what a check waits for before it
  // trusts the timer - a tap that missed would otherwise read as a leaked dialog.
  const [popDateMounted, setPopDateMounted] = useState(true);
  const [popDateDropArmed, setPopDateDropArmed] = useState(false);
  const POP_CHOICE_SETS: string[][] = [
    ['Alpha', 'Beta', 'Gamma'],
    ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'],
  ];
  const popChoices = POP_CHOICE_SETS[popOptions] ?? POP_CHOICE_SETS[0] ?? [];

  const noteSegmented = useCallback((event: { index: number }) => {
    setPopSegmented(event.index);
  }, []);

  const notePicker = useCallback((event: { index: number }) => {
    setPopPicker(event.index);
  }, []);

  useEffect(() => {
    if (!popDateDropArmed) {
      return;
    }
    const timer = setTimeout(() => {
      setPopDateMounted(false);
      setPopDateDropArmed(false);
    }, POP_DATE_DROP_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [popDateDropArmed]);

  // Both halves of the comparison mount the same number of controls, at the same
  // pitch, in the same box - the only difference is who composes them.
  const batch = useMemo(
    () =>
      Array.from({ length: BATCH }, (_, index) => (
        <Switch
          key={index}
          defaultValue={index % 3 === 0}
          onValueChange={onBatchChange}
          testID={`batch-switch-${index}`}
          accessibilityLabel={`Batch switch ${String(index)}`}
        />
      )),
    [onBatchChange]
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
          react-native-nitro-ui · Host
        </Text>
        <Text style={[styles.note, { color: ink.muted }]}>
          Everything inside a Host is one Compose composition: N controls, one
          AndroidComposeView, one LayoutNode tree. Outside a Host each one
          brings its own. All seven controls can be hosted, including the three
          that open a popup or a dialog; on iOS a Host is a plain view today.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Three Switches, one composition
        </Text>
        <View style={[styles.hostBox, { backgroundColor: ink.box }]}>
          <Host style={styles.threeRows}>
            {values.map((value, index) => (
              <Switch
                key={index}
                value={value}
                onValueChange={(next) => {
                  setHosted(index, next);
                }}
                testID={`host-switch-${index}`}
                accessibilityLabel={`Hosted switch ${String(index)}`}
              />
            ))}
          </Host>
        </View>
        <Text style={[styles.note, { color: ink.muted }]}>
          The Host has a height; its children do not need one. A style on a
          hosted child moves the frame React Native computes, not what Compose
          draws.
        </Text>

        <Row label="first switch, as JS sees it">
          <Text
            testID="host-controlled-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {values[0] ? 'on' : 'off'}
          </Text>
        </Row>
        <Row label="changes JS has accepted">
          <Text
            testID="host-events-count"
            style={[styles.value, { color: ink.ink }]}
          >
            {events}
          </Text>
        </Row>
        <Pressable
          onPress={flipFirstFromJs}
          testID="host-js-toggle"
          hitSlop={8}
        >
          <Text style={[styles.link, { color: ink.link }]}>
            flip the first from JS
          </Text>
        </Pressable>

        <Text style={[styles.section, { color: ink.ink }]}>
          A Slider and a Button, one composition
        </Text>
        {/* The readouts sit above the box rather than below it because the
            real-input suite has to be able to read them after it has scrolled to the
            last control in the box: below, that scroll can push them off the screen
            and the check cannot see what its own tap did. */}
        <Row label="hosted Slider, as JS sees it">
          <Text
            testID="host-slider-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {hostSlider.toFixed(2)}
          </Text>
        </Row>
        <Row label="presses the hosted Buttons share">
          <Text
            testID="host-button-presses"
            style={[styles.value, { color: ink.ink }]}
          >
            {buttonPresses}
          </Text>
        </Row>
        <View style={[styles.hostBox, { backgroundColor: ink.box }]}>
          <Host style={styles.sliderButtonRows}>
            <Slider
              value={hostSlider}
              onValueChange={setHostSlider}
              testID="host-slider"
              accessibilityLabel="Hosted slider"
            />
            <Button
              title="Hosted action"
              onPress={countHostPress}
              accessibilityLabel="Hosted button"
              testID="host-button"
            />
            <Button
              title="Hosted action, disabled"
              disabled
              onPress={countHostPress}
              accessibilityLabel="Hosted disabled button"
              testID="host-button-disabled"
            />
          </Host>
        </View>
        <Text style={[styles.note, { color: ink.muted }]}>
          The Slider fills the Host&apos;s width - its own style would only move
          the frame React Native computes. The Buttons do not: an intrinsic
          control sits at the column&apos;s leading edge at the width its title
          needs (D24).
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Four kinds of control, one composition
        </Text>
        <Row label="mixed Host, as JS sees it">
          <Text
            testID="host-mixed-state"
            style={[styles.value, { color: ink.ink }]}
          >
            {mixedOn ? 'on' : 'off'} {mixedValue.toFixed(2)} {mixedPresses}
          </Text>
        </Row>
        <View style={[styles.hostBox, { backgroundColor: ink.box }]}>
          <Host style={styles.mixedRows}>
            <Switch
              value={mixedOn}
              onValueChange={setMixedOn}
              testID="host-mixed-switch"
              accessibilityLabel="Mixed switch"
            />
            <Slider
              value={mixedValue}
              onValueChange={setMixedValue}
              testID="host-mixed-slider"
              accessibilityLabel="Mixed slider"
            />
            <Progress
              value={0.35}
              testID="host-mixed-progress-linear"
              accessibilityLabel="Mixed linear progress"
            />
            <Progress
              variant="circular"
              value={0.65}
              testID="host-mixed-progress-circular"
              accessibilityLabel="Mixed circular progress"
            />
            <Button
              title="Mixed action"
              onPress={countMixedPress}
              accessibilityLabel="Mixed button"
              testID="host-mixed-button"
            />
          </Host>
        </View>
        <Text style={[styles.note, { color: ink.muted }]}>
          One Compose composition holds a switch, a slider, a bar, an indicator
          and a button, and each of them still answers on its own: recomposition
          stays per-child, so flipping the switch does not redraw the slider.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Popups and dialogs, one composition
        </Text>
        <Row label="hosted SegmentedControl, as JS sees it">
          <Text
            testID="host-segmented-index"
            style={[styles.value, { color: ink.ink }]}
          >
            {popSegmented}
          </Text>
        </Row>
        <Row label="hosted Picker, as JS sees it">
          <Text
            testID="host-picker-index"
            style={[styles.value, { color: ink.ink }]}
          >
            {popPicker}
          </Text>
        </Row>
        <Row label="hosted DatePicker, as JS sees it">
          <Text
            testID="host-datepicker-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {popDate.getFullYear()}-
            {String(popDate.getMonth() + 1).padStart(2, '0')}-
            {String(popDate.getDate()).padStart(2, '0')}
          </Text>
        </Row>
        <View style={[styles.actions, { borderColor: ink.box }]}>
          <Pressable
            onPress={() => setPopOptions((current) => (current === 0 ? 1 : 0))}
            testID="host-picker-change-options"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>
              {popOptions === 0 ? 'add two choices' : 'cut back to three'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPopPickerDisabled((current) => !current)}
            testID="host-picker-toggle-disabled"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>
              {popPickerDisabled ? 'enable the picker' : 'disable the picker'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPopDateDisabled((current) => !current)}
            testID="host-datepicker-toggle-disabled"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>
              {popDateDisabled ? 'enable the field' : 'disable the field'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPopDateDropArmed(true)}
            testID="host-datepicker-drop"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>
              {`Unmount the field in ${String(POP_DATE_DROP_MS / 1000)}s`}
            </Text>
          </Pressable>
          {/* The echo that says the press landed, and the one that says the child is
              gone. Same reasoning as `PickerScreen`'s drop picker: a check that armed a
              timer by pressing blind would read a missed tap as a dialog that outlived
              its own child. */}
          {popDateDropArmed ? (
            <Text
              testID="host-datepicker-drop-armed"
              style={[styles.note, { color: ink.muted }]}
            >
              unmount armed
            </Text>
          ) : null}
          {!popDateMounted ? (
            <>
              <Text
                testID="host-datepicker-drop-gone"
                style={[styles.note, { color: ink.muted }]}
              >
                field unmounted
              </Text>
              <Pressable
                onPress={() => setPopDateMounted(true)}
                testID="host-datepicker-drop-remount"
                hitSlop={4}
              >
                <Text style={[styles.link, { color: ink.link }]}>
                  Mount it again
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <View style={[styles.hostBox, { backgroundColor: ink.box }]}>
          <Host style={styles.popupRows}>
            <SegmentedControl
              options={['One', 'Two', 'Three']}
              selectedIndex={popSegmented}
              onChange={noteSegmented}
              testID="host-segmented"
              accessibilityLabel="Hosted segmented"
            />
            <Picker
              options={popChoices}
              selectedIndex={popPicker}
              onChange={notePicker}
              label="Hosted picker"
              accessibilityLabel="Hosted picker"
              testID="host-picker"
            />
            <Picker
              options={['Only choice']}
              defaultSelectedIndex={0}
              disabled
              label="Disabled picker"
              accessibilityLabel="Hosted disabled picker"
              testID="host-picker-disabled"
            />
            {popDateMounted ? (
              <DatePicker
                value={popDate}
                onChange={setPopDate}
                accessibilityLabel="Hosted date picker"
                testID="host-datepicker"
              />
            ) : null}
            <DatePicker
              defaultValue={popDate}
              disabled
              accessibilityLabel="Hosted disabled date picker"
              testID="host-datepicker-disabled"
            />
          </Host>
        </View>
        <Text style={[styles.note, { color: ink.muted }]}>
          The menu and the dialog are windows of their own, and they belong to
          this composition: each opens under the row the Host drew, and closing
          it is the same outside tap, back gesture or row that has always closed
          it. Disabling a control while its window is up closes it.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          {BATCH} Switches, {batchHosted ? 'in one Host' : 'each on its own'}
        </Text>
        <View style={[styles.actions, { borderColor: ink.box }]}>
          <Pressable
            onPress={() => setBatchHosted((current) => !current)}
            testID="host-batch-toggle"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>
              {batchHosted ? 'render unhosted' : 'render in a Host'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setBatchGeneration((generation) => generation + 1);
              setBatchEvents(0);
            }}
            testID="host-batch-rebuild"
            hitSlop={4}
          >
            <Text style={[styles.link, { color: ink.link }]}>rebuild</Text>
          </Pressable>
        </View>
        {batchHosted ? (
          <View
            key={`hosted-${String(batchGeneration)}`}
            style={[styles.hostBox, { backgroundColor: ink.box }]}
          >
            <Host style={styles.batchRows}>{batch}</Host>
          </View>
        ) : (
          <View
            key={`plain-${String(batchGeneration)}`}
            style={[styles.hostBox, { backgroundColor: ink.box }]}
          >
            {batch}
          </View>
        )}
        <Row label="switches on screen">
          <Text style={[styles.value, { color: ink.ink }]}>{BATCH}</Text>
        </Row>
        <Row label="compositions they cost">
          <Text
            testID="host-batch-compositions"
            style={[styles.value, { color: ink.ink }]}
          >
            {batchHosted ? '1' : String(BATCH)}
          </Text>
        </Row>
        <Row label="changes since the last rebuild">
          <Text
            testID="host-batch-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {batchEvents}
          </Text>
        </Row>
        <Text style={[styles.note, { color: ink.muted }]}>
          Rebuild unmounts the batch and mounts it again: the loop the leak gate
          measures, on a screen where you can watch it.
        </Text>
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
  root: { flex: 1 },
  page: { padding: 16, gap: 6 },
  title: { fontSize: 18, fontWeight: '600' },
  note: { color: '#888', marginBottom: 8 },
  section: {
    marginTop: 14,
    marginBottom: 2,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  // Only the box is Yoga's. What is inside it is placed by Compose, so these heights
  // are the one number RN gets right about a hosted control (D24) - module-level so a
  // re-render never hands the Host a style object with a new identity.
  threeRows: { width: '100%', height: 3 * ROW },
  // Generous rather than exact: a Host places from its top-leading edge and clips to
  // its box, so extra height is only ever empty space at the bottom, while a Host that
  // is too short loses a row. The Switch pitch (ROW) is the one the sizing engine
  // agrees with; a Slider, Button or Progress draws its own height inside the box it
  // is given, and RN does not know it (D24).
  sliderButtonRows: { width: '100%', height: 170 },
  mixedRows: { width: '100%', height: 280 },
  // Five rows of popup controls, generously: a Host clips to its box, so extra
  // height at the bottom is empty space while too little height loses a row.
  popupRows: { width: '100%', height: 300 },
  batchRows: { width: '100%', height: BATCH * ROW },
  hostBox: { borderRadius: 10, paddingVertical: 4 },
  actions: {
    flexDirection: 'row',
    gap: 16,
    // Wraps, because the popup section's row does not fit: its four links run past a
    // 1080-px screen, which clipped `Unmount the field in 2.5s` against the right edge
    // and laid the `unmount armed` / `field unmounted` echoes entirely outside the
    // window. A person could not read them either, but the cost is sharper than that:
    // `scripts/real-input`'s `hosted-date-picker` check waits on that echo to learn its
    // arm press landed, and a witness that is composed off-screen never appears in the
    // accessibility tree at all, so a press that worked read as a tap that missed.
    flexWrap: 'wrap',
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 34,
    gap: 12,
  },
  label: { flex: 1, color: '#666' },
  value: { fontVariant: ['tabular-nums'] },
  link: { color: '#3b82f6' },
});
