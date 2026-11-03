/**
 * TextField stories (G13). Props and events: `docs/components/text-field.md`.
 *
 * The internal props (`hybridRef`, `nuiPerfId`) are hidden: they are harness and
 * benchmark handles, not app API (DECISIONS D14).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TextField, type TextFieldHandle } from 'react-native-nitro-ui';
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Frame, Note, Showcase, useShowcaseInk } from './showcase';

const meta = {
  component: TextField,
  args: {
    value: 'Hello',
    placeholder: 'Placeholder',
    multiline: false,
    keyboardType: 'default',
    autoCapitalize: 'sentences',
    autoCorrect: true,
    secureTextEntry: false,
    returnKeyType: 'default',
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
        'The text. Set it to control the field; unset it and native owns the text.',
    },
    defaultValue: {
      control: { type: 'text' },
      description: 'Initial text of an uncontrolled field.',
    },
    placeholder: { control: { type: 'text' } },
    multiline: {
      control: { type: 'boolean' },
      description: 'Wrap and grow with the text; Return inserts a newline.',
    },
    keyboardType: {
      control: { type: 'select' },
      options: [
        'default',
        'number-pad',
        'decimal-pad',
        'numeric',
        'email-address',
        'phone-pad',
        'url',
      ],
    },
    autoCapitalize: {
      control: { type: 'select' },
      options: ['none', 'sentences', 'words', 'characters'],
    },
    autoCorrect: { control: { type: 'boolean' } },
    secureTextEntry: {
      control: { type: 'boolean' },
      description: 'Obscure the text. Single-line only.',
    },
    maxLength: {
      control: { type: 'number' },
      description: 'The longest text, in UTF-16 units (`string.length`).',
    },
    returnKeyType: {
      control: { type: 'select' },
      options: ['default', 'done', 'go', 'next', 'search', 'send'],
    },
    editable: { control: { type: 'boolean' } },
    onChangeText: { action: 'text changed' },
    onFocus: { action: 'focused' },
    onBlur: { action: 'blurred' },
    onSubmitEditing: { action: 'submitted' },
    hybridRef: { control: false, table: { disable: true } },
    nuiPerfId: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof TextField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A field in a grey well: the field is undecorated, so the well is the container. */
function Well({ children }: { children: React.ReactNode }) {
  const ink = useShowcaseInk();
  return (
    <View style={[styles.well, { borderColor: ink.hairline }]}>{children}</View>
  );
}

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
        <Well>
          <TextField
            {...props}
            accessibilityLabel="Playground field"
            onChangeText={handleChange}
            testID="storybook-text-field-playground"
            value={current}
          />
        </Well>
      </Showcase>
    );
  },
};

/** The field's looks, side by side: the README's screenshot. */
export const States: Story = {
  render: () => (
    <Showcase>
      <Column label="empty, with a placeholder">
        <Well>
          <TextField placeholder="Name" />
        </Well>
      </Column>
      <Column label="text">
        <Well>
          <TextField defaultValue="Ada Lovelace" />
        </Well>
      </Column>
      <Column label="secureTextEntry">
        <Well>
          <TextField defaultValue="hunter2" secureTextEntry />
        </Well>
      </Column>
      <Column label="multiline, grows with its text">
        <Well>
          <TextField
            defaultValue={
              'Notes can run over\nmore than one line,\nand the field grows.'
            }
            multiline
          />
        </Well>
      </Column>
      <Column label="editable={false}">
        <Well>
          <TextField defaultValue="Shown, not editable" editable={false} />
        </Well>
      </Column>
    </Showcase>
  ),
};

/** The controlled contract, a refused edit, a cap, and `ref.focus()`. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const ink = useShowcaseInk();
    const [name, setName] = useState('');
    const [refusals, setRefusals] = useState(0);
    const ref = useRef<TextFieldHandle>(null);
    const refuse = useCallback(() => setRefusals((count) => count + 1), []);
    const focus = useCallback(() => ref.current?.focus(), []);
    return (
      <Showcase>
        <Column label="controlled">
          <Well>
            <TextField
              ref={ref}
              placeholder="Type"
              value={name}
              onChangeText={setName}
            />
          </Well>
          <Text style={{ color: ink.ink }}>{`value: ${name}`}</Text>
          <Pressable onPress={focus} style={styles.button}>
            <Text style={{ color: ink.ink }}>ref.focus()</Text>
          </Pressable>
        </Column>
        <Column label="refuses every edit">
          <Well>
            <TextField value="frozen" onChangeText={refuse} />
          </Well>
          <Text
            style={{ color: ink.ink }}
          >{`${String(refusals)} edits refused`}</Text>
        </Column>
        <Column label="maxLength 5">
          <Well>
            <TextField maxLength={5} placeholder="Five at most" />
          </Well>
        </Column>
        <Note>
          A refused edit is reported to onChangeText and then put back: the
          field shows its value again once the echo arrives.
        </Note>
      </Showcase>
    );
  },
};

/** Width is the parent's; height is one line, or the text at that width. */
export const Sizing: Story = {
  render: () => (
    <Showcase>
      <Frame label="single-line, in a 240 wide parent" width={240}>
        <TextField defaultValue="One line, whatever its length" />
      </Frame>
      <Frame label="multiline, in a 240 wide parent" width={240}>
        <TextField
          defaultValue="A multi-line field wraps at its parent's width and grows to fit what it holds."
          multiline
        />
      </Frame>
    </Showcase>
  ),
};

const styles = StyleSheet.create({
  well: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: { paddingVertical: 6 },
});
