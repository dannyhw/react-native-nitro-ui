/**
 * Small layout helpers shared by the showcase stories.
 *
 * Stories render inside Storybook's own container, whose background is the
 * background swatch (`preview.tsx`), which a person can change from the device
 * while a story is open. The showcase stories therefore bring their own
 * surface: `Showcase` paints the pair from `useShowcaseInk()` behind its rows,
 * so a row of controls is always readable whatever swatch is selected, and the
 * component inside it still resolves its own colours from the OS appearance.
 */
import type { PropsWithChildren, ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

/**
 * Text/surface colours for the current appearance.
 *
 * The same pair the example screens use (`SwitchScreen.tsx`): RN gives `Text` no
 * dynamic default colour, so a story that has to read in both light and dark
 * mode picks its own.
 */
export function useShowcaseInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000000' : '#ffffff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    hairline: dark ? '#3a3a3c' : '#d1d1d6',
  };
}

/** Scrollable column the showcase stories lay their rows in. */
export function Showcase({ children }: PropsWithChildren) {
  const ink = useShowcaseInk();
  return (
    <ScrollView
      contentContainerStyle={[
        styles.stack,
        { backgroundColor: ink.background },
      ]}
      style={{ backgroundColor: ink.background }}
      testID="storybook-showcase"
    >
      {children}
    </ScrollView>
  );
}

/** A caption and the controls it describes, side by side. */
export function Row({
  label,
  children,
}: PropsWithChildren<{ label: string; children?: ReactNode }>) {
  const ink = useShowcaseInk();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

/** A caption above a stack of controls (for variant/size strips). */
export function Column({
  label,
  children,
}: PropsWithChildren<{ label: string; children?: ReactNode }>) {
  const ink = useShowcaseInk();
  return (
    <View style={styles.column}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      <View style={styles.columnContent}>{children}</View>
    </View>
  );
}

/**
 * A parent with a declared width.
 *
 * The sizing stories need to show what a control does inside a box it does not
 * choose: an intrinsic control keeps its measured size inside this, a
 * `fillWidth` control takes the width and only measures its height.
 */
export function Frame({
  label,
  width,
  children,
}: PropsWithChildren<{ label: string; width: number; children?: ReactNode }>) {
  const ink = useShowcaseInk();
  return (
    <View style={styles.column}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      <View
        style={[
          styles.frame,
          { width, borderColor: ink.hairline },
          { backgroundColor: ink.background },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** A line of running text, for the notes a story needs to the reader. */
export function Note({ children }: PropsWithChildren<{ children: ReactNode }>) {
  const ink = useShowcaseInk();
  return <Text style={[styles.note, { color: ink.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  stack: {
    gap: 18,
    padding: 16,
    paddingBottom: 48,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  column: {
    gap: 6,
  },
  columnContent: {
    gap: 12,
  },
  content: {
    flexShrink: 1,
  },
  frame: {
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
  },
});
