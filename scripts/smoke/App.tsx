import {
  Button,
  DatePicker,
  nitroUiCore,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
} from 'react-native-nitro-ui';
import * as React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Consumer smoke app. scripts/smoke/expo.sh and scripts/smoke/rn-cli.sh copy
// this file over the generated app's App.tsx. It is typechecked by
// `bun run check`, so a public-API rename fails the gate instead of a 10-minute
// smoke run.
//
// Contract:
//   - renders every component the package exports exactly once, each with a
//     `SMOKE-` testID;
//   - logs NITRO_UI_SMOKE_CORE_NOW once the native core answers (proves Nitro
//     Modules + our core are linked and callable);
//   - logs `NITRO_UI_SMOKE_READY <control>=<W>x<H> …`, one box per control, once
//     the core has answered AND every control has been laid out with a non-zero
//     size. That one line is the readiness signal on BOTH platforms: RN routes
//     console.* to Android logcat and to os_log (subsystem
//     "com.facebook.react.log") in every build configuration, Release included
//     - see "Consumer smoke tests" in CONTRIBUTING.md. `scripts/smoke/lib.mjs`
//     owns the shape and asserts it on both platforms, and
//     `scripts/__tests__/smoke-ready-line.test.js` proves the assertion can
//     fail; the control list here and there is a deliberate copy, because this
//     file is copied into an app we did not build and cannot import from.
//   - if the core answered but a control still has no box after
//     LAYOUT_TIMEOUT_MS, it logs `NITRO_UI_SMOKE_PENDING <control>=<W>x<H> …`
//     instead of waiting out the runner's timeout in silence. A control that
//     never lays out therefore fails fast, with its size in the log;
//   - paints a background colour (white starting, red ready, amber waiting for
//     layout, blue core-call failed) so a screenshot is readable by a human at a
//     glance. A component that crashes on mount never turns the screen red.
//
// Adding a component = add its import + ONE line to the JSX list below + its
// name to SMOKE_CONTROLS. Do not touch the ready-line logic. See CONTRIBUTING.md.
// ─────────────────────────────────────────────────────────────────────────────

type SmokeStatus = 'starting' | 'ready' | 'layout' | 'error';

/** Must match `SMOKE_CONTROLS` in `scripts/smoke/lib.mjs`. */
const SMOKE_CONTROLS = [
  'switch',
  'slider',
  'button',
  'progress',
  'segmented-control',
  'date-picker',
  'picker',
] as const;

type SmokeControl = (typeof SMOKE_CONTROLS)[number];

const READY_PREFIX = 'NITRO_UI_SMOKE_READY';
const PENDING_PREFIX = 'NITRO_UI_SMOKE_PENDING';

/** How long to wait for every box once the core answered. */
const LAYOUT_TIMEOUT_MS = 6000;

interface Box {
  width: number;
  height: number;
}

function boxText(box: Box | undefined): string {
  return box == null ? 'never' : `${box.width}x${box.height}`;
}

function isLaidOut(box: Box | undefined): boolean {
  return box != null && box.width > 0 && box.height > 0;
}

function boxesText(boxes: Partial<Record<SmokeControl, Box>>): string {
  return SMOKE_CONTROLS.map(
    (control) => `${control}=${boxText(boxes[control])}`
  ).join(' ');
}

