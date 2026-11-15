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

/** `Text` gets no dynamic default colour from React Native. */
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
 * The real-input tests find these rows by title, so each title must appear
 * nowhere else on the screen.
 */
const REAL_INPUT_GROUP: MenuGroup = {
  actions: [
    { id: 'alpha', title: 'Alpha' },
    { id: 'bravo', title: 'Bravo' },
    { id: 'locked', title: 'Locked row', disabled: true },
    { id: 'checked', title: 'Checked row', checked: true },
  ],
};

const OPTIONAL_ROW = { id: 'extra', title: 'Extra row' };

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

  // One string, because the real-input tests assert the order of events: a
  // pick reads `open > select bravo > close` on Android and `select bravo` on
  // iOS, where a menu reports neither opening nor closing.
  const [events, setEvents] = useState('none');
  const [lastPick, setLastPick] = useState('-');

  const appendEvent = useCallback((said: string) => {
    setEvents((current) =>
      current === 'none' ? said : `${current} > ${said}`
    );
  }, []);

  // Kept apart from `events`: the real-input tests assert each string whole.
  const [splitEvents, setSplitEvents] = useState('none');
  const appendSplitEvent = useCallback((said: string) => {
    setSplitEvents((current) =>
      current === 'none' ? said : `${current} > ${said}`
    );
  }, []);
  const noteSplitAction = useCallback(
    () => appendSplitEvent('action'),
    [appendSplitEvent]
  );
  const noteSplitOpen = useCallback(
    () => appendSplitEvent('open'),
    [appendSplitEvent]
  );
  const noteSplitClose = useCallback(
    () => appendSplitEvent('close'),
    [appendSplitEvent]
  );
  const noteSplitSelect = useCallback(
    (id: string) => appendSplitEvent(`select ${id}`),
    [appendSplitEvent]
  );
  const noteRealSelect = useCallback(
    (id: string) => {
      setLastPick(id);
      appendEvent(`select ${id}`);
    },
    [appendEvent]
  );
  const noteRealOpen = useCallback(() => appendEvent('open'), [appendEvent]);
  const noteRealClose = useCallback(() => appendEvent('close'), [appendEvent]);

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

  // A submenu is nested on iOS and drawn inline as its own group on Android.
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
          {/* The accessibility checks find this control by its
              `accessibilityLabel`; the real-input tests by its testID. */}
          <Menu
            title="Actions"
            group={REAL_INPUT_GROUP}
            onSelect={noteRealSelect}
            onOpen={noteRealOpen}
            onClose={noteRealClose}
            testID="real-input-menu"
            accessibilityLabel="Real-input menu"
          />
          {/* Separate `Text`s: a nested `Text` renders inline in its parent, so
              on Android it is no view of its own and carries no `resource-id`
              for a test to find. */}
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
          A primary action, and the list beside it
        </Text>
        <Text style={styles.note}>
          Both platforms draw this now (DECISIONS D29, E3), each in its own
          idiom: on iOS a tap runs the action and a long-press opens the menu;
          on Android the control is Material 3's split button - the left half
          runs the action, the chevron on the right opens the list. The control
          is therefore wider on Android than the plain trigger above.
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
          The split trigger under a real finger
        </Text>
        <Text style={styles.note}>
          The two halves of one control, named for a screen reader as a button
          and as a &quot;More options&quot; button. Everything the split trigger
          reports lands in its own echo, in the order it happened:
        </Text>
        <View style={styles.row}>
          <Menu
            title="Publish"
            group={REAL_INPUT_GROUP}
            accessibilityLabel="Real-input split menu"
            primaryAction={noteSplitAction}
            onSelect={noteSplitSelect}
            onOpen={noteSplitOpen}
            onClose={noteSplitClose}
            testID="real-input-menu-split"
          />
          <Text style={[styles.readout, { color: ink.muted }]}>
            split trigger reported
          </Text>
          <Text
            testID="real-input-menu-split-events"
            style={[styles.value, { color: ink.ink }]}
          >
            {splitEvents}
          </Text>
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
