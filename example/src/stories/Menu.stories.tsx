/**
 * Menu stories (S1). Props and events: `docs/components/menu.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are
 * harness/benchmark handles, not app API (DECISIONS D14).
 *
 * `group` gets no Controls row. It is a tree of rows, submenus and sections, and
 * the on-device Controls panel types text, numbers, booleans and lists of strings -
 * not nested objects - so the Playground chooses between five item lists on chips
 * instead. That is also the shape a caller has: the group is data a screen builds,
 * not a value someone types into a field.
 */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Menu,
  type ButtonSize,
  type ButtonVariant,
  type MenuGroup,
} from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase } from './showcase';

const VARIANTS: readonly ButtonVariant[] = [
  'filled',
  'tonal',
  'outlined',
  'text',
  'elevated',
];
const SIZES: readonly ButtonSize[] = ['small', 'medium', 'large'];

/**
 * The item lists the stories hand a `Menu`.
 *
 * Module-level so their identity never changes: `group` is an object prop, and a
 * literal in the JSX would be a fresh one on every render.
 */
const GROUPS = {
  flat: {
    actions: [
      { id: 'rename', title: 'Rename' },
      { id: 'duplicate', title: 'Duplicate' },
      { id: 'delete', title: 'Delete', destructive: true },
    ],
  },
  withDisabled: {
    actions: [
      { id: 'copy', title: 'Copy' },
      { id: 'paste', title: 'Paste', disabled: true },
      { id: 'cut', title: 'Cut' },
    ],
  },
  sections: {
    actions: [{ id: 'open', title: 'Open' }],
    sections: [
      {
        id: 'share',
        title: 'Share',
        items: [
          { id: 'airdrop', title: 'AirDrop' },
          { id: 'mail', title: 'Mail' },
        ],
      },
      {
        id: 'danger',
        items: [{ id: 'delete', title: 'Delete', destructive: true }],
      },
    ],
  },
  submenu: {
    actions: [
      { id: 'rename', title: 'Rename' },
      {
        id: 'sort',
        title: 'Sort by',
        systemImage: 'arrow.up.arrow.down',
        items: [
          { id: 'sort-name', title: 'Name' },
          { id: 'sort-date', title: 'Date' },
        ],
      },
    ],
  },
  long: {
    actions: [
      { id: 'short', title: 'Move' },
      { id: 'long', title: 'Move to another folder entirely' },
    ],
  },
} satisfies Record<string, MenuGroup>;

type GroupName = keyof typeof GROUPS;
const GROUP_NAMES = Object.keys(GROUPS) as GroupName[];