export default function App(): React.ReactElement {
  const [status, setStatus] = React.useState<SmokeStatus>('starting');
  const [coreNow, setCoreNow] = React.useState<number | null>(null);
  const [boxes, setBoxes] = React.useState<Partial<Record<SmokeControl, Box>>>(
    {}
  );
  const announcedReady = React.useRef(false);
  const announcedPending = React.useRef(false);

  React.useEffect(() => {
    if (status !== 'starting') {
      return;
    }
    try {
      // Proves NitroModules + our native core are linked and callable.
      const now = nitroUiCore.now();
      console.log(`NITRO_UI_SMOKE_CORE_NOW=${now}`);
      setCoreNow(now);
      setStatus('ready');
    } catch (error) {
      console.log(`NITRO_UI_SMOKE_ERROR=${String(error)}`);
      setStatus('error');
    }
  }, [status]);

  /**
   * `onLayout` per control, with a stable handler each.
   *
   * Layout only arrives once per size, so the state settles; the identity
   * compare keeps a re-render that changed nothing from re-rendering again.
   */
  const measureFor = React.useMemo(() => {
    const handlers = new Map<
      SmokeControl,
      (event: LayoutChangeEvent) => void
    >();
    return (control: SmokeControl) => {
      let handler = handlers.get(control);
      if (handler == null) {
        handler = (event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          setBoxes((current) => {
            const previous = current[control];
            if (
              previous != null &&
              previous.width === width &&
              previous.height === height
            ) {
              return current;
            }
            return { ...current, [control]: { width, height } };
          });
        };
        handlers.set(control, handler);
      }
      return handler;
    };
  }, []);

  // The ready line, once: core answered, and every control has a non-zero box.
  React.useEffect(() => {
    if (status !== 'ready' || announcedReady.current) {
      return;
    }
    if (!SMOKE_CONTROLS.every((control) => isLaidOut(boxes[control]))) {
      return;
    }
    announcedReady.current = true;
    console.log(`${READY_PREFIX} ${boxesText(boxes)}`);
  }, [status, boxes]);

  // And the honest failure: say what is missing rather than staying quiet until
  // the runner's own timeout.
  React.useEffect(() => {
    if (status !== 'ready' || announcedPending.current) {
      return;
    }
    if (SMOKE_CONTROLS.every((control) => isLaidOut(boxes[control]))) {
      return;
    }
    const timer = setTimeout(() => {
      if (announcedPending.current || announcedReady.current) {
        return;
      }
      announcedPending.current = true;
      console.log(`${PENDING_PREFIX} ${boxesText(boxes)}`);
      setStatus('layout');
    }, LAYOUT_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status, boxes]);

  const missing = SMOKE_CONTROLS.filter(
    (control) => !isLaidOut(boxes[control])
  );

  return (
    <View testID="SMOKE-root" style={[StyleSheet.absoluteFill, styles[status]]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text testID="SMOKE-nitro-ui-core">
          NitroUiCore.now(): {coreNow == null ? 'pending' : coreNow}
        </Text>
        <Text style={styles.layoutText} testID="SMOKE-layouts">
          {status === 'layout'
            ? `waiting for a box: ${missing.join(', ')}`
            : 'layout'}
          {'\n'}
          {SMOKE_CONTROLS.map((control) => (
            <React.Fragment key={control}>
              {control} {boxText(boxes[control])}
              {'\n'}
            </React.Fragment>
          ))}
        </Text>

        {/* ── One line per exported component goes here. ─────────────────────
            Keep each line bare: the point is that a packed library renders in an
            app we did not build. The `onLayout` is what the ready line reports. */}
        <Switch
          defaultValue={true}
          onLayout={measureFor('switch')}
          testID="SMOKE-switch"
        />
        <Slider
          defaultValue={0.5}
          onLayout={measureFor('slider')}
          testID="SMOKE-slider"
        />
        <Button
          onLayout={measureFor('button')}
          title="Save"
          testID="SMOKE-button"
        />
        <Progress
          onLayout={measureFor('progress')}
          testID="SMOKE-progress"
          value={0.6}
        />
        <SegmentedControl
          onLayout={measureFor('segmented-control')}
          options={['One', 'Two', 'Three']}
          testID="SMOKE-segmented-control"
        />
        <DatePicker
          onLayout={measureFor('date-picker')}
          testID="SMOKE-date-picker"
        />
        <Picker
          onLayout={measureFor('picker')}
          options={['One', 'Two', 'Three']}
          testID="SMOKE-picker"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 12,
    padding: 24,
    // Stay clear of the iOS status bar / notch in screenshots.
    paddingTop: 60,
  },
  layoutText: {
    fontSize: 11,
    opacity: 0.8,
  },
  starting: {
    backgroundColor: '#ffffff',
  },
  ready: {
    backgroundColor: '#ff0000',
  },
  layout: {
    backgroundColor: '#ff9500',
  },
  error: {
    backgroundColor: '#0000ff',
  },
});
