import { useCallback, useState } from 'react';
import {
  Modal,
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
import { Tooltip, type TooltipAction } from 'react-native-nitro-ui';

/** Text colours for the current appearance - the helper the other screens use. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    button: dark ? '#2c2c2e' : '#e5e5ea',
  };
}

/** Android draws every app edge to edge and RN's `SafeAreaView` is iOS-only. */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/**
 * The real-input tooltip's one action, spelled as `CHECKS.tooltip` and
 * `testRealInputTooltip` spell it. `Got it` appears nowhere else on the screen.
 */
const RICH_ACTIONS: TooltipAction[] = [{ id: 'ok', title: 'Got it' }];

/** A plain RN button, so the opener is not itself a nitro-ui control. */
function Opener({
  label,
  testID,
  onPress,
}: {
  label: string;
  testID: string;
  onPress: () => void;
}) {
  const ink = useInk();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={[styles.opener, { backgroundColor: ink.button }]}
    >
      <Text style={{ color: ink.ink }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Every Tooltip configuration G18 shows on one screen: a rich tooltip with a title and
 * an action around a star button, a plain one around a label, one that prefers the
 * side below, and one inside an RN `Modal`.
 *
 * The log line (`tooltip-log`) is what real input reads: every event the app received,
 * in order, so "the action before the close" is a string comparison. The star counts
 * its own presses (`tooltip-anchor-presses`): a closed tooltip must leave every tap on
 * its anchor to the anchor.
 */
export default function TooltipScreen() {
  const ink = useInk();
  const topInset = useTopInset();
  const [log, setLog] = useState<string[]>([]);
  const record = useCallback((entry: string) => {
    setLog((previous) => [...previous.slice(-11), entry]);
  }, []);
  const [richOpen, setRichOpen] = useState(false);
  const [plainOpen, setPlainOpen] = useState(false);
  const [belowOpen, setBelowOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [inModalOpen, setInModalOpen] = useState(false);
  const [presses, setPresses] = useState(0);

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: ink.background }]}
      testID="tooltip-screen"
    >
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: 16 + topInset }]}
      >
        <Text style={[styles.title, { color: ink.ink }]}>Tooltip</Text>
        <Text style={styles.note}>
          Material 3&apos;s PlainTooltip and RichTooltip on Android; a UIKit
          popover on iOS, which has no tooltip. The app opens it, and it stays
          up until the user or the app closes it.
        </Text>
        <Text testID="tooltip-log" style={[styles.value, { color: ink.ink }]}>
          {log.join(' > ') || 'none'}
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Rich, with an action
        </Text>
        <Opener
          label="Show the tip"
          testID="tooltip-open-rich"
          onPress={() => setRichOpen(true)}
        />
        <View style={styles.anchorRow}>
          <Tooltip
            testID="tooltip-rich"
            isPresented={richOpen}
            onIsPresentedChange={(next) => {
              record(`presented:${String(next)}`);
              setRichOpen(next);
            }}
            title="Saved searches"
            message="Tap the star to keep this search."
            actions={RICH_ACTIONS}
            onAction={(id) => record(`action:${id}`)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Star this search"
              testID="tooltip-anchor"
              onPress={() => setPresses((n) => n + 1)}
              style={[styles.star, { backgroundColor: ink.button }]}
            >
              <Text style={[styles.starGlyph, { color: ink.ink }]}>★</Text>
            </Pressable>
          </Tooltip>
          <Text
            testID="tooltip-anchor-presses"
            style={[styles.value, { color: ink.ink }]}
          >
            {`star presses: ${String(presses)}`}
          </Text>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Plain</Text>
        <View style={styles.row}>
          <Opener
            label="Show a plain tip"
            testID="tooltip-open-plain"
            onPress={() => setPlainOpen(true)}
          />
          <Tooltip
            testID="tooltip-plain"
            isPresented={plainOpen}
            onIsPresentedChange={(next) => {
              record(`plain:presented:${String(next)}`);
              setPlainOpen(next);
            }}
            message="Copied to the clipboard"
          >
            <View style={[styles.chip, { borderColor: ink.muted }]}>
              <Text style={{ color: ink.ink }}>Copy link</Text>
            </View>
          </Tooltip>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Below</Text>
        <View style={styles.row}>
          <Opener
            label="Show a tip below"
            testID="tooltip-open-below"
            onPress={() => setBelowOpen(true)}
          />
          <Tooltip
            testID="tooltip-below"
            isPresented={belowOpen}
            onIsPresentedChange={setBelowOpen}
            placement="below"
            message="Filters apply to every tab."
          >
            <View style={[styles.chip, { borderColor: ink.muted }]}>
              <Text style={{ color: ink.ink }}>Filters</Text>
            </View>
          </Tooltip>
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Inside a Modal</Text>
        <Opener
          label="Open a Modal"
          testID="tooltip-open-modal"
          onPress={() => setModalOpen(true)}
        />
      </ScrollView>

      <Modal
        visible={modalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={[styles.modal, { backgroundColor: ink.background }]}>
          <Text style={[styles.title, { color: ink.ink }]}>A Modal</Text>
          <Tooltip
            isPresented={inModalOpen}
            onIsPresentedChange={setInModalOpen}
            message="This tooltip opened inside the Modal."
          >
            <Opener
              label="Show a tip in here"
              testID="tooltip-modal-open"
              onPress={() => setInModalOpen(true)}
            />
          </Tooltip>
          <Opener
            label="Close the Modal"
            testID="tooltip-modal-close"
            onPress={() => setModalOpen(false)}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { padding: 16, gap: 10 },
  modal: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  section: { fontSize: 15, fontWeight: '600', marginTop: 14 },
  note: { color: '#8a8a8f', fontSize: 12, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  anchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 90,
  },
  value: { fontSize: 13, fontWeight: '600' },
  opener: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  star: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starGlyph: { fontSize: 22 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
