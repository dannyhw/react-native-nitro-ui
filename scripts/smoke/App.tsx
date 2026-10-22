import { nitroUiCore } from 'react-native-nitro-ui';
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Consumer smoke app. scripts/smoke/expo.sh and scripts/smoke/rn-cli.sh copy
// this file over the generated app's App.tsx.
//
// Contract:
//   - renders every component the package exports exactly once, each with a
//     `SMOKE-` testID;
//   - signals readiness over TWO host-observable channels, because JS console
//     output is stripped in iOS Release builds (RN routes console.* nowhere
//     once `__DEV__` is false):
//       1. logs NITRO_UI_SMOKE_READY once, after mount and once the native
//          core answers (visible in Android Release logcat);
//       2. paints the background a semaphore colour:
//            white = still starting, red = READY, blue = core call failed.
//          scripts/smoke/pixel-ready.mjs decodes a screenshot and reads it.
//   A component that crashes on mount therefore never turns the screen red.
//
// Adding a component = add its import + ONE line to the JSX list below.
// Do not touch the ready/semaphore logic. See "Consumer smoke tests" in
// CONTRIBUTING.md.
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
    <View
      testID="SMOKE-root"
      style={[StyleSheet.absoluteFill, styles.semaphore(status)]}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text testID="SMOKE-nitro-ui-core">
          NitroUiCore.now(): {coreNow == null ? 'pending' : coreNow}
        </Text>

        {/* ── One line per exported component goes here. Example: ───────────
        <NitroUiSwitch key="switch" testID="SMOKE-switch" value={true} /> */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 12,
    padding: 24,
  },
  semaphore: (status: SmokeStatus) => ({
    backgroundColor:
      status === 'ready'
        ? '#ff0000'
        : status === 'error'
          ? '#0000ff'
          : '#ffffff',
  }),
});
