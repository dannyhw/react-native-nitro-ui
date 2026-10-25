import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import type { BenchListProps } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonTitle,
  dateLabel,
  onPress,
  onValueChange,
  range,
  rowStyle,
  segmentedOptions,
} from './shared';

/**
 * The control arm: what RN core itself offers for each component.
 *
 * Every metric is reported relative to this, which is also how the runner
 * detects a noisy machine (if `rn-core` moves between runs, the run is
 * inconclusive).
 *
 * - `switch`: plain `react-native` `Switch`, i.e. the platform widget wrapped by
 *   RN core.
 * - `slider`: RN core has no slider - it left the framework in 0.80 - so the
 *   floor is a bare `View` in the same box. That is a *floor*, not a peer: it
 *   hosts no control, runs no gesture code and owns no value, so a slider arm's
 *   ratio against it says "what does any native slider cost over drawing
 *   nothing", and the `@expo/ui` arms are what answer "what does it cost over
 *   another native slider".
 * - `button`: RN core has no button widget either, so the idiomatic core
 *   equivalent is a `Pressable` wrapping a `Text`. The label is a real child
 *   `Text` because that is what the other arms pay too: SwiftUI draws the label
 *   of `Button(label:)` and Material 3 composes a `Text` inside the button slot.
 *   Padding and background are the minimum that makes it a button rather than
 *   tappable text - RN core owns no theme, so anything richer would be this
 *   arm's decoration, not the control's.
 * - `segmented-control`: RN core has no segmented control either, so the
 *   idiomatic core equivalent is a row of `Pressable`s, one `Text` each - which is
 *   what a pure-JS implementation of this control is. Also a *floor*: it owns no
 *   native control, and the segments are RN views rather than one hosted control,
 *   which is exactly the cost this arm exists to make visible. One label pair
 *   (`segmentedOptions`) and one selected index (`SEGMENTED_SELECTION`) are shared
 *   with the other arms, so the row says the same words and paints the same
 *   segment chosen.
 * - `date-picker`: RN core has no date picker either, so the idiomatic core
 *   equivalent is the label a JS-only picker would show: the same instant every
 *   other arm displays, formatted by the shared `Intl` formatter (`dateLabel`).
 *   Also a *floor* - it owns no calendar, no dialog and no native control - and
 *   the G5 brief asks for exactly this arm.
 */
export function RnCoreList({ n, value, component }: BenchListProps) {
  const style = rowStyle(component);
  if (component === 'date-picker') {
    return (
      <>
        {range(n).map((index) => (
          <Text key={index} testID={`bench-rn-core-date-${String(index)}`} style={style}>
            {dateLabel(value)}
          </Text>
        ))}
      </>
    );
  }
  if (component === 'segmented-control') {
    const options = segmentedOptions(value);
    return (
      <>
        {range(n).map((index) => (
          <View
            key={index}
            testID={`bench-rn-core-segmented-${String(index)}`}
            style={[style, segmentedStyles.row]}
          >
            {options.map((label, segment) => (
              <Pressable
                key={label}
                onPress={onPress}
                style={
                  segment === SEGMENTED_SELECTION
                    ? segmentedStyles.selected
                    : segmentedStyles.segment
                }
              >
                <Text
                  style={
                    segment === SEGMENTED_SELECTION
                      ? segmentedStyles.selectedLabel
                      : segmentedStyles.label
                  }
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </>
    );
  }
  if (component === 'button') {
    return (
      <>
        {range(n).map((index) => (
          <Pressable
            key={index}
            testID={`bench-rn-core-button-${String(index)}`}
            onPress={onPress}
            style={style}
          >
            <Text style={[buttonStyles.background, buttonStyles.label]}>
              {buttonTitle(value)}
            </Text>
          </Pressable>
        ))}
      </>
    );
  }
  if (component === 'slider') {
    return (
      <>
        {range(n).map((index) => (
          <View
            key={index}
            testID={`bench-rn-core-slider-${String(index)}`}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'progress') {
    // RN core has no progress bar. What it does have is `ActivityIndicator`,
    // the control every RN app reaches for when something is loading, and the
    // G3 brief asks for it as the floor. Two honest consequences, both reported:
    // it is *indeterminate and circular* while the other arms render a linear
    // determinate bar, and it has no value, so `update.progress` flips nothing
    // on it (`NO_MOUNT_SIGNAL` in `plan.ts`). A ratio against it therefore reads
    // "what does a native progress bar cost over an RN spinner", not "over a
    // peer progress bar" - the `@expo/ui` arms answer the peer question.
    return (
      <>
        {range(n).map((index) => (
          <ActivityIndicator
            key={index}
            testID={`bench-rn-core-progress-${String(index)}`}
            animating={true}
            style={style}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {range(n).map((index) => (
        <Switch
          key={index}
          testID={`bench-rn-core-${index}`}
          value={value}
          onValueChange={onValueChange}
          style={style}
        />
      ))}
    </>
  );
}

const buttonStyles = StyleSheet.create({
  background: {
    backgroundColor: '#6750A4',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  label: { color: '#FFFFFF' },
});

/**
 * The minimum that makes the core floor read as one segmented control: a shared
 * outline, a divider per segment, and a fill on the chosen one. Any richer and
 * this arm would be drawing its own design rather than the control's.
 */
const segmentedStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#79747E',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: '#79747E',
  },
  selected: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: '#79747E',
    backgroundColor: '#E8DEF8',
  },
  label: { color: '#1D1B20' },
  selectedLabel: { color: '#1D1B20', fontWeight: '600' },
});
