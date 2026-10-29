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
import { Picker } from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance — the same helper `ButtonScreen` and
 * `SegmentedControlScreen` use. `Text` gets no dynamic default colour from React
 * Native, and the screen has to read in both light and dark mode for the
 * screenshots in `docs/components/`.
 */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    field: dark ? '#1c1c1e' : '#f2f2f7',
  };
}

/** Android draws every app edge to edge and RN's `SafeAreaView` is iOS-only. */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/**
 * The option list that rotates on a timer: three different widths *and* three
 * different lengths, so both the selected title and the number of choices move
 * under the control (`nuiSizingKey` covers both).
 */
const OPTION_SETS: readonly string[][] = [
  ['One', 'Two', 'Three'],
  ['January', 'February'],
  ['Yes', 'No'],
];

/**
 * The real-input controls' options.
 *
 * Three words that appear nowhere else on this screen, which the checks need twice
 * over: `scripts/real-input` decides whether the popup is open by looking for the
 * text of the row it is about to tap, so an option that another row also paints as
 * its own title (`'Two'`, say, which the disabled row shows) would read as an open
 * popup forever. And the last one is longer than the first on purpose - the main
 * control below is *uncontrolled*, so choosing it moves the painted title with no
 * React render, and the box has to follow on the native measure signal alone.
 */
const REAL_INPUT_OPTIONS = [
  'Onyx',
  'Quartz',
  'A considerably longer mineral name',
];

/**
 * The refusing parent's options - a fourth set of words nobody else paints.
 *
 * The check's popup oracle counts how many nodes carry a given title (one is the
 * anchor's own text, two means a popup is open), which only separates the two
 * controls on this screen if their titles do not overlap.
 */
const REJECT_OPTIONS = ['Summit', 'Ridge', 'Valley'];

/**
 * The options of the row that gets unmounted while its menu is open.
 *
 * Different words again, for the same reason: after the unmount the check asserts
 * that none of these strings is on screen any more, which is only evidence about
 * the popup if the row itself is the only thing that ever draws them.
 */
const DROP_OPTIONS = ['Alpha', 'Beta', 'Gamma'];

/**
 * The options of the disabled / enabled pair - a fourth set of private words.
 *
 * These two rows are the check for "a disabled Picker refuses a real touch", and
 * on iOS the witness is the *absence* of an option's text: an open menu is the
 * only thing that can put 'Cinder' on screen. The pair used to share 'One' with
 * the rotating list below, where 200 rows paint 'One' as their own title, so the
 * absence could never be read there (measured: 134 matches with nothing open).
 */
const PAIR_OPTIONS = ['Cinder', 'Mica', 'Shale'];

/** How long the "drop while open" row stays mounted after the button is tapped. */
// Platform-split, because the two platforms are in different moods about a popup.
//
// Android: the popup is a real window and the app keeps running, so the delay only
// has to outlast one `uiautomator dump` (~0.5-1s under load) - and it must be
// *short*, because the point of the check is that the unmount lands with the popup
// still up. A tap elsewhere would only have dismissed the popup; the unmount has to
// be what finishes it.
//
// iOS: a presented menu keeps the app's own work queued behind it (the check prints
// the evidence), so nothing React does reaches the screen until the menu closes -
// and an XCUITest tap on the anchor lands 2-3s after the press that armed this
// timer, element queries being that slow. The delay therefore has to outlast the
// check's own reading of the open menu, or the row disappears out from under the tap
// that is meant to close the menu.
//
// Android's number used to be 2500, which was enough when the check pressed this
// button and the anchor back to back with nothing in between. It now proves the arm
// press landed before aiming at the anchor - the same screen's own echo, read out of
// the accessibility tree, because a swallowed tap used to leave nothing scheduled and
// the check read the Picker's survival as a leaked menu. That proof costs a dump, a
// dump is about two seconds on a loaded emulator, and the check needs one more after
// it to find the anchor. So both platforms now get the same generous window; the
// check waits for the `picker unmounted` echo rather than a guessed delay either way.
const DROP_DELAY_MS = 12000;

/**
 * Every Picker configuration G6 has to prove, on one screen: a real tap pair, a
 * rejecting parent, a row that can be unmounted with its menu open, controlled and
 * uncontrolled selection, options changing on a timer, disabled, tinted, a menu
 * too wide for its box, the wheel variant, and 200 pickers in a scrolling list.
 *
 * This is also the screen the screenshots in `docs/components/picker.md` come
 * from. The on-device assertions live in
 * `example/__tests__/Picker.harness.tsx`, which renders its own trees.
 */
