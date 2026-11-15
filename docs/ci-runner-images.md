# GitHub-hosted runner images: which iOS simulator runtimes they ship

The declared sizing fallbacks can only be checked on an iOS older than the deployment target if
a runner CI can schedule on has such a runtime. This file records which images do. The answer
comes from a published image manifest and changes when an image is rebuilt, so each fact below
names the image it was read from.

Source: `actions/runner-images`' published manifests on `main`:
`images/macos/macos-26-arm64-Readme.md`, `images/macos/macos-15-arm64-Readme.md` and
`images/macos/xcode-27-arm64-Readme.md`. Quote the **arm64** manifests: the `macos-26` and
`xcode-27` labels schedule arm64 hosts, and the unsuffixed `macos-26-Readme.md` is the Intel
image, with a different build number.

## The two labels this repo schedules on

| Label in `.github/workflows`                           | Image (arm64 manifest)                                                       | iOS simulator runtimes installed        | iOS 18? |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------- | ------- |
| `macos-26` (`native-tests`, `release.yml`'s `version`) | `macos-26-arm64`, image `20261026.0455.2`, macOS 26.6.2, Xcode 26.0.1 → 26.6 | 26.2, 26.4, 26.5                        | **no**  |
| `xcode-27` (`harness-ios`, smoke's iOS jobs)           | `xcode-27-arm64`, image `20261026.0314.1`, Xcode 27                          | 27.0, 27.1 (`27.1` only for iPhone Duo) | **no**  |

So **neither image this repo uses can run an iOS 18 simulator.** `macos-26`'s floor is iOS
26.2: its SDK list stops at iOS 26.5, its simulator list starts at 26.2, and there is no older
runtime on the image to point `IOS_VERSION` at.

## Where an iOS 18 simulator does exist

`macos-15` and `macos-15-arm64` (same page; arm64 image `20261028.0489.1`) install **iOS 18.5
and iOS 18.6** simulators alongside iOS 26.0 – 26.2, with **Xcode 16.0 → 16.4 and 26.0.1 →
26.3** installed and 16.4 as the default. That is the only hosted image series with an iOS 18
runtime, and no workflow here uses it.

On that image the iOS 18.5/18.6 simulators are installed next to Xcode 26.0.1 through 26.3,
and simulator runtimes are shared across the Xcode installs on a machine. The manifest does
not say whether Xcode 26 will **boot** an iOS 18.5 device.

## What a first try would look like (not yet added)

A dispatch-only harness row on `macos-15` would need:

- `xcode-select` to Xcode 26.3 (installed there), so the toolchain matches the
  `macos-26`/`xcode-27` builds this repo already does, and `RCT_USE_PREBUILT_RNCORE` /
  `RCT_USE_RN_DEP` resolve the same prebuilt core;
- `IOS_VERSION=18.6` plus `IOS_SIM` for a device that exists in that runtime
  (`example/rn-harness.config.mjs` takes both per run; its default is the iOS 27 `iPhone 17`,
  which is not on this image);
- a new label recorded in `.github/actionlint.yaml`, which names what may be scheduled.

Unproven, and the reason no row is added: whether `simctl` will boot that runtime under Xcode
26.3, whether the example builds on macOS 15 at all (the image runs macOS 15.x, and this repo
is not built there), and what a run costs. It would also be a device job, and device jobs in
CI are manual-dispatch only.

Nothing in CI asserts the fallbacks on an older runtime. The cheapest step is the `macos-15`
dispatch row above, tried once by hand before it becomes a workflow row. A Mac with a
downloaded iOS 18 runtime answers the same question without any CI change.
