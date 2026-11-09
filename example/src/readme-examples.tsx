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
  ButtonGroup,
  Checkbox,
  Chip,
  ContextMenu,
  DatePicker,
  type DialogAction,
  Host,
  IconButton,
  Menu,
  type MenuGroup,
  Picker,
  Popover,
  Progress,
  SearchField,
  SegmentedControl,
  Slider,
  Switch,
  TextField,
  type TextFieldHandle,
  Tooltip,
  setMaterialTheme,
} from 'react-native-nitro-ui';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

export function UploadProgressExpressive({
  fraction,
}: {
  fraction: number | null;
}) {
  // Material 3 Expressive: the wavy bar and the morphing loading shape. Both are
  // Android's; iOS draws the flat bar and the ring it has.
  return (
    <>
      <Progress
        accessibilityLabel="Uploading"
        appearance="wavy"
        value={fraction}
      />
      <Progress accessibilityLabel="Uploading" variant="loading" contained />
    </>
  );
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

// #region button-icon
export function ShareButton({ onShare }: { onShare: () => void }) {
  // iOS draws the SF Symbol; Android draws the `.xml` the app imports. Each
  // platform ignores the other's prop, so one Button reads the same on both.
  return (
    <Button
      title="Share"
      systemImage="square.and.arrow.up"
      androidIcon={require('./assets/icons/share_24px.xml')}
      onPress={onShare}
    />
  );
}
// #endregion

// #region icon-button
export function SearchButton({ onSearch }: { onSearch: () => void }) {
  return (
    <IconButton
      accessibilityLabel="Search"
      systemImage="magnifyingglass"
      androidIcon={require('./assets/icons/search_24px.xml')}
      variant="tonal"
      onPress={onSearch}
    />
  );
}
// #endregion

// #region icon-button-toggle
export function BookmarkButton({
  saved,
  onSave,
}: {
  saved: boolean;
  onSave: (next: boolean) => void;
}) {
  return (
    <IconButton
      accessibilityLabel="Bookmark this post"
      systemImage={saved ? 'bookmark.fill' : 'bookmark'}
      androidIcon="bookmark"
      variant="filled"
      checked={saved}
      onCheckedChange={onSave}
    />
  );
}
// #endregion

// #region button-group
export function FormatToolbar({
  spellcheck,
  onSpellcheck,
  onCommand,
}: {
  spellcheck: boolean;
  onSpellcheck: (next: boolean) => void;
  onCommand: (id: string) => void;
}) {
  return (
    <ButtonGroup
      items={[
        { id: 'copy', title: 'Copy', systemImage: 'doc.on.doc' },
        { id: 'paste', title: 'Paste', systemImage: 'doc.on.clipboard' },
        // Controlled: this render decides what is drawn.
        {
          id: 'spellcheck',
          title: 'Spellcheck',
          toggle: true,
          checked: spellcheck,
        },
        // Uncontrolled: native owns it after the first render.
        { id: 'bold', title: 'Bold', toggle: true, defaultChecked: true },
      ]}
      appearance="connected"
      onCheckedChange={(id, checked) => {
        if (id === 'spellcheck') onSpellcheck(checked);
      }}
      onPress={onCommand}
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
export function FileActions() {
  const [last, setLast] = useState('nothing yet');
  const [pinned, setPinned] = useState(false);

  const group: MenuGroup = {
    actions: [
      { id: 'rename', title: 'Rename' },
      { id: 'duplicate', title: 'Duplicate', subtitle: 'Keeps the original' },
      { id: 'pin', title: 'Pinned', checked: pinned },
    ],
    sections: [
      {
        id: 'dangerous',
        title: 'Dangerous',
        // `systemImage` is iOS's glyph and `androidIcon` Android's. Each platform
        // ignores the other's, so one row reads the same on both.
        items: [
          {
            id: 'delete',
            title: 'Delete',
            destructive: true,
            systemImage: 'xmark',
            androidIcon: require('./assets/icons/close_24px.xml'),
          },
        ],
      },
    ],
  };

  const handleSelect = (id: string) => {
    setLast(id);
    if (id === 'pin') setPinned((current) => !current);
  };

  const handlePrimary = () => {
    setLast('file itself');
  };

  return (
    <>
      <Text>Last action: {last}</Text>
      <Menu
        accessibilityLabel="File"
        title="File"
        group={group}
        variant="tonal"
        size="medium"
        primaryAction={handlePrimary}
        onSelect={handleSelect}
      />
    </>
  );
}
// #endregion

// #region context-menu
const MESSAGE_ACTIONS: MenuGroup = {
  actions: [
    { id: 'reply', title: 'Reply', systemImage: 'arrowshape.turn.up.left' },
    { id: 'copy', title: 'Copy text', systemImage: 'doc.on.doc' },
    // iOS draws the SF Symbol; Android draws the `.xml` the app imports.
    {
      id: 'share',
      title: 'Share',
      systemImage: 'square.and.arrow.up',
      androidIcon: require('./assets/icons/share_24px.xml'),
    },
  ],
  sections: [
    {
      id: 'danger',
      items: [{ id: 'delete', title: 'Delete', destructive: true }],
    },
  ],
};

export function MessageRow() {
  const [last, setLast] = useState('nothing yet');

  return (
    <ContextMenu
      group={MESSAGE_ACTIONS}
      onSelect={setLast}
      style={messageStyles.bubble}
    >
      <Text>Hold this message for its menu.</Text>
      <Text>Last action: {last}</Text>
    </ContextMenu>
  );
}

const messageStyles = StyleSheet.create({
  bubble: { padding: 12, borderRadius: 16, backgroundColor: '#f2f2f7' },
});
// #endregion

// #region chip
export function PlaceFilters({
  onDirections,
  onStar,
}: {
  onDirections: () => void;
  onStar: () => void;
}) {
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
      <Chip
        variant="assist"
        label="Starred"
        systemImage="star"
        androidIcon={require('./assets/icons/star_24px.xml')}
        onPress={onStar}
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

// #region tooltip
export function StarHint({ onStar }: { onStar: () => void }) {
  const [hint, setHint] = useState(true);

  return (
    <Tooltip
      isPresented={hint}
      onIsPresentedChange={setHint}
      title="Saved searches"
      message="Tap the star to keep this search."
      actions={[{ id: 'ok', title: 'Got it' }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Star this search"
        onPress={onStar}
      >
        <Text>★</Text>
      </Pressable>
    </Tooltip>
  );
}
// #endregion

// #region popover
export function ShareMenu() {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      isPresented={open}
      onIsPresentedChange={setOpen}
      anchor={
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
          <Text>Share this list</Text>
        </Pressable>
      }
    >
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
        <Text>Copy link</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
        <Text>AirDrop</Text>
      </Pressable>
    </Popover>
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

// #region search-field
export function ProductSearch({
  onSearch,
}: {
  onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState('');

  return (
    <>
      <SearchField
        accessibilityLabel="Search products"
        placeholder="Search the catalogue"
        maxLength={40}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={onSearch}
      />
      <Text>
        {query === ''
          ? 'Type a product name, then press search.'
          : `Searching for ${query}…`}
      </Text>
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

// #region material-theme
// Once, at startup — before the first screen renders.
setMaterialTheme('baseline');
// #endregion
