/**
 * The code blocks in README.md, as real components.
 *
 * README.md has one ```tsx block per component whose fence opens with
 * `name=<region>`; the lines between `// #region <name>` and
 * `// #endregion` here are what that block must contain, and
 * `scripts/readme-examples-check.mjs` (part of `bun run check`) fails when the
 * two drift apart. So the README is typechecked by `bun run check` with the rest
 * of `example/src`, and a prop rename cannot survive silently into the docs.
 *
 * These are documentation fixtures, not screens: the app has its own per-tab
 * screens in this folder, and nothing imports this file.
 */
import {
  AlertDialog,
  BottomSheet,
  Button,
  Checkbox,
  Chip,
  DatePicker,
  type DialogAction,
  Host,
  Menu,
  type MenuGroup,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
  TextField,
  type TextFieldHandle,
} from 'react-native-nitro-ui';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// #region switch
export function WifiSettings() {
  const [enabled, setEnabled] = useState(false);

  return (
    <>
      <Text>Wi-Fi</Text>
      <Switch
        accessibilityLabel="Wi-Fi"
        value={enabled}
        onValueChange={setEnabled}
      />
    </>
  );
}
// #endregion

// #region slider
export function VolumeSlider() {
  const [volume, setVolume] = useState(0.5);

  return (
    <Slider
      accessibilityLabel="Volume"
      value={volume}
      onValueChange={setVolume}
      minimumValue={0}
      maximumValue={1}
      step={0.05}
    />
  );
}
// #endregion

// #region progress
export function UploadProgress({ fraction }: { fraction: number | null }) {
  // `null` is indeterminate ("working"); a number 0…1 is a determinate bar.
  return <Progress accessibilityLabel="Uploading" value={fraction} />;
}
// #endregion

// #region button
export function SaveButton() {
  const [saving, setSaving] = useState(false);

  return (
    <Button
      title={saving ? 'Saving…' : 'Save'}
      variant="filled"
      size="medium"
      disabled={saving}
      onPress={() => setSaving(true)}
    />
  );
}
// #endregion

// #region segmented-control
export function ViewToggle() {
  const [index, setIndex] = useState(0);

  return (
    <SegmentedControl
      options={['Day', 'Week', 'Month']}
      selectedIndex={index}
      onChange={(event) => setIndex(event.index)}
    />
  );
}
// #endregion

// #region picker
export function SizePicker() {
  const [index, setIndex] = useState(0);

  return (
    <Picker
      label="Size"
      options={['Small', 'Medium', 'Large']}
      selectedIndex={index}
      onChange={(event) => setIndex(event.index)}
    />
  );
}
// #endregion

// #region date-picker
export function DueDate() {
  const [date, setDate] = useState(() => new Date());

  return (
    <DatePicker accessibilityLabel="Due date" value={date} onChange={setDate} />
  );
}
// #endregion

// #region menu
const FILE_ACTIONS: MenuGroup = {
  actions: [
    { id: 'rename', title: 'Rename' },
    { id: 'duplicate', title: 'Duplicate' },
  ],
  sections: [
    {
      id: 'dangerous',
      title: 'Dangerous',
      items: [{ id: 'delete', title: 'Delete', destructive: true }],
    },
  ],
};

export function FileActions() {
  const [last, setLast] = useState('nothing yet');

  return (
    <>
      <Text>Last action: {last}</Text>
      <Menu
        accessibilityLabel="File"
        title="File"
        group={FILE_ACTIONS}
        variant="tonal"
        size="medium"
        onSelect={setLast}
      />
    </>
  );
}
// #endregion

// #region chip
export function PlaceFilters({ onDirections }: { onDirections: () => void }) {
  const [openNow, setOpenNow] = useState(false);

  return (
    <>
      <Chip label="Open now" selected={openNow} onSelectedChange={setOpenNow} />
      <Chip label="Vegan" defaultSelected />
      <Chip
        variant="assist"
        label="Directions"
        systemImage="map"
        onPress={onDirections}
      />
    </>
  );
}
// #endregion

// #region checkbox
export function CheckoutOptions({
  onEmailMe,
}: {
  onEmailMe: (email: boolean) => void;
}) {
  const [gift, setGift] = useState(false);

  return (
    <>
      <Checkbox label="Gift wrap" checked={gift} onCheckedChange={setGift} />
      <Checkbox label="Email me the receipt" onCheckedChange={onEmailMe} />
    </>
  );
}
// #endregion

// #region dialog
const DRAFT_ACTIONS: DialogAction[] = [
  { id: 'keep', title: 'Keep', role: 'cancel' },
  { id: 'delete', title: 'Delete', role: 'destructive' },
];

export function DeleteDraft({ onDelete }: { onDelete: () => void }) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Button
        title="Delete draft"
        variant="text"
        size="medium"
        onPress={() => setAsking(true)}
      />
      <AlertDialog
        isPresented={asking}
        onIsPresentedChange={setAsking}
        title="Delete the draft?"
        message="The draft and its photos go for good."
        actions={DRAFT_ACTIONS}
        onAction={(id) => {
          if (id === 'delete') onDelete();
        }}
      />
    </>
  );
}
// #endregion

// #region bottom-sheet
export function Filters() {
  const [open, setOpen] = useState(false);
  const [detent, setDetent] = useState(0);

  return (
    <>
      <Button
        title="Filters"
        variant="tonal"
        size="medium"
        onPress={() => setOpen(true)}
      />
      <BottomSheet
        isPresented={open}
        onIsPresentedChange={setOpen}
        detents={['medium', 'large']}
        onDetentChange={setDetent}
        // The next presentation opens at the first detent again.
        onDismiss={() => setDetent(0)}
        accessibilityLabel="Filters"
      >
        <View style={{ padding: 24, gap: 12 }}>
          <Text>{detent === 0 ? 'Half height' : 'Full height'}</Text>
          <Button
            title="Done"
            variant="filled"
            size="medium"
            onPress={() => setOpen(false)}
          />
        </View>
      </BottomSheet>
    </>
  );
}
// #endregion

// #region text-field
export function SignInForm({ onSignIn }: { onSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const passwordField = useRef<TextFieldHandle>(null);

  return (
    <>
      <TextField
        accessibilityLabel="Email"
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => passwordField.current?.focus()}
      />
      <TextField
        ref={passwordField}
        accessibilityLabel="Password"
        placeholder="Password"
        secureTextEntry
        returnKeyType="go"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={onSignIn}
      />
    </>
  );
}
// #endregion

// #region host
export function NotificationSettings() {
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);

  // Android: both Switches render in one Compose composition.
  // iOS: Host is a plain View, so this renders exactly as without it.
  return (
    <Host style={styles.settings}>
      <Switch accessibilityLabel="Push" value={push} onValueChange={setPush} />
      <Switch
        accessibilityLabel="Email"
        value={email}
        onValueChange={setEmail}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  // Say how tall a Host is: it draws its children into this box.
  settings: { height: 96 },
});
// #endregion
