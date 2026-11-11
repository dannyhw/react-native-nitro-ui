/**
 * Form stories (G24): grouped settings lists whose rows are React Native views.
 * Props and events: `docs/components/form.md`.
 *
 * A `Form` is not self-sizing — it takes the box it is given and scrolls inside it —
 * so every story hands it a height rather than wrapping it in another scroller: a
 * list inside a `ScrollView` would fight the list for the drag. Row text is React
 * Native's, so it colours itself from the appearance like every other showcase.
 *
 * `children` gets no Controls row: a section is a component and the on-device panel
 * cannot type one, so the Playground's rows are fixed and its Controls panel carries
 * the one prop a Form has. The internal props (`hybridRef`, `nuiPerfId`) are hidden:
 * they are harness and benchmark handles, not app API (DECISIONS D14).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Form, Switch, TextField } from 'react-native-nitro-ui';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Note, useShowcaseInk } from './showcase';

/**
 * The height every story gives a Form: about six rows on iOS, five on Android, so a
 * short story is readable and a long one has something to scroll.
 */
const FORM_HEIGHT = 420;

const meta = {
  component: Form,
  args: {
    keyboardAvoidance: true,
  },
  argTypes: {
    keyboardAvoidance: {
      control: { type: 'boolean' },
      description:
        'Keep the focused row above the keyboard: a bottom inset on the list on iOS, the IME inset reserved in the scroll content on Android. On by default.',
    },
    children: {
      control: false,
      table: { disable: true },
      description:
        '`Form.Section`s, or rows directly. Each direct child of a section is one row.',
    },
    hybridRef: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Form>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The two sections the README picture shows, as a component so the Playground can
 * hold their switch state while `Sections` renders the same form uncontrolled.
 *
 * The two switch rows are the bare pair the README prints: a `Text` with `flex: 1`
 * and the control after it. A row lays that pair out as one centred row across its
 * content width, so the switch sits on the trailing edge level with its label with
 * no wrapper in this file to arrange it (`docs/components/form.md`).
 */
function NotificationSections({
  push,
  sound,
  onPushChange,
  onSoundChange,
  onOpenQuietHours,
}: {
  push?: boolean;
  sound?: boolean;
  onPushChange?: ((value: boolean) => void) | undefined;
  onSoundChange?: ((value: boolean) => void) | undefined;
  onOpenQuietHours?: (() => void) | undefined;
}) {
  const ink = useShowcaseInk();
  return (
    <>
      <Form.Section
        title="Notifications"
        footer="Push arrives on this device only."
      >
        <Form.Row>
          <Text style={[styles.rowLabel, { color: ink.ink }]}>
            Push notifications
          </Text>
          <Switch
            accessibilityLabel="Push notifications"
            value={push}
            onValueChange={onPushChange}
          />
        </Form.Row>
        <Form.Row>
          <Text style={[styles.rowLabel, { color: ink.ink }]}>
            Play a sound
          </Text>
          <Switch
            accessibilityLabel="Play a sound"
            value={sound}
            onValueChange={onSoundChange}
          />
        </Form.Row>
      </Form.Section>
      <Form.Section title="Quiet hours">
        <Form.Row accessory="disclosure" onPress={onOpenQuietHours}>
          <Text style={[styles.rowLabel, { color: ink.ink }]}>
            Set quiet hours
          </Text>
        </Form.Row>
      </Form.Section>
    </>
  );
}

/**
 * Every public prop on the Controls panel, over a form that behaves.
 *
 * The switches and the press counter are React state, so what the picture shows is
 * what the app committed to: a row press moves the number below the list, a switch
 * tap moves only its own value.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ keyboardAvoidance }) {
    const ink = useShowcaseInk();
    const [push, setPush] = useState(true);
    const [sound, setSound] = useState(false);
    const [presses, setPresses] = useState(0);

    return (
      <View style={styles.page}>
        <Form keyboardAvoidance={keyboardAvoidance} style={styles.form}>
          <NotificationSections
            push={push}
            sound={sound}
            onPushChange={setPush}
            onSoundChange={setSound}
            onOpenQuietHours={() => setPresses((count) => count + 1)}
          />
        </Form>
        <Text style={[styles.echo, { color: ink.ink }]}>
          quiet-hours presses: {presses}
        </Text>
      </View>
    );
  },
};

/**
 * A section header, a footer, and a group whose row goes somewhere.
 *
 * This is the README screenshot. On iOS it is UIKit's `.insetGrouped` list — the
 * card, the header, the footer and the disclosure chevron are drawn by the list, and
 * the two rows are React Native views inside its cells. On Android the rows stay
 * exactly where Yoga put them and the section draws Material 3's segmented-list
 * shapes behind them, so a group reads as one connected list with rounded ends.
 */
export const Sections: Story = {
  render: () => (
    <View style={styles.page}>
      <Form style={styles.form}>
        <NotificationSections />
      </Form>
    </View>
  ),
};

/** The three accessories, and the selected state. */
function AccessoriesStory() {
  const ink = useShowcaseInk();
  const ignored = () => {};
  return (
    <View style={styles.page}>
      <Form style={styles.form}>
        <Form.Section title="Accessory">
          <Form.Row onPress={ignored}>
            <Text style={[styles.rowLabel, { color: ink.ink }]}>None</Text>
          </Form.Row>
          <Form.Row accessory="disclosure" onPress={ignored}>
            <Text style={[styles.rowLabel, { color: ink.ink }]}>
              Disclosure
            </Text>
          </Form.Row>
          <Form.Row accessory="checkmark" onPress={ignored}>
            <Text style={[styles.rowLabel, { color: ink.ink }]}>Checkmark</Text>
          </Form.Row>
        </Form.Section>
        <Form.Section title="Selected" footer="One row at a time, usually.">
          <Form.Row selected onPress={ignored}>
            <Text style={[styles.rowLabel, { color: ink.ink }]}>
              Selected row
            </Text>
          </Form.Row>
          <Form.Row onPress={ignored}>
            <Text style={[styles.rowLabel, { color: ink.ink }]}>
              Not selected
            </Text>
          </Form.Row>
        </Form.Section>
      </Form>
      <Note>
        `disclosure` is UIKit&apos;s `disclosureIndicator` and the Material
        Symbols `chevron_right`; `checkmark` is `.checkmark` and `check` — the
        official symbol files, never a hand-drawn path (D43). Android reserves
        the trailing room the glyph takes, so a label never sits under it.
        `selected` is the cell&apos;s selected background on iOS,
        `secondaryContainer` on Android.
      </Note>
    </View>
  );
}

/** The three accessories and the selected state. */
export const Accessories: Story = {
  render: () => <AccessoriesStory />,
};

/** Any React Native view is a row, with or without an explicit `Form.Row`. */
function RowContentStory() {
  const ink = useShowcaseInk();
  const [on, setOn] = useState(false);
  const [text, setText] = useState('');
  const [inner, setInner] = useState(0);
  const [row, setRow] = useState(0);

  return (
    <View style={styles.page}>
      <Form style={styles.form}>
        <Form.Section title="Bare children" footer="No wrapper needed.">
          <Text style={[styles.rowLabel, { color: ink.ink }]}>
            A text element is already a row
          </Text>
          <Pressable
            accessibilityLabel="Pressable inside a row"
            onPress={() => setInner((count) => count + 1)}
            style={({ pressed }) => [
              styles.inner,
              { borderColor: ink.hairline },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.rowLabel, { color: ink.ink }]}>
              A Pressable: {inner}
            </Text>
          </Pressable>
          <TextField
            accessibilityLabel="Field inside a row"
            placeholder="A TextField, too"
            value={text}
            onChangeText={setText}
          />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: ink.ink }]}>
              Airplane mode
            </Text>
            <Switch
              accessibilityLabel="Airplane mode"
              value={on}
              onValueChange={setOn}
            />
          </View>
        </Form.Section>
        <Form.Section title="With an onPress">
          <Form.Row
            accessory="disclosure"
            onPress={() => setRow((count) => count + 1)}
          >
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: ink.ink }]}>
                The whole row presses: {row}
              </Text>
              <Text style={[styles.rowDetail, { color: ink.muted }]}>
                one element
              </Text>
            </View>
          </Form.Row>
        </Form.Section>
      </Form>
      <Note>
        A row without `onPress` leaves its content alone: the `Switch` above is
        a switch and nothing more, and the `Pressable` keeps its own touches. A
        row *with* `onPress` is one element on both platforms, so the counter
        moves once per tap however tall the row is.
      </Note>
    </View>
  );
}

