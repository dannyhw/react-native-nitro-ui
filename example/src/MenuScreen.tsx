import { useCallback, useMemo, useState } from 'react';
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
  Menu,
  type ButtonSize,
  type ButtonVariant,
  type MenuGroup,
} from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance — same helper `ButtonScreen` uses.
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

/**
 * The rows of the real-input menu, spelled as `CHECKS.menu` and
 * `testRealInputMenu` spell them.
 *
 * None of the three titles appears anywhere else on this screen, which is what lets
 * a text match name one popup row rather than some other text on screen (the same
 * rule `PickerScreen`'s `REAL_INPUT_OPTIONS` follows). `Locked row` is disabled, so
 * it is the row a check proves takes no pick.
 */
const REAL_INPUT_GROUP: MenuGroup = {
  actions: [
    { id: 'alpha', title: 'Alpha' },
    { id: 'bravo', title: 'Bravo' },
    { id: 'locked', title: 'Locked row', disabled: true },
  ],
};

/** The rows the "group changes" block can take away and put back. */
const OPTIONAL_ROW = { id: 'extra', title: 'Extra row' };

/**
 * Every Menu configuration G7a has to show, on one screen: each variant at each
 * size, disabled, tinted, a long title, an SF Symbol (iOS), sections, a submenu, a
 * primary action (iOS), and a `group` whose rows come and go while the control
 * stays mounted.
 *
 * This is also the screen the screenshots in `docs/components/menu.md` come from.
 * The on-device assertions live in `example/__tests__/Menu.harness.tsx`, which
 * renders its own trees.
 */
