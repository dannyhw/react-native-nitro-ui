import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  IconButton,
  type IconButtonSize,
  type IconButtonVariant,
  type IconButtonWidth,
} from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Frame, Note, Row, Showcase } from './showcase';

const DRAWABLE = 'nitroui_test_star';

const RUNGS: readonly IconButtonSize[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];
const VARIANTS: readonly IconButtonVariant[] = [
  'standard',
  'filled',
  'tonal',
  'outlined',
];
const WIDTHS: readonly IconButtonWidth[] = ['narrow', 'uniform', 'wide'];

const meta = {
  component: IconButton,
  args: {
    accessibilityLabel: 'Playground icon button',
    systemImage: 'paperplane',
    androidIcon: DRAWABLE,
    variant: 'standard',
    size: 'medium',
    width: 'uniform',
    shape: 'round',
    disabled: false,
    tintColor: undefined,
    onPress: fn(),
  },
  argTypes: {
    accessibilityLabel: {
      control: { type: 'text' },
      description:
        'The control&apos;s only name: an IconButton has no text, so this is what VoiceOver and TalkBack read. Required by the type.',
    },
    systemImage: {
      control: { type: 'text' },
      description:
        'SF Symbol name. **iOS only** — Android has no SF Symbols, so name the drawable in `androidIcon` as well and each platform draws its own.',
    },
    androidIcon: {
      control: { type: 'text' },
      description:
        '**Android only**: a drawable resource name (`nitroui_test_star` here) or a Metro asset (`require(&apos;./icons/share.xml&apos;)`). The glyph&apos;s size comes from `size`, never from the file.',
    },
    variant: {
      control: 'select',
      options: [...VARIANTS],
      description:
        '`standard` (bare glyph), `filled`, `tonal` or `outlined` — Material&apos;s own names for the four icon buttons.',
    },
    size: {
      control: 'select',
      options: [...RUNGS],
      description:
        'The shared ladder (`small` … `xxlarge`), the same word as `Button.size`. On Android a rung is Material&apos;s own container token.',
    },
    width: {
      control: 'select',
      options: [...WIDTHS],
      description:
        '**Android only**: Material&apos;s three width options for a rung. iOS has no counterpart and keeps one box for all three.',
    },
    shape: {
      control: 'select',
      options: ['round', 'square'],
      description:
        'The corner, with `Button`&apos;s vocabulary. Repaints; does not resize.',
    },
    disabled: { control: { type: 'boolean' } },
    tintColor: {
      control: { type: 'color' },
      description:
        'SwiftUI `.tint()` on iOS; on Android the variant&apos;s container colour, or its content colour when `variant` is `outlined`.',
    },
    onPress: {
      action: 'pressed',
      description:
        'One call per tap on the press form. Nothing fires while `disabled`.',
    },
    onCheckedChange: {
      action: 'checked changed',
      description:
        'The toggle form&apos;s event: the selection native now displays. Pass `checked` to control it.',
    },
    checked: {
      control: { type: 'boolean' },
      description:
        'Makes the control a toggle and controls it. Unset it for an uncontrolled toggle, or pass none of `checked` / `defaultChecked` / `onCheckedChange` for a press button.',
    },
    defaultChecked: {
      control: { type: 'boolean' },
      description: 'Initial selection of an uncontrolled toggle.',
    },
    testID: { control: false },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory({ onPress, ...props }) {
    const [presses, setPresses] = useState(0);
    const handlePress = useCallback(() => {
      setPresses((count) => count + 1);
      onPress?.();
    }, [onPress]);

    return (
      <View style={styles.playground}>
        <IconButton
          {...props}
          onPress={handlePress}
          testID="storybook-icon-button-playground"
        />
        <Text style={styles.readout}>presses: {presses}</Text>
      </View>
    );
  },
};

export const Variants: Story = {
  render: function VariantsStory() {
    const [on, setOn] = useState<Record<string, boolean>>({
      standard: true,
      filled: false,
      tonal: true,
      outlined: false,
    });
    const flip = useCallback(
      (variant: string) => (next: boolean) => {
        setOn((current) => ({ ...current, [variant]: next }));
      },
      []
    );

    return (
      <Showcase>
        <Row label="standard — a bare glyph, no container">
          <IconButton
            accessibilityLabel="Standard, filled variant label"
            androidIcon={DRAWABLE}
            size="large"
            systemImage="paperplane"
          />
        </Row>
        <Row label="filled">
          <IconButton
            accessibilityLabel="Filled"
            androidIcon={DRAWABLE}
            size="large"
            systemImage="paperplane"
            variant="filled"
          />
        </Row>
        <Row label="tonal">
          <IconButton
            accessibilityLabel="Tonal"
            androidIcon={DRAWABLE}
            size="large"
            systemImage="paperplane"
            variant="tonal"
          />
        </Row>
        <Row label="outlined">
          <IconButton
            accessibilityLabel="Outlined"
            androidIcon={DRAWABLE}
            size="large"
            systemImage="paperplane"
            variant="outlined"
          />
        </Row>
        <Row label="each one disabled">
          {VARIANTS.map((variant) => (
            <IconButton
              key={variant}
              accessibilityLabel={`${variant} disabled`}
              androidIcon={DRAWABLE}
              disabled
              size="large"
              systemImage="paperplane"
              variant={variant}
            />
          ))}
        </Row>
        <Row label="the toggle form, two on and two off">
          {VARIANTS.map((variant) => (
            <IconButton
              key={variant}
              accessibilityLabel={`${variant} toggle`}
              androidIcon={DRAWABLE}
              checked={on[variant] ?? false}
              onCheckedChange={flip(variant)}
              size="large"
              systemImage="paperplane"
              variant={variant}
            />
          ))}
        </Row>
        <Note>
          Android composes Material&apos;s `IconButton`, `FilledIconButton`,
          `FilledTonalIconButton` and `OutlinedIconButton`, and the matching
          `…IconToggleButton`s for the last row. iOS has no icon-button control:
          it draws a SwiftUI `Button` / `Toggle(.button)` whose label is
          `.iconOnly`, so its look comes from a button style instead.
        </Note>
      </Showcase>
    );
  },
};

// Three width columns on Android only: iOS has no counterpart to Material's
// width options. Android lays the two smallest sizes out at its 48 dp minimum.
export const Sizes: Story = {
  render: () => (
    <Showcase>
      {RUNGS.map((size) => (
        <Row key={size} label={size}>
          {(Platform.OS === 'android'
            ? WIDTHS
            : (['uniform'] as readonly IconButtonWidth[])
          ).map((width) => (
            <IconButton
              key={width}
              accessibilityLabel={`${size} ${width}`}
              androidIcon={DRAWABLE}
              size={size}
              systemImage="paperplane"
              width={width}
            />
          ))}
        </Row>
      ))}
      <Note>
        Android only: the three boxes per row are `width` set to `narrow`,
        `uniform` and `wide`. iOS draws one box per rung whatever `width` says —
        its glyph plus the style&apos;s own padding — and the ladder moves only
        with `size`. On Android no rung is laid out below Material&apos;s 48 dp
        minimum interactive size, so `small` and `medium` sit in a box wider
        than the token they are drawn from.
      </Note>
    </Showcase>
  ),
};

export const Shapes: Story = {
  render: () => (
    <Showcase>
      {VARIANTS.map((variant) => (
        <Row key={variant} label={variant}>
          <IconButton
            accessibilityLabel={`${variant} round`}
            androidIcon={DRAWABLE}
            size="large"
            systemImage="paperplane"
            variant={variant}
          />
          <IconButton
            accessibilityLabel={`${variant} square`}
            androidIcon={DRAWABLE}
            shape="square"
            size="large"
            systemImage="paperplane"
            variant={variant}
          />
        </Row>
      ))}
      <Note>
        The corner is not part of the control&apos;s size configuration:
        switching it repaints and moves nothing.
      </Note>
    </Showcase>
  ),
};

export const Toggles: Story = {
  render: function TogglesStory() {
    const [saved, setSaved] = useState(true);
    const [refusedLast, setRefusedLast] = useState('none');
    const onSaved = useCallback((next: boolean) => setSaved(next), []);
    const onRefused = useCallback((next: boolean) => {
      setRefusedLast(String(next));
    }, []);

    return (
      <Showcase>
        <Row label="uncontrolled (defaultChecked true)">
          <IconButton
            accessibilityLabel="Uncontrolled bookmark toggle"
            androidIcon={DRAWABLE}
            defaultChecked
            systemImage="bookmark"
            variant="tonal"
          />
        </Row>
        <Row label="controlled by this story">
          <IconButton
            accessibilityLabel="Controlled bookmark toggle"
            androidIcon={DRAWABLE}
            checked={saved}
            onCheckedChange={onSaved}
            systemImage="bookmark"
            variant="tonal"
          />
          <IconButton
            accessibilityLabel="Controlled, square"
            androidIcon={DRAWABLE}
            checked={saved}
            onCheckedChange={onSaved}
            shape="square"
            systemImage="bookmark"
            variant="tonal"
          />
        </Row>
        <Row label="controlled to false — every flip snaps back">
          <IconButton
            accessibilityLabel="Refused bookmark toggle"
            androidIcon={DRAWABLE}
            checked={false}
            onCheckedChange={onRefused}
            systemImage="bookmark"
            variant="tonal"
          />
          <Text style={styles.readout}>last event: {refusedLast}</Text>
        </Row>
        <Note>
          A toggle is the handshake the Switch and the Chip use: native paints
          the flip it was asked for, and the value React pushes down afterwards
          is the one that stays. The label is the same in both states — what a
          reader hears change is the selected state, not the name.
        </Note>
      </Showcase>
    );
  },
};

export const Glyphs: Story = {
  render: () => (
    <Showcase>
      <Row label="androidIcon from a Metro asset (Android) / SF Symbol (iOS)">
        <IconButton
          accessibilityLabel="Share, from an asset"
          androidIcon={require('../assets/icons/share_24px.xml')}
          size="large"
          systemImage="square.and.arrow.up"
          variant="tonal"
        />
      </Row>
      <Row label="androidIcon as a drawable name">
        <IconButton
          accessibilityLabel="Share, from a drawable"
          androidIcon={DRAWABLE}
          size="large"
          systemImage="square.and.arrow.up"
          variant="tonal"
        />
      </Row>
      <Row label="neither resolves">
        <IconButton
          accessibilityLabel="Nothing resolves"
          androidIcon="this_name_is_not_built"
          size="large"
          systemImage="not-a-real-symbol"
          variant="tonal"
        />
      </Row>
      <Row label="tinted (iOS .tint / Android container or content colour)">
        <IconButton
          accessibilityLabel="Filled, tinted"
          androidIcon={DRAWABLE}
          size="large"
          systemImage="paperplane"
          tintColor="#ff375f"
          variant="filled"
        />
        <IconButton
          accessibilityLabel="Outlined, tinted"
          androidIcon={DRAWABLE}
          size="large"
          systemImage="paperplane"
          tintColor="#ff375f"
          variant="outlined"
        />
      </Row>
      <Note>
        An unresolved name costs nothing but the glyph: no slot is reserved and
        no padding changes, so the control is exactly its no-icon self. The
        third row is the same box as the first two.
      </Note>
    </Showcase>
  ),
};

export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Row label="intrinsic">
        <IconButton
          accessibilityLabel="Intrinsic"
          androidIcon={DRAWABLE}
          size="large"
          systemImage="paperplane"
          variant="tonal"
        />
        <Text style={styles.baseline}>measured box, baseline-aligned</Text>
      </Row>
      <Frame label="inside a 240-wide parent (dashed)" width={240}>
        <IconButton
          accessibilityLabel="In a narrow parent"
          androidIcon={DRAWABLE}
          size="large"
          systemImage="paperplane"
          variant="tonal"
        />
      </Frame>
      <Frame label="inside a 240-wide parent, alignSelf: stretch" width={240}>
        <IconButton
          accessibilityLabel="Stretched"
          androidIcon={DRAWABLE}
          size="large"
          style={styles.stretch}
          systemImage="paperplane"
          variant="tonal"
        />
      </Frame>
      <Note>
        The third row is wider than its siblings for the reason every measured
        control has: measured sizes leave Yoga nothing to stretch, so a parent's
        `alignItems` does not widen one.
      </Note>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  baseline: {
    fontSize: 13,
    opacity: 0.7,
  },
  playground: {
    alignSelf: 'stretch',
    gap: 10,
    padding: 12,
  },
  readout: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  stretch: {
    alignSelf: 'stretch',
  },
});
