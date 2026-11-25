/** Types for `held-frames.mjs`, which is plain JavaScript with JSDoc comments. */
import type { DecodedPng } from './png-pixel.mjs';

export declare const UPTIME_STEP_S: number;

export interface FrameGeometry {
  readonly width: number;
  readonly height: number;
  readonly headerBytes: number;
}

export interface HeldFrame {
  readonly askedAt: number;
  readonly takenBy: number;
  readonly mean: number;
}

export declare function frameGeometry(
  head: Uint8Array,
  length: number
): FrameGeometry;
export declare function frameRows(
  geometry: FrameGeometry,
  top: number,
  count: number,
  bytes: Uint8Array
): DecodedPng;
export declare function lastTouchUpSeconds(dump: string): number | null;
export declare function heldDrop(
  before: number,
  frames: readonly HeldFrame[],
  liftedAt: number
): number;
