/**
 * Layout helpers shared by the showcase stories. They paint their own surface, because
 * Storybook's background swatch can be changed while a story is open.
 */
import type { PropsWithChildren, ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

/** React Native gives `Text` no dynamic default colour, so stories pick their own. */
export function useShowcaseInk() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000000' : '#ffffff',
    ink: dark ? '#ffffff' : '#000000',
    muted: dark ? '#9d9da2' : '#666666',
    hairline: dark ? '#3a3a3c' : '#d1d1d6',
  };
}

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

export function Row({
  label,
  children,
}: PropsWithChildren<{ label: string; children?: ReactNode }>) {
  const ink = useShowcaseInk();
  return (
    <View style={styles.captioned}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      <View style={styles.controls}>{children}</View>
    </View>
  );
}

export function Column({
  label,
  children,
}: PropsWithChildren<{ label: string; children?: ReactNode }>) {
  const ink = useShowcaseInk();
  return (
    <View style={styles.captioned}>
      <Text style={[styles.label, { color: ink.muted }]}>{label}</Text>
      <View style={styles.columnContent}>{children}</View>
    </View>
  );
}

export function Frame({
  label,
  width,
  children,
}: PropsWithChildren<{ label: string; width: number; children?: ReactNode }>) {
  const ink = useShowcaseInk();
  return (
    <View style={styles.captioned}>
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
  captioned: {
    gap: 6,
  },
  columnContent: {
    gap: 12,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
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
