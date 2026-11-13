/**
 * A press that says what it aimed at, when the platform refuses it.
 *
 * `userEvent.press(element)` presses the *view* a query answered with: the JS side sends
 * `(0, 0)` beside the `nativeId` (`@react-native-harness/ui/src/userEvent.ts:80`), the native
 * side looks that id up in its registry, resolves it to the centre of the box it finds and
 * hit-tests *that* (`HarnessUI.mm:248`). When nothing answers for the point, iOS rejects with
 * a string that formats the two numbers the call was handed —
 * `No view found at point (0.00, 0.00)` — whatever was actually aimed at (`HarnessUI.mm:277`).
 * That file ships inside the harness package, which this repo consumes and patches but does
 * not own, so the fix sits on this side of the boundary: the upstream text is kept verbatim
 * and the two facts it cannot carry are added.
 *
 * Why they are needed is written up in `Form.harness.tsx`'s E4: two red runs of one tree,
 * 35 minutes apart, where a press had either landed on a neighbouring row or landed outside
 * the window, and the only text the run printed was two zeros in both cases (X29). A failure
 * that cannot tell those two apart is a device round spent re-running it.
 *
 * The box is read *after* the rejection, which is the honest order: the point that was
 * pressed is the centre of the box the native side resolved at press time, and the only
 * reading of it available from JS is the one the same identifier answers for now. Usually the
 * same box; when it is not, the disagreement is itself the answer to "why did the press
 * miss".
 */
import { TurboModuleRegistry } from 'react-native';
import { userEvent } from '@react-native-harness/ui';
import type { ElementReference } from '@react-native-harness/ui';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * Press an element the way `userEvent.press` does, and fail naming the aim.
 *
 * The `testId` is a parameter next to the element because an `ElementReference` is one field
 * wide — a `nativeId` with no name attached — and "the view called `inner-press`, which is at
 * …, whose centre is …" is the sentence that closes a diagnosis. Pass the id the element was
 * queried with.
 */
export async function pressAimed(
  element: ElementReference,
  testId: string
): Promise<void> {
  try {
    await userEvent.press(element);
  } catch (cause) {
    // `describeRefusedPress` reads the view's box to say what was aimed at, and that lookup
    // can itself fail — a remount with two live copies of a `testID` is exactly when
    // `queryByTestId` refuses. The refusal above is the thing being diagnosed, so it goes
    // along as the cause rather than being replaced by a message about the diagnosis.
    throw new Error(describeRefusedPress(element, testId, cause), { cause });
  }
}

/**
 * The message: the upstream text unchanged, then what it left out.
 *
 * Exported because a claim that is not graded is a hope: the device case in
 * `Form.harness.tsx` aims this at a view that is outside the window — a press the platform
 * has to refuse — and reads the result for the `nativeId` and the resolved centre.
 */
export function describeRefusedPress(
  element: ElementReference,
  testId: string,
  cause: unknown
): string {
  const upstream = cause instanceof Error ? cause.message : String(cause);
  let box: ViewInfo | null = null;
  let lookedUp = true;
  try {
    box = harnessUi.queryByTestId(testId);
  } catch {
    // Named rather than swallowed: "answers for no view at all now" below would read like the
    // view is gone when what happened is that the tree refuses to name one — a different
    // answer, and the one that matters while a remount is in flight.
    lookedUp = false;
  }
  const centreX = box == null ? null : box.x + box.width / 2;
  const centreY = box == null ? null : box.y + box.height / 2;
  let thisSide: string;
  if (box == null || centreX == null || centreY == null) {
    thisSide = lookedUp
      ? `"${testId}" answers for no view at all now, so the native side had nothing to ` +
        'resolve and pressed the literal (0, 0) it was handed.'
      : `"${testId}" would not answer a lookup at all while this was being written, so the ` +
        'centre that was pressed is unknown here — read the native line above for the point.';
  } else {
    thisSide = `"${testId}" is at ${String(box.x)},${String(box.y)} → ${String(
      box.x + box.width
    )},${String(box.y + box.height)}, whose centre is (${String(centreX)}, ${String(
      centreY
    )}) — the point it pressed.`;
  }
  return (
    `press on "${testId}" was refused: ${upstream} — upstream prints the arguments it was ` +
    `handed, not the point it pressed. This side: nativeId=${element.nativeId}, and ` +
    thisSide
  );
}
