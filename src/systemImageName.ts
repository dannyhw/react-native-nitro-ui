/**
 * The name rules of the iOS `systemImage` prop. The Android twin is
 * `warnAndroidIconName` in `iconName.ts`, and the two say the same kind of thing.
 *
 * A name is checked on the device, not here: SF Symbols are added with each iOS
 * version, so a name that draws on one device draws nothing on an older one, and
 * only UIKit knows which is which. Native answers; this owns the wording.
 *
 * @internal Not app API — exported for this repo's tests.
 */

import { Platform } from 'react-native';

import { nitroUiNativeCore } from './NitroUiCore';

/** Names native has answered for. */
const answered = new Set<string>();
/** Names answered unresolved, so the answer survives the batch that asked. */
const unresolved = new Set<string>();
/** Names already sent to native, so one name costs one lookup. */
const asked = new Set<string>();
/** `${component}\u0000${prop}` sites that asked about a name not answered yet. */
const waiting = new Map<string, Set<string>>();
/** Which names the next batch will ask about, or `null` when none is queued. */
let batch: Set<string> | null = null;
/** One warning per component and name, as on Android. */
const warned = new Set<string>();

/** Where one unresolved name was seen: a component and the path of its prop. */
function site(componentName: string, propName: string): string {
  return `${componentName}\u0000${propName}`;
}

function splitSite(key: string): [string, string] {
  const split = key.indexOf('\u0000');
  return [key.slice(0, split), key.slice(split + 1)];
}

function warn(componentName: string, propName: string, name: string): void {
  const key = `${componentName}:${name}`;
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  console.warn(
    `nitro-ui: ${componentName}'s ${propName} "${name}" is not an SF Symbol ` +
      `this iOS can draw. Nothing will be drawn for it. ` +
      `See docs/components/button.md, "SF Symbols".`
  );
}

function flush(names: string[]): void {
  let answeredNames: Promise<string[]>;
  try {
    // A development warning must never become the app's problem: where there is
    // no native core, the warning simply does not come.
    answeredNames = nitroUiNativeCore().unresolvedSystemImageNames(names);
  } catch {
    return;
  }
  answeredNames.then(
    (missing: string[]) => {
      for (const name of missing) {
        unresolved.add(name);
      }
      for (const name of names) {
        answered.add(name);
        const sites = waiting.get(name);
        waiting.delete(name);
        if (sites == null || !unresolved.has(name)) {
          continue;
        }
        for (const key of sites) {
          const [componentName, propName] = splitSite(key);
          warn(componentName, propName, name);
        }
      }
    },
    () => undefined
  );
}

/**
 * Warn in development about an SF Symbol name this device cannot draw - once per
 * component and name. `propName` is the path the app would write, so a row prop
 * names its item (`items[].systemImage`).
 */
export function warnIosSystemImageName(
  componentName: string,
  propName: string,
  name: string
): void {
  if (!__DEV__ || Platform.OS !== 'ios') {
    return;
  }
  const key = site(componentName, propName);
  let sites = waiting.get(name);
  if (sites == undefined) {
    if (answered.has(name)) {
      if (unresolved.has(name)) {
        warn(componentName, propName, name);
      }
      return;
    }
    sites = new Set();
    waiting.set(name, sites);
  }
  sites.add(key);
  if (asked.has(name)) {
    return;
  }
  asked.add(name);
  if (batch == null) {
    batch = new Set();
    const queued = batch;
    setTimeout(() => {
      batch = null;
      flush([...queued]);
    }, 0);
  }
  batch.add(name);
}
