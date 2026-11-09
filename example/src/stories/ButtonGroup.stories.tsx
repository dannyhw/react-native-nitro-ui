/**
 * ButtonGroup stories (G20). Props and events: `docs/components/button-group.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness and
 * benchmark handles, not app API (DECISIONS D14).
 *
 * Every item names both glyphs — `systemImage` for iOS and `androidIcon` for
 * Android — because each platform ignores the other's, and a row that only names
 * one is a row with half its icons missing on half the devices.
 */
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import {
  ButtonGroup,
  type ButtonGroupAppearance,
  type ButtonGroupItem,
  type ButtonGroupLabelStyle,
  type ButtonGroupProps,
} from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

/** A drawable the example app ships in `res/drawable/` — the resource-name form. */
const DRAWABLE = 'nitroui_test_star';

const APPEARANCES: readonly ButtonGroupAppearance[] = ['standard', 'connected'];
const VARIANTS: readonly NonNullable<ButtonGroupProps['variant']>[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];
const SIZES: readonly NonNullable<ButtonGroupProps['size']>[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];
const LABEL_STYLES: readonly ButtonGroupLabelStyle[] = [
  'automatic',
  'titleOnly',
  'iconOnly',
  'titleAndIcon',
];

/** The three commands the README pair and most rows use. */
const COMMANDS: ButtonGroupItem[] = [
  {
    id: 'copy',
    title: 'Copy',
    systemImage: 'doc.on.doc',
    androidIcon: DRAWABLE,
  },
  { id: 'cut', title: 'Cut', systemImage: 'scissors' },
  {
    id: 'paste',
    title: 'Paste',
    systemImage: 'doc.on.clipboard',
    androidIcon: 'nitroui_test_close',
  },
];

/** A toolbar's worth of independent toggles — the *Bold | Italic | Underline* case. */
const FORMAT: ButtonGroupItem[] = [
  {
    id: 'bold',
    title: 'Bold',
    systemImage: 'textformat.size',
    androidIcon: DRAWABLE,
    toggle: true,
  },
  { id: 'italic', title: 'Italic', systemImage: 'italic', toggle: true },
  {
    id: 'underline',
    title: 'Underline',
    systemImage: 'underline',
    toggle: true,
  },
];

/** Long enough titles that six of them cannot share a narrow box. */
const MANY: ButtonGroupItem[] = [
  { id: 'day', title: 'Day' },
  { id: 'week', title: 'Week' },
  { id: 'month', title: 'Month' },
  { id: 'quarter', title: 'Quarter' },
  { id: 'year', title: 'Year' },
  { id: 'all', title: 'All time' },
];

const meta = {
  component: ButtonGroup,
  args: {
    appearance: 'connected',
    variant: 'filled',
    size: 'medium',
    labelStyle: 'automatic',
    disabled: false,
    tintColor: undefined,
    accessibilityLabel: 'Playground button group',
    overflowAccessibilityLabel: undefined,
    items: [
      ...COMMANDS,
      ...FORMAT.map((item) => ({
        ...item,
        defaultChecked: item.id === 'bold',
      })),
    ],
    onPress: fn(),
    onCheckedChange: fn(),
  },
  argTypes: {
    items: {
      control: false,
      description:
        'The row, in render order. Each item&apos;s `id` is what `onPress` and `onCheckedChange` report; `toggle` makes it a toggle, and `checked` (a boolean) makes that toggle controlled.',
    },
    appearance: {
      control: 'radio',
      options: [...APPEARANCES],
      description:
        '`connected` is Material&apos;s joined group on Android and SwiftUI&apos;s `ControlGroup` on iOS; `standard` leaves a gap between each item.',
    },
    variant: {
      control: 'select',
      options: [...VARIANTS],
      description:
        'The five shared variants. **Android and iOS `standard` only** — a connected iOS `ControlGroup` ignores `.buttonStyle` entirely (measured).',
    },
    size: {
      control: 'select',
      options: [...SIZES],
      description:
        'The shared ladder. **Android and iOS `standard` only** — a connected group measured 31 pt at every rung.',
    },
    labelStyle: {
      control: 'select',
      options: [...LABEL_STYLES],
      description:
        '`automatic` is each platform&apos;s own default: icons only inside a connected iOS group that has glyphs, icon **and** title everywhere else.',
    },
    disabled: {
      control: 'boolean',
      description:
        'No item is reachable and no event fires, from the row or from the overflow menu. An open menu closes.',
    },
    tintColor: {
      control: 'color',
      description:
        'The variant&apos;s container on Android, SwiftUI&apos;s `.tint()` on an iOS standard row. **Ignored by a connected iOS group** (measured).',
    },
    accessibilityLabel: {
      control: { type: 'text' },
      description:
        'The group&apos;s own name. Unset, each item simply speaks for itself — usually right for a row of commands.',
    },
    overflowAccessibilityLabel: {
      control: { type: 'text' },
      description:
        'The name of the overflow control on **both** platforms, defaulting to `More`. Android could leave it to Material, which draws an ellipsis with no description at all.',
    },
    onPress: {
      action: 'pressed',
      description: 'One call per tap, with the item&apos;s `id`.',
    },
    onCheckedChange: {
      action: 'checked',
      description:
        'A toggle item&apos;s change: the `id` and the state native now displays.',
    },
  },
} satisfies Meta<typeof ButtonGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The playground, with a readout — a tap is one event, and this shows it. */
export const Playground: Story = {};

