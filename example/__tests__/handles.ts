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

/**
 * How to read each handle a fixture has said is coming, by the `testID` of the
 * control it belongs to. Filled by {@link handleRef} as fixtures render, emptied
 * by {@link forgetPromisedHandles} between cases.
 */
const promisedHandles = new Map<string, () => unknown>();

/**
 * A `hybridRef` callback that files the handle under `key` in `map`, and promises
 * it for `testId`, so {@link waitForPromisedHandle} knows a box with that `testID`
 * is not ready until the handle has landed too.
 *
 * Called while the fixture renders, which is before its native view exists: by the
 * time any box with this `testID` can be found, the promise is already on file.
 * That is what lets a box helper wait for "the box and, if one is coming, its
 * handle" without each call site naming the handle again (G12 fix round 1: the
 * Host suites raced the ref callback at sites a per-site wait had missed).
 *
 * The promise reads `map[key]`, so {@link handleOf}'s remount rule holds here too:
 * a test that mounts the same id again deletes the old entry first.
 *
 * @param map where the suite keeps handles of this kind
 * @param key the entry in `map`
 * @param testId the control's `testID`, when it is not `key`
 */
export function handleRef<T>(
  map: Record<string, T>,
  key: string,
  testId: string = key
): (view: T) => void {
  promisedHandles.set(testId, () => map[key]);
  return (view: T) => {
    map[key] = view;
  };
}

/**
 * Wait for the handle a fixture promised for `testId`, if it promised one; return
 * at once otherwise (a wrapper `View`, a Host, a control wired without
 * {@link handleRef}). Existence only: whatever the caller asserts next is unchanged.
 */
export async function waitForPromisedHandle(
  testId: string,
  timeoutMs?: number
): Promise<void> {
  const read = promisedHandles.get(testId);
  if (read == null) return;
  await waitForHandle(read, { what: `"${testId}"`, timeoutMs });
}

/**
 * Wait for a control's `hybridRef` handle to exist, then hand it back: the Host
 * suites' first read of a handle that no box lookup has waited for.
 *
 * `render` and `boxOf` resolve when the view is laid out, and the callback runs on
 * a commit after that, so a read straight after a mount can find nothing: on a
 * loaded machine HostPopups failed `No hybrid handle for "segmented row"` twice in
 * one merge run, and HostControls lost a Slider's handle the same way. The wait is
 * on existence only. Every value a test asserts is still read after it, unchanged.
 *
 * A test that mounts the same id again (a re-add, or a fresh `render` into the same
 * log) deletes the old entry first. Otherwise this would return the dropped view's
 * handle at once.
 *
 * @param read the entry, re-read every tick
 * @param what how a miss names the control
 */
export function handleOf<T>(
  read: () => T | null | undefined,
  what: string
): Promise<T> {
  return waitForHandle(read, { what: `"${what}"` });
}

/**
 * Drop every promise, so a later case cannot be satisfied (or held up) by a
 * fixture an earlier case rendered under the same `testID`. Call it in `afterEach`.
 */
export function forgetPromisedHandles(): void {
  promisedHandles.clear();
}
