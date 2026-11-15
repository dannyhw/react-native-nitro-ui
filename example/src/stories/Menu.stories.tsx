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
        'The items, as data: `actions` (rows and submenus) then `sections` (a group with an optional header). A row can carry a `subtitle` and a `checked`. No on-device control can type a tree, so the Playground picks one of five item lists from a chip.',
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
        'A second job for the trigger, drawn each platform’s way (DECISIONS D29, E3): on iOS a tap runs this and a long-press opens the menu; on Android the control becomes a split button whose left half runs this and whose chevron opens the menu. The Playground leaves it off because on iOS it turns a tap into something else - see `PrimaryAction`.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Menu>;

export default meta;

type Story = StoryObj<typeof meta>;

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

// A submenu is nested on iOS and drawn inline as a group of its own on Android.
export const ItemLists: Story = {
  render: function ItemListsStory() {
    const [picked, setPicked] = useState('nothing yet');
    return (
      <Showcase>
        <Row label="Sections and an untitled group">
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
          and reports nothing; the submenu nests on iOS and comes inline as a
          group of its own on Android.
        </Note>
      </Showcase>
    );
  },
};

export const RowDetails: Story = {
  render: function RowDetailsStory() {
    const [layout, setLayout] = useState<'icons' | 'list'>('icons');
    const [showHidden, setShowHidden] = useState(false);
    const group = useMemo<MenuGroup>(
      () => ({
        actions: [
          {
            id: 'icons',
            title: 'Icons',
            subtitle: 'Large thumbnails',
            checked: layout === 'icons',
          },
          {
            id: 'list',
            title: 'List',
            subtitle: 'Names and dates',
            checked: layout === 'list',
          },
        ],
        sections: [
          {
            id: 'options',
            title: 'Options',
            items: [
              { id: 'hidden', title: 'Show hidden files', checked: showHidden },
              {
                id: 'refresh',
                title: 'Refresh',
                subtitle: 'Updated a minute ago',
              },
            ],
          },
        ],
      }),
      [layout, showHidden]
    );
    const handleSelect = useCallback((id: string) => {
      if (id === 'icons' || id === 'list') setLayout(id);
      if (id === 'hidden') setShowHidden((current) => !current);
    }, []);
    return (
      <Showcase>
        <Row label="Checks and subtitles">
          <Menu
            title="View"
            group={group}
            onSelect={handleSelect}
            testID="storybook-row-details"
          />
        </Row>
        <Note>
          Layout: {layout} - hidden files: {showHidden ? 'shown' : 'hidden'}. A
          pick reports the row; the check is the app’s state, sent back as
          `checked`.
        </Note>
      </Showcase>
    );
  },
};

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

// iOS keeps one button: a tap runs the action and a long-press opens the list.
// Android draws Material 3's split button: the left half runs the action and the
// chevron opens the list.
export const PrimaryAction: Story = {
  render: function PrimaryActionStory() {
    const [presses, setPresses] = useState(0);
    const [picks, setPicks] = useState(0);
    const [opens, setOpens] = useState(0);
    return (
      <Showcase>
        <Row label="primaryAction">
          <Menu
            title="Send"
            group={GROUPS.flat}
            primaryAction={() => setPresses((current) => current + 1)}
            onSelect={() => setPicks((current) => current + 1)}
            onOpen={() => setOpens((current) => current + 1)}
            testID="storybook-primary"
          />
        </Row>
        <Note>
          Actions run: {presses} - picks: {picks} - the list opened: {opens}
          ×. On iOS a tap acts and a long-press opens; on Android the left half
          acts and the chevron opens.
        </Note>
      </Showcase>
    );
  },
};

export const SplitTrigger: Story = {
  render: function SplitTriggerStory() {
    const [log, setLog] = useState<string[]>([]);
    const say = useCallback(
      (said: string) => setLog((current) => [...current.slice(-5), said]),
      []
    );
    return (
      <Showcase>
        {(['small', 'medium', 'large'] as const).map((size) => (
          <Row key={size} label={size}>
            <Menu
              title={`Send ${size}`}
              group={GROUPS.flat}
              size={size}
              testID={`storybook-split-plain-${size}`}
              onOpen={() => say(`plain ${size} open`)}
              onClose={() => say(`plain ${size} close`)}
            />
            <Menu
              title={`Send ${size}`}
              group={GROUPS.flat}
              size={size}
              primaryAction={() => say(`action ${size}`)}
              testID={`storybook-split-action-${size}`}
              onOpen={() => say(`split ${size} open`)}
              onClose={() => say(`split ${size} close`)}
            />
          </Row>
        ))}
        <Note>
          Plain trigger on the left, `primaryAction` on the right. On Android
          the right-hand one is a split button, and wider; on iOS the pair is
          the same box. Last events:{' '}
          {log.length > 0 ? log.join(' · ') : 'nothing yet'}.
        </Note>
      </Showcase>
    );
  },
};

// The same pick reports `open > select > close` on Android and `select` alone on
// iOS.
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