/**
 * Any React Native view is a row.
 *
 * The first section's rows are a bare `Text`, a `Pressable`, a `TextField` and a
 * `View` with a `Switch` — direct children, each wrapped into a row by the section.
 * The second names `Form.Row` only to add the press and the accessory.
 */
export const RowContent: Story = {
  render: () => <RowContentStory />,
};

/** Twenty-four rows across three sections, which is what a settings screen is. */
function ManyRowsStory() {
  const ink = useShowcaseInk();
  const ignored = () => {};
  const sections = [
    { title: 'Account', count: 8 },
    { title: 'Storage', count: 8 },
    { title: 'Advanced', count: 8 },
  ];
  return (
    <View style={styles.page}>
      <Form style={styles.form}>
        {sections.map((section) => (
          <Form.Section
            key={section.title}
            title={section.title}
            footer={`${section.count} rows, each a React Native view.`}
          >
            {Array.from({ length: section.count }, (_, index) => (
              <Form.Row
                key={`${section.title}-${String(index)}`}
                accessory="disclosure"
                onPress={ignored}
              >
                <Text style={[styles.rowLabel, { color: ink.ink }]}>
                  {section.title} row {index + 1}
                </Text>
              </Form.Row>
            ))}
          </Form.Section>
        ))}
      </Form>
      <Note>
        A Form builds every row it is given, like SwiftUI&apos;s `Form`. iOS
        reuses the cells, not the rows, so a list this long costs cells rather
        than views. For a list that is truly long, use FlashList or Legend List
        — see `docs/components/form.md`.
      </Note>
    </View>
  );
}

