import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { BenchListProps } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonGroupTitles,
  buttonTitle,
  dateLabel,
  ICON_BUTTON_LABEL,
  iconButtonGlyph,
  menuTitle,
  onButtonGroupPress,
  onIconButtonPress,
  onPress,
  onValueChange,
  range,
  rowStyle,
  pickerOptions,
  pickerSelection,
  segmentedOptions,
  onTextChange,
  textFieldValue,
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
 * - `picker`: RN core has no picker either, so the idiomatic core equivalent is a
 *   `Pressable` whose `Text` says which option is chosen - what a pure-JS picker
 *   without a popup is. Also a *floor*: it owns no popup, no list, and no native
 *   control, which is exactly the cost this arm exists to make visible. The words
 *   (`pickerOptions`) and the chosen index (`pickerSelection`) are shared with the
 *   other arms, so the flip paints the same new title everywhere, and the box has
 *   to grow with it the way the hosted controls' boxes do.
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
 * - `menu`: RN core has no menu either, so the floor is the same `Pressable` +
 *   `Text` trigger, drawn with the shared `menuTitle` and nothing else: no popup,
 *   no list, no native control. The ratio therefore reads "what does a real menu
 *   cost over a tappable label", and the `@expo/ui` arms answer the peer question.
 * - `icon-button`: RN core has no icon button, so the floor is the `Pressable` +
 *   `Image` pair every RN app writes when it needs one — the brief's own wording.
 *   Also a *floor*, and a thinner one than the others: it is a tappable image with
 *   a label, so it owns no container, no state layer, no ripple/highlight, and no
 *   minimum touch target (the glyph box is 24 dp, below the 48 dp both platforms
 *   enforce for the real controls, which is part of what those cost). The shared
 *   glyph keeps the picture identical to the other arms' on each platform.
 */
export function RnCoreList({ n, value, component }: BenchListProps) {
  const style = rowStyle(component);
  if (component === 'date-picker') {
    return (
      <>
        {range(n).map((index) => (
          <Text
            key={index}
            testID={`bench-rn-core-date-${String(index)}`}
            style={style}
          >
            {dateLabel(value)}
          </Text>
        ))}
      </>
    );
  }
  if (component === 'picker') {
    const options = pickerOptions();
    const selection = pickerSelection(value);
    return (
      <>
        {range(n).map((index) => (
          <Pressable
            key={index}
            testID={`bench-rn-core-picker-${String(index)}`}
            onPress={onPress}
            style={[style, pickerStyles.box]}
          >
            <Text style={pickerStyles.label}>{options[selection]}</Text>
          </Pressable>
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
  if (component === 'menu') {
    // RN core has no menu either, so the floor is the same `Pressable` + `Text`
    // button a JS-only menu without a popup is: the trigger's label, and nothing
    // else. Also a *floor* - it owns no popup window, no list and no native control,
    // which is exactly the cost this arm exists to make visible. The words come from
    // the shared `menuTitle`, so the flip paints the same new label everywhere and
    // the box grows with it the way the hosted controls' boxes do.
    return (
      <>
        {range(n).map((index) => (
          <Pressable
            key={index}
            testID={`bench-rn-core-menu-${String(index)}`}
            onPress={onPress}
            style={style}
          >
            <Text style={[buttonStyles.background, buttonStyles.label]}>
              {menuTitle(value)}
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
  if (component === 'text-field') {
    // RN core's own field, controlled the same way: the peer G13 is priced against.
    return (
      <>
        {range(n).map((index) => (
          <TextInput
            key={index}
            testID={`bench-rn-core-text-field-${String(index)}`}
            value={textFieldValue(value)}
            onChangeText={onTextChange}
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
  if (component === 'icon-button') {
    // The glyph is sized by this arm because an `Image` has no size of its own in
    // RN layout: 24 dp is the box every other arm's icon gets at the default rung,
    // so the picture is the same size everywhere and only the control around it
    // differs. `accessibilityLabel` is what the other arms' controls get for free.
    const glyph = iconButtonGlyph(value);
    return (
      <>
        {range(n).map((index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={ICON_BUTTON_LABEL}
            onPress={onIconButtonPress}
            testID={`bench-rn-core-icon-button-${String(index)}`}
            style={style}
          >
            <Image source={glyph.source} style={iconButtonStyles.glyph} />
          </Pressable>
        ))}
      </>
    );
  }
  if (component === 'button-group') {
    // The floor for a row of commands is a `View` of `Pressable`s with a `Text` in
    // each: no Material/SwiftUI group, no connected corners and no overflow of its
    // own — which is the point. The labels are the same three the nitro-ui arm
    // draws, so the text measure is charged to both, and the 8 pt gap is the gap
    // `ButtonGroup` draws its `standard` row at.
    const titles = buttonGroupTitles(value);
    return (
      <>
        {range(n).map((index) => (
          <View
            key={index}
            testID={`bench-rn-core-button-group-${String(index)}`}
            style={buttonGroupStyles.row}
          >
            {titles.map((title) => (
              <Pressable
                key={title}
                accessibilityRole="button"
                onPress={onButtonGroupPress}
                style={buttonGroupStyles.item}
              >
                <Text style={buttonStyles.label}>{title}</Text>
              </Pressable>
            ))}
          </View>
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

/**
 * The glyph box for the `icon-button` floor: 24 dp, the size the other arms' icon
 * gets at the default rung, and deliberately *not* 48 — RN core's pair has no
 * minimum touch target, and padding one in here would hide the cost the platform
 * controls pay for having one.
 */
const iconButtonStyles = StyleSheet.create({
  glyph: { width: 24, height: 24 },
});

/**
 * The row the `button-group` floor draws: the 8 pt gap `ButtonGroup` spaces its
 * `standard` items with, and each item's own box. No minimum touch target and no
 * group chrome, for `iconButtonStyles`' reason two lines above.
 */
const buttonGroupStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  item: {
    backgroundColor: '#6750A4',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
});

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
 * The minimum that makes the core floor read as a picker rather than a line of
 * text: a tappable box around the chosen option. It draws no chevron and no list,
 * because a chevron is decoration this arm invented and the list is the part the
 * other arms actually have to build - which is what the ratio is there to show.
 */
const pickerStyles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: '#79747E',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { color: '#1D1B20' },
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
