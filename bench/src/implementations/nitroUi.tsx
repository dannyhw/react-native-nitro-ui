import {
  Button,
  ButtonGroup,
  DatePicker,
  Form,
  Host,
  IconButton,
  ListItem,
  Menu,
  Stepper,
  type MenuGroup,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
  TextField,
  nitroUiCore,
} from 'react-native-nitro-ui';

import { Text, type ViewStyle } from 'react-native';

import type { BenchListProps, BenchPerfMark } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonGroupItems,
  buttonTitle,
  dateValue,
  onButtonGroupPress,
  ICON_BUTTON_LABEL,
  iconButtonGlyph,
  listItemValue,
  LIST_ITEM_TITLE,
  onListItemPress,
  formRowKind,
  formRowLabel,
  formRowValue,
  formSwitchValue,
  FORM_VALUE_STYLE,
  onRowPress,
  menuItems,
  menuTitle,
  onDateChange,
  onIconButtonPress,
  onPress,
  onMenuSelect,
  onPickerChange,
  onSegmentChange,
  onSliderChange,
  onTextChange,
  onValueChange,
  pickerOptions,
  pickerSelection,
  progressValue,
  range,
  rowStyle,
  segmentedOptions,
  sliderValue,
  stepperValue,
  STEPPER_LABEL,
  onStepperChange,
  stackStyle,
  textFieldValue,
} from './shared';

/**
 * The `nitro-ui` arm: the only bench file that renders `react-native-nitro-ui`
 * and reads its native perf marks. Each control gets what the reference arms
 * pass (value, a stable no-op handler, `testID`, the shared row style) and
 * otherwise stays at its platform default, so every arm prices the same thing.
 */

/** Perf marks are in ms; the probe speaks ns. */
const MS_TO_NS = 1_000_000;

/**
 * Whether this process turned marks on. Off in a normal measured run, so the
 * arm is instrumented no more than the reference arms.
 */
let marksEnabled = false;

/** Called by the runner for a `--perf-marks` launch, before the first commit. */
export function enableNitroUiPerfMarks(): void {
  nitroUiCore.setPerfEnabled(true);
  marksEnabled = true;
}

/**
 * Every mark recorded since the last call, in the probe's nanosecond base.
 * Drain between iterations: the library's ring holds 4096 events and a full
 * ring drops its oldest marks.
 */
export function drainNitroUiPerfMarks(): BenchPerfMark[] | null {
  if (!marksEnabled) {
    return null;
  }
  const marks: BenchPerfMark[] = [];
  for (const event of nitroUiCore.drainPerf()) {
    marks.push({
      instanceId: event.instanceId,
      kind: event.kind,
      timeNs: Math.round(event.time * MS_TO_NS),
    });
  }
  return marks;
}

/**
 * One grouped Form holding the whole batch: `n` counts rows, not Forms. `Form`
 * takes no `nuiPerfId`, so a perf-marks run reads this cell from the probe's
 * signals alone.
 */
function BenchForm({
  n,
  value,
  style,
}: {
  n: number;
  value: boolean;
  style: ViewStyle;
}) {
  return (
    <Form testID="bench-nitro-ui-form" style={style}>
      {/* A row with one child is passed bare. A row with several children must
          name `Form.Row`, because fragments and arrays split into separate
          rows. */}
      <Form.Section title="Settings">
        {range(n).map((index) => {
          const kind = formRowKind(index);
          const label = formRowLabel(index);
          if (kind === 'detail') {
            return (
              <Form.Row key={index}>
                <Text>{label}</Text>
                <Text style={FORM_VALUE_STYLE}>{formRowValue(value)}</Text>
              </Form.Row>
            );
          }
          if (kind === 'switch') {
            return (
              <Form.Row key={index}>
                <Text>{label}</Text>
                <Switch
                  testID={`bench-nitro-ui-form-switch-${String(index)}`}
                  value={formSwitchValue(index, value)}
                  onValueChange={onValueChange}
                  nuiPerfId={null}
                />
              </Form.Row>
            );
          }
          if (kind === 'press') {
            // Same visible content as a `label` row, so this kind prices the
            // press handler alone. No `disclosure` accessory: the reference
            // arms have no chevron to set against it.
            return (
              <Form.Row key={index} onPress={onRowPress}>
                <Text>{label}</Text>
              </Form.Row>
            );
          }
          return <Text key={index}>{label}</Text>;
        })}
      </Form.Section>
    </Form>
  );
}

