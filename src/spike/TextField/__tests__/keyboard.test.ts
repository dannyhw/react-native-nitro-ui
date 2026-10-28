/**
 * T18 spike — the `keyboardHints` bitfield and the sizing key's width rule.
 *
 * Two things are pinned here, and both are pinned because a *device* cannot catch them:
 *
 * 1. **The numbers themselves.** Swift (`ios/spike/HybridNitroUiSpikeTextField.swift`,
 *    `SpikeKeyboardHints`) and Kotlin (`NitroSpikeKeyboardHints.kt`) each carry a hand-copied
 *    copy of this bit layout, because the point of one number is that it crosses the bridge
 *    without a generated per-option enum. If one platform's copy drifts by one bit, every
 *    device run still goes green — the field just gets somebody else's keyboard, and the A/B
 *    table quietly compares a phone keyboard against a URL one. Only a test on the JS side can
 *    hold the three copies to one answer, so the numbers live here and are asserted here.
 * 2. **The bucketing rule P4 measures.** Q2 §6's cache-growth question is answered by
 *    `widthBucket`, and the harness observes only its consequence (one cache entry per bucket,
 *    none within one). The rule is cheap to get subtly wrong — `Math.floor` instead of
 *    `Math.round` shifts every boundary and the device curve looks identical — so the rule
 *    itself is tested, not just its symptom.
 *
 * @internal Spike only.
 */

/*
 * The bit layout is the subject of this file, so the operators that read it are the point rather than
 * something to route around — same rule `src/spike/TextField/keyboard.ts` states for itself.
 */
/* eslint-disable no-bitwise */

import { describe, expect, it } from '@jest/globals';

import {
  KEYBOARD_CAP_CHARACTERS,
  KEYBOARD_CAP_SENTENCES,
  KEYBOARD_CAP_WORDS,
  KEYBOARD_NONE,
  KEYBOARD_NO_CORRECT,
  KEYBOARD_RETURN_DONE,
  KEYBOARD_RETURN_NEXT,
  KEYBOARD_SECURE,
  KEYBOARD_SUBMITS,
  KEYBOARD_TYPE_EMAIL,
  KEYBOARD_TYPE_MASK,
  KEYBOARD_TYPE_NUMBER,
  KEYBOARD_TYPE_PHONE,
  KEYBOARD_TYPE_TEXT,
  KEYBOARD_TYPE_URL,
  sizingVariantFor,
  WIDTH_BUCKET,
  widthBucket,
} from '../keyboard';

/*
 * Written out as literals on purpose. A test that re-derived the expectations from the same
 * expressions the module exports would pass no matter what the constants became, which is the
 * exact failure it is here to catch.
 */
describe('keyboardHints bit layout (shared with Swift and Kotlin)', () => {
  it('pins every bit to the number both native copies read', () => {
    expect(KEYBOARD_NONE).toBe(0);

    expect(KEYBOARD_TYPE_TEXT).toBe(1);
    expect(KEYBOARD_TYPE_NUMBER).toBe(2);
    expect(KEYBOARD_TYPE_PHONE).toBe(4);
    expect(KEYBOARD_TYPE_EMAIL).toBe(8);
    expect(KEYBOARD_TYPE_URL).toBe(16);

    expect(KEYBOARD_RETURN_DONE).toBe(256);
    expect(KEYBOARD_RETURN_NEXT).toBe(512);
    expect(KEYBOARD_SUBMITS).toBe(1024);

    expect(KEYBOARD_CAP_WORDS).toBe(4096);
    expect(KEYBOARD_CAP_SENTENCES).toBe(8192);
    expect(KEYBOARD_CAP_CHARACTERS).toBe(16384);

    expect(KEYBOARD_NO_CORRECT).toBe(65536);
    expect(KEYBOARD_SECURE).toBe(131072);
  });

  it('leaves the gaps the native readers rely on', () => {
    /*
     * Bits 5-7, 11 and 15 are unused. The Kotlin and Swift decoders read each field by
     * mask-and-compare, so an unused bit is not merely spare — it is a bit neither platform
     * interprets, and a future option that lands in the wrong gap silently changes the type
     * bucket or a return key. These assertions are the fence.
     */
    expect(KEYBOARD_TYPE_MASK).toBe(31);
    expect(KEYBOARD_TYPE_MASK & 224).toBe(0);
    expect(KEYBOARD_SECURE & KEYBOARD_TYPE_MASK).toBe(0);
    expect(KEYBOARD_NO_CORRECT & KEYBOARD_SECURE).toBe(0);
  });

  it('keeps every constant distinct and a single bit, so a hint cannot alias another', () => {
    const all = [
      KEYBOARD_TYPE_TEXT,
      KEYBOARD_TYPE_NUMBER,
      KEYBOARD_TYPE_PHONE,
      KEYBOARD_TYPE_EMAIL,
      KEYBOARD_TYPE_URL,
      KEYBOARD_RETURN_DONE,
      KEYBOARD_RETURN_NEXT,
      KEYBOARD_SUBMITS,
      KEYBOARD_CAP_WORDS,
      KEYBOARD_CAP_SENTENCES,
      KEYBOARD_CAP_CHARACTERS,
      KEYBOARD_NO_CORRECT,
      KEYBOARD_SECURE,
    ];
    expect(new Set(all).size).toBe(all.length);
    for (const bit of all) {
      expect(Number.isInteger(bit)).toBe(true);
      // Exactly one bit set: `bit & (bit - 1)` is 0 only for a power of two.
      expect(bit & (bit - 1)).toBe(0);
    }
  });

  it('composes hints from different families into one readable number', () => {
    const multilineEmail =
      KEYBOARD_TYPE_EMAIL | KEYBOARD_SUBMITS | KEYBOARD_NO_CORRECT;
    expect(multilineEmail & KEYBOARD_TYPE_MASK).toBe(KEYBOARD_TYPE_EMAIL);
    expect(multilineEmail & KEYBOARD_SUBMITS).toBe(KEYBOARD_SUBMITS);
    expect(multilineEmail & KEYBOARD_NO_CORRECT).toBe(KEYBOARD_NO_CORRECT);
    // And the type bucket has one member in it, which is what "at most one type" means on
    // both native sides.
    expect(
      [
        KEYBOARD_TYPE_TEXT,
        KEYBOARD_TYPE_NUMBER,
        KEYBOARD_TYPE_PHONE,
        KEYBOARD_TYPE_EMAIL,
        KEYBOARD_TYPE_URL,
      ].filter((bit) => (multilineEmail & bit) !== 0)
    ).toHaveLength(1);
  });
});

