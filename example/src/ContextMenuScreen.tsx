/**
 * The ContextMenu tab (G16): a message row that opens a menu on a long press, and the
 * fixtures real input reads (`testRealInputContextMenu` in `RealInputTests.swift`,
 * `CHECKS['context-menu']` in `scripts/real-input/android.mjs`).
 *
 * The echoes are React's own counters, in a fixed header *outside* the ScrollView: a
 * scrolled echo leaves the accessibility tree, and an echo that grows would move every
 * ContextMenu below it - which closes an open Android menu (the layout-move rule), so
 * each line has a fixed height.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ContextMenu, type MenuGroup } from 'react-native-nitro-ui';

const MESSAGE_GROUP: MenuGroup = {
  actions: [
    { id: 'reply', title: 'Reply', systemImage: 'arrowshape.turn.up.left' },
    { id: 'copy', title: 'Copy text', systemImage: 'doc.on.doc' },
    { id: 'pin', title: 'Pin', disabled: true },
  ],
  sections: [
    {
      id: 'danger',
      items: [
        {
          id: 'delete',
          title: 'Delete',
          destructive: true,
          systemImage: 'trash',
        },
      ],
    },
  ],
};
const OUTER_GROUP: MenuGroup = { actions: [{ id: 'outer', title: 'Outer' }] };
const INNER_GROUP: MenuGroup = { actions: [{ id: 'inner', title: 'Inner' }] };
const BOTTOM_GROUP: MenuGroup = {
  actions: [
    { id: 'b1', title: 'Bottom one' },
    { id: 'b2', title: 'Bottom two' },
    { id: 'b3', title: 'Bottom three' },
  ],
};

type Counts = {
  press: number;
  pressIn: number;
  pressOut: number;
  opens: number;
  closes: number;
  selects: number;
  below: number;
  inner: number;
  outer: number;
  bottom: number;
  dPress: number;
  dOpens: number;
};

const ZERO: Counts = {
  press: 0,
  pressIn: 0,
  pressOut: 0,
  opens: 0,
  closes: 0,
  selects: 0,
  below: 0,
  inner: 0,
  outer: 0,
  bottom: 0,
  dPress: 0,
  dOpens: 0,
};

export default function ContextMenuScreen() {
  const [counts, setCounts] = useState<Counts>(ZERO);
  const [order, setOrder] = useState<string[]>([]);
  const [scrollY, setScrollY] = useState(0);
  const [hScrollX, setHScrollX] = useState(0);

  const bump = useCallback((key: keyof Counts) => {
    setCounts((c) => ({ ...c, [key]: c[key] + 1 }));
  }, []);
  const note = useCallback((event: string) => {
    setOrder((o) => [...o.slice(-8), event]);
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
  const onBelow = useCallback(() => bump('below'), [bump]);
  const onInnerOpen = useCallback(() => bump('inner'), [bump]);
  const onOuterOpen = useCallback(() => bump('outer'), [bump]);
  const onBottomOpen = useCallback(() => bump('bottom'), [bump]);
  const onDisabledOpen = useCallback(() => bump('dOpens'), [bump]);
  const onDisabledPress = useCallback(() => bump('dPress'), [bump]);
  const reset = useCallback(() => {
    setCounts(ZERO);
    setOrder([]);
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

  const echo = useMemo(
    () =>
      `press=${counts.press};pressIn=${counts.pressIn};pressOut=${counts.pressOut};` +
      `opens=${counts.opens};closes=${counts.closes};selects=${counts.selects};` +
      `below=${counts.below};inner=${counts.inner};outer=${counts.outer};` +
      `bottom=${counts.bottom};dPress=${counts.dPress};dOpens=${counts.dOpens};` +
      `scrollY=${scrollY};hX=${hScrollX}`,
    [counts, scrollY, hScrollX]
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text testID="ctx-echo" style={[styles.mono, styles.line2]}>
          {echo}
        </Text>
        <Text testID="ctx-order" style={[styles.mono, styles.line1]}>
          {`order=${order.join(',')}`}
        </Text>
        <Pressable
          testID="ctx-reset"
          accessibilityLabel="Reset the counters"
          style={styles.button}
          onPress={reset}
        >
          <Text>Reset</Text>
        </Pressable>
      </View>
      <ScrollView
        testID="ctx-scroll"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.hint}>
          Touch and hold the message for its menu. A tap opens the message.
        </Text>
        <ContextMenu
          testID="ctx-menu"
          group={MESSAGE_GROUP}
          title="Message"
          style={styles.message}
          onOpen={onOpen}
          onClose={onClose}
          onSelect={onSelect}
        >
          <Pressable
            testID="ctx-target"
            accessibilityLabel="Open the message"
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            style={({ pressed }) => [styles.target, pressed && styles.pressed]}
          >
            <Text style={styles.from}>Ada Lovelace</Text>
            <Text>Hold this message for its menu.</Text>
          </Pressable>
          <ScrollView
            testID="ctx-hscroll"
            horizontal
            onScroll={onHScroll}
            scrollEventThrottle={16}
            style={styles.hscroll}
          >
            <Text style={styles.wide}>{'Attachments · '.repeat(12)}</Text>
          </ScrollView>
        </ContextMenu>
        <Pressable
          testID="ctx-below"
          accessibilityLabel="Below the message"
          style={styles.below}
          onPress={onBelow}
        >
          <Text>Below the message</Text>
        </Pressable>
        <ContextMenu
          testID="ctx-accessible"
          group={MESSAGE_GROUP}
          accessible
          accessibilityLabel="Message from Grace"
          style={styles.message}
        >
          <Text style={styles.from}>Grace Hopper</Text>
          <Text>One element for screen readers, with the menu on it.</Text>
        </ContextMenu>
        <ContextMenu
          testID="ctx-outer"
          group={OUTER_GROUP}
          style={styles.outer}
          onOpen={onOuterOpen}
        >
          <Text>Outer</Text>
          <ContextMenu
            testID="ctx-inner"
            group={INNER_GROUP}
            style={styles.inner}
            onOpen={onInnerOpen}
          >
            <Text>Inner</Text>
          </ContextMenu>
        </ContextMenu>
        <ContextMenu
          testID="ctx-disabled"
          group={MESSAGE_GROUP}
          disabled
          style={styles.outer}
          onOpen={onDisabledOpen}
        >
          <Pressable
            testID="ctx-disabled-target"
            accessibilityLabel="A message with its menu disabled"
            onPress={onDisabledPress}
            style={styles.target}
          >
            <Text>Menu disabled</Text>
          </Pressable>
        </ContextMenu>
        <View style={styles.spacer} />
      </ScrollView>
      <ContextMenu
        testID="ctx-bottom"
        group={BOTTOM_GROUP}
        style={styles.bottom}
        onOpen={onBottomOpen}
      >
        <Text>At the bottom edge</Text>
      </ContextMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 12, paddingTop: 6, gap: 2 },
  content: { padding: 12, gap: 12 },
  mono: { fontSize: 10, color: '#000' },
  line1: { height: 16 },
  line2: { height: 30 },
  hint: { color: '#555' },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#ddd',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  message: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#c8c8d0',
    borderRadius: 16,
    backgroundColor: '#f2f2f7',
    gap: 8,
  },
  from: { fontWeight: '600' },
  target: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#dfe7f2',
    borderRadius: 10,
    gap: 2,
  },
  pressed: { opacity: 0.5 },
  hscroll: { height: 32 },
  wide: { fontSize: 14, lineHeight: 32, color: '#336' },
  below: { height: 44, backgroundColor: '#eef6ee', justifyContent: 'center' },
  outer: { padding: 12, backgroundColor: '#fbeeee', borderRadius: 10 },
  inner: {
    padding: 12,
    marginTop: 6,
    backgroundColor: '#f3d6d6',
    borderRadius: 8,
  },
  spacer: { height: 900 },
  bottom: {
    height: 56,
    backgroundColor: '#fff7d6',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
