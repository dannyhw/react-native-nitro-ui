import {
  Button,
  Column,
  DropdownMenuItem,
  ExposedDropdownMenu,
  ExposedDropdownMenuBox,
  Host,
  Icon,
  IconButton,
  LoadingIndicator,
  Row,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Slider,
  Switch,
  Text,
  TextField,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { menuAnchor } from '@expo/ui/jetpack-compose/modifiers';
import {
  FieldGroup,
  Row as FormRow,
  Switch as FormSwitch,
  Text as FormText,
} from '@expo/ui';
import { ListItem } from '@expo/ui';

import { useCallback, useEffect, useState } from 'react';

import type { BenchListProps } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonGroupItems,
  buttonTitle,
  FORM_ROW_HOST_STYLE,
  formRowKind,
  formRowLabel,
  formRowValue,
  formSwitchValue,
  ICON_BUTTON_LABEL,
  iconButtonGlyph,
  listItemValue,
  LIST_ITEM_TITLE,
  onListItemPress,
  menuItems,
  menuTitle,
  onButtonGroupPress,
  onIconButtonPress,
  onPress,
  onMenuSelect,
  onRowPress,
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
  onTextChange,
  textFieldValue,
} from './shared';

/**
 * `@expo/ui` has no DatePicker arm on Android. Its only mountable picker is the
 * inline Material 3 calendar, whose horizontally scrollable month pager throws
 * when a `matchContents` host measures it with infinite width. The runner never
 * schedules these cells; this fails a launch that asks anyway.
 */
function unsupportedDatePicker(): never {
  throw new Error(
    'expo-ui has no DatePicker arm on Android: @expo/ui exposes no mountable date ' +
      'field, and its inline M3 calendar cannot be measured by a matchContents ' +
      'host (see ARMS_WITHOUT_COMPONENT in scripts/bench/lib.mjs).'
  );
}

/**
 * `@expo/ui` has no Stepper on Android, because Material has none. The runner
 * never schedules these cells; this fails a launch that asks anyway.
 */
function unsupportedStepper(): never {
  throw new Error(
    'expo-ui has no Stepper arm on Android: @expo/ui exposes no stepper, because ' +
      'Material has none either (see ARMS_WITHOUT_COMPONENT in scripts/bench/lib.mjs).'
  );
}

/** Module-level so the anchor's modifier keeps its identity across renders. */
const MENU_ANCHOR = menuAnchor();

/**
 * Material 3's exposed dropdown menu, the control `nitro-ui`'s Android Picker
 * is, composed from the same primitives through Expo's bridge.
 *
 * Material 3's text field owns its string, so the chosen title reaches the
 * anchor through a write to a native observable and not through a prop.
 */
