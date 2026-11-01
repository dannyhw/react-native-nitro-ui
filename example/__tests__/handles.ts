/**
 * Waiting for a `hybridRef` handle, in the one place several suites need it.
 *
 * Every suite here reads something through a control's own handle — a box
 * (`measureContent`), a state report, a sizing id — and the handle arrives on a
 * React commit *after* the view exists. The suites already knew that:
 * `ColdSizing.sizingIdOf` polls for `nuiSizingId`, and most call sites follow a
 * `waitForTestId`, which waits for the *box* and says nothing about the callback.
 * Run 41230848294 on a hosted runner is what made the difference measurable:
 * `Switch · keeps the control inside its default box` died on
 * `expected null not to be null` at `hybrid?.measureContent()` while its own log
 * line showed `fabric=61x28`, and `Conformance · is named on its own box` died on
 * `no hybridRef handle for "conformance-date-picker"` at load1 152 on 3 cores,
 * while both passed in the next dispatch of the same suite (41234953779). The box
 * was there; the callback had not run yet.
 *
 * So asking for a handle asks: has the callback for this control run? Poll, and
 * name the miss if it never does — a control whose handle never arrives is a real
 * bug, and this throws that fact rather than letting a caller read a property off
 * `undefined`. The CI text was `Cannot read property 'nuiSizingId' of undefined`,
 * which reads like a product crash and is a fixture that did not wait.
 *
 * The wait is on the handle, not on a duration, so it costs nothing when the
 * callback already ran and hides nothing: every assertion after it is unchanged.
 */

/** How long a `hybridRef` callback may take to run after its view was laid out. */
const HANDLE_TIMEOUT_MS = 5000;

/** How often to ask. A commit lands well inside one tick. */
const POLL_MS = 20;

/**
 * Poll until `read()` hands back a handle, and fail with a sentence about the
 * control rather than a `TypeError` about `undefined`.
 *
 * `read` is a thunk because these suites keep handles in a `Map` keyed by testID,
 * filled by one `hybridRef` callback shared by several controls, and the entries
 * arrive in whatever order React commits them.
 *
 * @param read called every tick; anything non-nullish is taken as the handle
 * @param options.what the control, as the failure should name it
 * @param options.timeoutMs how long to wait (defaults to 5 s)
 */
export async function waitForHandle<T>(
  read: () => T | null | undefined,
  options: { what: string; timeoutMs?: number } = { what: 'control' }
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? HANDLE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = read();
    if (handle != null) return handle;
    if (Date.now() > deadline) {
      throw new Error(
        `no hybridRef handle for ${options.what} within ${String(timeoutMs)}ms. ` +
          'A box can exist before its ref callback has run — the callback lands on ' +
          'a commit after the view is created — so this is the handle being late, ' +
          'not the control being broken; if it never arrives at all, the control ' +
          'has stopped handing back its state.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
