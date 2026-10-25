import {
  Button,
  Column,
  Host,
  LoadingIndicator,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Slider,
  Switch,
  Text,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { useEffect } from 'react';

import type { BenchListProps } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonTitle,
  onPress,
  onSliderChange,
  onValueChange,
  progressValue,
  range,
  rowStyle,
  segmentedOptions,
  sliderValue,
  stackStyle,
} from './shared';

/**
 * `@expo/ui` worst case for the library: one Compose hosting view per control
 * (one `AndroidComposeView` each). Expo UI always needs a `Host`, so both Expo
 * arms are required for a fair comparison
 * (docs/research/setup-decisions.md SS6).
 */
/**
 * `@expo/ui` has no DatePicker arm on Android, and a launch that asks for one
 * fails here rather than reaching Compose.
 *
 * Its only picker surface is the inline Material 3 `DateTimePicker` (there is no
 * date *field*: `DatePickerDialog` is a whole dialog, not a mountable control),
 * and neither shape of it is priceable against this library's compact field.
 * Measured on `nitroui_t02` (2026-10-25):
 *
 * - inside the `matchContents` host every self-sizing arm gets, the calendar's
 *   horizontally scrollable month pager is measured with infinite width and the
 *   process dies: `IllegalStateException: Horizontally scrollable component was
 *   measured with an infinity maximum width constraints`;
 * - with the width bounded it mounts, at 2.45 s of mount work per iteration of
 *   50 inline calendars (~96 s per launch for one host per batch, more once each
 *   calendar gets its own host), which is the runner's entire per-launch budget.
 *
 * The runner therefore never schedules these cells on Android
 * (`scripts/bench/lib.mjs` `ARMS_WITHOUT_COMPONENT`); this is the loud failure
 * for a launch that asks anyway, in place of an opaque Compose crash or 50
 * calendars that took three minutes to lay out.
 */
function unsupportedDatePicker(): never {
  throw new Error(
    'expo-ui has no DatePicker arm on Android: @expo/ui exposes no mountable date ' +
      'field, and its inline M3 calendar cannot be measured by a matchContents ' +
      'host (see ARMS_WITHOUT_COMPONENT in scripts/bench/lib.mjs).'
  );
}

/**
 * `@expo/ui` worst case for the library: one Compose hosting view per control
 * (one `AndroidComposeView` each). Expo UI always needs a `Host`, so both Expo
 * arms are required for a fair comparison
 * (docs/research/setup-decisions.md SS6).
 */
export function ExpoUiHostPerControlList({
  n,
  value,
  component,
}: BenchListProps) {
  if (component === 'date-picker') {
    return unsupportedDatePicker();
  }
  const style = rowStyle(component);
  return (
    <>
      {range(n).map((index) =>
        component === 'button' ? (
          // `matchContents` lets the host take the button's fitting size, which
          // is how a consumer ships a sized-to-content control here. It is part
          // of what this arm costs per control and is measured as such - and it
          // stays out of the switch/slider/progress arms, which are published
          // numbers.
          <Host key={index} matchContents style={style}>
            <BenchButton value={value} />
          </Host>
        ) : component === 'segmented-control' ? (
          <Host key={index} matchContents style={style}>
            <BenchSegmented value={value} />
          </Host>
        ) : (
          <Host key={index} style={style}>
            {component === 'slider' ? (
              <BenchSlider value={value} />
            ) : component === 'progress' ? (
              <BenchProgress value={value} />
            ) : (
              <Switch value={value} onCheckedChange={onValueChange} />
            )}
          </Host>
        )
      )}
    </>
  );
}

/**
 * Material 3's filled `Button`, whose slot content is a `Text` - the same label
 * cost SwiftUI's `Button(label:)` and RN core's `Pressable` + `Text` pay.
 *
 * The default palette is left alone: `seedColor` would change what the arm draws,
 * and the comparison is each control's platform default. There is no `testID` to
 * pass either - the Compose `Button` props carry none, as in the Switch arm.
 */
