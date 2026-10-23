import { Button, Column, Host, Text } from '@expo/ui/jetpack-compose';

import type { BenchListProps } from '../types';
import {
  buttonRowStyle,
  buttonTitle,
  onPress,
  range,
  sharedHostStyle,
} from './shared';

/**
 * Material 3's filled `Button`, whose slot content is a `Text` - the same label
 * cost SwiftUI's `Button(label:)` and RN core's `Pressable` + `Text` pay.
 *
 * The default palette is left alone: `seedColor` would change what the arm
 * draws, and the comparison is each control's platform default. There is no
 * `testID` to pass either - the Compose `Button` props carry none, as in
 * `expoUi.android.tsx`.
 */
function BenchButton({ value }: { value: boolean }) {
  return (
    <Button onClick={onPress}>
      <Text>{buttonTitle(value)}</Text>
    </Button>
  );
}

/**
 * `@expo/ui` worst case for the library: one Compose hosting view per control
 * (one `AndroidComposeView` each).
 */
export function ExpoUiButtonHostPerControlList({ n, value }: BenchListProps) {
  return (
    <>
      {range(n).map((index) => (
        <Host key={index} matchContents style={buttonRowStyle}>
          <BenchButton key={index} value={value} />
        </Host>
      ))}
    </>
  );
}

/**
 * `@expo/ui` best case: N composables inside a single `Host`, i.e. one Compose
 * tree and one recomposition scope for the whole batch.
 */
export function ExpoUiButtonSharedHostList({ n, value }: BenchListProps) {
  if (n === 0) {
    return null;
  }
  return (
    <Host matchContents style={sharedHostStyle}>
      <Column>
        {range(n).map((index) => (
          <BenchButton key={index} value={value} />
        ))}
      </Column>
    </Host>
  );
}
