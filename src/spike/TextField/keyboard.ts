/**
 * T18 spike — the keyboard/IME bitfield behind `keyboardHints`, and the sizing
 * variant a field sends as `nuiSizingKey`.
 *
 * One `number` prop instead of six, for the reason Q2 §3 gives: on the SwiftUI
 * shape, keyboard type / return key / capitalisation / autocorrect are
 * *initialiser arguments* rather than modifiers we can apply after the fact, and
 * one argument is far easier to thread into a controller that is created exactly
 * once. iOS reads the bits as `UITextField` configuration or `TextField`
 * initialiser arguments; Android maps the same bits onto `KeyboardOptions` and
 * a `TextFieldState`'s plain-text filter.
 *
 * A shipped API would take strings (`keyboardType="email-address"`, per RN) and
 * map them natively; whether G8 keeps the bitfield is a G8 decision, and both
 * are priced in T18's report.
 *
 * @internal Spike only — `src/spike/**` is not published.
 */

/*
 * A bitfield by design (see the doc comment below), so the operators that build and
 * read it are the point of the file rather than something to route around.
 */
/* eslint-disable no-bitwise */

/** No hints: default keyboard, default IME behaviour. */
export const KEYBOARD_NONE = 0;

/* Keyboard type — at most one of these. */
export const KEYBOARD_TYPE_TEXT = 1 << 0;
export const KEYBOARD_TYPE_NUMBER = 1 << 1;
export const KEYBOARD_TYPE_PHONE = 1 << 2;
export const KEYBOARD_TYPE_EMAIL = 1 << 3;
export const KEYBOARD_TYPE_URL = 1 << 4;

/** Return key is `done` instead of the platform default. */
export const KEYBOARD_RETURN_DONE = 1 << 8;
/** Return key is `next`. */
export const KEYBOARD_RETURN_NEXT = 1 << 9;
/** Return key submits — RN's `onSubmitEditing` path. */
export const KEYBOARD_SUBMITS = 1 << 10;

/** `autoCapitalize`, the three RN spellings that are not "none". */
export const KEYBOARD_CAP_WORDS = 1 << 12;
export const KEYBOARD_CAP_SENTENCES = 1 << 13;
export const KEYBOARD_CAP_CHARACTERS = 1 << 14;

/**
 * `autoCorrect` off. Off is the explicit bit, because both platforms default to
 * on and a field that means "no" has to be able to say it.
 */
export const KEYBOARD_NO_CORRECT = 1 << 16;

/**
 * `secureTextEntry` / `KeyboardType.Password`.
 *
 * Q2 §2 counts this as a text-comparison *vector* rather than a boolean in a
 * table: a secure field's displayed text and its stored text are the same
 * string on both platforms, but the drawing layer hides it, and that is where a
 * "did the write apply?" test can start lying.
 */
export const KEYBOARD_SECURE = 1 << 17;

/** Every keyboard-type bit, for a test that asserts they are mutually exclusive. */
export const KEYBOARD_TYPE_MASK =
  KEYBOARD_TYPE_TEXT |
  KEYBOARD_TYPE_NUMBER |
  KEYBOARD_TYPE_PHONE |
  KEYBOARD_TYPE_EMAIL |
  KEYBOARD_TYPE_URL;

/**
 * The width bucket a sizing key rounds the box width to, in platform units
 * (points on iOS, dp on Android).
 *
 * P4's answer to Q2 §6's cache-growth question. A `fillWidth` control whose
 * height depends on its width must put the width in the key — one cache entry
 * holds one height (`cpp/NitroUiSizingEngine.hpp:502`) — but the sizing engine's
 * cache has no eviction and only an environment bump clears it
 * (`cpp/NitroUiSizingEngine.cpp:216`). Unbucketed, a field resized across a
 * window drag adds one entry per pixel and `cachedSizes` never comes back down;
 * bucketed, it adds one entry per 16 units and stops.
 */
export const WIDTH_BUCKET = 16;

/** Round a width to the bucket it belongs to. */
export function widthBucket(width: number): number {
  return Math.round(width / WIDTH_BUCKET) * WIDTH_BUCKET;
}

/**
 * The variant part of a field's `nuiSizingKey` (`core/NitroUiIntrinsicProps`:
 * the engine folds in the component name and the environment epoch, so a key
 * never repeats the component name and an empty variant is the default
 * configuration).
 *
 * Everything that changes a field's size is here: `keyboardHints` (a phone
 * keyboard and a secure field are both the same height, but `multiline` is
 * carried in the hints' companion prop and must not be forgotten), `maxLines`
 * (the cap on auto-grow), and the box width — rounded, see
 * [WIDTH_BUCKET](./WIDTH_BUCKET).
 *
 * `width: null` is "not laid out yet", which is its own configuration: the
 * height a field reports before it has a width is the height it wants at *no*
 * width, and that answer must not be cached under a real width's key.
 */
export function sizingVariantFor(
  multiline: boolean,
  maxLines: number,
  width: number | null
): string {
  const lines = maxLines > 0 ? String(maxLines) : 'u';
  const w = width == null ? '?' : String(widthBucket(width));
  return `${multiline ? 'multi' : 'single'}|${lines}|w${w}`;
}
