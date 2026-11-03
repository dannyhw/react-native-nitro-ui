/**
 * SearchField stories (G17). The API is `SearchFieldProps`, documented on the
 * component itself in `src/components/SearchField/SearchField.tsx`: TextField's
 * prop names, minus every keyboard option - a search field is one line, and its
 * Return key is the Search key.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness and
 * benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SearchField, type SearchFieldHandle } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Row, Showcase, useShowcaseInk } from './showcase';

const meta = {
  component: SearchField,
  args: {
    value: 'Ada',
    placeholder: 'Search',
    editable: true,
    onChangeText: fn(),
    onFocus: fn(),
    onBlur: fn(),
    onSubmitEditing: fn(),
  },
  argTypes: {
    value: {
      control: { type: 'text' },
      description:
        'The query. Set it to control the field; unset it and native owns the text.',
    },
    defaultValue: {
      control: { type: 'text' },
      description:
        'Initial text of an uncontrolled field. Ignored while `value` is set.',
    },
    placeholder: {
      control: { type: 'text' },
      description:
        "Text shown while the field is empty. Unset: the platform's own localized Search.",
    },
    maxLength: {
      control: { type: 'number' },
      description: 'The longest query, in UTF-16 units (`string.length`).',
    },
    editable: {
      control: { type: 'boolean' },
      description:
        '`false`: the query shows, but the field takes no focus and no input.',
    },
    onChangeText: {
      action: 'text changed',
      description: 'Called with the new text after every edit, clear included.',
    },
    onFocus: { action: 'focused' },
    onBlur: { action: 'blurred' },
    onSubmitEditing: {
      action: 'submitted',
      description:
        'The Search key, with the query itself - not an event, as TextInput gives it.',
    },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof SearchField>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every public prop on the Controls panel. Typing moves a local copy of `value`
 * (so the field feels alive) and reports to the Actions panel; moving the `value`
 * row writes the field.
 */
export const Playground: Story = {
  render: function PlaygroundStory({ onChangeText, value, ...props }) {
    const [current, setCurrent] = useState(value ?? '');
    useEffect(() => {
      setCurrent(value ?? '');
    }, [value]);
    const handleChange = useCallback(
      (next: string) => {
        setCurrent(next);
        onChangeText?.(next);
      },
      [onChangeText]
    );
    return (
      <Showcase>
        <SearchField
          {...props}
          accessibilityLabel="Playground search field"
          onChangeText={handleChange}
          testID="storybook-search-field-playground"
          value={current}
        />
      </Showcase>
    );
  },
};

/** The field's looks, side by side: the README screenshot candidate. */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="empty">
        <SearchField />
      </Column>
      <Column label="a query, so the clear button is up">
        <SearchField defaultValue="Ada Lovelace" />
      </Column>
      <Column label="maxLength 8">
        <SearchField
          defaultValue="Truncate me"
          maxLength={8}
          placeholder="Eight at most"
        />
      </Column>
      <Column label="editable={false}">
        <SearchField defaultValue="Shown, not editable" editable={false} />
      </Column>
      <Note>
        Nothing behind the field: a search field brings its own container (the
        Material 3 search bar on Android, a bordered UIKit field on iOS), so the
        rows show it bare. The clear button arrives with the text and reports an
        empty query when tapped.
      </Note>
    </Showcase>
  ),
};

/**
 * `placeholder`, including what an empty field says with the prop unset: both
 * platforms put their own localized Search there, so an unset placeholder reads
 * in the device language.
 */
export const Placeholder: Story = {
  render: () => (
    <Showcase>
      <Row label="unset">
        <SearchField />
      </Row>
      <Row label="its own text">
        <SearchField placeholder="Search recipes" />
      </Row>
      <Row label="longer than the field">
        <SearchField placeholder="Search recipes, ingredients or tags" />
      </Row>
      <Note>
        A caption, never a query: an empty field submits nothing whatever its
        placeholder says.
      </Note>
    </Showcase>
  ),
};

