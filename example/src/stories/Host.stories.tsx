import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  DatePicker,
  Host,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
} from 'react-native-nitro-ui';

import type { Meta, StoryObj } from '@storybook/react-native';

import { Column, Note, Showcase } from './showcase';

const ROWS = 8;

/** The height a hosted `Switch` row draws at on Android, in dp. */
const ROW = 48;

const meta = {
  component: Host,
  args: {},
  argTypes: {
    children: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof Host>;

export default meta;

type Story = StoryObj<typeof meta>;

/** On iOS both columns are ordinary views: a Host is a passthrough there. */
export const HostedVsNot: Story = {
  render: function HostedVsNotStory() {
    const [events, setEvents] = useState(0);
    const count = useCallback(() => {
      setEvents((current) => current + 1);
    }, []);
    const switches = Array.from({ length: ROWS }, (_, index) => (
      <Switch
        key={index}
        defaultValue={index % 3 === 0}
        onValueChange={count}
        accessibilityLabel={`Switch ${String(index)}`}
      />
    ));
    return (
      <Showcase>
        <Column label={`one Host · ${ROWS} Switches`}>
          <View style={styles.card}>
            <Host style={styles.host}>{switches}</Host>
          </View>
        </Column>
        <Column label={`${ROWS} Switches · ${ROWS} compositions`}>
          <View style={styles.card}>{switches}</View>
        </Column>
        <Note>
          {events === 0
            ? 'Toggle either side: the events land in the same handler, from a composition or from ' +
              ROWS +
              ' of them.'
            : `${events} change${events === 1 ? '' : 's'} reported — the same handler either way.`}
        </Note>
        <Note>
          The Host has a height, its children do not need one. A style on a
          hosted child moves the frame React Native computes, not what is drawn
          (D24).
        </Note>
      </Showcase>
    );
  },
};

export const Churn: Story = {
  render: function ChurnStory() {
    const [generation, setGeneration] = useState(0);
    const [events, setEvents] = useState(0);
    const count = useCallback(() => {
      setEvents((current) => current + 1);
    }, []);
    return (
      <Showcase>
        <Pressable onPress={() => setGeneration((current) => current + 1)}>
          <Text style={styles.link}>rebuild the batch</Text>
        </Pressable>
        <View style={styles.card}>
          <Host key={String(generation)} style={styles.host}>
            {Array.from({ length: ROWS }, (_, index) => (
              <Switch
                key={index}
                defaultValue={index % 2 === 0}
                onValueChange={count}
                accessibilityLabel={`Churned switch ${String(index)}`}
              />
            ))}
          </Host>
        </View>
        <Note>
          Generation {generation} · {events} changes reported by this batch.
        </Note>
      </Showcase>
    );
  },
};

export const Mixed: Story = {
  render: function MixedStory() {
    const [on, setOn] = useState(false);
    const [value, setValue] = useState(0.4);
    const [presses, setPresses] = useState(0);
    return (
      <Showcase>
        <View style={styles.card}>
          <Host style={styles.mixedHost}>
            <Switch
              value={on}
              onValueChange={setOn}
              accessibilityLabel="Mixed switch"
            />
            <Slider
              value={value}
              onValueChange={setValue}
              accessibilityLabel="Mixed slider"
            />
            <Progress value={0.35} accessibilityLabel="Mixed linear progress" />
            <Progress
              variant="circular"
              value={0.65}
              accessibilityLabel="Mixed circular progress"
            />
            <Button
              title="Mixed action"
              onPress={() => setPresses((current) => current + 1)}
              accessibilityLabel="Mixed button"
            />
          </Host>
        </View>
        <Note>
          {`${on ? 'on' : 'off'} · slider ${value.toFixed(2)} · ${presses} press${
            presses === 1 ? '' : 'es'
          } — five controls, one composition, and each one still answers for itself.`}
        </Note>
      </Showcase>
    );
  },
};

export const Popups: Story = {
  render: function PopupsStory() {
    const [segmented, setSegmented] = useState(1);
    const [choice, setChoice] = useState(1);
    const [date, setDate] = useState(() => new Date(2026, 4, 17));
    const [presses, setPresses] = useState(0);
    return (
      <Showcase>
        <View style={styles.card}>
          <Host style={styles.popupHost}>
            <Switch
              defaultValue
              onValueChange={() => setPresses((c) => c + 1)}
              accessibilityLabel="Popup switch"
            />
            <Slider defaultValue={0.3} accessibilityLabel="Popup slider" />
            <Progress value={0.4} accessibilityLabel="Popup linear progress" />
            <Button
              title="Popup action"
              onPress={() => setPresses((c) => c + 1)}
              accessibilityLabel="Popup button"
            />
            <SegmentedControl
              options={['One', 'Two', 'Three']}
              selectedIndex={segmented}
              onChange={(event) => setSegmented(event.index)}
              accessibilityLabel="Popup segmented"
            />
            <Picker
              options={['Alpha', 'Beta', 'Gamma', 'Delta']}
              selectedIndex={choice}
              onChange={(event) => setChoice(event.index)}
              label="Popup picker"
              accessibilityLabel="Popup picker"
            />
            <DatePicker
              value={date}
              onChange={setDate}
              accessibilityLabel="Popup date picker"
            />
          </Host>
        </View>
        <Note>
          {`segment ${segmented} · choice ${choice} · ${String(
            date.getDate()
          )}/${String(date.getMonth() + 1)}/${String(date.getFullYear())} — seven controls, one composition, ${presses} change${
            presses === 1 ? '' : 's'
          } reported.`}
        </Note>
        <Note>
          The menu and the dialog are windows of their own, owned by the
          Host&apos;s composition: they open under the row that opened them, and
          they close with it. A React Native `Modal` as a child is still refused
          — that is a window RN owns, not one Compose does.
        </Note>
      </Showcase>
    );
  },
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  host: { width: '100%', height: ROWS * ROW },
  // Hosted controls report no size, so these heights are room, not a measurement.
  // A Host that is too short clips its last rows.
  mixedHost: { width: '100%', height: 280 },
  popupHost: { width: '100%', height: 420 },
  link: { color: '#3b82f6', paddingVertical: 6 },
});
