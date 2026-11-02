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
import { BottomSheet, type BottomSheetDetent } from 'react-native-nitro-ui';

/** Text colours for the current appearance - the helper the other screens use. */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    button: dark ? '#2c2c2e' : '#e5e5ea',
    row: dark ? '#1c1c1e' : '#f2f2f7',
  };
}

/** Android draws every app edge to edge and RN's `SafeAreaView` is iOS-only. */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/** A plain RN button, so neither the opener nor the content is a nitro-ui control. */
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

const DETENTS_TWO: BottomSheetDetent[] = ['medium', 'large'];
const DETENTS_FRACTION: BottomSheetDetent[] = ['medium', { fraction: 0.85 }];
const ROWS = Array.from({ length: 30 }, (_, index) => `Row ${index + 1}`);
const CHIPS = Array.from({ length: 12 }, (_, index) => `Chip ${index + 1}`);

/**
 * Every BottomSheet configuration G14 shows on one screen: a `fit` sheet whose
 * content is a `Pressable` and a growing list; a `medium`/`large` sheet with a
 * `ScrollView`; a fractional one; a sheet only its own button can close; and one
 * presented from inside an RN `Modal`.
 *
 * The log line (`sheet-log`) is what real input reads: every event the app received,
 * in order, so a press inside the sheet and the close it is followed by are a string
 * comparison.
 */
