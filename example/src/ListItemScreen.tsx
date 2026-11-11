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
import { Form, ListItem } from 'react-native-nitro-ui';

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

/**
 * The ListItem's example screen: the real-input block first, then the slots
 * (title, subtitle, value, leading icon, disclosure), a long piece of text that
 * truncates, the same leaf inside a `Form.Row`, and a disabled row.
 *
 * The README screenshots come from the Storybook story, not this screen. The
 * on-device assertions live in `example/__tests__/ListItem.harness.tsx`, which
 * renders its own trees.
 */
export default function ListItemScreen() {
  const ink = useInk();
  const dark = useColorScheme() === 'dark';
  const topInset = useTopInset();

  //
  // The real-input suite's block (`scripts/real-input`): a pressed item, a disabled
  // item on its own counter, and an item inside a `Form.Row`. Every echo is React's
  // own render, so a number moves only if a real touch reached the hosted row, the
  // row told Nitro, and Nitro told JS.
  //
  const [presses, setPresses] = useState(0);
  const [last, setLast] = useState('none');
  const onPress = useCallback((title: string) => {
    setLast(title);
    setPresses((count) => count + 1);
  }, []);
  const onRealPress = useCallback(() => onPress('real'), [onPress]);
  // Its own counter, so a tap that leaked through a disabled item is a number on
  // screen rather than the absence of a callback.
  const [disabledEvents, setDisabledEvents] = useState(0);
  const onDisabledPress = useCallback(() => {
    setDisabledEvents((count) => count + 1);
  }, []);
  // The `Form.Row` item: the one place in this app where a leaf presses from inside a
  // cell, which is what DECISIONS D46 item 2 has to get right.
  const [formPresses, setFormPresses] = useState(0);
  const onFormPress = useCallback(() => {
    setFormPresses((count) => count + 1);
  }, []);

  const [account, setAccount] = useState('Work');
  const [sync, setSync] = useState('Every hour');

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
          react-native-nitro-ui · ListItem
        </Text>
        <Text style={styles.note}>
          UIKit&apos;s UIListContentView on iOS and Material 3&apos;s ListItem
          on Android: the row content of a list row, not the row itself.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>Real input</Text>
        <ListItem
          accessibilityLabel="Real-input item"
          onPress={onRealPress}
          subtitle="One press per tap"
          testID="real-input-listitem"
          title="Real input"
        />
        <ListItem
          accessibilityLabel="Real-input disabled item"
          disabled
          onPress={onDisabledPress}
          subtitle="A tap does nothing"
          testID="real-input-listitem-disabled"
          title="Real input, disabled"
        />
        <View style={styles.echoes}>
          <Echo
            ink={ink}
            label="item presses"
            testID="real-input-listitem-presses"
            value={String(presses)}
          />
          <Echo
            ink={ink}
            label="last pressed"
            testID="real-input-listitem-last"
            value={last}
          />
          <Echo
            ink={ink}
            label="disabled: requests"
            testID="real-input-listitem-disabled-events"
            value={String(disabledEvents)}
          />
          <Echo
            ink={ink}
            label="inside a Form: presses"
            testID="real-input-listitem-form-presses"
            value={String(formPresses)}
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Slots</Text>
        <ListItem title="Title only" />
        <ListItem
          onPress={() => onPress('subtitle')}
          subtitle="Only while the app is open"
          title="With a subtitle"
        />
        <ListItem
          onPress={() => onPress('value')}
          title="With a value"
          value="1.2.3"
        />
        <ListItem
          accessory="disclosure"
          androidIcon="nitroui_test_notifications"
          subtitle="Alerts, sounds and badges"
          systemImage="bell"
          title="Notifications"
          value="On"
        />

        <Text style={[styles.section, { color: ink.ink }]}>Truncation</Text>
        <ListItem
          subtitle="A supporting line long enough to need an ellipsis of its own"
          title="A headline long enough to need an ellipsis at this width"
          value="Last synced eleven minutes ago"
        />

        <Text style={[styles.section, { color: ink.ink }]}>In a Form</Text>
        <Form style={styles.form}>
          <Form.Section footer="The row owns the cell; the item draws content.">
            <Form.Row>
              <ListItem
                accessibilityLabel="Item inside a Form row"
                accessory="disclosure"
                onPress={onFormPress}
                subtitle="A real tap reaches the item"
                testID="real-input-listitem-in-form"
                title="Inside a Form.Row"
              />
            </Form.Row>
            <Form.Row>
              <ListItem
                onPress={() => setAccount('Personal')}
                title="Account"
                value={account}
              />
            </Form.Row>
            <Form.Row>
              <ListItem
                onPress={() => setSync('Manually')}
                subtitle="Background refresh costs battery"
                title="Sync"
                value={sync}
              />
            </Form.Row>
          </Form.Section>
        </Form>

        <Text style={[styles.section, { color: ink.ink }]}>Disabled</Text>
        <ListItem
          accessory="disclosure"
          disabled
          subtitle="Greyed by the platform, not by us"
          systemImage="lock"
          title="Change password"
          value="Soon"
        />
        <View style={{ height: 24 }} />
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
  echoes: {
    gap: 2,
    marginTop: 6,
    marginBottom: 6,
    padding: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
    gap: 12,
  },
  label: {
    fontSize: 13,
    flexShrink: 1,
  },
  value: {
    fontSize: 13,
    fontWeight: '600',
  },
  form: {
    height: 260,
  },
});
