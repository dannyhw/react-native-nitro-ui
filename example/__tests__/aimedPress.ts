/**
 * A press that says what it aimed at when the platform refuses it: the harness's own error
 * prints the `(0, 0)` it was handed, not the point it pressed.
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
 * Press an element the way `userEvent.press` does, and fail naming the aim. Pass the test id
 * the element was queried with.
 */
export async function pressAimed(
  element: ElementReference,
  testId: string
): Promise<void> {
  try {
    await userEvent.press(element);
  } catch (cause) {
    throw new Error(describeRefusedPress(element, testId, cause), { cause });
  }
}

/**
 * The message: the upstream text unchanged, then the view's `nativeId`, its box and the
 * centre that was pressed. The box is read after the refusal, so it can have moved since.
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
    // The lookup throws while two views share the test id, as during a remount.
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
