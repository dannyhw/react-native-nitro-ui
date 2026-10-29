/**
 * F7 dwell probe only: which shape of the Switch screen `SwitchScreen` renders.
 *
 * The mechanism question in `docs/tasks/F7-quick-tap.md` is answered by changing
 * one thing at a time on the busy screen and pressing the same control with the
 * same 50 ms press, so the variants have to be switchable *without* a native
 * rebuild — JS comes from Metro, so a flip is one file write and one re-render.
 *
 * Each number in the report names the variant it was taken with. Nothing in a
 * real app sets this, `0` is the shipped screen, and the whole file goes away
 * with the probe that reads it.
 */
export type SwitchScreenVariant =
  /** The shipped screen: 200 hosted Switches in a `ScrollView`. */
  | 0
  /** `canCancelContentTouches={false}` on that `ScrollView`. */
  | 1
  /** `scrollEnabled={false}`: the scroll view's pan recogniser never arms. */
  | 2
  /** The 200-row list removed; the same screen with ~a dozen controls mounted. */
  | 3
  /** The same 200 hosted Switches, but in a plain `View` — no scroll view. */
  | 4
  /** 200 rows, but React Native's own `Switch` — same count, nothing hosted. */
  | 5
  /** 200 rows of plain boxes — same geometry and hit-test cost, no controls. */
  | 6;

export const SWITCH_SCREEN_VARIANT: SwitchScreenVariant = 0;

/**
 * Whether the Switch screen renders the controls the F7 dwell probe presses: the
 * hosted/React-Native pair, the counting Pressable, and the line saying which
 * variant is on screen.
 *
 * Off by default, and that is the important part of this file. Every extra row
 * moves everything below it, and the shipped screen's rows land on whole-pixel
 * coordinates; F7's first gate run failed `assertStillInPlace` — a pre-existing
 * check unrelated to this task — because one hosted Switch, pushed to a fractional
 * y origin by rows added above it, reported a height of `28.000015258789062` on one
 * read and `28.0` on the next. The probe's measurements need its witnesses mounted;
 * the example app the suite and the gates exercise needs its original geometry. A
 * probe-only screen that is invisible unless a probe asks for it is the only shape
 * that gives both.
 *
 * `scripts/real-input/dwell-probe.mjs --probe-controls` turns it on; nothing else
 * does, and no gate run ever will.
 */
export const SWITCH_SCREEN_PROBE_CONTROLS = false;
