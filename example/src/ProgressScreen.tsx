import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { Progress } from 'react-native-nitro-ui';

/**
 * Text colours for the current appearance.
 *
 * Copied from `SliderScreen.tsx` for the same reason: `Text` gets no dynamic
 * default colour from React Native, so a screen that has to read in both light and
 * dark mode picks its own.
 */
function useInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#fff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
  };
}

/**
 * Status bar height the system reserves for itself on Android.
 *
 * Android draws every app edge to edge, and RN's `SafeAreaView` only applies the
 * iOS safe area, so the top inset has to be added by hand.
 */
function useTopInset() {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
}

/** One display frame. The scenario is a download callback, which ticks per frame. */
const FRAME_MS = 16;

/** How far one frame moves the clock's fraction: ~1.5 s from empty to full. */
const FRAME_STEP = 0.011;

/** Rows in the list section - the case `RecyclableView` exists for. */
const LIST_ROWS = 200;

/**
 * Every Progress configuration this task has to prove, on one screen: a `value`
 * written from JS at 60 Hz, both indeterminate shapes, both determinate ones,
 * tints, a value that overshoots, `NaN`, a caller's box, a live variant switch,
 * and 200 indicators in a scrolling list.
 *
 * The list can be dropped from the tree with one press, which is how the
 * "indeterminate animation stops when nobody can see it" CPU check is run by hand:
 * watch the CPU with 200 spinning indicators, drop them, and watch it fall to
 * idle (`docs/components/progress.md`).
 */