function BenchButton({ value }: { value: boolean }) {
  return (
    <Button onClick={onPress}>
      <Text>{buttonTitle(value)}</Text>
    </Button>
  );
}

/**
 * A bare Material 3 `Slider`, no tick marks and no label slots.
 *
 * `steps={0}` is continuous, matching the continuous default of the control
 * under test: a stepped slider draws tick marks neither of the other arms has
 * (T02 review B3).
 */
function BenchSlider({ value }: { value: boolean }) {
  return (
    <Slider
      value={sliderValue(value)}
      min={0}
      max={1}
      steps={0}
      onValueChange={onSliderChange}
    />
  );
}

/**
 * The closest thing `@expo/ui` has to a progress bar: its `LoadingIndicator`
 * (Material 3's expressive `LoadingIndicator`), which is *indeterminate by
 * default* and becomes determinate only when handed a `progress` **observable**.
 *
 * That is a different shape of update from every other arm's, and it is the Expo
 * UI way of doing progress, so the arm renders what the library offers rather
 * than something it is not:
 *
 * - one observable per control (`useNativeState` is a hook, so this has to be a
 *   component per indicator - which is also what the host-per-control arm needs);
 * - the runner's flipped bit reaches Compose through a **write to the state**,
 *   not through a native prop diff: React re-renders the child, the effect writes
 *   `state.value`, and Expo schedules that write to the UI thread.
 *
 * So on `update.progress` this arm measures "React render inside the host + one
 * shared-object write" while `nitro-ui` measures "one prop commit over Nitro".
 * Both are what their runtime costs; neither arm is shaped to look cheap.
 *
 * What this arm is *not*: M3's `LinearProgressIndicator`/`CircularProgressIndicator`
 * are not exposed by `@expo/ui`, so this is the equivalent **API surface** for a
 * progress value, not the same drawable as the other two arms. The table says so.
 */
function BenchProgress({ value }: { value: boolean }) {
  const progress = useNativeState<number | null>(progressValue(value));
  useEffect(() => {
    progress.value = progressValue(value);
  }, [progress, value]);
  return <LoadingIndicator progress={progress} />;
}

/**
 * Material 3's single-choice segmented row - the same composable nitro-ui hosts,
 * reached through Expo's bridge instead of through Nitro.
 *
 * No `colors`: `tintColor` has an equivalent here, but the comparison is each
 * control's platform default (as in `BenchButton`), and a seeded palette would
 * change what this arm draws. Like the other Compose arms it has no `testID` to
 * pass - the props carry none.
 */
function BenchSegmented({ value }: { value: boolean }) {
  return (
    <SingleChoiceSegmentedButtonRow>
      {segmentedOptions(value).map((label, segment) => (
        <SegmentedButton
          key={label}
          selected={segment === SEGMENTED_SELECTION}
          onClick={onPress}
        >
          <SegmentedButton.Label>{label}</SegmentedButton.Label>
        </SegmentedButton>
      ))}
    </SingleChoiceSegmentedButtonRow>
  );
}

/**
 * `@expo/ui` best case: N composables inside a single `Host`, i.e. one Compose
 * tree and one recomposition scope for the whole batch.
 */
export function ExpoUiSharedHostList({ n, value, component }: BenchListProps) {
  if (component === 'date-picker') {
    return unsupportedDatePicker();
  }
  if (n === 0) {
    return null;
  }
  return (
    <Host style={stackStyle(n, component)}>
      <Column>
        {range(n).map((index) =>
          component === 'button' ? (
            <BenchButton key={index} value={value} />
          ) : component === 'segmented-control' ? (
            <BenchSegmented key={index} value={value} />
          ) : component === 'slider' ? (
            <BenchSlider key={index} value={value} />
          ) : component === 'progress' ? (
            <BenchProgress key={index} value={value} />
          ) : (
            <Switch key={index} value={value} onCheckedChange={onValueChange} />
          )
        )}
      </Column>
    </Host>
  );
}
