import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ButtonScreen from './ButtonScreen';
import SwitchScreen from './SwitchScreen';

type Screen = 'switch' | 'button';

/**
 * Which screen the app opens on. The example exists for manual checks and for
 * screenshots; `bun run harness:*` renders its own trees and never looks here.
 */
const INITIAL: Screen = 'switch';

const TABS: readonly { readonly id: Screen; readonly label: string }[] = [
  { id: 'switch', label: 'Switch' },
  { id: 'button', label: 'Button' },
];

/**
 * Playground for the library. T10 put the Switch tracer bullet here; G2 added a
 * tab per component rather than one long screen, so each component's screen
 * stays screenshot-able in one scroll position.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>(INITIAL);
  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            testID={`tab-${tab.id}`}
            onPress={() => {
              setScreen(tab.id);
            }}
            style={[styles.tab, screen === tab.id && styles.tabActive]}
          >
            <Text style={styles.tabLabel}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.body}>
        {screen === 'switch' ? <SwitchScreen /> : <ButtonScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#e5e5ea',
  },
  tabActive: {
    backgroundColor: '#007aff',
  },
  tabLabel: {
    color: '#000',
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
});