/** The controlled contract, a refused edit, and `ref.focus()` / `ref.blur()`. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const ink = useShowcaseInk();
    const [query, setQuery] = useState('');
    const [refusals, setRefusals] = useState(0);
    const ref = useRef<SearchFieldHandle>(null);
    const refuse = useCallback(() => setRefusals((count) => count + 1), []);
    const focus = useCallback(() => ref.current?.focus(), []);
    const blur = useCallback(() => ref.current?.blur(), []);
    return (
      <Showcase>
        <Column label="controlled">
          <SearchField
            ref={ref}
            accessibilityLabel="Controlled search field"
            onChangeText={setQuery}
            placeholder="Type"
            testID="storybook-search-field-controlled"
            value={query}
          />
          <Text style={{ color: ink.ink }}>{`value: ${query}`}</Text>
          <View style={styles.buttons}>
            <Pressable onPress={focus} style={styles.button}>
              <Text style={{ color: ink.ink }}>ref.focus()</Text>
            </Pressable>
            <Pressable onPress={blur} style={styles.button}>
              <Text style={{ color: ink.ink }}>ref.blur()</Text>
            </Pressable>
          </View>
        </Column>
        <Column label="refuses every edit">
          <SearchField
            accessibilityLabel="Frozen search field"
            onChangeText={refuse}
            testID="storybook-search-field-frozen"
            value="frozen"
          />
          <Text
            style={{ color: ink.ink }}
          >{`${String(refusals)} edits refused`}</Text>
        </Column>
        <Note>
          A refused edit is reported to onChangeText and then put back: the
          event-count handshake writes the prop into the field again, so what
          was typed disappears. ref.focus() returns at once and onFocus fires
          when focus lands; it does nothing while the field is not editable.
        </Note>
      </Showcase>
    );
  },
};

/**
 * `maxLength`, counted the way JavaScript counts `string.length` - UTF-16 code
 * units, so an emoji is two of them.
 */
export const MaxLength: Story = {
  render: function MaxLengthStory() {
    const ink = useShowcaseInk();
    const [query, setQuery] = useState('');
    return (
      <Showcase>
        <Column label="maxLength 5">
          <SearchField
            accessibilityLabel="Five character search field"
            maxLength={5}
            onChangeText={setQuery}
            placeholder="Five at most"
            testID="storybook-search-field-max-length"
            value={query}
          />
          <Text style={{ color: ink.ink }}>
            {`value: ${query} (${String(query.length)})`}
          </Text>
        </Column>
        <Column label="no maxLength">
          <SearchField
            accessibilityLabel="Uncapped search field"
            placeholder="As long as you like"
          />
        </Column>
        <Note>
          An insertion that would pass the limit is cut short, never through the
          middle of an emoji or another composed character. No limit, or a
          negative one, is no limit at all, as it is for TextInput.
        </Note>
      </Showcase>
    );
  },
};

/**
 * The Search key: `onSubmitEditing` gets the query itself, then the field loses
 * focus, so the blur count moves with the submission.
 */
export const Submit: Story = {
  render: function SubmitStory() {
    const ink = useShowcaseInk();
    const [query, setQuery] = useState('');
    const [submitted, setSubmitted] = useState<string | null>(null);
    const [focusCount, setFocusCount] = useState(0);
    const [blurCount, setBlurCount] = useState(0);
    const noteFocus = useCallback(
      () => setFocusCount((count) => count + 1),
      []
    );
    const noteBlur = useCallback(() => setBlurCount((count) => count + 1), []);
    const record = useCallback((text: string) => setSubmitted(text), []);
    return (
      <Showcase>
        <SearchField
          accessibilityLabel="Submit search field"
          onBlur={noteBlur}
          onChangeText={setQuery}
          onFocus={noteFocus}
          onSubmitEditing={record}
          placeholder="Type, then press Search"
          testID="storybook-search-field-submit"
          value={query}
        />
        <Text
          testID="storybook-search-field-submitted"
          style={{ color: ink.ink }}
        >
          {submitted == null
            ? 'nothing submitted yet'
            : `submitted: ${submitted}`}
        </Text>
        <Text style={{ color: ink.muted }}>
          {`focus: ${String(focusCount)} blur: ${String(blurCount)}`}
        </Text>
        <Note>
          Submitting hands over the string, where React Native TextInput hands
          over an event. An empty field never submits, on either platform, so
          the Search key on an empty field is a no-op.
        </Note>
      </Showcase>
    );
  },
};

