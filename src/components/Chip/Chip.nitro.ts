import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiChip` Hybrid View.
 *
 * A Chip is a sibling of two controls and takes one thing from each:
 * - a **filter** chip has a value, so `selected` / `defaultSelected` /
 *   `mostRecentEventCount` / `onSelectedChange` are Switch's event-count
 *   handshake (`docs/architecture/core.md` §4) under a chip's names;
 * - an **assist** chip is a press, so `onPress` is Button's: a gesture, not a
 *   value JS can reject.
 *
 * Both sets are always sent, whichever variant is showing: no member is optional
 * (DECISIONS D7 / nitro#1184) except the callbacks (D7b), and the wrapper
 * (`Chip.tsx`) always sends every prop. A variant ignores the other variant's
 * props rather than the wrapper dropping them, so a variant change at runtime
 * never makes a prop disappear between two commits.
 *
 * All props are applied in one batch between `beforeUpdate()` and
 * `afterUpdate()`; setters only store + mark dirty.
 */
export interface NitroUiChipProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The chip's text. Size-affecting (it is in `nuiSizingKey`), and the default
   * accessibility label.
   */
  label: string;
  /**
   * `'filter' | 'assist'`, resolved by the wrapper; anything else is `'filter'`.
   * See `docs/components/chip.md` for what each maps to per platform.
   */
  variant: string;
  /**
   * Controlled selection of a filter chip, or `null` for an uncontrolled one -
   * native then keeps the displayed value, seeded by `defaultSelected`. Ignored by
   * an assist chip.
   */
  selected: boolean | null;
  /** Initial selection of an uncontrolled filter chip; ignored while `selected` is set. */
  defaultSelected: boolean | null;
  /**
   * The last event count JS has fully processed (core-architecture §4). Native
   * only accepts a `selected` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /** Disable interaction (and show the disabled style). No event fires. */
  disabled: boolean;
  /**
   * Leading SF Symbol name, or `null`. iOS only: Android ignores it, which is
   * Button's convention (`docs/components/button.md`). Still in the sizing key on
   * both platforms, so the two cannot drift when Android gains an icon.
   */
  systemImage: string | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the control itself, or `null` to use `label`. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * A filter chip's toggle: the selection native now displays, plus native's
   * event count (echoed back as `mostRecentEventCount`). Optional for the reason
   * `NitroUiSwitchProps.onValueChange` spells out (D7b), and always sent.
   */
  onSelectedChange?: (selected: boolean, eventCount: number) => void;
  /** An assist chip's tap. Optional (D7b), and always sent - a no-op when unset. */
  onPress?: () => void;
}

export interface NitroUiChipMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.4).
   */
  measureContent(): NitroUiChipSize;

  /**
   * TEMPORARY, test-only: press the chip through the same path a tap takes - the
   * filter chip's toggle (optimistic, with a fresh event count, so a change JS
   * refuses still reverts) or the assist chip's `onPress`. Refused while disabled,
   * as a tap is.
   *
   * It exists for one platform's harness: a harness tap is a `UITouch` with no HID
   * event behind it, which SwiftUI's button gesture refuses (`Button.harness.tsx`
   * measured it, and `Toggle(.button)` is a button). The real tap is
   * `real-input:ios`'s job. Runs on the UI thread, like a tap; a call from JS hops
   * there and returns at once.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPress(): void;

  /**
   * TEMPORARY, test-only: read the chip's accessibility node on the UI thread and
   * keep the answer for ``nuiTestStateReport``. Returns at once (the Slider's
   * `nuiTestAccessibilityStep` pair has the same shape, for the same reason: a
   * Nitro method never blocks for main).
   *
   * Android reads the merged Compose semantics node a reader is handed. iOS has
   * nothing to read in-process - the SwiftUI hosting view answers
   * `accessibilityElements == []` to anything that is not an accessibility client
   * (`HybridNitroUiSlider.swift` measured it) - so iOS records `a11y=unavailable`
   * and the role is asserted by XCUITest in `real-input:ios`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestProbeAccessibility(): void;

  /**
   * TEMPORARY, test-only: what the chip is showing, as one line -
   * `displayed=<0|1|none>;probes=<n>;a11y=<...>`.
   *
   * `displayed` is written where the control is drawn (the SwiftUI body, the
   * composable), so it is a reading of the hosted control rather than an echo of a
   * prop: the handle's `selected` answers what React sent. `none` until the
   * control has drawn, and for an assist chip, which has no selection. `probes`
   * counts the answers ``nuiTestProbeAccessibility`` has stored, so a test can tell
   * a fresh one from the last; `a11y` is that answer (Android:
   * `role=<role>,selected=<bool|none>,toggle=<On|Off|none>,disabled=<bool>,clickable=<bool>,label=<text>`).
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
 *
 * The shape is per-component on purpose, like `NitroUiButtonSize`: nitrogen
 * generates one struct per name, and a shared type in one component's spec file
 * would make every other component import that component's spec.
 */
export interface NitroUiChipSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiChip`.
 *
 * @internal Hybrid Views and their settable props are not public (DECISIONS
 * D14): it is exported for this repo's example, harness and smoke apps, and for
 * the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiChip = HybridView<NitroUiChipProps, NitroUiChipMethods>;