export default function ProgressScreen() {
  const ink = useInk();
  const [clockValue, setClockValue] = useState(0);
  const [clockRunning, setClockRunning] = useState(true);
  const [writes, setWrites] = useState(0);
  const [variant, setVariant] = useState<'linear' | 'circular'>('linear');
  const [listMounted, setListMounted] = useState(true);
  const writesRef = useRef(0);

  // The 60 Hz scenario: a sawtooth fraction written on every frame, which is the
  // shape of a download progress callback. It is the expensive thing on the page,
  // so it can be stopped - and it stops by itself when this screen unmounts.
  useEffect(() => {
    if (!clockRunning) {
      return undefined;
    }
    const timer = setInterval(() => {
      setClockValue((current) => {
        const next = current + FRAME_STEP;
        return next > 1 ? 0 : next;
      });
      writesRef.current += 1;
      setWrites(writesRef.current);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [clockRunning]);

  const list = useMemo(
    () =>
      Array.from({ length: LIST_ROWS }, (_, index) => ({
        id: `row-${index}`,
        // Every third row is indeterminate, so the recycled rows carry both kinds
        // of state across a recycle.
        value: index % 3 === 0 ? null : (index % 11) / 10,
      })),
    []
  );

  const topInset = useTopInset();

  return (
    <SafeAreaView
      style={[
        styles.root,
        { backgroundColor: ink.background, paddingTop: topInset },
      ]}
    >
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={[styles.title, { color: ink.ink }]}>Progress</Text>
        <Text style={[styles.note, { color: ink.muted }]}>
          value is a 0...1 fraction; null is indeterminate. Out-of-range values
          clamp and NaN draws empty.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>
          60 Hz from JavaScript
        </Text>
        <Progress value={clockValue} testID="progress-clock" />
        <Row label="Written this run">
          <Text
            style={[styles.value, { color: ink.ink }]}
            testID="progress-writes"
          >
            {writes}
          </Text>
        </Row>
        <Row label="Fraction shown">
          <Text style={[styles.value, { color: ink.ink }]}>
            {clockValue.toFixed(3)}
          </Text>
        </Row>
        <Pressable
          onPress={() => setClockRunning((running) => !running)}
          testID="progress-toggle-clock"
        >
          <Text style={styles.link}>
            {clockRunning ? 'Stop the 60 Hz writes' : 'Start the 60 Hz writes'}
          </Text>
        </Pressable>

        <Text style={[styles.section, { color: ink.ink }]}>Indeterminate</Text>
        <Progress testID="progress-linear-indeterminate" />
        <Progress variant="circular" testID="progress-circular-indeterminate" />

        <Text style={[styles.section, { color: ink.ink }]}>Determinate</Text>
        <Progress value={0} testID="progress-linear-empty" />
        <Progress value={0.35} testID="progress-linear-third" />
        <Progress value={1} testID="progress-linear-full" />
        <View style={styles.inlineRow}>
          <Progress
            variant="circular"
            value={0.2}
            testID="progress-circular-fifth"
          />
          <Progress
            variant="circular"
            value={0.65}
            testID="progress-circular-two-thirds"
          />
        </View>

        <Text style={[styles.section, { color: ink.ink }]}>Tinted</Text>
        <Progress
          value={0.45}
          tintColor="#7C4DFF"
          trackColor="#3f3f46"
          testID="progress-tinted-linear"
        />
        <Progress
          variant="circular"
          value={0.45}
          tintColor="#FF6D00"
          trackColor="#3f3f46"
          testID="progress-tinted-circular"
        />
        <Progress
          tintColor="#2E7D32"
          trackColor="#3f3f46"
          testID="progress-tinted-indeterminate"
        />

        <Text style={[styles.section, { color: ink.ink }]}>
          Values an app gets wrong
        </Text>
        <Row label="value=1.7 (clamps to 1)">
          <Progress
            value={1.7}
            testID="progress-overshoot"
            style={styles.shortBar}
          />
        </Row>
        <Row label="value=NaN (draws empty)">
          <Progress
            value={Number.NaN}
            testID="progress-nan"
            style={styles.shortBar}
          />
        </Row>

        <Text style={[styles.section, { color: ink.ink }]}>
          A caller&apos;s box
        </Text>
        <View style={styles.sizedBox}>
          <Progress
            value={0.5}
            style={styles.sizedProgress}
            testID="progress-sized"
          />
        </View>
        <Text style={[styles.note, { color: ink.muted }]}>
          width: 180 is the bar&apos;s; a linear Progress is laid out alignSelf:
          &apos;stretch&apos; by default, and its height stays the
          control&apos;s.
        </Text>

        <Text style={[styles.section, { color: ink.ink }]}>Variant switch</Text>
        <Progress
          variant={variant}
          value={0.6}
          testID="progress-variant"
          accessibilityLabel="Variant switcher"
        />
        <Pressable
          onPress={() =>
            setVariant((current) =>
              current === 'linear' ? 'circular' : 'linear'
            )
          }
          testID="progress-toggle-variant"
        >
          <Text style={styles.link}>
            Switch to {variant === 'linear' ? 'circular' : 'linear'}
          </Text>
        </Pressable>

        <Text style={[styles.section, { color: ink.ink }]}>
          200 in a list{' '}
          <Pressable
            onPress={() => setListMounted((mounted) => !mounted)}
            testID="progress-toggle-list"
          >
            <Text style={styles.link}>
              {listMounted ? '(drop them)' : '(mount them)'}
            </Text>
          </Pressable>
        </Text>
        {listMounted ? (
          <View style={styles.list}>
            {list.map((row, index) => (
              <View key={row.id} style={styles.listRow}>
                <Text style={[styles.listLabel, { color: ink.muted }]}>
                  {index}
                </Text>
                <Progress
                  value={row.value}
                  testID={`progress-list-${index}`}
                  nuiPerfId={null}
                />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const ink = useInk();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      {children}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 22,
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 12,
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  link: {
    color: '#3b82f6',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 16,
  },
  // A bar inside a row, so the label can sit beside it: the bar takes the width the
  // row gives it and keeps its own height.
  shortBar: {
    width: 140,
  },
  sizedBox: {
    alignItems: 'flex-start',
  },
  sizedProgress: {
    width: 180,
    height: 60,
  },
  list: {
    gap: 2,
  },
  listRow: {
    gap: 2,
  },
  listLabel: {
    fontSize: 11,
  },
});
