/**
 * The iOS twin of `warnAndroidIconName` in `iconName.ts`: the same sentence about
 * a name that will draw nothing, answered by the device rather than by a rule.
 * SF Symbols are added with each iOS version, so a name that draws on one device
 * draws nothing on an older one, and only UIKit knows which is which.
 *
 * @internal Not app API - the library's own components call this.
 */

import { Platform } from 'react-native';

import { nitroUiNativeCore } from './NitroUiCore';

/** Where a name was seen: the component, and the path of the prop that carried it. */
type SymbolSite = {
  readonly componentName: string;
  readonly propName: string;
};

/**
 * What the device answered per name: `false` for a name it cannot draw. A name
 * the device could not be asked about is kept here as one that draws.
 */
const answers = new Map<string, boolean>();
/** Names already sent to the device, so one name costs one lookup. */
const asked = new Set<string>();
/** Sites that named a name the device has not answered yet. */
const waiting = new Map<string, SymbolSite[]>();
/** Which names the next batch will ask about, or `null` when none is queued. */
let batch: Set<string> | null = null;
/** One warning per component and name, as on Android. */
const warned = new Set<string>();

function warn(site: SymbolSite, name: string): void {
  const key = `${site.componentName}:${name}`;
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  console.warn(
    `nitro-ui: ${site.componentName}'s ${site.propName} "${name}" is not an SF ` +
      `Symbol this iOS can draw. Nothing will be drawn for it. ` +
      `See docs/components/button.md, "SF Symbols".`
  );
}

function drop(names: string[]): void {
  // Answered as one that draws, so the warning is dropped and the name is never
  // asked again: a core that cannot answer must not leave another site waiting
  // on every render.
  for (const name of names) {
    answers.set(name, true);
    waiting.delete(name);
  }
}

function flush(names: string[]): void {
  let asking: Promise<string[]>;
  try {
    // A development warning must never become the app's problem: where there is
    // no native core, the warning simply does not come.
    asking = nitroUiNativeCore().unresolvedSystemImageNames(names);
  } catch {
    drop(names);
    return;
  }
  asking.then(
    (missing: string[]) => {
      const missingNames = new Set(missing);
      for (const name of names) {
        answers.set(name, !missingNames.has(name));
        const sites = waiting.get(name);
        waiting.delete(name);
        if (sites == null || !missingNames.has(name)) {
          continue;
        }
        for (const site of sites) {
          warn(site, name);
        }
      }
    },
    () => {
      drop(names);
    }
  );
}

/**
 * Warn in development about an SF Symbol name this device cannot draw - once per
 * component and name. `propName` is the path the app would write, so a row prop
 * names its item (`items[].systemImage`). The device answers after the render
 * that asked, so the warning follows the render rather than landing in it.
 */
export function warnIosSystemImageName(
  componentName: string,
  propName: string,
  name: string
): void {
  if (!__DEV__ || Platform.OS !== 'ios') {
    return;
  }
  const site: SymbolSite = { componentName, propName };
  const answer = answers.get(name);
  if (answer != null) {
    if (!answer) {
      warn(site, name);
    }
    return;
  }
  const waitingHere = waiting.get(name);
  if (waitingHere == null) {
    waiting.set(name, [site]);
  } else {
    waitingHere.push(site);
  }
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
