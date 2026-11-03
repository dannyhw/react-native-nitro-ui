/**
 * S3 spike only (DECISIONS D36): the ContextMenu prototype's measuring screen, never
 * merged. Every number the spike reports is read off this screen by real input
 * (XCUITest on iOS, `adb` + `uiautomator dump` on Android): the echoes below are
 * React's own counters, and the trace is the native clock.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  LogBox,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { NitroUiMenuRow } from '../../src/components/Menu/Menu.nitro';
import {
  ContextMenuProto,
  type ContextMenuProtoHandle,
} from '../../src/spike/ContextMenuProto/ContextMenuProto';

function row(
  id: string,
  title: string,
  extra: Partial<NitroUiMenuRow> = {}
): NitroUiMenuRow {
  return {
    id,
    kind: 'action',
    title,
    parentId: null,
    disabled: false,
    destructive: false,
    systemImage: null,
    ...extra,
  };
}

const ROWS: NitroUiMenuRow[] = [
  row('reply', 'Reply', { systemImage: 'arrowshape.turn.up.left' }),
  row('copy', 'Copy text'),
  row('danger', '', { kind: 'section' }),
  row('delete', 'Delete', { parentId: 'danger', destructive: true }),
];
const INNER_ROWS: NitroUiMenuRow[] = [row('inner-a', 'Inner action')];
const OUTER_ROWS: NitroUiMenuRow[] = [row('outer-a', 'Outer action')];
const BOTTOM_ROWS: NitroUiMenuRow[] = [
  row('b1', 'Bottom one'),
  row('b2', 'Bottom two'),
  row('b3', 'Bottom three'),
];

type Counts = {
  press: number;
  pressIn: number;
  pressOut: number;
  opens: number;
  closes: number;
  selects: number;
  below: number;
  innerOpens: number;
  outerOpens: number;
  bottomOpens: number;
  disabledPress: number;
  disabledOpens: number;
};

const ZERO: Counts = {
  press: 0,
  pressIn: 0,
  pressOut: 0,
  opens: 0,
  closes: 0,
  selects: 0,
  below: 0,
  innerOpens: 0,
  outerOpens: 0,
  bottomOpens: 0,
  disabledPress: 0,
  disabledOpens: 0,
};

const CHURN_ROUNDS = 50;

// The warnings banner is pinned over the bottom-edge ContextMenu; this screen is
// a measuring rig, so it goes.
LogBox.ignoreAllLogs(true);

function shuffle(ids: number[], round: number): number[] {
  // Deterministic: insert one, drop one, rotate by the round.
  const next = ids.filter((id) => id % 7 !== round % 7);
  next.push(100 + round);
  const shift = round % next.length;
  return [...next.slice(shift), ...next.slice(0, shift)].slice(0, 5);
}

export default function ContextMenuProtoScreen() {
  const [counts, setCounts] = useState<Counts>(ZERO);
  const [order, setOrder] = useState<string[]>([]);
  const [trace, setTrace] = useState<string[]>([]);
  const [timings, setTimings] = useState<string[]>([]);
  const [anchor, setAnchor] = useState('-');
  const [scrollY, setScrollY] = useState(0);
  const [hScrollX, setHScrollX] = useState(0);
  const [cancel, setCancel] = useState(true);
  const [a11y, setA11y] = useState(false);
  const [report, setReport] = useState('-');
  const [churnIds, setChurnIds] = useState<number[]>([0, 1, 2, 3, 4]);
  const [churn, setChurn] = useState('idle');
  const targetRef = useRef<ContextMenuProtoHandle | null>(null);
  const fixtureRef = useRef<ContextMenuProtoHandle | null>(null);
  const churnRef = useRef<ContextMenuProtoHandle | null>(null);

  const bump = useCallback((key: keyof Counts) => {
    setCounts((c) => ({ ...c, [key]: c[key] + 1 }));
  }, []);
  const note = useCallback((event: string) => {
    setOrder((o) => [...o.slice(-11), event]);
  }, []);

  const onTrace = useCallback((line: string) => {
    setTrace((t) => [...t.slice(-7), line]);
    const [, event, , detail] = line.split('|');
    if (event === 'display' || event === 'drawn') {
      setTimings((t) => [...t.slice(-11), detail ?? '']);
    }
    if (event === 'menuFrame') {
      setAnchor(detail ?? '-');
    }
  }, []);

  const onOpen = useCallback(() => {
    bump('opens');
    note('open');
  }, [bump, note]);
  const onClose = useCallback(() => {
    bump('closes');
    note('close');
  }, [bump, note]);
  const onSelect = useCallback(
    (id: string) => {
      bump('selects');
      note(`select:${id}`);
    },
    [bump, note]
  );
  const onPress = useCallback(() => bump('press'), [bump]);
  const onPressIn = useCallback(() => bump('pressIn'), [bump]);
  const onPressOut = useCallback(() => bump('pressOut'), [bump]);
  const onInnerOpen = useCallback(() => bump('innerOpens'), [bump]);
  const onOuterOpen = useCallback(() => bump('outerOpens'), [bump]);
  const onBottomOpen = useCallback(() => bump('bottomOpens'), [bump]);
  const onDisabledOpen = useCallback(() => bump('disabledOpens'), [bump]);
  const onDisabledPress = useCallback(() => bump('disabledPress'), [bump]);
  const setTargetRef = useCallback((ref: ContextMenuProtoHandle) => {
    targetRef.current = ref;
  }, []);
  const setFixtureRef = useCallback((ref: ContextMenuProtoHandle) => {
    fixtureRef.current = ref;
  }, []);
  const setChurnRef = useCallback((ref: ContextMenuProtoHandle) => {
    churnRef.current = ref;
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) =>
      setScrollY(Math.round(e.nativeEvent.contentOffset.y)),
    []
  );
  const onHScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) =>
      setHScrollX(Math.round(e.nativeEvent.contentOffset.x)),
    []
  );

  const probe = useCallback(() => {
    fixtureRef.current?.nuiTestReport();
    targetRef.current?.nuiTestReport();
    setTimeout(() => {
      setReport(
        `fixture{${fixtureRef.current?.nuiTestReport() ?? '-'}} target{${
          targetRef.current?.nuiTestReport() ?? '-'
        }}`
      );
    }, 150);
  }, []);

  const runChurn = useCallback(() => {
    let ids = [0, 1, 2, 3, 4];
    let round = 0;
    let ok = 0;
    let firstBad = '-';
    let late = 0;
    const step = () => {
      round += 1;
      ids = shuffle(ids, round);
      setChurnIds(ids);
      // The native report is published on main and read back here, so a read can
      // precede the round's mount under load (measured once on iOS at load1 ~30: the
      // previous round's order). Re-read for up to a second; an order that is still
      // wrong then is a mount bug, and `late` counts the reads that needed a retry.
      const js = ids.map((id) => `c${id}`).join(',');
      let tries = 0;
      const read = () => {
        churnRef.current?.nuiTestReport();
        setTimeout(() => {
          const line = churnRef.current?.nuiTestReport() ?? '';
          const kids = /kids=(.*)$/.exec(line)?.[1] ?? '';
          const native = kids
            .split('|')
            .map((k) => k.split('@')[0])
            .join(',');
          tries += 1;
          if (native !== js && tries < 10) {
            read();
            return;
          }
          if (tries > 1) late += 1;
          if (native === js) {
            ok += 1;
          } else if (firstBad === '-') {
            firstBad = `r${round}:js=${js}:native=${native}`;
          }
          setChurn(
            `rounds=${round}/${CHURN_ROUNDS};ok=${ok};late=${late};bad=${firstBad}`
          );
          if (round < CHURN_ROUNDS) {
            step();
          }
        }, 100);
      };
      setTimeout(read, 60);
    };
    setChurn('running');
    step();
  }, []);

  const reset = useCallback(() => {
    setCounts(ZERO);
    setOrder([]);
    setTrace([]);
    setTimings([]);
    setAnchor('-');
  }, []);

  const echo = useMemo(
    () =>
      `press=${counts.press};pressIn=${counts.pressIn};pressOut=${counts.pressOut};` +
      `opens=${counts.opens};closes=${counts.closes};selects=${counts.selects};` +
      `below=${counts.below};inner=${counts.innerOpens};outer=${counts.outerOpens};` +
      `bottom=${counts.bottomOpens};dPress=${counts.disabledPress};dOpens=${counts.disabledOpens};` +
      `scrollY=${scrollY};hX=${hScrollX};cancel=${cancel ? 1 : 0}`,
    [counts, scrollY, hScrollX, cancel]
  );

  return (
    <View style={styles.root}>
      {/* The echoes are outside the ScrollView: a scrolled echo leaves the tree. */}
      <View style={styles.header}>
        <Text testID="s3-echo" style={[styles.mono, styles.line2]}>
          {echo}
        </Text>
        <Text testID="s3-order" style={[styles.mono, styles.line1]}>
          {`order=${order.join(',')}`}
        </Text>
        <Text
          testID="s3-timings"
          style={[styles.mono, styles.line4]}
          numberOfLines={4}
        >
          {`timings=${timings.join(' ; ')}`}
        </Text>
        <Text
          testID="s3-anchor"
          style={[styles.mono, styles.line2]}
          numberOfLines={2}
        >
          {`anchor=${anchor}`}
        </Text>
        <Text
          testID="s3-trace"
          style={[styles.mono, styles.line6]}
          numberOfLines={6}
        >
          {`trace=${trace.join(' ; ')}`}
        </Text>
        <View style={styles.buttons}>
          <Pressable
            testID="s3-cancel-toggle"
            accessibilityLabel="s3-cancel-toggle"
            style={styles.button}
            onPress={() => setCancel((c) => !c)}
          >
            <Text>{cancel ? 'cancel on' : 'cancel off'}</Text>
          </Pressable>
          <Pressable
            testID="s3-reset"
            accessibilityLabel="s3-reset"
            style={styles.button}
            onPress={reset}
          >
            <Text>reset</Text>
          </Pressable>
          <Pressable
            testID="s3-a11y-toggle"
            accessibilityLabel="s3-a11y-toggle"
            style={styles.button}
            onPress={() => setA11y((v) => !v)}
          >
            <Text>{a11y ? 'a11y on' : 'a11y off'}</Text>
          </Pressable>
          <Pressable
            testID="s3-synth"
            accessibilityLabel="s3-synth"
            style={styles.button}
            onPress={() => targetRef.current?.nuiTestSynthHold(0.2, 0.3, 1000)}
          >
            <Text>synth</Text>
          </Pressable>
          <Pressable
            testID="s3-a11y-click"
            accessibilityLabel="s3-a11y-click"
            style={styles.button}
            onPress={() => targetRef.current?.nuiTestA11yLongClick()}
          >
            <Text>a11yLC</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        testID="s3-scroll"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
      >
        <ContextMenuProto
          testID="s3-menu"
          rows={ROWS}
          cancelTouches={cancel}
          accessible={a11y ? true : undefined}
          accessibilityLabel={a11y ? 'Message from Ada' : undefined}
          style={styles.menu}
          onOpen={onOpen}
          onClose={onClose}
          onSelect={onSelect}
          onTrace={onTrace}
          hybridRef={setTargetRef}
        >
          <Pressable
            testID="s3-target"
            accessibilityLabel="s3-target"
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            style={({ pressed }) => [styles.target, pressed && styles.pressed]}
          >
            <Text>Hold this message</Text>
          </Pressable>
          <ScrollView
            testID="s3-hscroll"
            horizontal
            onScroll={onHScroll}
            scrollEventThrottle={16}
            style={styles.hscroll}
          >
            <Text style={styles.wide}>
              {'horizontal strip ' + '· '.repeat(80)}
            </Text>
          </ScrollView>
        </ContextMenuProto>
        <Pressable
          testID="s3-below"
          accessibilityLabel="s3-below"
          style={styles.below}
          onPress={() => bump('below')}
        >
          <Text>below</Text>
        </Pressable>
        <View style={styles.fixtures}>
          <ContextMenuProto
            testID="s3-fixture"
            rows={ROWS}
            style={styles.fixture}
            hybridRef={setFixtureRef}
          >
            <View testID="s3-fixture-child" style={styles.child} />
          </ContextMenuProto>
          <View testID="s3-twin" style={styles.fixture}>
            <View testID="s3-twin-child" style={styles.child} />
          </View>
        </View>
        <ContextMenuProto
          testID="s3-outer"
          rows={OUTER_ROWS}
          style={styles.outer}
          onOpen={onOuterOpen}
        >
          <Text>outer</Text>
          <ContextMenuProto
            testID="s3-inner"
            rows={INNER_ROWS}
            style={styles.inner}
            onOpen={onInnerOpen}
          >
            <Text>inner</Text>
          </ContextMenuProto>
        </ContextMenuProto>
        <ContextMenuProto
          testID="s3-disabled"
          rows={ROWS}
          disabled
          style={styles.outer}
          onOpen={onDisabledOpen}
        >
          <Pressable
            testID="s3-disabled-target"
            accessibilityLabel="s3-disabled-target"
            onPress={onDisabledPress}
            style={styles.target}
          >
            <Text>disabled menu</Text>
          </Pressable>
        </ContextMenuProto>
        <Pressable
          testID="s3-probe"
          accessibilityLabel="s3-probe"
          style={styles.button}
          onPress={probe}
        >
          <Text>probe</Text>
        </Pressable>
        <Text
          testID="s3-report"
          style={[styles.mono, styles.line6]}
          numberOfLines={8}
        >
          {`report=${report}`}
        </Text>
        <Pressable
          testID="s3-churn"
          accessibilityLabel="s3-churn"
          style={styles.button}
          onPress={runChurn}
        >
          <Text>churn</Text>
        </Pressable>
        <Text testID="s3-churn-result" style={[styles.mono, styles.line1]}>
          {`churn=${churn}`}
        </Text>
        <ContextMenuProto
          testID="s3-churn-menu"
          rows={ROWS}
          style={styles.churnBox}
          hybridRef={setChurnRef}
        >
          {churnIds.map((id) => (
            <View key={id} testID={`c${id}`} style={styles.churnChild} />
          ))}
        </ContextMenuProto>
        <View style={styles.spacer} />
      </ScrollView>
      <ContextMenuProto
        testID="s3-bottom"
        rows={BOTTOM_ROWS}
        style={styles.bottom}
        onOpen={onBottomOpen}
        onTrace={onTrace}
      >
        <Text>bottom edge</Text>
      </ContextMenuProto>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 12, paddingTop: 6, gap: 2 },
  content: { padding: 12, gap: 8 },
  mono: { fontSize: 10, color: '#000' },
  // Fixed heights: an echo that grows moves everything below it, and a ContextMenu
  // that moves takes its open popup with it (measured on Android).
  line1: { height: 28 },
  line2: { height: 40 },
  line4: { height: 64 },
  line6: { height: 84 },
  buttons: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#ddd',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  menu: {
    padding: 12,
    borderWidth: 2,
    borderColor: '#88a',
    borderRadius: 16,
    backgroundColor: '#eef',
    gap: 8,
  },
  target: {
    height: 64,
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#cde',
    borderRadius: 8,
  },
  pressed: { opacity: 0.5 },
  hscroll: { height: 36 },
  wide: { fontSize: 16, lineHeight: 36 },
  below: { height: 44, backgroundColor: '#efe', justifyContent: 'center' },
  fixtures: { flexDirection: 'row', gap: 16 },
  fixture: {
    padding: 12,
    borderWidth: 2,
    borderColor: '#a88',
    alignSelf: 'flex-start',
  },
  child: { width: 100, height: 40, backgroundColor: '#fc9' },
  churnBox: { borderWidth: 1, borderColor: '#999' },
  churnChild: { height: 6, backgroundColor: '#9cf', marginBottom: 2 },
  outer: { padding: 12, backgroundColor: '#fee' },
  inner: { padding: 12, marginTop: 6, backgroundColor: '#fcc' },
  spacer: { height: 900 },
  bottom: {
    height: 56,
    backgroundColor: '#ffd',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