/**
 * `n` nitro-ui controls inside one `<Host>`: one Compose composition for the
 * batch instead of one per control. The children keep the `nitro-ui` arm's
 * props and row box, so the cell prices only where the control composes.
 */
export function NitroUiHostList({
  n,
  value,
  perfMarks,
  component,
}: BenchListProps) {
  if (n === 0) {
    return null;
  }
  const style = rowStyle(component);
  /** One child, the same props the `nitro-ui` arm passes for this component. */
  const child = (index: number) => {
    const testId = `bench-nitro-ui-host-${component}-${String(index)}`;
    const nuiPerfId = perfMarks ? index : null;
    if (component === 'slider') {
      return (
        <Slider
          key={index}
          testID={testId}
          value={sliderValue(value)}
          onValueChange={onSliderChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'progress') {
      return (
        <Progress
          key={index}
          testID={testId}
          value={progressValue(value)}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'button') {
      return (
        <Button
          key={index}
          testID={testId}
          title={buttonTitle(value)}
          onPress={onPress}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'switch') {
      return (
        <Switch
          key={index}
          testID={testId}
          value={value}
          onValueChange={onValueChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'segmented-control') {
      return (
        <SegmentedControl
          key={index}
          testID={testId}
          options={segmentedOptions(value)}
          selectedIndex={SEGMENTED_SELECTION}
          onChange={onSegmentChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'picker') {
      return (
        <Picker
          key={index}
          testID={testId}
          options={pickerOptions()}
          selectedIndex={pickerSelection(value)}
          onChange={onPickerChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'menu') {
      return (
        <Menu
          key={index}
          testID={testId}
          title={menuTitle(value)}
          group={MENU_GROUP}
          onSelect={onMenuSelect}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'date-picker') {
      return (
        <DatePicker
          key={index}
          testID={testId}
          value={dateValue(value)}
          onChange={onDateChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'text-field') {
      // The plan never asks this arm for a control a Host refuses, so reaching
      // one of these throws means the plan and the arm's list disagree.
      throw new Error(
        'nitro-ui-host cannot compose text-field: a Host refuses it'
      );
    }
    if (component === 'icon-button') {
      throw new Error(
        'nitro-ui-host cannot compose icon-button: a Host refuses it'
      );
    }
    if (component === 'form') {
      throw new Error(
        'nitro-ui-host cannot compose form: a Host refuses a container'
      );
    }
    if (component === 'stepper') {
      throw new Error(
        'nitro-ui-host cannot compose stepper: a Host refuses it'
      );
    }
    if (component === 'button-group') {
      throw new Error(
        'nitro-ui-host cannot compose button-group: a Host refuses it'
      );
    }
    if (component === 'list-item') {
      throw new Error(
        'nitro-ui-host cannot compose list-item: a Host refuses it'
      );
    }
    throw new Error(`nitro-ui-host cannot compose ${component}`);
  };
  return <Host style={stackStyle(n, component)}>{range(n).map(child)}</Host>;
}

/**
 * The item group every `nitro-ui` Menu mounts. Module-level so its identity is
 * stable: a literal in the JSX would be a prop diff on every flip.
 */
const MENU_GROUP: MenuGroup = {
  actions: menuItems().map((title, index) => ({
    id: `row-${String(index)}`,
    title,
  })),
};

/**
 * `n` nitro-ui controls. `nuiPerfId` stays `null` unless the launch asked for
 * marks, so the published numbers are the ones a consumer gets.
 */
export function NitroUiList({
  n,
  value,
  perfMarks,
  component,
}: BenchListProps) {
  if (n === 0) {
    return null;
  }
  const style = rowStyle(component);
  if (component === 'form') {
    // One Form for the batch, not one Form per row: `n` counts rows here.
    return <BenchForm n={n} value={value} style={style as ViewStyle} />;
  }
  if (component === 'date-picker') {
    return (
      <>
        {range(n).map((index) => (
          <DatePicker
            key={index}
            testID={`bench-nitro-ui-date-${String(index)}`}
            value={dateValue(value)}
            onChange={onDateChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'picker') {
    return (
      <>
        {range(n).map((index) => (
          <Picker
            key={index}
            testID={`bench-nitro-ui-picker-${String(index)}`}
            options={pickerOptions()}
            selectedIndex={pickerSelection(value)}
            onChange={onPickerChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'menu') {
    // The popup is never opened: the cell measures the mounted trigger.
    return (
      <>
        {range(n).map((index) => (
          <Menu
            key={index}
            testID={`bench-nitro-ui-menu-${String(index)}`}
            title={menuTitle(value)}
            group={MENU_GROUP}
            onSelect={onMenuSelect}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'segmented-control') {
    return (
      <>
        {range(n).map((index) => (
          <SegmentedControl
            key={index}
            testID={`bench-nitro-ui-segmented-${String(index)}`}
            options={segmentedOptions(value)}
            selectedIndex={SEGMENTED_SELECTION}
            onChange={onSegmentChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'button') {
    return (
      <>
        {range(n).map((index) => (
          <Button
            key={index}
            testID={`bench-nitro-ui-button-${String(index)}`}
            title={buttonTitle(value)}
            onPress={onPress}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'slider') {
    return (
      <>
        {range(n).map((index) => (
          <Slider
            key={index}
            testID={`bench-nitro-ui-slider-${String(index)}`}
            value={sliderValue(value)}
            onValueChange={onSliderChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'stepper') {
    return (
      <>
        {range(n).map((index) => (
          <Stepper
            key={index}
            accessibilityLabel={STEPPER_LABEL}
            maximumValue={10}
            minimumValue={0}
            onValueChange={onStepperChange}
            testID={`bench-nitro-ui-stepper-${String(index)}`}
            value={stepperValue(value)}
            nuiPerfId={perfMarks ? index : null}
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
          <IconButton
            key={index}
            accessibilityLabel={ICON_BUTTON_LABEL}
            androidIcon={glyph.androidIcon}
            systemImage={glyph.systemImage}
            onPress={onIconButtonPress}
            nuiPerfId={perfMarks ? index : null}
            testID={`bench-nitro-ui-icon-button-${String(index)}`}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'button-group') {
    const items = buttonGroupItems(value);
    return (
      <>
        {range(n).map((index) => (
          <ButtonGroup
            key={index}
            items={items}
            onPress={onButtonGroupPress}
            nuiPerfId={perfMarks ? index : null}
            testID={`bench-nitro-ui-button-group-${String(index)}`}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'list-item') {
    return (
      <>
        {range(n).map((index) => (
          <ListItem
            key={index}
            title={LIST_ITEM_TITLE}
            value={listItemValue(value)}
            onPress={onListItemPress}
            nuiPerfId={perfMarks ? index : null}
            testID={`bench-nitro-ui-list-item-${String(index)}`}
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
          <TextField
            key={index}
            testID={`bench-nitro-ui-text-field-${String(index)}`}
            value={textFieldValue(value)}
            onChangeText={onTextChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'progress') {
    return (
      <>
        {range(n).map((index) => (
          <Progress
            key={index}
            testID={`bench-nitro-ui-progress-${String(index)}`}
            value={progressValue(value)}
            nuiPerfId={perfMarks ? index : null}
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
          testID={`bench-nitro-ui-${String(index)}`}
          value={value}
          onValueChange={onValueChange}
          nuiPerfId={perfMarks ? index : null}
          style={style}
        />
      ))}
    </>
  );
}
