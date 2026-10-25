import {
  Button,
  Column,
  DropdownMenuItem,
  ExposedDropdownMenu,
  ExposedDropdownMenuBox,
  Host,
  LoadingIndicator,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Slider,
  Switch,
  Text,
  TextField,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { menuAnchor } from '@expo/ui/jetpack-compose/modifiers';
import { useCallback, useEffect, useState } from 'react';

import type { BenchListProps } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonTitle,
  onPress,
  onPickerChange,
  onSliderChange,
  onValueChange,
  progressValue,
  range,
  rowStyle,
  pickerOptions,
  pickerSelection,
  segmentedOptions,
  sliderValue,
  stackStyle,
} from './shared';

/**
 * Module-level so the anchor gets the same `modifiers` array identity every render
 * (T02 review NIT), the way the other arms' modifier arrays are built.
 */
const MENU_ANCHOR = menuAnchor();

/**
 * Material 3's exposed dropdown menu - the control `nitro-ui`'s Android Picker is,
 * composed out of the same primitives through Expo's bridge (`@expo/ui`'s own
 * `Picker` renders exactly this shape).
 *
 * Like `BenchProgress`, the anchor's text reaches Compose through a write to a
 * native observable rather than through a prop diff: Material 3's text field owns
 * its own string, so the chosen title has to be pushed to it. That is a different
 * shape of update from `nitro-ui`'s one prop commit, and it is what this runtime
 * costs, so the arm renders what the library offers rather than something it is
 * not.
 *
 * The expanded state is React's own: `ExposedDropdownMenuBox` is controlled, and a
 * menu that no check opens stays shut in every cell - the bench measures mounting
 * the box and the items, which is what a list of mounted pickers costs.
 */
function BenchPicker({ value }: { value: boolean }) {
  const options = pickerOptions();
  const selection = pickerSelection(value);
  const title = useNativeState<string>(options[selection] ?? '');
  const [expanded, setExpanded] = useState(false);
  // Hoisted, so the arm pays no per-render callback identity (the rule every other
  // arm follows) while still answering the menu's own dismiss and choose events.
  const dismiss = useCallback(() => {
    setExpanded(false);
  }, []);
  const choose = useCallback(() => {
    onPickerChange();
    setExpanded(false);
  }, []);
  useEffect(() => {
    title.value = options[selection] ?? '';
  }, [title, options, selection]);
  return (
    <ExposedDropdownMenuBox expanded={expanded} onExpandedChange={setExpanded}>
      <TextField value={title} readOnly modifiers={[MENU_ANCHOR]} />
      <ExposedDropdownMenu expanded={expanded} onDismissRequest={dismiss}>
        {options.map((label) => (
          <DropdownMenuItem key={label} onClick={choose}>
            <DropdownMenuItem.Text>
              <Text>{label}</Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ))}
      </ExposedDropdownMenu>
    </ExposedDropdownMenuBox>
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
        ) : component === 'picker' ? (
          <Host key={index} style={style}>
            <BenchPicker value={value} />
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
          ) : component === 'picker' ? (
            <BenchPicker key={index} value={value} />
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
