import { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import SliderScreen from './SliderScreen';
import SwitchScreen from './SwitchScreen';

type Screen = 'switch' | 'slider';

/**
 * Which screen a cold launch shows.
 *
 * A constant rather than a build-time variable: Metro only inlines `NODE_ENV`
 * here, so an `process.env`-based switch would need a Metro config for one
 * developer convenience. Task screenshots are taken with this flipped (see the
 * task report), which needs no Metro change and no rebuild of anything else.
 */
const DEFAULT_SCREEN: Screen = 'switch';

const TABS: { id: Screen; label: string }[] = [
  { id: 'switch', label: 'Switch' },
  { id: 'slider', label: 'Slider' },
];

/**
 * Playground for the library. T10 put the Switch tracer bullet here; G1 added
 * the Slider, and every task adds a screen.
 *
 * The tabs are the only navigation: the harness renders its own UI, and a
 * screenshot of the example app is a screenshot of whichever screen is showing.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>(DEFAULT_SCREEN);
  const dark = useColorScheme() === 'dark';

  return (
    <View style={[styles.root, dark ? null : styles.rootLight]}>
      <SafeAreaView style={[styles.tabs, dark ? null : styles.tabsLight]}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => setScreen(tab.id)}
            testID={`tab-${tab.id}`}
            style={[
              styles.tab,
              screen === tab.id &&
                (dark ? styles.tabActive : styles.tabActiveLight),
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                screen === tab.id && (dark ? styles.ink : styles.inkLight),
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </SafeAreaView>
      <View style={styles.body}>
        {screen === 'switch' ? <SwitchScreen /> : <SliderScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  rootLight: {
    backgroundColor: '#fff',
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    backgroundColor: '#111',
  },
  tabsLight: {
    backgroundColor: '#ececec',
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: '#333',
  },
  tabActiveLight: {
    backgroundColor: '#d5d5d8',
  },
  tabLabel: {
    color: '#9d9da2',
    fontSize: 13,
  },
  ink: {
    color: '#fff',
  },
  inkLight: {
    color: '#000',
  },
  body: {
    flex: 1,
  },
});
