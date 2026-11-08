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
import {
  ButtonGroup,
  type ButtonGroupAppearance,
  type ButtonGroupItem,
  type ButtonGroupLabelStyle,
  type ButtonGroupProps,
} from 'react-native-nitro-ui';

/** Text colours for the current appearance - the helper the other screens use. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    well: dark ? '#1c1c1e' : '#f2f2f7',
  };
}

/** Android draws every app edge to edge and RN's `SafeAreaView` is iOS-only. */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/** The two appearances, in the order the docs table reads them. */
const APPEARANCES: readonly ButtonGroupAppearance[] = ['standard', 'connected'];

/** The five looks, in Material's order. */
const VARIANTS: readonly NonNullable<ButtonGroupProps['variant']>[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];

/** The rungs, in ladder order. */
const SIZES: readonly NonNullable<ButtonGroupProps['size']>[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];

/** The four label styles, including the platform default. */
const LABEL_STYLES: readonly ButtonGroupLabelStyle[] = [
  'automatic',
  'titleOnly',
  'iconOnly',
  'titleAndIcon',
];

/** The three actions the real-input block and most stories use. */
const ACTIONS: ButtonGroupItem[] = [
  {
    id: 'copy',
    title: 'Copy',
    systemImage: 'doc.on.doc',
    androidIcon: require('../src/assets/icons/share_24px.xml'),
  },
  { id: 'cut', title: 'Cut', systemImage: 'scissors' },
  {
    id: 'paste',
    title: 'Paste',
    systemImage: 'doc.on.clipboard',
    androidIcon: 'nitroui_test_star',
  },
];

/** A toolbar's worth of formatting toggles - the *Bold | Italic | Underline* case. */
const FORMAT_TOGGLES: ButtonGroupItem[] = [
  {
    id: 'bold',
    title: 'Bold',
    systemImage: 'textformat.size',
    androidIcon: require('../src/assets/icons/star_24px.xml'),
    toggle: true,
  },
  { id: 'italic', title: 'Italic', systemImage: 'italic', toggle: true },
  {
    id: 'underline',
    title: 'Underline',
    systemImage: 'underline',
    toggle: true,
  },
];

/**
 * Six items with titles long enough that they cannot share a 220 pt box, which is
 * what makes this the overflow row rather than a row that happens to be narrow.
 */
const MANY_ITEMS: ButtonGroupItem[] = [
  { id: 'day', title: 'Day' },
  { id: 'week', title: 'Week' },
  { id: 'month', title: 'Month' },
  { id: 'quarter', title: 'Quarter' },
  { id: 'year', title: 'Year' },
  { id: 'all', title: 'All time' },
];

/**
 * Every ButtonGroup configuration G20 has to show, and the controls the real-input
 * suite taps (`scripts/real-input`).
 *
 * The real-input block is first on the page for Chip's reason: `uiautomator dump`
 * lists no off-screen nodes, so a control the suite has to find has to be on screen
 * when the tab opens.
 */
