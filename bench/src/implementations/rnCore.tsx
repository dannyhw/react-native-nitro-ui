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
import { ScrollView } from 'react-native';

import type { BenchListProps } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonGroupTitles,
  STEPPER_LABEL,
  buttonTitle,
  dateLabel,
  FORM_ROW_HOST_STYLE,
  FORM_VALUE_STYLE,
  formRowKind,
  formRowLabel,
  formRowValue,
  formSwitchValue,
  ICON_BUTTON_LABEL,
  iconButtonGlyph,
  listItemValue,
  LIST_ITEM_TITLE,
  menuTitle,
  onButtonGroupPress,
  onIconButtonPress,
  onPress,
  onRowPress,
  onValueChange,
  range,
  rowStyle,
  pickerOptions,
  pickerSelection,
  segmentedOptions,
  stepperValue,
  onTextChange,
  textFieldValue,
} from './shared';

/**
 * The control arm: what RN core itself offers for each component. Where core has
 * no such control, the arm renders the plainest views an app would build instead,
 * so a ratio against it reads "cost over a floor", not "cost over a peer".
 */
export function RnCoreList({ n, value, component }: BenchListProps) {
  const style = rowStyle(component);
  if (component === 'form') {
    return (
      <ScrollView testID="bench-rn-core-form" style={style}>
        {range(n).map((index) => {
          const kind = formRowKind(index);
          const label = formRowLabel(index);
          const content = (
            <>
              <Text>{label}</Text>
              {kind === 'detail' ? (
                <Text style={FORM_VALUE_STYLE}>{formRowValue(value)}</Text>
              ) : null}
              {kind === 'switch' ? (
                <Switch
                  testID={`bench-rn-core-form-switch-${String(index)}`}
                  value={formSwitchValue(index, value)}
                  onValueChange={onValueChange}
                />
              ) : null}
            </>
          );
          return kind === 'press' ? (
            <Pressable
              key={index}
              testID={`bench-rn-core-form-press-${String(index)}`}
              onPress={onRowPress}
              style={formStyles.row}
            >
              {content}
            </Pressable>
          ) : (
            <View key={index} style={formStyles.row}>
              {content}
            </View>
          );
        })}
      </ScrollView>
    );
  }
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
    // `ActivityIndicator` is indeterminate and has no value, so `update.progress`
    // changes nothing on this arm.
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
  if (component === 'stepper') {
    // The value arrives as `accessibilityValue` so `update.stepper` changes a prop
    // on this arm too.
    return (
      <>
        {range(n).map((index) => (
          <View
            key={index}
            accessibilityLabel={STEPPER_LABEL}
            accessibilityValue={{ min: 0, max: 10, now: stepperValue(value) }}
            testID={`bench-rn-core-stepper-${String(index)}`}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'icon-button') {
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
  if (component === 'list-item') {
    return (
      <>
        {range(n).map((index) => (
          <View
            key={index}
            testID={`bench-rn-core-list-item-${String(index)}`}
            style={listItemStyles.row}
          >
            <Text numberOfLines={1}>{LIST_ITEM_TITLE}</Text>
            <Text numberOfLines={1} style={FORM_VALUE_STYLE}>
              {listItemValue(value)}
            </Text>
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

// 24 dp is the icon size the other arms draw. Deliberately not padded to a 48 dp
// touch target: that is part of what the platform controls pay for.
const iconButtonStyles = StyleSheet.create({
  glyph: { width: 24, height: 24 },
});

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

const formStyles = StyleSheet.create({
  row: {
    ...FORM_ROW_HOST_STYLE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
});

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

const listItemStyles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 16,
    width: '100%',
  },
});

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