function BenchPicker({ value }: { value: boolean }) {
  const options = pickerOptions();
  const selection = pickerSelection(value);
  const title = useNativeState<string>(options[selection] ?? '');
  const [expanded, setExpanded] = useState(false);
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
 * Material 3's menu, composed from the primitives `nitro-ui`'s Android Menu
 * uses: an `ExposedDropdownMenuBox`, a `Button` anchor carrying `menuAnchor()`,
 * and an `ExposedDropdownMenu` of `DropdownMenuItem`s.
 */
function BenchMenu({ value }: { value: boolean }) {
  return (
    // `expanded` is a constant: no cell opens a popup, so React state and a
    // dismiss handler would be cost for a transition that never happens.
    <ExposedDropdownMenuBox expanded={false}>
      <Button onClick={onPress} modifiers={[MENU_ANCHOR]}>
        <Text>{menuTitle(value)}</Text>
      </Button>
      <ExposedDropdownMenu expanded={false}>
        {menuItems().map((label) => (
          <DropdownMenuItem key={label} onClick={onMenuSelect}>
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
 * One row of the batch's `FieldGroup`, `@expo/ui`'s grouped settings list.
 *
 * Built from the universal components, not the `jetpack-compose` ones the other
 * arms use: `FieldGroup.Section` builds its rows from the universal primitives.
 */
function BenchFormRow({ index, value }: { index: number; value: boolean }) {
  const kind = formRowKind(index);
  const label = formRowLabel(index);
  if (kind === 'detail') {
    return (
      <FormRow spacing={8}>
        <FormText>{label}</FormText>
        <FormText>{formRowValue(value)}</FormText>
      </FormRow>
    );
  }
  if (kind === 'switch') {
    return (
      <FormRow spacing={8}>
        <FormText>{label}</FormText>
        <FormSwitch
          testID={`bench-expo-form-switch-${String(index)}`}
          value={formSwitchValue(index, value)}
          onValueChange={onValueChange}
        />
      </FormRow>
    );
  }
  if (kind === 'press') {
    return (
      <FormRow spacing={8} onPress={onRowPress}>
        <FormText>{label}</FormText>
      </FormRow>
    );
  }
  return <FormText>{label}</FormText>;
}

/**
 * `@expo/ui` worst case: one Compose hosting view per control. Expo UI always
 * needs a `Host`, so a fair comparison takes this arm and the shared-host one.
 */
export function ExpoUiHostPerControlList({
  n,
  value,
  component,
}: BenchListProps) {
  if (component === 'date-picker') {
    return unsupportedDatePicker();
  }
  if (component === 'stepper') {
    return unsupportedStepper();
  }
  const style = rowStyle(component);
  if (component === 'form') {
    return (
      <>
        {range(n).map((index) => (
          <Host key={index} style={FORM_ROW_HOST_STYLE}>
            <FieldGroup>
              <BenchFormRow index={index} value={value} />
            </FieldGroup>
          </Host>
        ))}
      </>
    );
  }
  return (
    <>
      {range(n).map((index) =>
        component === 'button' ? (
          // `matchContents` lets the host take the control's fitting size,
          // which is how an app ships a sized-to-content control here.
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
        ) : component === 'menu' ? (
          <Host key={index} matchContents style={style}>
            <BenchMenu value={value} />
          </Host>
        ) : (
          <Host key={index} style={style}>
            {component === 'slider' ? (
              <BenchSlider value={value} />
            ) : component === 'icon-button' ? (
              <BenchIconButton value={value} />
            ) : component === 'text-field' ? (
              <BenchTextField value={value} />
            ) : component === 'progress' ? (
              <BenchProgress value={value} />
            ) : component === 'button-group' ? (
              <BenchButtonGroup value={value} />
            ) : component === 'list-item' ? (
              <BenchListItem value={value} />
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
 * Material 3's filled `Button` with a `Text` in its slot, in the default
 * palette: the comparison is each control's platform default.
 */
function BenchButton({ value }: { value: boolean }) {
  return (
    <Button onClick={onPress}>
      <Text>{buttonTitle(value)}</Text>
    </Button>
  );
}

/**
 * Material 3's bare `IconButton` with an `Icon` in its slot. `@expo/ui`'s
 * `IconButton` takes no size of its own; 24 on the icon is Material's medium
 * glyph, matching nitro-ui's default.
 */
function BenchIconButton({ value }: { value: boolean }) {
  const glyph = iconButtonGlyph(value);
  return (
    <IconButton onClick={onIconButtonPress}>
      <Icon
        contentDescription={ICON_BUTTON_LABEL}
        source={glyph.source}
        size={24}
      />
    </IconButton>
  );
}

/**
 * Three Material 3 `Button`s in a `Row`, spaced by 8 dp: the row an app
 * hand-rolls, because `@expo/ui` has no `ButtonGroup` on Android.
 */
function BenchButtonGroup({ value }: { value: boolean }) {
  return (
    <Row horizontalArrangement={{ spacedBy: 8 }}>
      {buttonGroupItems(value).map((item) => (
        <Button key={item.id} onClick={onButtonGroupPress}>
          <Text>{item.title}</Text>
        </Button>
      ))}
    </Row>
  );
}

/**
 * `@expo/ui`'s universal `ListItem`, which on Android is Material 3's own
 * `ListItem` with a `clickable` modifier.
 */
function BenchListItem({ value }: { value: boolean }) {
  return (
    <ListItem
      onPress={onListItemPress}
      trailing={<Text>{listItemValue(value)}</Text>}
    >
      <Text>{LIST_ITEM_TITLE}</Text>
    </ListItem>
  );
}

/**
 * A bare Material 3 `Slider`. `steps={0}` is continuous, like the other arms: a
 * stepped slider draws tick marks they do not have.
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
 * `@expo/ui`'s Compose `TextField`, single-line. It takes its text only as an
 * observable, written when the runner flips.
 */
function BenchTextField({ value }: { value: boolean }) {
  const text = useNativeState<string>(textFieldValue(value));
  useEffect(() => {
    text.value = textFieldValue(value);
  }, [text, value]);
  return <TextField value={text} singleLine onValueChange={onTextChange} />;
}

/**
 * The closest thing `@expo/ui` has to a progress bar: Material 3's expressive
 * `LoadingIndicator`, determinate only when handed a `progress` observable. So
 * the flip reaches Compose as a write to that state and not as a prop diff,
 * and the drawable is not the one the other arms show: `@expo/ui` exposes
 * neither `LinearProgressIndicator` nor `CircularProgressIndicator`.
 */
function BenchProgress({ value }: { value: boolean }) {
  const progress = useNativeState<number | null>(progressValue(value));
  useEffect(() => {
    progress.value = progressValue(value);
  }, [progress, value]);
  return <LoadingIndicator progress={progress} />;
}

/**
 * Material 3's single-choice segmented row, the composable nitro-ui hosts,
 * in the default palette.
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
  if (component === 'stepper') {
    return unsupportedStepper();
  }
  if (n === 0) {
    return null;
  }
  if (component === 'form') {
    return (
      <Host style={stackStyle(n, component)}>
        <FieldGroup>
          <FieldGroup.Section title="Settings">
            {range(n).map((index) => (
              <BenchFormRow key={index} index={index} value={value} />
            ))}
          </FieldGroup.Section>
        </FieldGroup>
      </Host>
    );
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
          ) : component === 'menu' ? (
            <BenchMenu key={index} value={value} />
          ) : component === 'slider' ? (
            <BenchSlider key={index} value={value} />
          ) : component === 'icon-button' ? (
            <BenchIconButton key={index} value={value} />
          ) : component === 'text-field' ? (
            <BenchTextField key={index} value={value} />
          ) : component === 'progress' ? (
            <BenchProgress key={index} value={value} />
          ) : component === 'button-group' ? (
            <BenchButtonGroup key={index} value={value} />
          ) : component === 'list-item' ? (
            <BenchListItem key={index} value={value} />
          ) : (
            <Switch key={index} value={value} onCheckedChange={onValueChange} />
          )
        )}
      </Column>
    </Host>
  );
}
