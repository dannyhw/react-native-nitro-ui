import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  AlertDialog,
  ConfirmationDialog,
  type DialogAction,
} from 'react-native-nitro-ui';

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
 * The real-input alert, spelled as `CHECKS.dialog` and `testRealInputDialog` spell
 * it. None of these titles appears anywhere else on the screen, so a text match
 * names one button of one window. `Locked action` is disabled: the button a check
 * proves takes no tap.
 */
const ALERT_ACTIONS: DialogAction[] = [
  { id: 'cancel', title: 'Keep it', role: 'cancel' },
  { id: 'delete', title: 'Delete draft', role: 'destructive' },
  { id: 'locked', title: 'Locked action', disabled: true },
];

/**
 * The real-input confirmation sheet: rows on Android, an action sheet on iOS. It
 * has no cancel action on purpose, so iOS adds its own Cancel - and a tap outside
 * an action sheet, which is that Cancel, reports the close alone on both platforms.
 */
const SHEET_ACTIONS: DialogAction[] = [
  { id: 'copy', title: 'Copy link' },
  { id: 'remove', title: 'Remove photo', role: 'destructive' },
  { id: 'locked-row', title: 'Locked share', disabled: true },
];

const STICKY_ACTIONS: DialogAction[] = [{ id: 'ok', title: 'Understood' }];

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
 * Every dialog configuration G11 shows on one screen: an alert with a cancel, a
 * destructive and a disabled action; a confirmation sheet; a dialog that only an
 * action can close; and the presentation contexts Q5's spike asked about - inside an
 * RN `Modal`, over one, and two dialogs at once.
 *
 * The log line (`dialog-log`) is what real input reads: every event the app received,
 * in order, so "the action before the close" is a string comparison.
 */
export default function DialogScreen() {
  const ink = useInk();
  const topInset = useTopInset();
  const [log, setLog] = useState<string[]>([]);
  const record = useCallback((entry: string) => {
    setLog((previous) => [...previous.slice(-11), entry]);
  }, []);

  const [alertOpen, setAlertOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stickyOpen, setStickyOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [inModalOpen, setInModalOpen] = useState(false);
  const [overModalOpen, setOverModalOpen] = useState(false);
  const [firstOpen, setFirstOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    []
  );
  const later = (ms: number, run: () => void) => {
    timers.current.push(setTimeout(run, ms));
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: ink.background }]}
      testID="dialog-screen"
    >
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: 16 + topInset }]}
      >
        <Text style={[styles.title, { color: ink.ink }]}>Dialogs</Text>
        <Text style={styles.note}>
          AlertDialog and ConfirmationDialog: UIKit&apos;s UIAlertController on
          iOS, Material 3&apos;s AlertDialog and ModalBottomSheet on Android.
          Neither has a box: the window is the platform&apos;s.
        </Text>
        <Text testID="dialog-log" style={[styles.value, { color: ink.ink }]}>
          {log.join(' > ') || 'none'}
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>Alert</Text>
        <Opener
          label="Open the alert"
          testID="dialog-open-alert"
          onPress={() => setAlertOpen(true)}
        />
        <AlertDialog
          testID="dialog-alert"
          isPresented={alertOpen}
          onIsPresentedChange={(next) => {
            record(`presented:${String(next)}`);
            setAlertOpen(next);
          }}
          title="Delete the draft?"
          message="The draft and its photos go for good."
          actions={ALERT_ACTIONS}
          onAction={(id) => record(`action:${id}`)}
        />

        <Text style={[styles.section, { color: ink.ink }]}>Confirmation</Text>
        <View>
          <Opener
            label="Open the sheet"
            testID="dialog-open-sheet"
            onPress={() => setSheetOpen(true)}
          />
          {/* Placed over its opener: on iPad the action sheet points here. */}
          <ConfirmationDialog
            testID="dialog-sheet"
            isPresented={sheetOpen}
            onIsPresentedChange={(next) => {
              record(`presented:${String(next)}`);
              setSheetOpen(next);
            }}
            title="Share the photo"
            message="Choose what happens to it."
            titleVisibility="visible"
            actions={SHEET_ACTIONS}
            onAction={(id) => record(`action:${id}`)}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>
          Only an action closes it
        </Text>
        <Opener
          label="Open the sticky alert"
          testID="dialog-open-sticky"
          onPress={() => setStickyOpen(true)}
        />
        <AlertDialog
          testID="dialog-sticky"
          isPresented={stickyOpen}
          onIsPresentedChange={(next) => {
            record(`presented:${String(next)}`);
            setStickyOpen(next);
          }}
          title="Back and outside do nothing"
          actions={STICKY_ACTIONS}
          dismissible={false}
          onAction={(id) => record(`action:${id}`)}
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          Presentation contexts
        </Text>
        <Text style={styles.note}>
          Inside an RN Modal; over one (the dialog lives on this screen and the
          Modal is on top); and a second dialog over the first.
        </Text>
        <View style={styles.row}>
          <Opener
            label="Inside a Modal"
            testID="dialog-open-modal"
            onPress={() => setModalOpen(true)}
          />
          <Opener
            label="Over a Modal"
            testID="dialog-open-over-modal"
            onPress={() => {
              setModalOpen(true);
              later(700, () => setOverModalOpen(true));
            }}
          />
          <Opener
            label="Two at once"
            testID="dialog-open-two"
            onPress={() => {
              setFirstOpen(true);
              later(700, () => setSecondOpen(true));
            }}
          />
        </View>
        <AlertDialog
          isPresented={overModalOpen}
          onIsPresentedChange={setOverModalOpen}
          title="Over the Modal"
          message="This dialog's view is on the screen under the Modal."
          actions={[{ id: 'ok', title: 'OK' }]}
        />
        <AlertDialog
          isPresented={firstOpen}
          onIsPresentedChange={setFirstOpen}
          title="First dialog"
          actions={[{ id: 'ok', title: 'Close first' }]}
        />
        <AlertDialog
          isPresented={secondOpen}
          onIsPresentedChange={setSecondOpen}
          title="Second dialog"
          actions={[{ id: 'ok', title: 'Close second' }]}
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
          <Opener
            label="Open a dialog in here"
            testID="dialog-modal-open"
            onPress={() => setInModalOpen(true)}
          />
          <Opener
            label="Close the Modal"
            testID="dialog-modal-close"
            onPress={() => setModalOpen(false)}
          />
          <ConfirmationDialog
            isPresented={inModalOpen}
            onIsPresentedChange={setInModalOpen}
            title="Inside the Modal"
            titleVisibility="visible"
            actions={[
              { id: 'one', title: 'First choice' },
              { id: 'two', title: 'Second choice' },
            ]}
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  value: { fontSize: 13, fontWeight: '600' },
  opener: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
});
