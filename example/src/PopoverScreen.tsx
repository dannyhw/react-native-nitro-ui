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
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { BottomSheet, Popover, Tooltip } from 'react-native-nitro-ui';

/** Text colours for the current appearance - the helper the other screens use. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    button: dark ? '#2c2c2e' : '#e5e5ea',
    field: dark ? '#1c1c1e' : '#f2f2f7',
  };
}

/** Android draws every app edge to edge and RN's `SafeAreaView` is iOS-only. */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

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
 * The element a popover points at: a box the app lays out, sized in dp. It opens its
 * popover on press, because the anchor is the app's own view and the popover is
 * controlled - `Popover` adds nothing to it and takes no touch from it.
 */
function Anchor({
  label,
  testID,
  width,
  height,
  onPress,
}: {
  label: string;
  testID: string;
  width?: number;
  height?: number;
  onPress?: () => void;
}) {
  const ink = useInk();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={[
        styles.anchor,
        { backgroundColor: ink.button, borderColor: ink.muted },
        width == null ? null : { width },
        height == null ? null : { height },
      ]}
    >
      <Text style={{ color: ink.ink }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Every Popover configuration G22 shows on one screen: content that fits its own width,
 * content that needs the whole `maxWidth`, a tall popover near the bottom of the window
 * (which flips above its anchor), a `TextInput` (which brings up the keyboard), a popover
 * inside an RN `Modal`, and a Tooltip and a BottomSheet open at the same time.
 *
 * The log line (`popover-log`) is what real input reads: every event the app received, in
 * order, so "the press before the close" is a string comparison. The presses inside the
 * popover are counted (`popover-inner-presses`): a real tap must land exactly once.
 */
export default function PopoverScreen() {
  const ink = useInk();
  const topInset = useTopInset();
  const [log, setLog] = useState<string[]>([]);
  const record = useCallback((entry: string) => {
    setLog((previous) => [...previous.slice(-11), entry]);
  }, []);
  const [shortOpen, setShortOpen] = useState(false);
  const [wideOpen, setWideOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [inModalOpen, setInModalOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [presses, setPresses] = useState(0);
  const [typed, setTyped] = useState('');

  const reset = () => {
    setLog([]);
    setPresses(0);
    setTyped('');
    setShortOpen(false);
    setWideOpen(false);
    setFieldOpen(false);
    setBottomOpen(false);
    setInModalOpen(false);
    setTooltipOpen(false);
    setSheetOpen(false);
  };

  /** The content of the popover real input taps inside: press once, and it closes. */
  const pressContent = (testId: string) => (
    <View style={[styles.content, styles.narrow]}>
      <Text style={[styles.contentTitle, { color: ink.ink }]}>Actions</Text>
      <Pressable
        accessibilityRole="button"
        testID={`${testId}-inner-press`}
        onPress={() => {
          setPresses((n) => n + 1);
          record(`press:${testId}`);
          if (testId === 'popover-short') setShortOpen(false);
          if (testId === 'popover-in-modal') setInModalOpen(false);
        }}
        style={[styles.item, { backgroundColor: ink.field }]}
      >
        <Text style={{ color: ink.ink }}>Do the thing</Text>
      </Pressable>
      <Text style={[styles.small, { color: ink.muted }]}>
        One line, then one more, so the box has a height of its own.
      </Text>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: ink.background }]}
      testID="popover-screen"
    >
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: 16 + topInset }]}
      >
        <Text style={[styles.title, { color: ink.ink }]}>Popover</Text>
        <Text style={styles.note}>
          A platform popover whose content is React Native views: UIKit&apos;s
          popover on iOS, a popup window on Android, which has no popover. The
          content lays itself out first, so the popover&apos;s first frame is
          already its final size.
        </Text>
        <Text testID="popover-log" style={[styles.value, { color: ink.ink }]}>
          {log.join(' > ') || 'none'}
        </Text>
        <Text
          testID="popover-inner-presses"
          style={[styles.value, { color: ink.ink }]}
        >
          {`inner presses: ${String(presses)}`}
        </Text>
        <Opener label="Reset" testID="popover-reset" onPress={reset} />

        <Text style={[styles.section, { color: ink.ink }]}>
          Content of its own width
        </Text>
        <Popover
          testID="popover-short"
          isPresented={shortOpen}
          onIsPresentedChange={(next) => {
            record(`short:presented:${String(next)}`);
            setShortOpen(next);
          }}
          onDismiss={() => record('short:dismiss')}
          anchor={
            <Anchor
              label="Share"
              testID="popover-short-anchor"
              onPress={() => setShortOpen(true)}
            />
          }
        >
          {pressContent('popover-short')}
        </Popover>

        <Text style={[styles.section, { color: ink.ink }]}>
          Content that needs the cap
        </Text>
        <Popover
          testID="popover-wide"
          isPresented={wideOpen}
          onIsPresentedChange={(next) => {
            record(`wide:presented:${String(next)}`);
            setWideOpen(next);
          }}
          maxWidth={260}
          anchor={
            <Anchor
              label="Row actions"
              testID="popover-wide-anchor"
              onPress={() => setWideOpen(true)}
            />
          }
        >
          {/* No width: this content asks for more than the cap, so the box is the cap. */}
          <View style={styles.content}>
            <Text style={[styles.contentTitle, { color: ink.ink }]}>
              A long label that reaches the cap
            </Text>
            <Text style={[styles.small, { color: ink.muted }]}>
              This content asks for more than 260 points, so the popover is 260
              wide and never wider, whatever the window says.
            </Text>
          </View>
        </Popover>

        <Text style={[styles.section, { color: ink.ink }]}>
          With a text field (the keyboard)
        </Text>
        <Popover
          testID="popover-field"
          isPresented={fieldOpen}
          onIsPresentedChange={(next) => {
            record(`field:presented:${String(next)}`);
            setFieldOpen(next);
          }}
          anchor={
            <Anchor
              label="Rename"
              testID="popover-field-anchor"
              onPress={() => setFieldOpen(true)}
            />
          }
        >
          <View style={[styles.content, styles.fieldBox]}>
            <Text style={[styles.contentTitle, { color: ink.ink }]}>
              Rename this list
            </Text>
            <TextInput
              testID="popover-inner-field"
              accessibilityLabel="New name"
              value={typed}
              onChangeText={(next) => {
                setTyped(next);
                record(`typed:${next}`);
              }}
              placeholder="New name"
              placeholderTextColor={ink.muted}
              style={[styles.input, { color: ink.ink, borderColor: ink.muted }]}
            />
            <View style={[styles.item, { backgroundColor: ink.field }]}>
              <Text style={{ color: ink.ink }}>
                The popover moves clear of the keyboard.
              </Text>
            </View>
          </View>
        </Popover>

        <Text style={[styles.section, { color: ink.ink }]}>
          Alongside a Tooltip and a BottomSheet
        </Text>
        <View style={styles.row}>
          <Tooltip
            testID="popover-tooltip"
            isPresented={tooltipOpen}
            onIsPresentedChange={setTooltipOpen}
            message="A tooltip at the same time."
          >
            <Opener
              label="Show the tip"
              testID="popover-open-tooltip"
              onPress={() => setTooltipOpen(true)}
            />
          </Tooltip>
          <Opener
            label="Open the sheet"
            testID="popover-open-sheet"
            onPress={() => setSheetOpen(true)}
          />
        </View>
        <Popover
          testID="popover-near-bottom"
          isPresented={bottomOpen}
          onIsPresentedChange={(next) => {
            record(`near:presented:${String(next)}`);
            setBottomOpen(next);
          }}
          anchor={
            <Anchor
              label="Near the bottom"
              testID="popover-near-anchor"
              height={64}
              onPress={() => setBottomOpen(true)}
            />
          }
        >
          <View style={[styles.content, styles.narrow]}>
            <Text style={[styles.contentTitle, { color: ink.ink }]}>
              No room below
            </Text>
            <Text style={[styles.small, { color: ink.muted }]}>
              So the popover sits above its anchor instead.
            </Text>
          </View>
        </Popover>

        <Text style={[styles.section, { color: ink.ink }]}>Inside a Modal</Text>
        <Opener
          label="Open a Modal"
          testID="popover-open-modal"
          onPress={() => setModalOpen(true)}
        />
      </ScrollView>

      <BottomSheet
        testID="popover-sheet"
        isPresented={sheetOpen}
        onIsPresentedChange={setSheetOpen}
      >
        <View style={[styles.content, styles.narrow]}>
          <Text style={[styles.contentTitle, { color: ink.ink }]}>
            A sheet at the same time
          </Text>
        </View>
      </BottomSheet>

      <Modal
        visible={modalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={[styles.modal, { backgroundColor: ink.background }]}>
          <Text style={[styles.title, { color: ink.ink }]}>A Modal</Text>
          <Popover
            testID="popover-in-modal"
            isPresented={inModalOpen}
            onIsPresentedChange={(next) => {
              record(`modal:presented:${String(next)}`);
              setInModalOpen(next);
            }}
            onDismiss={() => record('modal:dismiss')}
            anchor={
              <Anchor
                label="More"
                testID="popover-in-modal-anchor"
                onPress={() => setInModalOpen(true)}
              />
            }
          >
            {pressContent('popover-in-modal')}
          </Popover>
          <Opener
            label="Close the Modal"
            testID="popover-modal-close"
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
  value: { fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  opener: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  anchor: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  content: { padding: 14, gap: 8 },
  narrow: { width: 180 },
  fieldBox: { width: 220 },
  small: { fontSize: 12, lineHeight: 16 },
  contentTitle: { fontSize: 15, fontWeight: '600' },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
});