/** Twenty-four rows across three sections, which is what a settings screen is. */
export const ManyRows: Story = {
  render: () => <ManyRowsStory />,
};

/** Fields below the fold, so the keyboard has something to cover. */
function KeyboardStory() {
  const ink = useShowcaseInk();
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  return (
    <View style={styles.page}>
      <Form style={styles.form}>
        <Form.Section title="Address">
          {['Street', 'Postal code', 'Region', 'Country'].map((label) => (
            <Form.Row key={label}>
              <Text style={[styles.rowLabel, { color: ink.ink }]}>{label}</Text>
            </Form.Row>
          ))}
        </Form.Section>
        <Form.Section
          title="City"
          footer="These two fields sit near the bottom edge of the Form."
        >
          <TextField
            accessibilityLabel="City"
            placeholder="City"
            value={city}
            onChangeText={setCity}
          />
          <TextField
            accessibilityLabel="Street"
            placeholder="Street"
            value={street}
            onChangeText={setStreet}
          />
        </Form.Section>
      </Form>
      <Note>
        Focus a field: with `keyboardAvoidance` on (the default) the Form keeps
        it above the keyboard — iOS grows the list&apos;s bottom inset and
        scrolls the row in, Android reserves the IME inset in its scroll content
        and asks the scroller to make the row visible. Turn it off in the
        Playground and the same tap hides the field.
      </Note>
    </View>
  );
}

/**
 * A field near the bottom edge, with keyboard avoidance.
 *
 * `real-input` proves the same thing with a real IME: `form-field-focus` stays
 * visible above a full software keyboard on both platforms.
 */
export const Keyboard: Story = {
  render: () => <KeyboardStory />,
};

const styles = StyleSheet.create({
  page: {
    gap: 12,
  },
  form: {
    height: FORM_HEIGHT,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowLabel: {
    // The label takes the room the row has and the control keeps the room it
    // measured: `flex: 1` is what puts a trailing control at the trailing edge.
    flexShrink: 1,
    fontSize: 16,
    flexGrow: 1,
  },
  rowDetail: {
    fontSize: 13,
  },
  inner: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 8,
  },
  pressed: {
    opacity: 0.6,
  },
  echo: {
    fontSize: 13,
  },
});