describe('the sizing key a field sends (Q2 §6)', () => {
  it('rounds a width to its bucket rather than carrying pixels', () => {
    expect(WIDTH_BUCKET).toBe(16);
    expect(widthBucket(0)).toBe(0);
    expect(widthBucket(7)).toBe(0);
    expect(widthBucket(8)).toBe(16);
    expect(widthBucket(100)).toBe(96);
    expect(widthBucket(104)).toBe(112);
    expect(widthBucket(390)).toBe(384);
  });

  it('collapses a whole window drag into a handful of buckets', () => {
    // The measurement P4 makes, expressed as the rule instead of as a device reading: widths a
    // user can actually drag between must not each become a cache entry. 200 px of drag has to
    // land in single digits of buckets, and consecutive pixels must not advance the key at all.
    const buckets = new Set<number>();
    for (let width = 120; width <= 320; width += 1) {
      buckets.add(widthBucket(width));
    }
    expect(buckets.size).toBeLessThanOrEqual(14);
    expect(buckets.size).toBeLessThan(201);
    // And it is monotonic: a wider box never maps to a smaller bucket.
    const sorted = [...buckets].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i] ?? 0).toBeGreaterThan(sorted[i - 1] ?? 0);
    }
  });

  it('names a size-affecting configuration, and never reuses a key across widths', () => {
    expect(sizingVariantFor(false, 0, null)).toBe('single|u|w?');
    expect(sizingVariantFor(true, 4, 200)).toBe('multi|4|w208');
    expect(sizingVariantFor(false, 4, 200)).toBe('single|4|w208');
    expect(sizingVariantFor(true, 0, 200)).toBe('multi|u|w208');
    // Each of the four inputs that changes a field's height has to be visible in the string,
    // or the engine serves one configuration's height to another.
    const keys = new Set([
      sizingVariantFor(false, 0, null),
      sizingVariantFor(true, 4, 200),
      sizingVariantFor(false, 4, 200),
      sizingVariantFor(true, 0, 200),
      sizingVariantFor(true, 4, 280),
    ]);
    expect(keys.size).toBe(5);
  });

  it("keeps an un-laid-out field out of a real width's entry", () => {
    // `?` is "no width yet": the height reported before layout must not be cached under the key
    // of a width the field has not been measured at.
    expect(sizingVariantFor(true, 4, null)).toContain('w?');
    expect(sizingVariantFor(true, 4, null)).not.toBe(
      sizingVariantFor(true, 4, 0)
    );
  });

  it('survives a width bucket boundary without changing anything else about the key', () => {
    const before = sizingVariantFor(true, 4, 199);
    const after = sizingVariantFor(true, 4, 201);
    expect(before).not.toBe(after);
    expect(before.split('|').slice(0, 2)).toEqual(after.split('|').slice(0, 2));
    // And inside one bucket the key is stable, which is the half that keeps `cachedSizes` flat
    // while a person drags a window.
    expect(sizingVariantFor(true, 4, 200)).toBe(sizingVariantFor(true, 4, 207));
  });
});
