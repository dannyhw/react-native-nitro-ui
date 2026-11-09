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
 *
 * Plainly, for anyone reading this looking for a number: this arm is **never
 * rendered**, on any launch, so no table in `docs/benchmarks.md` has an Android
 * `@expo/ui` DatePicker row to compare against. It is *not* an inline calendar
 * that lost a comparison - there is no Android date-picker arm at all.
 */
function unsupportedDatePicker(): never {
  throw new Error(
    'expo-ui has no DatePicker arm on Android: @expo/ui exposes no mountable date ' +
      'field, and its inline M3 calendar cannot be measured by a matchContents ' +
      'host (see ARMS_WITHOUT_COMPONENT in scripts/bench/lib.mjs).'
  );
}

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
 * Material 3's menu, composed out of the same primitives `nitro-ui`'s Android Menu
 * composes through Expo's bridge: an `ExposedDropdownMenuBox`, a `Button` anchor
 * carrying `menuAnchor()`, and an `ExposedDropdownMenu` of `DropdownMenuItem`s.
 *
 * The anchor is a `Button` with a `Text` child rather than the `TextField` the
 * Picker's arm needs, because that is the control under test's own shape
 * (`HybridNitroUiMenu.kt` composes `NitroUiM3Button` with
 * `menuAnchor(PrimaryNotEditable)`), and a slot `Text` takes its string from a prop
 * like every other arm does - no observable write, no `useNativeState`.
 *
 * The expanded state is React's own: the box is controlled, and a menu no check
 * opens stays shut in every cell, so the bench measures mounting the box, the
 * trigger and the items - what a list of mounted menus costs.
 */
function BenchMenu({ value }: { value: boolean }) {
  return (
    // `expanded` is a constant rather than React state, and `onExpandedChange` is
    // left out entirely: no cell opens a popup, so this arm would pay a `useState`
    // and a dismiss handler for a state transition that never happens. The props
    // that reach Compose are the ones the control mounts with.
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
 * One row of the batch's FieldGroup, in the universal toolkit's row vocabulary.
 *
 * `@expo/ui`'s `FieldGroup` is its answer to a grouped settings list; on Android it
 * is a Compose `LazyColumn` whose rows are clipped to position-aware Material 3
 * shapes - the same job nitro-ui's section does with `SegmentedListItem`, which is
 * what makes it the peer the brief asks for. Each kind is what an app writes for
 * it: `Text` alone, a `Row` of title and value, a `Row` of title and `Switch`, and
 * a `Row` that answers to a press - universal `onPress`, this toolkit's row-level
 * press, asked the same way nitro-ui's `Form.Row onPress` asks it.
 *
 * The universal components, not the `jetpack-compose` ones the other arms use:
 * `FieldGroup.Section` builds its rows out of this toolkit's own primitives, and a
 * row has to be spelled the way a consumer of this container spells it.
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
 * `@expo/ui` worst case for the library: one Compose hosting view per control
 * (one `AndroidComposeView` each). Expo UI always needs a `Host`, so both Expo
 * arms are required for a fair comparison
 * (docs/research/setup-decisions.md SS6).
 *
 * For `date-picker` it defers to [unsupportedDatePicker], which says why there is
 * no Android arm to write here.
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
  if (component === 'form') {
    // One hosting view per *row*: a FieldGroup per row, which is what an app pays
    // when it hosts each settings row instead of one grouped list. The host needs a
    // box (`FORM_ROW_HOST_STYLE`) because a host has no intrinsic size of its own.
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
        ) : component === 'menu' ? (
          // `matchContents` for the same reason the Button arm gets it: the trigger
          // sizes itself, and a host that stretched it would price a box this control
          // does not have.
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
 * Material 3's bare `IconButton` with an `Icon` in its slot — the peer the G23
 * brief names, and the closest thing in `@expo/ui` to the control under test.
 *
 * The default rung either way: this arm takes no `size`/`width` because
 * `@expo/ui`'s `IconButton` exposes neither (its slot content decides, and
 * `size={24}` on the icon is Material's own medium glyph), while nitro-ui gets its
 * `medium` default. The two boxes are both Material's, which is the comparison.
 * `contentDescription` is this arm's only name for the control, and it is the same
 * string every other arm uses.
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
 * Three Material 3 `Button`s in a `Row`, spaced by 8 dp — the row nitro-ui's
 * `ButtonGroup` draws at its defaults.
 *
 * `@expo/ui` has no `ButtonGroup` binding on Android (`Button`, `ToggleButton`,
 * `SegmentedButton` and `SingleChoiceSegmentedButtonRow` are its whole group-ish
 * surface), so this arm pays for the row a consumer would hand-roll: the same three
 * labels, the same gap, no group container, no connected corners and no overflow of
 * its own. That asymmetry is the number: it is what the control under test buys over
 * the best a `@expo/ui` app can do without writing layout code.
 *
 * `horizontalArrangement` is `{ spacedBy: 8 }` rather than `Spacer`s between the
 * buttons, so the row costs three composables and not five.
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
 * `@expo/ui`'s Compose `TextField`, single-line, with its text in an observable -
 * the one way Expo takes a value - written when the runner flips, as the Picker arm
 * writes its anchor. So `update.text-field` is a text write here as it is for the
 * other arms, not a repaint.
 */
function BenchTextField({ value }: { value: boolean }) {
  const text = useNativeState<string>(textFieldValue(value));
  useEffect(() => {
    text.value = textFieldValue(value);
  }, [text, value]);
  return <TextField value={text} singleLine onValueChange={onTextChange} />;
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
  if (component === 'form') {
    // The peer for nitro-ui's one grouped Form: one hosting view, one FieldGroup,
    // one section, `n` rows - the tree an app writes.
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
          ) : (
            <Switch key={index} value={value} onCheckedChange={onValueChange} />
          )
        )}
      </Column>
    </Host>
  );
}
