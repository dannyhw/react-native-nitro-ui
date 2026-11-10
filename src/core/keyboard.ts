/**
 * The keyboard vocabulary two text controls share.
 *
 * `TextField` and `SearchField` take the same three props, in React Native
 * `TextInput`'s spellings, and both map them onto one native answer per platform
 * (`NitroUiTextTraits` on iOS, `keyboardTypeOf`/`capitalizationOf` on Android).
 * The lists and the resolver live here so there is one answer to "is this
 * spelling real, and what is the default" — a second copy in the second wrapper
 * is a second copy that drifts.
 *
 * The names of the two types stay `TextField…`, because `TextField` was first and
 * an app writes them in either component.
 *
 * @file
 */

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
 * An enum prop as native receives it: the spelling the app gave when it is one we
 * know, and `fallback` for anything else — including a value that arrived from JS
 * at runtime, where the type is a compile-time promise only.
 */
export function resolveKeyboardOption<T extends string>(
  value: T | undefined,
  allowed: ReadonlyArray<T>,
  fallback: T
): T {
  return value != null && allowed.includes(value) ? value : fallback;
}