export default function MenuScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();
  const [picked, setPicked] = useState<string | null>(null);
  const [opens, setOpens] = useState(0);
  const [closes, setCloses] = useState(0);
  const [primary, setPrimary] = useState(0);
  const [extraRow, setExtraRow] = useState(true);

  const recordSelect = useCallback((id: string) => {
    setPicked(id);
  }, []);
  const recordOpen = useCallback(() => {
    setOpens((current) => current + 1);
  }, []);
  const recordClose = useCallback(() => {
    setCloses((current) => current + 1);
  }, []);
  const recordPrimary = useCallback(() => {
    setPrimary((current) => current + 1);
  }, []);
  const toggleExtraRow = useCallback(() => {
    setExtraRow((current) => !current);
  }, []);

  // The real-input echoes: what the control reported, in the order it reported it.
  //
  // One string rather than three counters, because the *order* is the thing
  // `scripts/real-input` asserts (DECISIONS D32: a pick fires `onSelect` and then
  // `onClose`, and Android is the only platform that fires either). So the same
  // echo reads `open > select bravo > close` on Android after one real pick and
  // `select bravo` on iOS — row ids, not titles — and each platform's check reads
  // it and expects its own text: the ruling is asserted rather than described.
  const [events, setEvents] = useState('none');
  const [lastPick, setLastPick] = useState('-');

  const appendEvent = useCallback((said: string) => {
    setEvents((current) =>
      current === 'none' ? said : `${current} > ${said}`
    );
  }, []);
  const noteRealSelect = useCallback(
    (id: string) => {
      setLastPick(id);
      appendEvent(`select ${id}`);
    },
    [appendEvent]
  );
  const noteRealOpen = useCallback(() => appendEvent('open'), [appendEvent]);
  const noteRealClose = useCallback(() => appendEvent('close'), [appendEvent]);

  // A menu with a header group, a divider-only group, a destructive row and a
  // disabled one — the whole row vocabulary in one control.
  const sectioned = useMemo<MenuGroup>(
    () => ({
      actions: [
        { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc' },
        { id: 'paste', title: 'Paste', systemImage: 'doc.on.clipboard' },
      ],
      sections: [
        {
          id: 'share',
          title: 'Share',
          items: [{ id: 'airdrop', title: 'AirDrop' }],
        },
        {
          id: 'danger',
          items: [
            { id: 'delete', title: 'Delete', destructive: true },
            { id: 'archive', title: 'Archive', disabled: true },
          ],
        },
      ],
    }),
    []
  );

  // One submenu level (DECISIONS D29): nested on iOS, inline under a divider on
  // Android.
  const withSubmenu = useMemo<MenuGroup>(
    () => ({
      actions: [
        { id: 'rename', title: 'Rename' },
        {
          id: 'sort',
          title: 'Sort by',
          systemImage: 'arrow.up.arrow.down',
          items: [
            { id: 'sort-name', title: 'Name' },
            { id: 'sort-date', title: 'Date' },
            { id: 'sort-size', title: 'Size' },
          ],
        },
      ],
    }),
    []
  );

  // The rows the caller can change while the control is mounted.
  const growing = useMemo<MenuGroup>(
    () => ({
      actions: extraRow
        ? [{ id: 'one', title: 'First' }, OPTIONAL_ROW]
        : [{ id: 'one', title: 'First' }],
    }),
    [extraRow]
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
          react-native-nitro-ui · Menu
        </Text>
        <Text style={styles.note}>
          SwiftUI Menu inside the shared host on iOS, a Material 3 DropdownMenu
          anchored to the button on Android. The trigger is a Button: same
          variants, same sizes, same box.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Real input (scripts/real-input reads these)
        </Text>
        <Text style={styles.note}>
          At the top of the page on purpose: a check that has to scroll to reach
          a control cannot tell a dropped tap from a control that is off screen.
        </Text>
        <View style={styles.row}>
          <Menu
            title="Actions"
            group={REAL_INPUT_GROUP}
            onSelect={noteRealSelect}
            onOpen={noteRealOpen}
            onClose={noteRealClose}
            testID="real-input-menu"
            accessibilityLabel="Real-input menu"
          />
          {/* Separate `Text`s, not one line with nested children: React Native renders
              a nested `Text` inline inside its parent, so on Android it never becomes
              its own view and never carries a `resource-id` — the only way
              `scripts/real-input/android.mjs` can find an echo. */}
          <Text style={[styles.readout, { color: ink.muted }]}>
            last row reported
          </Text>
          <Text
            testID="real-input-menu-pick"
            style={[styles.value, { color: ink.ink }]}
          >
            {lastPick}
          </Text>
          <Text style={[styles.readout, { color: ink.muted }]}>in order</Text>
          <Text
            testID="real-input-menu-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {events}
          </Text>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          What the control heard
        </Text>
        <Text style={styles.note}>
          last pick: {picked ?? 'nothing'} · opened {String(opens)}× · closed{' '}
          {String(closes)}× · primary action {String(primary)}×
        </Text>
        <Text style={styles.note}>
          `onOpen`/`onClose` fire on Android only - a SwiftUI Menu keeps its
          open state to itself, so iOS never reports either (DECISIONS D32). A
          pick reports `onSelect` first and `onClose` after it. The counts above
          are the platform's answer.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Sections and rows
        </Text>
        <View style={styles.row}>
          <Menu
            title="File"
            group={sectioned}
            onSelect={recordSelect}
            onOpen={recordOpen}
            onClose={recordClose}
            testID="menu-sectioned"
          />
          <Menu
            title="With submenu"
            group={withSubmenu}
            onSelect={recordSelect}
            testID="menu-submenu"
          />
          <Menu
            title="Disabled"
            group={sectioned}
            onSelect={recordSelect}
            disabled
            testID="menu-disabled"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          Trigger styles (every variant, three sizes)
        </Text>
        {SIZES.map((size) => (
          <View key={size} style={styles.row}>
            {VARIANTS.map((variant) => (
              <Menu
                key={`${variant}-${size}`}
                title="Actions"
                group={withSubmenu}
                variant={variant}
                size={size}
                onSelect={recordSelect}
                testID={`menu-${variant}-${size}`}
              />
            ))}
          </View>
        ))}

        <Text style={[styles.section, { color: ink.ink }]}>
          Colour, symbol, long title
        </Text>
        <View style={styles.row}>
          <Menu
            title="Tinted"
            group={sectioned}
            tintColor="#B4472C"
            onSelect={recordSelect}
          />
          <Menu
            title="Symbol"
            systemImage="ellipsis.circle"
            group={sectioned}
            onSelect={recordSelect}
          />
          <Menu
            title="A trigger with a long title"
            group={sectioned}
            onSelect={recordSelect}
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          iOS only: a primary action
        </Text>
        <Text style={styles.note}>
          Tap runs the action, a long-press opens the menu. Android always opens
          on tap and never calls it.
        </Text>
        <View style={styles.row}>
          <Menu
            title="Send"
            group={sectioned}
            onSelect={recordSelect}
            primaryAction={recordPrimary}
            testID="menu-primary"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          A group that changes while it is mounted
        </Text>
        <View style={styles.row}>
          <Menu
            title="Rows"
            group={growing}
            onSelect={recordSelect}
            testID="menu-growing"
          />
          <Menu
            title={extraRow ? 'Take a row away' : 'Put the row back'}
            group={{ actions: [{ id: 'toggle', title: 'Toggle' }] }}
            onSelect={toggleExtraRow}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { padding: 16, gap: 10 },
  title: { fontSize: 20, fontWeight: '600' },
  section: { fontSize: 15, fontWeight: '600', marginTop: 14 },
  note: { color: '#8a8a8f', fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  readout: { fontSize: 12, color: '#8a8a8f', alignSelf: 'center' },
  value: { fontSize: 13, fontWeight: '600', alignSelf: 'center' },
});
