/**
 * Types for `a11y-sweep.mjs`, the Android a11y pass the real-input gate runs. See
 * `a11y.d.mts` for why the rule itself is typed here rather than reimplemented.
 */

import type { UiautomatorNode } from './uiautomator.mjs';
import type { A11yControl } from './a11y.mjs';

/** The log one case writes to, in the shape a `CheckLog` offers. */
export interface A11ySweepLog {
  check(description: string, ok: boolean): void;
  note(message: string): void;
  warn(message: string): void;
  retried(message: string): void;
}

/** What the pass needs from the device: a screen, a dump, and two scrolls. */
export interface A11ySweepNavigation {
  goToScreen(screen: string, log: A11ySweepLog): void | Promise<void>;
  dump():
    | ReadonlyArray<UiautomatorNode>
    | Promise<ReadonlyArray<UiautomatorNode>>;
  scrollPage(pixels: number): void | Promise<void>;
  scrollToTop(): void | Promise<void>;
  /** A red case's evidence, kept; answers with a sentence naming it. */
  keepEvidence?(control: A11yControl): string | Promise<string>;
}

export function runA11ySweep(
  begin: (
    id: string,
    title: string,
    options: { rerun: string[] }
  ) => A11ySweepLog,
  navigation: A11ySweepNavigation,
  controls?: ReadonlyArray<A11yControl>
): Promise<{ covered: string[]; matched: string[]; stale: string[] }>;