export default function PickerScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // The pair `scripts/real-input` reads. All of the real-input rows are at the top
  // of the page because `uiautomator dump` lists no off-screen nodes, so a control
  // near the bottom would have nothing to aim a tap at.
  const [realIndex, setRealIndex] = useState('-');
  const [realEvents, setRealEvents] = useState(0);
  const [rejectEvents, setRejectEvents] = useState(0);
  // Pinned: the parent never moves it, so choosing in the popup has to snap back
  // natively. `rejectEvents` is what proves the choice was reported at all.
  const [rejectIndex] = useState(0);

  const [controlled, setControlled] = useState(1);
  const [changes, setChanges] = useState(0);
  const [optionsTick, setOptionsTick] = useState(0);

  // The "drop while open" row: tapping the button schedules an unmount, which
  // leaves the window `scripts/real-input` uses to open the menu first. The
  // check needs a delay rather than an instant unmount because a second real tap
  // outside an open menu would only dismiss it - the unmount has to be what
  // finishes the popup.
  const [dropMounted, setDropMounted] = useState(true);
  const [dropScheduled, setDropScheduled] = useState(false);

  useEffect(() => {
    if (!dropScheduled) {
      return;
    }
    const timer = setTimeout(() => {
      setDropMounted(false);
      setDropScheduled(false);
    }, DROP_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [dropScheduled]);

  useEffect(() => {
    const timer = setInterval(() => {
      setOptionsTick((current) => (current + 1) % OPTION_SETS.length);
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const countRealChange = useCallback((event: { index: number }) => {
    setRealEvents((current) => current + 1);
    setRealIndex(String(event.index));
  }, []);

  const countRejectChange = useCallback(() => {
    setRejectEvents((current) => current + 1);
  }, []);

  const acceptChange = useCallback((event: { index: number }) => {
    setChanges((current) => current + 1);
    setControlled(event.index);
  }, []);

  const options = OPTION_SETS[optionsTick] ?? OPTION_SETS[0]!;

  // 200 pickers, cycling option lists and selection, so a recycled row is a
  // different configuration than its neighbour (the case `RecyclableView` exists
  // for) and a recycled popup starts closed.
  const list = useMemo(
    () =>
      Array.from({ length: 200 }, (_, index) => ({
        id: `row-${index}`,
        options: OPTION_SETS[index % OPTION_SETS.length]!,
        selectedIndex: index % 3,
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
          react-native-nitro-ui · Picker
        </Text>

        <Text style={[styles.section, { color: ink.muted }]}>
          Real input (scripts/real-input reads these)
        </Text>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>Controlled</Text>
          <Picker
            options={REAL_INPUT_OPTIONS}
            defaultSelectedIndex={0}
            onChange={countRealChange}
            testID="real-input-picker"
            accessibilityLabel="Real-input picker"
          />
          {/* Separate `Text`s, not one line with nested children: React Native
              renders a nested `Text` inline inside its parent, so on Android it
              never becomes its own view and never carries a `resource-id` - which
              is the only way `scripts/real-input/android.mjs` can find an echo. */}
          <Text style={[styles.readout, { color: ink.muted }]}>
            last index reported
          </Text>
          <Text
            testID="real-input-picker-index"
            style={[styles.value, { color: ink.ink }]}
          >
            {realIndex}
          </Text>
          <Text style={[styles.readout, { color: ink.muted }]}>changes</Text>
          <Text
            testID="real-input-picker-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {realEvents}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>
            Refusing parent (pinned at 0)
          </Text>
          <Picker
            options={REJECT_OPTIONS}
            selectedIndex={rejectIndex}
            onChange={countRejectChange}
            testID="real-input-picker-reject"
            accessibilityLabel="Real-input rejecting picker"
          />
          <Text style={[styles.readout, { color: ink.muted }]}>changes</Text>
          <Text
            testID="real-input-reject-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {rejectEvents}
          </Text>
          <Text style={[styles.readout, { color: ink.muted }]}>
            parent sends
          </Text>
          <Text
            testID="real-input-reject-value"
            style={[styles.value, { color: ink.ink }]}
          >
            {rejectIndex}
          </Text>
        </View>

        {dropMounted ? (
          <View style={styles.row}>
            <Text style={[styles.label, { color: ink.ink }]}>
              Dropped while open
            </Text>
            <Picker
              options={DROP_OPTIONS}
              defaultSelectedIndex={0}
              testID="real-input-drop-picker"
              accessibilityLabel="Real-input drop picker"
            />
            <Pressable
              onPress={() => setDropScheduled(true)}
              testID="real-input-drop-button"
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: ink.field }]}
            >
              <Text style={[styles.buttonLabel, { color: ink.ink }]}>
                {`Unmount the picker above in ${String(DROP_DELAY_MS / 1000)}s`}
              </Text>
            </Pressable>
            {/* The echo that says this press landed. A synthesized tap can miss,
                and a check that armed the unmount by pressing blind would then read
                the Picker's survival as the library leaking a menu (observed once
                while developing this screen). With the echo the check waits for the
                press instead of assuming it, and the row's disappearance afterwards
                is evidence about the unmount. */}
            {dropScheduled ? (
              <Text
                testID="real-input-drop-armed"
                style={[styles.note, { color: ink.muted }]}
              >
                unmount armed
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.row}>
            <Text
              testID="real-input-drop-gone"
              style={[styles.note, { color: ink.muted }]}
            >
              picker unmounted
            </Text>
            <Pressable
              onPress={() => {
                setDropMounted(true);
              }}
              testID="real-input-drop-remount"
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: ink.field }]}
            >
              <Text style={[styles.buttonLabel, { color: ink.ink }]}>
                Mount it again
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={[styles.section, { color: ink.muted }]}>Selection</Text>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>Controlled</Text>
          <Picker
            options={['Small', 'Medium', 'Large']}
            selectedIndex={controlled}
            onChange={acceptChange}
            label="Size"
            testID="controlled-basic"
          />
          <Text style={[styles.readout, { color: ink.muted }]}>
            changes{' '}
            <Text testID="change-count" style={styles.value}>
              {changes}
            </Text>
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>
            Uncontrolled, starts at index 1
          </Text>
          <Picker
            options={['Small', 'Medium', 'Large']}
            defaultSelectedIndex={1}
            label="Size"
            testID="uncontrolled-default"
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>
            Options change every 2s
          </Text>
          <Picker options={options} label="Choice" testID="ticker-options" />
        </View>

        <Text style={[styles.section, { color: ink.muted }]}>
          Disabled · tinted · wheel
        </Text>
        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>Disabled</Text>
          <Picker
            options={PAIR_OPTIONS}
            selectedIndex={1}
            disabled
            label="Locked"
            accessibilityLabel="Real-input disabled picker"
            testID="disabled-one"
          />
          <Picker
            options={PAIR_OPTIONS}
            selectedIndex={1}
            label="Open"
            accessibilityLabel="Real-input enabled picker"
            testID="enabled-one"
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>Tinted</Text>
          <Picker
            options={['One', 'Two', 'Three']}
            selectedIndex={2}
            tintColor="#FF3B30"
            label="Menu"
            testID="tinted-menu"
          />
          <Picker
            options={['One', 'Two', 'Three']}
            selectedIndex={0}
            variant="wheel"
            tintColor="#34C759"
            label="Wheel"
            testID="tinted-wheel"
          />
        </View>

        <View style={styles.row}>
          <Text style={[styles.label, { color: ink.ink }]}>
            Wheel, full width
          </Text>
          <Picker
            options={['January', 'February', 'March', 'April']}
            defaultSelectedIndex={2}
            variant="wheel"
            testID="wheel-basic"
          />
        </View>

        <Text style={[styles.section, { color: ink.muted }]}>
          Too wide for its box (fits it, C1)
        </Text>
        <View style={styles.narrowBox}>
          <Picker
            options={[
              'A really long choice that cannot fit this box at all',
              'Short',
            ]}
            selectedIndex={0}
            label="Long"
            testID="long-labels"
          />
        </View>

        <Text style={[styles.section, { color: ink.muted }]}>
          200 in a list (recycling)
        </Text>
        {list.map((row) => (
          <View key={row.id} style={styles.listRow}>
            <Text style={[styles.listLabel, { color: ink.muted }]}>
              {row.id}
            </Text>
            <Picker
              options={row.options}
              selectedIndex={row.disabled ? 0 : row.selectedIndex}
              disabled={row.disabled}
              testID={row.id}
            />
          </View>
        ))}
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
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  section: {
    fontSize: 12,
    letterSpacing: 0.4,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  row: {
    gap: 6,
  },
  label: {
    fontSize: 15,
  },
  readout: {
    fontSize: 13,
  },
  value: {
    fontWeight: '700',
  },
  note: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  button: {
    borderRadius: 8,
    paddingVertical: 10,
  },
  buttonLabel: {
    fontSize: 15,
    textAlign: 'center',
  },
  narrowBox: {
    width: 180,
  },
  listRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
  },
  listLabel: {
    fontSize: 12,
    minWidth: 58,
  },
});
