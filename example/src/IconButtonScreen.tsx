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
  IconButton,
  type IconButtonSize,
  type IconButtonVariant,
  type IconButtonWidth,
} from 'react-native-nitro-ui';

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

const RUNGS: readonly IconButtonSize[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];

const VARIANTS: readonly IconButtonVariant[] = [
  'standard',
  'filled',
  'tonal',
  'outlined',
];

const WIDTHS: readonly IconButtonWidth[] = ['narrow', 'uniform', 'wide'];

export default function IconButtonScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  const [pressed, setPressed] = useState(0);
  const onPress = useCallback(() => {
    setPressed((count) => count + 1);
  }, []);

  const [saved, setSaved] = useState(false);
  const [toggleEvents, setToggleEvents] = useState(0);
  const onToggleChange = useCallback((next: boolean) => {
    setSaved(next);
    setToggleEvents((count) => count + 1);
  }, []);

  const [refusedLast, setRefusedLast] = useState('none');
  const [refusedEvents, setRefusedEvents] = useState(0);
  const onRefusedChange = useCallback((next: boolean) => {
    setRefusedLast(String(next));
    setRefusedEvents((count) => count + 1);
  }, []);

  const [disabledEvents, setDisabledEvents] = useState(0);
  const onDisabled = useCallback(() => {
    setDisabledEvents((count) => count + 1);
  }, []);
  const onDisabledToggle = useCallback(() => {
    setDisabledEvents((count) => count + 1);
  }, []);

  const [bookmarked, setBookmarked] = useState(true);

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
          react-native-nitro-ui · IconButton
        </Text>
        <Text style={styles.note}>
          Material 3&apos;s four icon buttons and their toggle forms on Android,
          a SwiftUI Button / Toggle(.button) with .iconOnly on iOS. The glyph is
          the whole control, so accessibilityLabel is required.
        </Text>

        {/* First on the page: `uiautomator dump` lists no off-screen nodes. */}
        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <View style={styles.row}>
          <IconButton
            accessibilityLabel="Real-input icon button"
            systemImage="paperplane"
            androidIcon={require('../src/assets/icons/share_24px.xml')}
            variant="filled"
            onPress={onPress}
            testID="real-input-icon-button"
          />
          <IconButton
            accessibilityLabel="Real-input toggle icon button"
            systemImage="bookmark"
            androidIcon="nitroui_test_star"
            variant="tonal"
            checked={saved}
            onCheckedChange={onToggleChange}
            testID="real-input-icon-button-toggle"
          />
          <IconButton
            accessibilityLabel="Real-input refusing toggle icon button"
            systemImage="bookmark"
            androidIcon="nitroui_test_star"
            checked={false}
            onCheckedChange={onRefusedChange}
            testID="real-input-icon-button-refusing"
          />
          <IconButton
            accessibilityLabel="Real-input disabled icon button"
            systemImage="paperplane"
            androidIcon={require('../src/assets/icons/share_24px.xml')}
            variant="filled"
            disabled
            onPress={onDisabled}
            testID="real-input-icon-button-disabled"
          />
          <IconButton
            accessibilityLabel="Real-input disabled toggle icon button"
            systemImage="bookmark"
            androidIcon="nitroui_test_star"
            variant="tonal"
            disabled
            checked={false}
            onCheckedChange={onDisabledToggle}
            testID="real-input-icon-button-disabled-toggle"
          />
        </View>
        <View style={styles.echoes}>
          <Echo
            label="presses"
            testID="real-input-icon-button-presses"
            value={String(pressed)}
            ink={ink}
          />
          <Echo
            label="toggle checked"
            testID="real-input-icon-button-value"
            value={saved ? 'on' : 'off'}
            ink={ink}
          />
          <Echo
            label="toggle changes"
            testID="real-input-icon-button-events"
            value={String(toggleEvents)}
            ink={ink}
          />
          <Echo
            label="refused: last request"
            testID="real-input-icon-button-refused-last"
            value={refusedLast}
            ink={ink}
          />
          <Echo
            label="refused: requests"
            testID="real-input-icon-button-refused-events"
            value={String(refusedEvents)}
            ink={ink}
          />
          <Echo
            label="disabled: requests"
            testID="real-input-icon-button-disabled-events"
            value={String(disabledEvents)}
            ink={ink}
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Variants</Text>
        <View style={styles.row}>
          {VARIANTS.map((variant) => (
            <IconButton
              key={variant}
              accessibilityLabel={`${variant} icon button`}
              systemImage="heart"
              androidIcon="nitroui_test_star"
              variant={variant}
              onPress={() => {}}
              testID={`variant-${variant}`}
            />
          ))}
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>The ladder</Text>
        {RUNGS.map((size) => (
          <View key={size} style={styles.ladderRow}>
            <Text style={[styles.label, { color: ink.muted }]}>{size}</Text>
            {WIDTHS.map((width) => (
              <IconButton
                key={width}
                accessibilityLabel={`${size} ${width} icon button`}
                systemImage="star.fill"
                androidIcon="nitroui_test_star"
                size={size}
                width={width}
                onPress={() => {}}
                testID={`ladder-${size}-${width}`}
              />
            ))}
          </View>
        ))}

        <Text style={[styles.section, { color: ink.ink }]}>
          Shape, tint, state
        </Text>
        <View style={styles.row}>
          <IconButton
            accessibilityLabel="Square filled icon button"
            systemImage="heart"
            androidIcon="nitroui_test_shape"
            variant="filled"
            shape="square"
            onPress={() => {}}
            testID="shape-square"
          />
          <IconButton
            accessibilityLabel="Tinted icon button"
            systemImage="heart"
            androidIcon="nitroui_test_star"
            variant="tonal"
            tintColor="#c2185b"
            onPress={() => {}}
            testID="tinted"
          />
          <IconButton
            accessibilityLabel="Uncontrolled toggle icon button"
            systemImage="bookmark.fill"
            androidIcon="nitroui_test_star"
            variant="tonal"
            defaultChecked={bookmarked}
            onCheckedChange={setBookmarked}
            testID="toggle-uncontrolled"
          />
          {/* An icon name that cannot be resolved: nothing is drawn, and the
              box keeps its size. */}
          <IconButton
            accessibilityLabel="Missing artwork"
            systemImage="not-a-real-symbol"
            androidIcon="nitroui_test_never_built"
            variant="outlined"
            onPress={() => {}}
            testID="missing-artwork"
          />
        </View>
        <Text testID="icon-button-toggle-state" style={{ color: ink.ink }}>
          {`uncontrolled toggle: ${bookmarked ? 'on' : 'off'}`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  ladderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
  },
  label: {
    fontSize: 12,
    minWidth: 64,
  },
  echoes: {
    gap: 2,
  },
  value: {
    fontSize: 13,
    fontWeight: '600',
  },
});