/**
 * The two appearances, then the same two with toggles in them.
 *
 * The fourth row is the one worth reading: a connected iOS group whose items include a
 * toggle draws the standard row, because `ControlGroup` shows no on state (measured).
 * Android keeps its connected toggles. Same props in both columns.
 */
export const Appearances: Story = {
  render: function AppearancesStory() {
    const [checked, setChecked] = useState(['bold']);
    const flip = useCallback((_id: string, next: boolean, id: string) => {
      setChecked((current) =>
        next
          ? [...new Set([...current, id])]
          : current.filter((entry) => entry !== id)
      );
    }, []);
    const toggles = FORMAT.map((item) => ({
      ...item,
      checked: checked.includes(item.id),
    }));
    const onChecked = useCallback(
      (id: string, next: boolean) => flip(id, next, id),
      [flip]
    );

    return (
      <Showcase>
        <Column label="standard — a gap between each command">
          <ButtonGroup
            accessibilityLabel="Standard commands"
            items={COMMANDS}
          />
        </Column>
        <Column label="connected — one track">
          <ButtonGroup
            accessibilityLabel="Connected commands"
            appearance="connected"
            items={COMMANDS}
          />
        </Column>
        <Column label="standard toggles, two on">
          <ButtonGroup
            accessibilityLabel="Formatting"
            items={toggles}
            onCheckedChange={onChecked}
          />
        </Column>
        <Column label="asked connected, with toggles — iOS falls back, Android joins">
          <ButtonGroup
            accessibilityLabel="Formatting, connected"
            appearance="connected"
            items={toggles}
            onCheckedChange={onChecked}
          />
        </Column>
        <Column label="each variant, at the medium rung">
          {VARIANTS.map((variant) => (
            <ButtonGroup
              key={variant}
              accessibilityLabel={`${variant} commands`}
              items={COMMANDS}
              variant={variant}
            />
          ))}
        </Column>
        <Column label="the whole group disabled">
          <ButtonGroup
            accessibilityLabel="Disabled commands"
            disabled
            items={COMMANDS}
          />
        </Column>
        <Column label="one item disabled beside two live ones">
          <ButtonGroup
            accessibilityLabel="One disabled"
            items={COMMANDS.map((item) => ({
              ...item,
              disabled: item.id === 'cut',
            }))}
          />
        </Column>
      </Showcase>
    );
  },
};

