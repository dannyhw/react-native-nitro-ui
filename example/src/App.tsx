import { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import ButtonScreen from './ButtonScreen';
import DatePickerScreen from './DatePickerScreen';
import ProgressScreen from './ProgressScreen';
import SliderScreen from './SliderScreen';
import SegmentedControlScreen from './SegmentedControlScreen';
import SwitchScreen from './SwitchScreen';

type Screen =
  'switch' | 'slider' | 'button' | 'progress' | 'segmented' | 'datepicker';

/**
 * Which screen a cold launch shows.
 *
 * A constant rather than a build-time variable: Metro only inlines `NODE_ENV`
 * here, so an `process.env`-based switch would need a Metro config for one
 * developer convenience. Task screenshots are taken with this flipped (see the
 * task report), which needs no Metro change and no rebuild of anything else.
 *
 * Keep the committed value a screen the window can go idle on, and land it back
 * here after a screenshot session. The Progress screen draws two indeterminate
 * indicators and starts its 60 Hz writer on mount, so on Android that window
 * never idles: `uiautomator dump` answers "could not get idle state", and
 * `bun run test:real-input:android` - which reads the screen that way - then
 * never sees the tab bar and times out (A2 measured it: the same timeout on
 * `main` and on this branch, and a dump that succeeds one tab over).
 */
const DEFAULT_SCREEN: Screen = 'switch';

/**
 * The tab bar's top padding.
 *
 * RN's `SafeAreaView` is iOS-only, and Android lays apps out edge to edge, so on
 * Android the tabs drew under the clock - the round-1 review's screenshots.
 * `StatusBar.currentHeight` is core's answer for that inset on Android and `null`
 * on iOS, where `SafeAreaView` is already doing the work, so this covers both
 * without taking `react-native-safe-area-context` into the example for one tab
 * bar. A display cutout taller than the status bar would still overlap; the
 * example is not where to solve that.
 */
const topInset =
  (Platform.select({ android: StatusBar.currentHeight, default: 0 }) ?? 0) + 4;

const TABS: { id: Screen; label: string }[] = [
  { id: 'switch', label: 'Switch' },
  { id: 'slider', label: 'Slider' },
  { id: 'button', label: 'Button' },
  { id: 'progress', label: 'Progress' },
  { id: 'segmented', label: 'Segments' },
  { id: 'datepicker', label: 'Dates' },
];

/**
 * Playground for the library. T10 put the Switch tracer bullet here; G1 added
 * the Slider, G2 the Button and G3 the Progress; every task adds a screen.
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
        {screen === 'switch' ? <SwitchScreen /> : null}
        {screen === 'slider' ? <SliderScreen /> : null}
        {screen === 'button' ? <ButtonScreen /> : null}
        {screen === 'progress' ? <ProgressScreen /> : null}
        {screen === 'segmented' ? <SegmentedControlScreen /> : null}
        {screen === 'datepicker' ? <DatePickerScreen /> : null}
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
    paddingHorizontal: 4,
    paddingBottom: 4,
    paddingTop: topInset,
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
