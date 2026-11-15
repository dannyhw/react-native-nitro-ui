/**
 * The a11y sweep, as the last thing the run does on the way out.
 *
 * One pass over `A11Y_CONTROLS`: for every control, scroll until its name has a
 * box, dump the tree, and ask the rule in `scripts/real-input/a11y.mjs` whether
 * the name sits on a node a person can act on. The rule cannot be stated from
 * inside the app — Compose publishes a hosted control's name on a `SemanticsNode`
 * that no in-app query can see — and it needs no gestures, which is why it runs
 * once over the whole table rather than once per control's own test.
 *
 * The pass itself is `runA11ySweep`, the same module the driver-era gate ran, and
 * the same one `scripts/__tests__/conformance.test.js` drives against a fake
 * device; what lives here is the navigation it scrolls and dumps through.
 */
import { writeFileSync } from 'node:fs';

import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import {
  runA11ySweep,
  type A11ySweepLog,
} from '../../../scripts/real-input/a11y-sweep.mjs';
import { screenTab } from '../../../scripts/real-input/screens.mjs';
import { openScreen, pageScroll, pageToTop } from './support';
import { tree } from './os-tree';

/** One case's verdict, as the gate's ledger wants to read it. */
interface SweepCase {
  id: string;
  title: string;
  failures: string[];
  notes: string[];
  warns: string[];
  retries: string[];
}

/** The `CheckLog` shape `runA11ySweep` writes to, collected instead of printed. */
function collectingLog(id: string, title: string): A11ySweepLog & SweepCase {
  const log = {
    id,
    title,
    failures: [] as string[],
    notes: [] as string[],
    warns: [] as string[],
    retries: [] as string[],
    check(description: string, ok: boolean): void {
      if (ok) {
        log.notes.push(`ok: ${description}`);
        console.log(`    ✓ ${description}`);
        return;
      }
      log.failures.push(description);
      console.log(`    ✗ ${description}`);
    },
    note(message: string): void {
      log.notes.push(message);
      console.log(`    · ${message}`);
    },
    warn(message: string): void {
      log.warns.push(message);
      console.log(`    WARN ${message}`);
    },
    retried(message: string): void {
      log.retries.push(message);
      log.note(message);
    },
  };
  return log;
}

test('every control is named on one node a person can act on', async ({
  app,
  screen,
}) => {
  await app.open();

  const cases: SweepCase[] = [];
  let screenOn: string | null = null;

  const result = await runA11ySweep(
    (id, title) => {
      const log = collectingLog(id, title);
      cases.push(log);
      return log;
    },
    {
      goToScreen: async (target, log) => {
        // Called whenever the table's next case lives on another screen, which
        // includes a return to one it visited earlier — so this cannot skip a
        // screen it has seen.
        screenOn = target;
        const anchor = screenTab(target).anchor;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          await openScreen(screen, target);
          try {
            await screen
              .getByTestId(anchor)
              .waitFor({ state: 'visible', timeout: 20_000 });
            return;
          } catch (error) {
            if (attempt === 3) {
              throw new Error(
                `real-input: the "${target}" tab was pressed three times and the ` +
                  `screen never drew its own "${anchor}" echo: ` +
                  String((error as Error)?.message ?? error)
              );
            }
            log.retried(
              `the "${target}" screen did not arrive on the first press — pressing ` +
                `its tab again (attempt ${String(attempt + 1)} of 3)`
            );
          }
        }
      },
      dump: () => tree(),
      scrollPage: async (pixels) => {
        await pageScroll(screen, pixels);
      },
      scrollToTop: async () => {
        if (screenOn == null) return;
        await pageToTop(screen);
      },
    }
  );

  const file = process.env.NITRO_UI_A11Y_SWEEP_FILE;
  if (file != null && file !== '') {
    writeFileSync(
      file,
      JSON.stringify({ cases, ...result }, null, 2) + '\n',
      'utf8'
    );
  }

  const failed = cases.filter((entry) => entry.failures.length > 0);
  expect(
    failed.map((entry) => `${entry.id}: ${entry.failures.join(' | ')}`),
    `the a11y sweep found ${String(failed.length)} control(s) of ` +
      `${String(cases.length)} whose accessibility tree does not answer the rule` +
      (result.stale.length > 0
        ? ` — and ${String(result.stale.length)} exemption row(s) describe debt ` +
          'that is no longer there'
        : '')
  ).toEqual([]);
  expect(
    result.stale,
    'rows of A11Y_EXEMPTIONS matched nothing this run: the debt they record has ' +
      'been fixed, and the row has to go with it'
  ).toEqual([]);
  expect(
    cases.length,
    'the sweep ran fewer cases than the table has controls'
  ).toBeGreaterThan(0);
});