/** The ladder, and what the five label styles do with a glyph. */
export const SizesAndLabels: Story = {
  render: function SizesAndLabelsStory() {
    return (
      <Showcase>
        {SIZES.map((size) => (
          <Column key={size} label={size}>
            {APPEARANCES.map((appearance) => (
              <ButtonGroup
                key={appearance}
                accessibilityLabel={`${size} ${appearance}`}
                appearance={appearance}
                items={COMMANDS.slice(0, 2)}
                size={size}
              />
            ))}
          </Column>
        ))}
        <Note>
          The second row of each pair does not change with the rung on iOS:
          `ControlGroup` measured 174.00 × 31.00 pt at every `.controlSize`. It
          is kept here so the two appearances are read together.
        </Note>
        {LABEL_STYLES.map((labelStyle) => (
          <Column key={labelStyle} label={labelStyle}>
            <ButtonGroup
              accessibilityLabel={`Label style ${labelStyle}`}
              items={COMMANDS}
              labelStyle={labelStyle}
            />
          </Column>
        ))}
        <Column label="iconOnly with nothing to draw — the title stays">
          <ButtonGroup
            accessibilityLabel="No glyphs"
            items={COMMANDS.map(
              ({ systemImage: _s, androidIcon: _a, ...rest }) => rest
            )}
            labelStyle="iconOnly"
          />
        </Column>
      </Showcase>
    );
  },
};

/**
 * Overflow, at three widths of the same six items.
 *
 * This is the story that shows the control is `fillWidth`: nothing here changes the
 * items, only the box, and the box is what decides.
 */
export const Overflow: Story = {
  render: function OverflowStory() {
    const [presses, setPresses] = useState<string[]>([]);
    const onPress = useCallback((id: string) => {
      setPresses((current) => [...current.slice(-4), id]);
    }, []);

    return (
      <Showcase>
        <Frame
          label="in a 220-wide box — four items move into the menu"
          width={220}
        >
          <ButtonGroup
            accessibilityLabel="Overflowing dates"
            items={MANY}
            onPress={onPress}
            testID="storybook-button-group-narrow"
          />
        </Frame>
        <Frame label="in a 320-wide box" width={320}>
          <ButtonGroup
            accessibilityLabel="Partly overflowing dates"
            items={MANY}
          />
        </Frame>
        <Column label="across the screen — every item is in the row">
          <ButtonGroup accessibilityLabel="All dates" items={MANY} />
        </Column>
        <Row label="taps, from the row or from the menu">
          <Text style={styles.readout}>
            {presses.length === 0 ? 'nothing yet' : presses.join(' · ')}
          </Text>
        </Row>
        <Note>
          {Platform.OS === 'ios'
            ? 'iOS draws the "More" menu beside the group, never inside a ControlGroup — inside one its segment measures but never opens.'
            : 'Android uses Material&apos;s own overflow indicator and Material&apos;s button-group menu.'}
        </Note>
      </Showcase>
    );
  },
};

/** Controlled and uncontrolled toggles in one row, and what a refused flip does. */
export const Toggles: Story = {
  render: function TogglesStory() {
    const [spellcheck, setSpellcheck] = useState(false);
    const [refuse, setRefuse] = useState(false);
    const onCheckedChange = useCallback(
      (_id: string, next: boolean) => {
        if (!refuse) setSpellcheck(next);
      },
      [refuse]
    );

    return (
      <Showcase>
        <Column label="one controlled, one uncontrolled, one action">
          <ButtonGroup
            accessibilityLabel="Editor toggles"
            appearance="connected"
            items={[
              { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc' },
              {
                id: 'spellcheck',
                title: 'Spellcheck',
                toggle: true,
                checked: spellcheck,
              },
              { id: 'bold', title: 'Bold', toggle: true, defaultChecked: true },
            ]}
            onCheckedChange={onCheckedChange}
            testID="storybook-button-group-toggles"
          />
        </Column>
        <Column label="the app refuses every change">
          <ButtonGroup
            accessibilityLabel="Refused group"
            items={[
              {
                id: 'always',
                title: 'Always off',
                toggle: true,
                checked: false,
              },
              { id: 'never', title: 'Never on', toggle: true, checked: true },
            ]}
            onCheckedChange={() => undefined}
          />
        </Column>
        <Column label="refuse the write above">
          <ButtonGroup
            items={[
              {
                id: 'refuse',
                title: refuse ? 'Refusing' : 'Accepting',
                toggle: true,
                checked: spellcheck,
              },
            ]}
            onPress={() => setRefuse((current) => !current)}
          />
        </Column>
        <Note>
          A tap is painted before React sees it. When the app does not move the
          value the next render sends, the item snaps back — the tap twice is
          the way to see it: a control that had kept a refused change would ask
          for the opposite the second time.
        </Note>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  readout: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
});
