import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { nitroUiCore } from 'react-native-nitro-ui';

/**
 * Playground for the library. Components arrive in later tasks; for now this
 * only proves the native core object links and answers on both platforms.
 */
export default function App() {
  const [now, setNow] = useState(() => nitroUiCore.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(nitroUiCore.now()), 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>react-native-nitro-ui</Text>
      <View style={styles.row} testID="core-now">
        <Text style={styles.label}>core clock</Text>
        <Text style={styles.value}>{now.toFixed(3)} ms</Text>
      </View>
      <Text style={styles.note}>
        No components yet - the Switch tracer bullet lands in T10.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: { color: '#666' },
  value: { fontVariant: ['tabular-nums'] },
  note: { color: '#999' },
});
