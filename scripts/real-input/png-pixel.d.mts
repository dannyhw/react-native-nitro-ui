/**
 * Types for `png-pixel.mjs`, which is plain JavaScript with JSDoc comments.
 *
 * The module is written in JS on purpose (its own header says why: a gate must
 * not depend on a tool it does not declare), and the typecheck program does not
 * read JavaScript. This file is the bridge for the one consumer that is
 * TypeScript — the e2e suite's press-feedback check — and nothing more: a new
 * export needs adding here before a typed caller can use it, which is the point.
 */

/** A decoded image: its size and its pixels, top-left first, `channels` per pixel. */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** 3 for an RGB image, 4 for RGBA. */
  readonly channels: number;
  /** `width * height * channels` bytes, row-major. */
  readonly pixels: Uint8Array;
}

/** Decode an 8-bit non-interlaced RGB/RGBA PNG, as `adb exec-out screencap -p` writes it. */
export declare function decodePng(buffer: Buffer | Uint8Array): DecodedPng;

/**
 * The RGBA of one pixel as four numbers 0-255.
 *
 * Throws for a coordinate that is not a whole number or is outside the image:
 * rounding a fractional coordinate would read a neighbouring pixel, and a check
 * that reads the wrong number passes. Callers clamp to the image first.
 */
export declare function pixelAt(
  image: DecodedPng,
  x: number,
  y: number
): readonly [number, number, number, number];
