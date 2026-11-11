import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * Native props of the `NitroUiListItem` Hybrid View (DECISIONS D46).
 *
 * A ListItem is the row *content* of a list row, not the row: inside a `Form.Row`
 * the row owns the cell's shape, padding and press, and this leaf only draws
 * title, subtitle, value, icon and chevron. Standalone it adds the platform's own
 * list insets.
 *
 * No member is optional (DECISIONS D7 / nitro#1184): Fabric sends `null` for a
 * prop that JS removed, and Nitro only treats `undefined` as "unset", so an
 * optional prop that goes away crashes. The JS wrapper (`ListItem.tsx`) always
 * sends every prop, using `null` for "not set". Callbacks are the one exception
 * (D7b) and the wrapper always sends one.
 *
 * All props are applied in one batch between `beforeUpdate()` and
 * `afterUpdate()`; setters only store + mark dirty.
 */
export interface NitroUiListItemProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The headline text, or `null` for none. One line, tail-truncated.
   *
   * In the sizing key only as *presence*: every slot is capped to one line, so the
   * height is the configuration's, never the text's
   * (`docs/architecture/sizing.md` §5).
   */
  title: string | null;
  /**
   * The supporting line under the headline, or `null` for none. One line,
   * tail-truncated.
   *
   * The one prop that moves the height on both platforms, and so the only presence
   * in the sizing key besides the leading icon.
   */
  subtitle: string | null;
  /**
   * Trailing text on the headline's own line — "Off", "1.2.3" — or `null` for
   * none. One line, tail-truncated.
   *
   * Both platforms draw it in the headline slot, on the headline's own line and
   * pushed to the trailing edge: iOS through
   * `UIListContentConfiguration.valueCell()`'s value, Android in the row it passes
   * as Material 3's `content` rather than `trailingContent`, because
   * `trailingContent` is centred against the whole row and would sit a two-line
   * item's value between the lines. Neither moves the height at one line, so it is
   * not in the sizing key.
   */
  value: string | null;
  /**
   * Leading SF Symbol name (iOS), or `null`. Android ignores it and draws
   * `androidIcon`. The wrapper sends the name through unvalidated: on iOS a name the
   * runtime does not have resolves to no image and the row draws no glyph, so a
   * typo is a missing icon rather than a crash or a placeholder.
   */
  systemImage: string | null;
  /**
   * Leading icon for Android — the wire string `src/iconSource.ts` produces
   * (G19/G43's path: a drawable name, `res:<name>` or `url:<file>`), or `null`.
   */
  androidIcon: string | null;
  /**
   * `'none'` or `'disclosure'`: the trailing chevron every platform puts on a row
   * that goes somewhere.
   *
   * The wrapper resolves anything else to `'none'`. Not in the sizing key: the
   * chevron sits inside the insets the row already has, and was measured not to
   * move the height on either platform.
   */
  accessory: string;
  /**
   * Whether this item has an `onPress`: the row's own highlight and its button
   * role. A prop rather than a read of the callback because the callback is always
   * sent (`onPressNotProvided` in `Button.tsx`), so its presence says nothing.
   * Same shape as `NitroUiFormRowProps.pressable`.
   */
  pressable: boolean;
  /**
   * Whether this item is rendered inside a `Form.Row` (`ListItem.tsx` reads the
   * context `RowRoot` publishes). The row is the cell, and the cell has already paid
   * for its own insets and shape, so an item inside one draws its content edge-to-edge
   * in the box the row gives it and adds no background of its own (DECISIONS D46
   * item 2). It is a prop and not a superview walk because the row's box is what the
   * platform already inset, and only the React tree knows that.
   *
   * Not in the sizing key: it moves the horizontal insets, and the height is the
   * same either way.
   */
  insideRow: boolean;
  /**
   * Disable interaction: no press, no highlight, no button role, and the row's own
   * disabled colours.
   */
  disabled: boolean;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /**
   * The item's whole accessibility label, or `null` to let native read title,
   * subtitle and value in the platform's own order.
   */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called when the item is tapped, through the platform's own row highlight.
   *
   * A press, not a value (Button's and Chip's rule): nothing here changes in a way
   * React can refuse, so there is no event-count handshake. The D7b callback
   * exception — the wrapper always sends one, and `pressable` says whether it is
   * wired at all.
   */
  onPress?: () => void;
}

export interface NitroUiListItemMethods extends HybridViewMethods {
  /**
   * The size of the hosted row content, as measured on the UI thread during the
   * last layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value,
   * so this is safe to call from the JS thread (core-architecture §1.4).
   *
   * A ListItem is `fillWidth`: the height is the control's own, the width is
   * Yoga's box.
   */
  measureContent(): NitroUiSize;