export default function BottomSheetScreen() {
  const ink = useInk();
  const topInset = useTopInset();
  const [log, setLog] = useState<string[]>([]);
  const record = useCallback((entry: string) => {
    setLog((previous) => [...previous.slice(-11), entry]);
  }, []);

  const [fitOpen, setFitOpen] = useState(false);
  const [extra, setExtra] = useState(0);
  const [presses, setPresses] = useState(0);
  const [twoOpen, setTwoOpen] = useState(false);
  const [fractionOpen, setFractionOpen] = useState(false);
  const [stickyOpen, setStickyOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [inModalOpen, setInModalOpen] = useState(false);

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: ink.background }]}
      testID="sheet-screen"
    >
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: 16 + topInset }]}
      >
        <Text style={[styles.title, { color: ink.ink }]}>BottomSheet</Text>
        <Text style={styles.note}>
          UIKit&apos;s sheet presentation on iOS, Material 3&apos;s
          ModalBottomSheet on Android. The content is React Native, laid out at
          the sheet&apos;s width.
        </Text>
        <Text testID="sheet-log" style={[styles.value, { color: ink.ink }]}>
          {log.join(' > ') || 'none'}
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          Fits its content
        </Text>
        <Opener
          label="Open the fit sheet"
          testID="sheet-open-fit"
          onPress={() => setFitOpen(true)}
        />
        <BottomSheet
          testID="sheet-fit"
          isPresented={fitOpen}
          onIsPresentedChange={(next) => {
            record(`presented:${String(next)}`);
            setFitOpen(next);
          }}
          onDismiss={() => record('dismiss')}
          accessibilityLabel="Fit sheet"
        >
          <View style={styles.sheet}>
            <Text
              testID="sheet-fit-title"
              style={[styles.title, { color: ink.ink }]}
            >
              As tall as this
            </Text>
            <Pressable
              accessibilityRole="button"
              testID="sheet-press"
              onPress={() => {
                const next = presses + 1;
                setPresses(next);
                record(`press:${next}`);
              }}
              style={[styles.opener, { backgroundColor: ink.button }]}
            >
              <Text style={{ color: ink.ink }}>Press inside the sheet</Text>
            </Pressable>
            <Text testID="sheet-presses" style={{ color: ink.ink }}>
              {`Pressed ${presses} times`}
            </Text>
            {/* A horizontal list: dragging it disallows its parents' interception for
                that gesture, which must not cost JS the gesture's end (real input
                presses the Pressable again after a scroll here). */}
            <ScrollView
              horizontal
              testID="sheet-hscroll"
              contentContainerStyle={styles.chips}
            >
              {CHIPS.map((chip) => (
                <View
                  key={chip}
                  style={[styles.chip, { backgroundColor: ink.row }]}
                >
                  <Text style={{ color: ink.ink }}>{chip}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              testID="sheet-grow"
              onPress={() => setExtra((count) => count + 1)}
              style={[styles.opener, { backgroundColor: ink.button }]}
            >
              <Text style={{ color: ink.ink }}>Add a row</Text>
            </Pressable>
            {Array.from({ length: extra }, (_, index) => (
              <View
                key={index}
                style={[styles.row, { backgroundColor: ink.row }]}
              >
                <Text
                  style={{ color: ink.ink }}
                >{`Added row ${index + 1}`}</Text>
              </View>
            ))}
          </View>
        </BottomSheet>

        <Text style={[styles.section, { color: ink.ink }]}>
          Medium and large
        </Text>
        <Opener
          label="Open the two-detent sheet"
          testID="sheet-open-two"
          onPress={() => setTwoOpen(true)}
        />
        <BottomSheet
          testID="sheet-two"
          isPresented={twoOpen}
          onIsPresentedChange={(next) => {
            record(`presented:${String(next)}`);
            setTwoOpen(next);
          }}
          onDetentChange={(index) => record(`detent:${index}`)}
          onDismiss={() => record('dismiss')}
          detents={DETENTS_TWO}
        >
          {/* A header that is not a scroll view: a drag on it moves the sheet. */}
          <View testID="sheet-two-header" style={styles.header}>
            <Text style={[styles.title, { color: ink.ink }]}>
              Drag this up for large
            </Text>
          </View>
          {/* `nestedScrollEnabled`: on Android a drag at the list's top edge then
              moves the sheet, as it does on iOS. */}
          <ScrollView nestedScrollEnabled contentContainerStyle={styles.sheet}>
            {ROWS.map((row) => (
              <View
                key={row}
                style={[styles.row, { backgroundColor: ink.row }]}
              >
                <Text style={{ color: ink.ink }}>{row}</Text>
              </View>
            ))}
          </ScrollView>
        </BottomSheet>

        <Text style={[styles.section, { color: ink.ink }]}>
          Medium, then 85%
        </Text>
        <Opener
          label="Open the 85% sheet"
          testID="sheet-open-fraction"
          onPress={() => setFractionOpen(true)}
        />
        <BottomSheet
          isPresented={fractionOpen}
          onIsPresentedChange={setFractionOpen}
          onDetentChange={(index) => record(`fraction-detent:${index}`)}
          detents={DETENTS_FRACTION}
          cornerRadius={28}
        >
          <View style={styles.sheet}>
            <Text style={[styles.title, { color: ink.ink }]}>
              Medium, then 85% of the largest height
            </Text>
          </View>
        </BottomSheet>

        <Text style={[styles.section, { color: ink.ink }]}>
          Only its button closes it
        </Text>
        <Opener
          label="Open the sticky sheet"
          testID="sheet-open-sticky"
          onPress={() => setStickyOpen(true)}
        />
        <BottomSheet
          testID="sheet-sticky"
          isPresented={stickyOpen}
          onIsPresentedChange={(next) => {
            record(`presented:${String(next)}`);
            setStickyOpen(next);
          }}
          onDismiss={() => record('dismiss')}
          dismissible={false}
        >
          <View style={styles.sheet}>
            <Text
              testID="sheet-sticky-title"
              style={[styles.title, { color: ink.ink }]}
            >
              Swipe, back and outside do nothing
            </Text>
            <Pressable
              accessibilityRole="button"
              testID="sheet-sticky-close"
              onPress={() => {
                record('close');
                setStickyOpen(false);
              }}
              style={[styles.opener, { backgroundColor: ink.button }]}
            >
              <Text style={{ color: ink.ink }}>Close the sticky sheet</Text>
            </Pressable>
          </View>
        </BottomSheet>

        <Text style={[styles.section, { color: ink.ink }]}>
          Inside an RN Modal
        </Text>
        <Opener
          label="Open a Modal"
          testID="sheet-open-modal"
          onPress={() => setModalOpen(true)}
        />
      </ScrollView>

      <Modal
        visible={modalOpen}
        animationType="slide"
        onRequestClose={() => setModalOpen(false)}
      >
        <View
          style={[
            styles.modal,
            { backgroundColor: ink.background, paddingTop: 24 + topInset },
          ]}
        >
          <Text style={[styles.title, { color: ink.ink }]}>A Modal</Text>
          <Opener
            label="Open a sheet in here"
            testID="sheet-modal-open"
            onPress={() => setInModalOpen(true)}
          />
          <Opener
            label="Close the Modal"
            testID="sheet-modal-close"
            onPress={() => setModalOpen(false)}
          />
          <BottomSheet
            isPresented={inModalOpen}
            onIsPresentedChange={setInModalOpen}
          >
            <View style={styles.sheet}>
              <Text style={[styles.title, { color: ink.ink }]}>
                Over the Modal
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setInModalOpen(false)}
                style={[styles.opener, { backgroundColor: ink.button }]}
              >
                <Text style={{ color: ink.ink }}>Done</Text>
              </Pressable>
            </View>
          </BottomSheet>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { padding: 16, gap: 10 },
  modal: { flex: 1, padding: 24, gap: 12 },
  sheet: { padding: 20, gap: 12 },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  section: { fontSize: 15, fontWeight: '600', marginTop: 14 },
  note: { color: '#8a8a8f', fontSize: 12, lineHeight: 17 },
  value: { fontSize: 13, fontWeight: '600' },
  row: { padding: 14, borderRadius: 10 },
  chips: { gap: 8 },
  chip: { width: 110, padding: 12, borderRadius: 10 },
  opener: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
});
