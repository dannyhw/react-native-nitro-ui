// The keyboard options `TextField` and `SearchField` share, in React Native
// `TextInput`'s spellings.

/** The keyboard a field asks for, in React Native's spellings. */
export type TextFieldKeyboardType =
  | 'default'
  | 'number-pad'
  | 'decimal-pad'
  | 'numeric'
  | 'email-address'
  | 'phone-pad'
  | 'url';

/** What the keyboard capitalises on its own. */
export type TextFieldAutoCapitalize =
  'none' | 'sentences' | 'words' | 'characters';

export const KEYBOARD_TYPES: ReadonlyArray<TextFieldKeyboardType> = [
  'default',
  'number-pad',
  'decimal-pad',
  'numeric',
  'email-address',
  'phone-pad',
  'url',
];

export const AUTO_CAPITALIZE: ReadonlyArray<TextFieldAutoCapitalize> = [
  'none',
  'sentences',
  'words',
  'characters',
];

/**
 * The value native receives: `value` when it is one of `allowed`, else `fallback`.
 * The type is a compile-time promise only, so a runtime value can be anything.
 */
export function resolveKeyboardOption<T extends string>(
  value: T | undefined,
  allowed: ReadonlyArray<T>,
  fallback: T
): T {
  return value != null && allowed.includes(value) ? value : fallback;
}