export default function ButtonGroupScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  // ---- Real input (`scripts/real-input`): one tap, one report, one refusal. ----
  const [presses, setPresses] = useState(0);
  const [lastPressed, setLastPressed] = useState('none');
  const onPress = useCallback((id: string) => {
    setPresses((count) => count + 1);
    setLastPressed(id);
  }, []);

  const [format, setFormat] = useState<string[]>(['bold']);
  const [toggleEvents, setToggleEvents] = useState(0);
  const onCheckedChange = useCallback((id: string, checked: boolean) => {
    setToggleEvents((count) => count + 1);
    setFormat((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((existing) => existing !== id)
    );
  }, []);

  // Controlled to "nothing checked" and never written: every flip is refused, and
  // the echo is what the control was *asked* to show, so a snap-back has a witness.
  const [refusedLast, setRefusedLast] = useState('none');
  const [refusedEvents, setRefusedEvents] = useState(0);
  const onRefusedChange = useCallback((id: string, checked: boolean) => {
    setRefusedLast(`${id}:${checked ? '1' : '0'}`);
    setRefusedEvents((count) => count + 1);
  }, []);

  // Shared by the disabled group and its disabled item, so a stray tap is a number
  // that did not move rather than the absence of a callback.
  const [disabledEvents, setDisabledEvents] = useState(0);
  const onDisabled = useCallback(() => {
    setDisabledEvents((count) => count + 1);
  }, []);

  // ---- The gallery below the real-input block. ----
  const [toggled, setToggled] = useState<string[]>(['bold']);
  const onToggled = useCallback((id: string, checked: boolean) => {
    setToggled((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((existing) => existing !== id)
    );
  }, []);

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
          react-native-nitro-ui · ButtonGroup
        </Text>
        <Text style={styles.note}>
          Material 3&apos;s ButtonGroup on Android, a row of bordered Buttons /
          SwiftUI&apos;s ControlGroup on iOS. Items are data, so the ones that
          do not fit move into an overflow menu.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <ButtonGroup
          items={ACTIONS}
          appearance="connected"
          onPress={onPress}
          testID="real-input-button-group"
          accessibilityLabel="Real-input actions"
        />
        <ButtonGroup
          items={withChecked(FORMAT_TOGGLES, format)}
          appearance="standard"
          onCheckedChange={onCheckedChange}
          testID="real-input-button-group-toggles"
          accessibilityLabel="Real-input formatting toggles"
        />
        <ButtonGroup
          items={withChecked(
            FORMAT_TOGGLES.map((item) => ({ ...item, checked: false })),
            []
          )}
          appearance="standard"
          onCheckedChange={onRefusedChange}
          testID="real-input-button-group-refusing"
          accessibilityLabel="Real-input refusing toggles"
        />
        <ButtonGroup
          items={ACTIONS.map((item) => ({
            ...item,
            disabled: item.id === 'cut',
          }))}
          appearance="connected"
          onPress={onDisabled}
          testID="real-input-button-group-disabled-item"
          accessibilityLabel="Real-input group with a disabled item"
        />
        <ButtonGroup
          items={ACTIONS}
          appearance="connected"
          disabled
          onPress={onDisabled}
          testID="real-input-button-group-disabled"
          accessibilityLabel="Real-input disabled group"
        />
        <View style={styles.narrowWell}>
          <ButtonGroup
            items={MANY_ITEMS}
            appearance="connected"
            onPress={onPress}
            testID="real-input-button-group-overflow"
            accessibilityLabel="Real-input overflowing group"
            overflowAccessibilityLabel="Real-input overflow control"
          />
        </View>
        <View style={styles.echoes}>
          <Echo
            label="presses"
            testID="button-group-presses"
            value={String(presses)}
            ink={ink}
          />
          <Echo
            label="last pressed"
            testID="button-group-pressed-id"
            value={lastPressed}
            ink={ink}
          />
          <Echo
            label="toggle changes"
            testID="button-group-toggle-events"
            value={String(toggleEvents)}
            ink={ink}
          />
          <Echo
            label="toggles checked"
            testID="button-group-toggle-state"
            value={format.join(',') || 'none'}
            ink={ink}
          />
          <Echo
            label="refused: last request"
            testID="button-group-refused-last"
            value={refusedLast}
            ink={ink}
          />
          <Echo
            label="refused: requests"
            testID="button-group-refused-events"
            value={String(refusedEvents)}
            ink={ink}
          />
          <Echo
            label="disabled: requests"
            testID="button-group-disabled-events"
            value={String(disabledEvents)}
            ink={ink}
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Appearance</Text>
        {APPEARANCES.map((appearance) => (
          <View key={appearance}>
            <Text style={[styles.label, { color: ink.muted }]}>
              {appearance}
            </Text>
            <ButtonGroup items={ACTIONS} appearance={appearance} />
            <ButtonGroup
              items={withChecked(FORMAT_TOGGLES, toggled)}
              appearance={appearance}
              onCheckedChange={onToggled}
            />
          </View>
        ))}

        <Text style={[styles.section, { color: ink.ink }]}>Variant</Text>
        {VARIANTS.map((variant) => (
          <ButtonGroup
            key={variant}
            items={ACTIONS}
            variant={variant}
            testID={`button-group-variant-${variant}`}
          />
        ))}

        <Text style={[styles.section, { color: ink.ink }]}>Size</Text>
        {SIZES.map((size) => (
          <ButtonGroup
            key={size}
            items={ACTIONS}
            size={size}
            testID={`button-group-size-${size}`}
          />
        ))}

        <Text style={[styles.section, { color: ink.ink }]}>Label style</Text>
        {LABEL_STYLES.map((style) => (
          <ButtonGroup
            key={style}
            items={ACTIONS}
            labelStyle={style}
            testID={`button-group-label-${style}`}
          />
        ))}

        <Text style={[styles.section, { color: ink.ink }]}>State</Text>
        <ButtonGroup
          items={ACTIONS.map((item) => ({
            ...item,
            disabled: item.id === 'cut',
          }))}
        />
        <ButtonGroup
          items={[
            { ...ACTIONS[0]!, disabled: true },
            { ...ACTIONS[1]!, disabled: true },
            { ...ACTIONS[2]!, disabled: true },
          ]}
        />
        <ButtonGroup items={[]} accessibilityLabel="An empty group" />
      </ScrollView>
    </SafeAreaView>
  );
}

/** The controlled form of a toggle list: every item gets this render's checked set. */
function withChecked(
  items: readonly ButtonGroupItem[],
  checked: readonly string[]
): ButtonGroupItem[] {
  return items.map((item) => ({
    ...item,
    toggle: true,
    checked: checked.indexOf(item.id) >= 0,
  }));
}

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
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 8,
  },
  section: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  value: {
    fontSize: 13,
    fontWeight: '600',
  },
  echoes: {
    marginTop: 8,
    gap: 2,
  },
  /**
   * A box narrow enough that six titles cannot share it, which is the only way the
   * overflow path is on screen at all: the group is `fillWidth`, so the width it is
   * given is the width it overflows at.
   */
  narrowWell: {
    width: 220,
    marginTop: 8,
  },
});