  /**
   * TEMPORARY, test-only: press the item through the same path a tap takes,
   * highlight and all. Refused while disabled, as a tap is, and the press counter
   * in `nuiTestStateReport` is what says whether one ran.
   *
   * It exists because a harness tap on iOS is a `UITouch` with no HID event behind
   * it (Chip's and Button's reason), and because the harness has to press a
   * *disabled* item exactly as an unwary finger would. The real tap is
   * `real-input:*`'s job. Runs on the UI thread, like a tap; a call from JS hops
   * there and returns at once.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPress(): void;

  /**
   * TEMPORARY, test-only: read the item's accessibility node on the UI thread and
   * keep the answer for `nuiTestStateReport`. Returns at once — the Chip's pair has
   * the same shape, for the same reason: a Nitro method never blocks for main.
   *
   * Android reads the merged Compose semantics node a reader is handed. iOS reads
   * the one element this leaf publishes for itself, which is readable in-process
   * where a SwiftUI host's elements are not.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestProbeAccessibility(): void;

  /**
   * TEMPORARY, test-only: what the item is showing, as one line —
   * `displayed=<title>|<subtitle>|<value>|<accessory>;presses=<n>;probes=<n>;a11y=<…>;iconTint=<#RRGGBB|->`.
   *
   * `displayed` is written where the row is drawn — the `UIListContentView`
   * configuration, the Material 3 composable — so it is a reading of the hosted
   * content rather than an echo of the props, and `none` until the row has drawn.
   * `presses` counts presses that reached the press seam *and were accepted*, so a
   * disabled item stays where it was. `probes` counts the answers
   * `nuiTestProbeAccessibility` has stored; `a11y` is that answer
   * (`role=…,disabled=…,label=…`, plus `clickable=…` on Android, where the
   * merged node is what a reader is handed).
   *
   * `iconTint` is the colour the leading glyph was painted with, recorded where it is
   * painted, or `-` when no glyph drew — and always `-` on iOS, which has no sampler.
   * `nuiTestPixelProbe` samples for it: Material's icon colour comes from the device's
   * dynamic palette, so a harness cannot write the RGB down (Chip's reason).
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;

  /**
   * TEMPORARY, test-only: where the row put its own content, as one line —
   * `insets=<leading>,<trailing>;shape=<0|1>;box=<w>x<h>`.
   *
   * `insets` are the horizontal paddings **the leaf itself** applied, measured off
   * where the row content actually landed inside the view's bounds — the title
   * label's own frame on iOS, `onGloballyPositioned` on Android — and not read back
   * out of the margins or padding the row was told to set, which would repeat the
   * number it wrote and could not notice an `insideRow` that was ignored. 16/16
   * standalone, 0/0 inside a `Form.Row`, whose cell has already paid for them
   * (DECISIONS D46 item 2).
   *
   * `shape` is whether this leaf's *own highlight painted* for the press last applied
   * to it — answered by the painter, not by the props that choose one. iOS records the
   * call that set its pressed background; Android records a `PressInteraction.Press`
   * collected off the same interaction stream its ripple consumes (the pixels
   * themselves are `real-input:android`'s reading). At rest both rows answer `0`; after
   * a press the standalone one answers `1` and the one inside a `Form.Row` stays `0`,
   * because inside a row the cell is the shape and the cell is the highlight.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestLayoutReport(): string;

  /**
   * TEMPORARY, test-only: sample the pixels this item is drawing, looking for
   * `color`, and keep the answer for `nuiTestPixelReport`. Returns at once — the
   * sampling needs the UI thread and a Nitro method may not block for it — so the
   * answer is polled, the way Button's pair works.
   *
   * G19's oracle for a glyph: `androidIcon` is a *drawing* contract, and every
   * other reading of it is an echo of the prop.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can read pixels.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * TEMPORARY, test-only: what the last `nuiTestPixelProbe` found, in Button's
   * shape — `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>`, or `n=<probes> no pixels` where there was no glyph to
   * sample. Empty before the first probe.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPixelReport(): string;

  /**
   * TEMPORARY, test-only: what this host object has been through since it was
   * allocated — `drops=<n> recycles=<m>` (Switch's shape).
   *
   * The conformance suite's recycle rule needs it: only a pooled instance can
   * report a drop it survived, which is what makes a second mount's reset worth
   * asserting.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestLifetimeReport(): string;
}

/**
 * The Hybrid View React renders as `NitroUiListItem`.
 *
 * @internal Hybrid Views and their settable props are not public (DECISIONS D14):
 * exported for this repo's example, harness, bench and smoke apps and for the
 * typed `hybridRef` handle; not semver surface.
 */
export type NitroUiListItem = HybridView<
  NitroUiListItemProps,
  NitroUiListItemMethods
>;
