import {
  Button,
  nitroUiCore,
  Progress,
  Slider,
  Switch,
} from 'react-native-nitro-ui';
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Consumer smoke app. scripts/smoke/expo.sh and scripts/smoke/rn-cli.sh copy
// this file over the generated app's App.tsx. It is typechecked by
// `bun run check`, so a public-API rename fails the gate instead of a 10-minute
// smoke run.
//
// Contract:
//   - renders every component the package exports exactly once, each with a
//     `SMOKE-` testID;
//   - logs NITRO_UI_SMOKE_READY once, after mount and once the native core
//     answers. That one line is the readiness signal on BOTH platforms: RN
//     routes console.* to Android logcat and to os_log (subsystem
//     "com.facebook.react.log") in every build configuration, Release included
//     - see "Consumer smoke tests" in CONTRIBUTING.md;
//   - paints a background colour (white starting, red ready, blue core-call
//     failed) so a screenshot is readable by a human at a glance. A component
//     that crashes on mount therefore never turns the screen red.
//
// Adding a component = add its import + ONE line to the JSX list below.
// Do not touch the ready-line logic. See CONTRIBUTING.md.
// ─────────────────────────────────────────────────────────────────────────────

type SmokeStatus = 'starting' | 'ready' | 'error';

export default function App(): React.ReactElement {
  const [status, setStatus] = React.useState<SmokeStatus>('starting');
  const [coreNow, setCoreNow] = React.useState<number | null>(null);

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

  React.useEffect(() => {
    if (status === 'ready') {
      console.log('NITRO_UI_SMOKE_READY');
    }
  }, [status]);

  return (
    <View testID="SMOKE-root" style={[StyleSheet.absoluteFill, styles[status]]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text testID="SMOKE-nitro-ui-core">
          NitroUiCore.now(): {coreNow == null ? 'pending' : coreNow}
        </Text>

        {/* ── One line per exported component goes here. ─────────────────────
            Keep each line bare: the point is that a packed library renders in an
            app we did not build. */}
        <Switch testID="SMOKE-switch" defaultValue={true} />
        <Slider testID="SMOKE-slider" defaultValue={0.5} />
        <Button testID="SMOKE-button" title="Save" />
        <Progress testID="SMOKE-progress" value={0.6} />
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
  starting: {
    backgroundColor: '#ffffff',
  },
  ready: {
    backgroundColor: '#ff0000',
  },
  error: {
    backgroundColor: '#0000ff',
  },
});