const RECIPES = [
  {
    title: 'Ribollita',
    summary: 'Tuscan bread and kale soup',
    tags: 'soup tuscan bread kale vegetarian',
  },
  {
    title: 'Cacio e pepe',
    summary: 'Pecorino and black pepper',
    tags: 'pasta italian cheese quick vegetarian',
  },
  {
    title: 'Shakshuka',
    summary: 'Eggs poached in spiced tomatoes',
    tags: 'eggs breakfast middle eastern tomatoes quick',
  },
  {
    title: 'Chicken korma',
    summary: 'Mild yoghurt and cashew curry',
    tags: 'curry chicken indian cashew',
  },
  {
    title: 'Bo ssam',
    summary: 'Korean boiled pork wrapped in greens',
    tags: 'korean pork greens ssam',
  },
  {
    title: 'Panzanella',
    summary: 'Bread, tomato and cucumber salad',
    tags: 'salad italian bread tomato vegetarian',
  },
];

/**
 * What the field is for: a list that narrows as the query grows, which is the
 * shape every search field ends up in.
 */
export const SearchResults: Story = {
  render: function SearchResultsStory() {
    const ink = useShowcaseInk();
    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();
    const matches = RECIPES.filter(
      (recipe) =>
        needle === '' ||
        `${recipe.title} ${recipe.summary} ${recipe.tags}`
          .toLowerCase()
          .includes(needle)
    );
    return (
      <Showcase>
        <SearchField
          accessibilityLabel="Recipe search field"
          onChangeText={setQuery}
          placeholder="Search recipes"
          testID="storybook-search-field-results"
          value={query}
        />
        <Text style={{ color: ink.muted }}>
          {`${String(matches.length)} of ${String(RECIPES.length)} recipes`}
        </Text>
        {matches.map((recipe) => (
          <View key={recipe.title} style={styles.result}>
            <Text style={{ color: ink.ink }}>{recipe.title}</Text>
            <Text style={{ color: ink.muted }}>{recipe.summary}</Text>
          </View>
        ))}
        {matches.length === 0 ? (
          <Text style={{ color: ink.muted }}>
            {`Nothing matches "${query}".`}
          </Text>
        ) : null}
        <Note>
          The list is filtered in JS, so the query has to be React state and
          every keystroke renders the row again. A field that only searches on
          the Search key could leave the text to native instead: an uncontrolled
          field costs no render per keystroke.
        </Note>
      </Showcase>
    );
  },
};

/**
 * A search field is `fillWidth`: its width belongs to the box and the measured
 * size it reports back is the height at that width.
 */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Frame label="in a 200 wide parent" width={200}>
        <SearchField defaultValue="One line, whatever its length" />
      </Frame>
      <Frame label="in a 320 wide parent" width={320}>
        <SearchField defaultValue="One line, whatever its length" />
      </Frame>
      <Column label="a style width of 160">
        <SearchField
          defaultValue="Its own width"
          placeholder="Search"
          style={styles.capped}
        />
      </Column>
      <Note>
        The height is the field, the width is the parent. A user `style` width
        wins over the stretch, and the query truncates inside the field.
      </Note>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: { paddingVertical: 6 },
  result: { gap: 2 },
  capped: { width: 160 },
});