const meta = {
  component: Menu,
  args: {
    title: 'Actions',
    // Required by the component type, so it has to be in `args` for the stories to
    // typecheck - and `control: false` below is what keeps it off the Controls
    // panel, where no control could type it. Stories that want another list pass
    // `group` themselves.
    group: GROUPS.flat,
    variant: 'filled',
    size: 'medium',
    disabled: false,
    systemImage: undefined,
    tintColor: undefined,
    onSelect: fn(),
    onOpen: fn(),
    onClose: fn(),
  },
  argTypes: {
    title: {
      control: { type: 'text' },
      description:
        'The trigger’s text. It is a Button’s label and it sizes the trigger - the menu’s box is a Button’s box - so this is what decides its width, and it is the default accessibility label.',
    },
    group: {
      control: false,
      table: { disable: true },
      description:
        'The items, as data: `actions` (rows and submenus) then `sections` (a divider, a header, and its rows). No on-device control can type a tree, so the Playground picks one of five item lists from a chip.',
    },
    variant: {
      control: { type: 'select' },
      options: [...VARIANTS],
      description:
        'The trigger’s style, shared with Button: the same five values, the same chrome, the same measured box.',
    },
    size: {
      control: { type: 'select' },
      options: [...SIZES],
      description:
        'Trigger size, shared with Button (SwiftUI `.controlSize`; content padding and label typography on Android).',
    },
    disabled: {
      control: { type: 'boolean' },
      description:
        'Disables the trigger. On Android an open menu closes; on iOS the presentation is SwiftUI’s, so it is neither enforced nor observable (DECISIONS D32).',
    },
    systemImage: {
      control: { type: 'text' },
      description:
        'Leading SF Symbol on the trigger. **iOS only in v0.1** - Android ignores it.',
    },
    tintColor: {
      control: { type: 'color' },
      description:
        "SwiftUI `.tint()` on iOS; the variant's container or label colour on Android.",
    },
    onSelect: {
      action: 'select',
      description:
        'One call per picked row, with its `id`. Fires before `onClose`, which a pick also fires.',
    },
    onOpen: {
      action: 'open',
      description:
        '**Android only** - a SwiftUI `Menu` keeps its open state to itself, so iOS never calls this (DECISIONS D32).',
    },
    onClose: {
      action: 'close',
      description:
        '**Android only**, for the same reason. A pick reports `onSelect` first.',
    },
    primaryAction: {
      action: 'primary',
      description:
        '**iOS only**: tap runs this and a long-press opens the menu. Android always opens on tap and never calls it (DECISIONS D29), so the Playground leaves it off - see `PrimaryAction`.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Menu>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel, with the item list on chips.
 *
 * `primaryAction` is deliberately left out of the Playground’s args: turning it on
 * turns a tap into an action and moves the menu behind a long-press, so the same
 * trigger would do two different things depending on a checkbox. `PrimaryAction`
 * is where that split is the point.
 */
export const Playground: Story = {
  render: function PlaygroundStory(props) {
    const { onSelect, onOpen, onClose, ...rest } = props;
    const [groupName, setGroupName] = useState<GroupName>('flat');
    const [picked, setPicked] = useState<string | null>(null);

    const handleSelect = useCallback(
      (id: string) => {
        setPicked(id);
        onSelect?.(id);
      },
      [onSelect]
    );

    return (
      <View style={styles.playground}>
        <Menu
          {...rest}
          group={GROUPS[groupName]}
          accessibilityLabel="Playground menu"
          onSelect={handleSelect}
          onOpen={onOpen}
          onClose={onClose}
          testID="storybook-menu-playground"
        />
        <View style={styles.chipRow}>
          {GROUP_NAMES.map((name) => (
            <Pressable
              key={name}
              onPress={() => setGroupName(name)}
              style={styles.chip}
              testID={`storybook-menu-group-${name}`}
            >
              <Text style={styles.chipLabel}>{name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.readout}>
          last pick: {picked ?? '(nothing)'} - item list: {groupName}
        </Text>
        <Note>
          `onOpen`/`onClose` reach Actions on Android and never on iOS, and a
          pick reports `select` before the `close` it causes.
        </Note>
      </View>
    );
  },
};

/**
 * The trigger vocabulary: five variants at three sizes.
 *
 * The same nine combinations `Button` publishes, deliberately: this control claims
 * its trigger *is* a Button, and the story is where a reader can put the two
 * screens next to each other.
 */
export const TriggerStyles: Story = {
  render: function TriggerStylesStory() {
    return (
      <Showcase>
        {SIZES.map((size) => (
          <Row key={size} label={size}>
            <View style={styles.chipRow}>
              {VARIANTS.map((variant) => (
                <Menu
                  key={`${variant}-${size}`}
                  title="Actions"
                  group={GROUPS.flat}
                  variant={variant}
                  size={size}
                  testID={`storybook-trigger-${variant}-${size}`}
                />
              ))}
            </View>
          </Row>
        ))}
        <Note>
          A menu’s box is a Button’s box: same variants, same sizes, same
          measured size. The system presents the list, so no variant changes
          what an open menu looks like.
        </Note>
      </Showcase>
    );
  },
};

/**
 * The row vocabulary in one control: rows, a destructive row, a disabled row,
 * sections with and without a header, and a submenu.
 *
 * The submenu is the one row that differs by platform - nested on iOS, inline
 * under a divider on Android (D29) - and neither platform nests a submenu inside a
 * submenu.
 */
export const ItemLists: Story = {
  render: function ItemListsStory() {
    const [picked, setPicked] = useState('nothing yet');
    return (
      <Showcase>
        <Row label="Sections and a divider-only group">
          <Menu
            title="File"
            group={GROUPS.sections}
            onSelect={setPicked}
            testID="storybook-items-sections"
          />
        </Row>
        <Row label="A disabled row">
          <Menu
            title="Edit"
            group={GROUPS.withDisabled}
            onSelect={setPicked}
            testID="storybook-items-disabled-row"
          />
        </Row>
        <Row label="A submenu">
          <Menu
            title="Sort"
            group={GROUPS.submenu}
            onSelect={setPicked}
            testID="storybook-items-submenu"
          />
        </Row>
        <Note>
          Last pick: {picked}. A disabled row is drawn and announced as disabled
          and reports nothing; the submenu nests on iOS and comes inline under a
          divider on Android.
        </Note>
      </Showcase>
    );
  },
};

/** Disabled, side by side with an enabled control of the same shape. */
export const Disabled: Story = {
  render: function DisabledStory() {
    return (
      <Showcase>
        <Row label="disabled">
          <Menu
            title="Actions"
            group={GROUPS.flat}
            disabled
            testID="storybook-disabled"
          />
        </Row>
        <Row label="enabled">
          <Menu
            title="Actions"
            group={GROUPS.flat}
            testID="storybook-enabled"
          />
        </Row>
        <Note>
          A disabled trigger opens nothing and reports nothing. Disabling one
          whose menu is already open closes it on Android; on iOS there is no
          open state to observe.
        </Note>
      </Showcase>
    );
  },
};

/** The accent colour and a leading symbol, next to plain controls. */
export const Tinted: Story = {
  render: function TintedStory() {
    return (
      <Showcase>
        <Column label="tintColor">
          <Menu
            title="Filled"
            group={GROUPS.flat}
            tintColor="#B4472C"
            testID="storybook-tint-filled"
          />
          <Menu
            title="Outlined"
            group={GROUPS.flat}
            variant="outlined"
            tintColor="#2C7BB4"
            testID="storybook-tint-outlined"
          />
        </Column>
        <Column label="systemImage (iOS)">
          <Menu
            title="More"
            group={GROUPS.flat}
            systemImage="ellipsis.circle"
            testID="storybook-symbol"
          />
        </Column>
        <Note>
          iOS tints the trigger; Android paints the variant’s container or label
          colour. `systemImage` is iOS-only in v0.1, so Android draws the title
          alone.
        </Note>
      </Showcase>
    );
  },
};

/**
 * The trigger is sized by its title, and a title too long for its box truncates.
 *
 * `intrinsic` sizing: the control measures itself and its box is what it measured,
 * so a caller either gives it room or sees an ellipsis. The list is as wide as its
 * own rows need, which is not the trigger’s width - on either platform.
 */
export const Sizing: Story = {
  render: function SizingStory() {
    return (
      <Showcase>
        <Frame label="menu in a 140 box" width={140}>
          <Menu
            title="A trigger far too long for this box"
            group={GROUPS.long}
            testID="storybook-sizing-long"
          />
          <Menu title="Short" group={GROUPS.flat} />
        </Frame>
        <Row label="Wide rows, narrow trigger">
          <Menu
            title="Move"
            group={GROUPS.long}
            testID="storybook-sizing-rows"
          />
        </Row>
        <Note>
          The long title is ellipsised at its measured width rather than
          clipped, and the list opens as wide as its widest row: a trigger does
          not size a menu.
        </Note>
      </Showcase>
    );
  },
};

/**
 * iOS's primary action: tap acts, a long-press opens the list.
 *
 * Worth reading on an iPhone and then on Android, because the two answers differ by
 * ruling rather than by gap (D29): Material 3 has no tap-versus-long-press split on
 * a menu, so Android always opens and never calls the callback.
 */
export const PrimaryAction: Story = {
  render: function PrimaryActionStory() {
    const [presses, setPresses] = useState(0);
    const [picks, setPicks] = useState(0);
    return (
      <Showcase>
        <Row label="primaryAction">
          <Menu
            title="Send"
            group={GROUPS.flat}
            primaryAction={() => setPresses((current) => current + 1)}
            onSelect={() => setPicks((current) => current + 1)}
            testID="storybook-primary"
          />
        </Row>
        <Note>
          Taps that acted: {presses} - picks: {picks}. On iOS a tap acts and a
          long-press opens the list; Android always opens, so its action counter
          stays at zero and only picks move.
        </Note>
      </Showcase>
    );
  },
};

/**
 * The events one gesture produces, in the order the platform reports them.
 *
 * One control and one line of text: the same pick reads `open > select > close` on
 * Android and `select` alone on iOS, which is D32’s ruling in a form a reader can
 * check on their own phone.
 */
export const Events: Story = {
  render: function EventsStory() {
    const [log, setLog] = useState<string[]>([]);
    const say = useCallback(
      (said: string) => setLog((current) => [...current.slice(-5), said]),
      []
    );
    return (
      <Showcase>
        <Row label="One control, every event">
          <Menu
            title="Actions"
            group={GROUPS.flat}
            onSelect={(id) => say(`select ${id}`)}
            onOpen={() => say('open')}
            onClose={() => say('close')}
            testID="storybook-events"
          />
          <Pressable
            onPress={() => setLog([])}
            style={styles.chip}
            testID="storybook-events-clear"
          >
            <Text style={styles.chipLabel}>Clear</Text>
          </Pressable>
        </Row>
        <Note>
          {log.length === 0 ? '(nothing reported yet)' : log.join(' > ')}
        </Note>
      </Showcase>
    );
  },
};

/**
 * A `group` whose rows come and go while the control stays mounted.
 *
 * The prop change is the interesting half: a menu is not a value React owns, so all
 * a new item list may do is redraw the list - never reopen it, and never lose a menu
 * that is already up.
 */
export const ChangingGroup: Story = {
  render: function ChangingGroupStory() {
    const [extra, setExtra] = useState(true);
    const group = useMemo<MenuGroup>(
      () => ({
        actions: extra
          ? [
              { id: 'one', title: 'First' },
              { id: 'two', title: 'Second' },
              { id: 'three', title: 'Third' },
            ]
          : [{ id: 'one', title: 'First' }],
      }),
      [extra]
    );
    return (
      <Showcase>
        <Row label="Three rows / one row">
          <Menu title="Rows" group={group} testID="storybook-changing" />
          <Pressable
            onPress={() => setExtra((current) => !current)}
            style={styles.chip}
            testID="storybook-changing-toggle"
          >
            <Text style={styles.chipLabel}>
              {extra ? 'Take two away' : 'Put them back'}
            </Text>
          </Pressable>
        </Row>
        <Note>
          The trigger never changes size, because the list is not what sizes it.
          Open the menu first and then press the chip: the list stays up and its
          rows change under it.
        </Note>
      </Showcase>
    );
  },
};

/**
 * The announcement, and what a screen reader is offered.
 *
 * The trigger is named by `accessibilityLabel` when one is given and by its `title`
 * when not, and it is a control that opens a list either way. The rows belong to the
 * system’s presentation, so a disabled row is announced as disabled there too.
 */
export const Accessibility: Story = {
  render: function AccessibilityStory() {
    return (
      <Showcase>
        <Row label="accessibilityLabel">
          <Menu
            title="Actions"
            group={GROUPS.withDisabled}
            accessibilityLabel="More actions for this file"
            testID="storybook-a11y-labelled"
          />
        </Row>
        <Row label="No label at all">
          <Menu
            title="Actions"
            group={GROUPS.withDisabled}
            testID="storybook-a11y-plain"
          />
        </Row>
        <Note>
          Turn a screen reader on: the trigger is announced as its label, or as
          its title when it has none, and “Paste” is announced as disabled
          inside the list.
        </Note>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  playground: {
    gap: 10,
    padding: 16,
  },
  readout: {
    fontSize: 13,
    opacity: 0.7,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipLabel: {
    fontSize: 14,
  },
});
