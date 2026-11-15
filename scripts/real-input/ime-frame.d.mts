/**
 * Types for `ime-frame.mjs`, which is plain JavaScript with JSDoc comments.
 *
 * The module stays JavaScript on purpose — a device gate must not depend on a
 * build step — and the typecheck program does not read JavaScript. This is the
 * bridge for its one TypeScript consumer, the e2e suite's keyboard checks, and
 * nothing more: a new export needs adding here before a typed caller can use it.
 */

/**
 * The keyboard's top edge in px, or `null` when the text never mentioned a
 * visible keyboard. `null` means "there was no keyboard", never "row zero".
 */
export function imeInsetTop(text: string): number | null;

/** Up to two of the dump's IME lines, joined and shortened, for a failure. */
export function imeInsetSample(text: string): string;
