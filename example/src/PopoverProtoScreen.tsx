/**
 * S5 spike only (never merged): the Popover prototype's real-input screen.
 *
 * Everything real input reads is in one echo line (`s5-echo`), `key=value;...`:
 *
 * - `press`: taps the Pressable inside the plain popover received;
 * - `opens`/`closes`: the plain popover's presents asked by JS / native closes reported;
 * - `modal`: whether the RN `Modal` is up (1) or not (0);
 * - `mpress`: taps the Pressable inside the popover *inside* the Modal received;
 * - `mopen`: whether that popover is presented, from JS;
 * - `main`: taps on a Pressable on this screen, which a stranded Modal would swallow;
 * - `focus`/`text`: the TextInput in the popover.
 */
import { useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  PopoverProto,
  type PopoverProtoHandle,
} from '../../src/spike/PopoverProto/PopoverProto';

/** `key=value;...` into a record. */
function parse(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

/**
 * Q1's verdict from the popover's own report, read after it has gone: the first frame
 * it showed, the last, every distinct size between, and the content box Yoga laid out.
 */
function fitVerdict(raw: string): { ok: boolean; line: string } {
  const r = parse(raw);
  if (Platform.OS === 'ios') {
    const first = `${r.firstW}x${r.firstH}`;
    const final = `${r.finalW}x${r.finalH}`;
    const content = `${r.askedW}x${r.askedH}`;
    const near =
      Math.abs(Number(r.finalW) - Number(r.askedW)) <= 1 &&
      Math.abs(Number(r.finalH) - Number(r.askedH)) <= 1;
    const ok =
      first === final && (r.sizes ?? '').split(',').length === 1 && near;
    return {
      ok,
      line: `first=${first} final=${final} sizes=${r.sizes} content=${content} frames=${r.visibleFrames} trace=${r.trace}`,
    };
  }
  const density = Number(r.density ?? 1);
  const [w, h] = (r.lastDraw ?? '0x0').split('x').map(Number);
  const near =
    Math.abs((w ?? 0) - Math.round(Number(r.contentW) * density)) <= 3 &&
    Math.abs((h ?? 0) - Math.round(Number(r.contentH) * density)) <= 3;
  const ok =
    r.firstDraw === r.lastDraw &&
    (r.drawSizes ?? '').split(',').length === 1 &&
    near;
  return {
    ok,
    line: `firstDraw=${r.firstDraw} lastDraw=${r.lastDraw} drawSizes=${r.drawSizes} content=${r.contentW}x${r.contentH}dp density=${density} draws=${r.draws} firstDrawMs=${r.firstDrawMs} trace=${r.trace}`,
  };
}

function Button({
  testID,
  title,
  onPress,
}: {
  testID: string;
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export default function PopoverProtoScreen() {
  const [open, setOpen] = useState(false);
  const [press, setPress] = useState(0);
  const [opens, setOpens] = useState(0);
  const [closes, setCloses] = useState(0);
  const [inputOpen, setInputOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [text, setText] = useState('');
  const [modal, setModal] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [mpress, setMpress] = useState(0);
  const [main, setMain] = useState(0);
  const [fitOk, setFitOk] = useState(0);
  const [fitN, setFitN] = useState(0);
  const [probe, setProbe] = useState('none');
  const plain = useRef<PopoverProtoHandle | null>(null);
  const [plainRef] = useState(() => (view: PopoverProtoHandle) => {
    plain.current = view;
  });
  const onPlainDismiss = () => {
    // Read once the popover is gone: its sampler finished a second after the present.
    setTimeout(() => {
      plain.current?.nuiTestStateReport();
      setTimeout(() => {
        const verdict = fitVerdict(plain.current?.nuiTestStateReport() ?? '');
        setFitN((n) => n + 1);
        if (verdict.ok) setFitOk((n) => n + 1);
        setProbe(`ok=${verdict.ok ? 1 : 0} ${verdict.line}`);
      }, 150);
    }, 150);
  };
  // A different content size on each open: Q1's ten presentations are ten sizes.
  const variant = opens % 4;

  const echo =
    `press=${press};opens=${opens};closes=${closes};modal=${modal ? 1 : 0}` +
    `;mopen=${modalOpen ? 1 : 0};mpress=${mpress};main=${main}` +
    `;open=${open ? 1 : 0};iopen=${inputOpen ? 1 : 0};focus=${focus};text=${text}` +
    `;fit=${fitOk}/${fitN}`;

  return (
    <View style={styles.screen} testID="s5-screen">
      <Text testID="s5-echo" accessibilityLabel={echo} style={styles.echo}>
        {echo}
      </Text>
      <Text testID="s5-probe" accessibilityLabel={probe} style={styles.echo}>
        {probe}
      </Text>
      <View style={styles.row}>
        <Button
          testID="s5-reset"
          title="Reset"
          onPress={() => {
            setPress(0);
            setOpens(0);
            setCloses(0);
            setMpress(0);
            setMain(0);
            setFocus(0);
            setText('');
            setFitOk(0);
            setFitN(0);
            setProbe('none');
          }}
        />
        <Button
          testID="s5-main"
          title="Main tap"
          onPress={() => setMain((n) => n + 1)}
        />
      </View>

      {/* Q2: a Pressable inside the popover. */}
      <PopoverProto
        testID="s5-plain"
        hybridRef={plainRef}
        onDismiss={onPlainDismiss}
        isPresented={open}
        onIsPresentedChange={(next) => {
          if (!next) setCloses((n) => n + 1);
          setOpen(next);
        }}
        anchor={
          <Button
            testID="s5-open"
            title="Open popover"
            onPress={() => {
              setOpens((n) => n + 1);
              setOpen(true);
            }}
          />
        }
      >
        <View style={styles.content}>
          <Text style={styles.title}>Filters</Text>
          <Text>A popover whose content is React Native.</Text>
          {Array.from({ length: variant }, (_, i) => (
            <Text key={i}>
              {
                ['Row', 'Another row', 'A longer row of text', 'Short'][
                  (i + variant) % 4
                ]
              }
            </Text>
          ))}
          <Pressable
            testID="s5-press"
            accessibilityRole="button"
            onPress={() => setPress((n) => n + 1)}
            style={({ pressed }) => [styles.inner, pressed && styles.pressed]}
          >
            <Text testID="s5-press-count" style={styles.buttonText}>
              {`Pressed ${press}`}
            </Text>
          </Pressable>
        </View>
      </PopoverProto>

      <View style={styles.row}>
        <Button
          testID="s5-open-modal"
          title="Open Modal"
          onPress={() => setModal(true)}
        />
      </View>

      <ScrollView style={styles.spacer} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flex: 1 }} />
      </ScrollView>

      {/* Q3: a TextInput in a popover anchored low on the screen. */}
      <PopoverProto
        testID="s5-input"
        isPresented={inputOpen}
        onIsPresentedChange={setInputOpen}
        anchor={
          <Button
            testID="s5-open-input"
            title="Open input popover"
            onPress={() => setInputOpen(true)}
          />
        }
      >
        <View style={styles.content}>
          <Text style={styles.title}>Rename</Text>
          <TextInput
            testID="s5-text"
            accessibilityLabel="Name"
            placeholder="Type a name"
            value={text}
            onChangeText={setText}
            onFocus={() => setFocus((n) => n + 1)}
            style={styles.input}
          />
        </View>
      </PopoverProto>

      <Modal
        visible={modal}
        animationType="none"
        onRequestClose={() => setModal(false)}
      >
        <View style={styles.modal} testID="s5-modal">
          <Text
            testID="s5-modal-echo"
            accessibilityLabel={echo}
            style={styles.echo}
          >
            {echo}
          </Text>
          <Button
            testID="s5-modal-close"
            title="Close Modal"
            onPress={() => setModal(false)}
          />
          {/* Q4: a popover inside the Modal. */}
          <PopoverProto
            testID="s5-mpop"
            isPresented={modalOpen}
            onIsPresentedChange={setModalOpen}
            anchor={
              <Button
                testID="s5-modal-open"
                title="Open popover in Modal"
                onPress={() => setModalOpen(true)}
              />
            }
          >
            <View style={styles.content}>
              <Text style={styles.title}>Inside the Modal</Text>
              <Pressable
                testID="s5-mpress"
                accessibilityRole="button"
                onPress={() => setMpress((n) => n + 1)}
                style={({ pressed }) => [
                  styles.inner,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.buttonText}>{`Pressed ${mpress}`}</Text>
              </Pressable>
              <Pressable
                testID="s5-close-modal"
                accessibilityRole="button"
                accessibilityLabel="Close the Modal from the popover"
                onPress={() => setModal(false)}
                style={({ pressed }) => [
                  styles.inner,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.buttonText}>Close the Modal</Text>
              </Pressable>
            </View>
          </PopoverProto>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // The bottom padding keeps the input popover's anchor clear of RN's dev banner.
  screen: { flex: 1, padding: 16, paddingBottom: 200, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  echo: { fontSize: 11, fontFamily: 'Menlo' },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0a66c2',
  },
  pressed: { opacity: 0.6 },
  buttonText: { color: 'white', fontWeight: '600' },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '600' },
  inner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2e7d32',
    alignSelf: 'flex-start',
  },
  input: {
    width: 220,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  spacer: { flex: 1 },
  modal: { flex: 1, padding: 24, paddingTop: 80, gap: 16 },
});
