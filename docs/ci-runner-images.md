# GitHub-hosted runner images: which iOS simulator runtimes they ship

Why this file exists: "verify the declared fallbacks on an iOS older than our
deployment target" (FOLLOWUPS 6 and 12, F4 rows 6/12) is only actionable if some
runner CI can schedule on actually has such a runtime. That answer is a fact about
a published image manifest, it changes when an image is rebuilt, and it costs an
hour of someone's life to re-derive. So it is written down, with its source and the
date it was read.

Read on 2026-10-31 (fix round 1) from `actions/runner-images`' published manifests
on `main`, read-only: `images/macos/macos-26-arm64-Readme.md`,
`images/macos/macos-15-arm64-Readme.md`, `images/macos/xcode-27-arm64-Readme.md`.
The **arm64** manifests are the ones to quote: the `macos-26` and `xcode-27` labels
schedule arm64 hosts, and the unsuffixed `macos-26-Readme.md` is the Intel image
with a different build number. Nothing was downloaded onto a maintainer machine to
check any of it.

## The two labels this repo schedules on

| Label in `.github/workflows` | Image (arm64 manifest) | iOS simulator runtimes installed | iOS 18? |
| ---------------------------- | ---------------------- | -------------------------------- | ------- |
| `macos-26` (`native-tests`, `release.yml`'s `version`) | `macos-26-arm64`, image `20261026.0455.2`, macOS 26.6.2, Xcode 26.0.1 → 26.6 | 26.2, 26.4, 26.5 | **no** |
| `xcode-27` (`harness-ios`, smoke's iOS jobs) | `xcode-27-arm64`, image `20261026.0314.1`, Xcode 27 | 27.0, 27.1 (`27.1` only for iPhone Duo) | **no** |

So **neither image this repo uses can run an iOS 18 simulator.** `macos-26`'s
floor is iOS 26.2: its SDK list stops at iOS 26.5, its simulator list starts at
26.2, and there is no older runtime on the image to point `IOS_VERSION` at.

## Where an iOS 18 simulator does exist

`macos-15` and `macos-15-arm64` (same page; arm64 image `20261028.0489.1`) install
**iOS 18.5 and iOS 18.6** simulators alongside iOS 26.0 – 26.2, with **Xcode
16.0 → 16.4 and 26.0.1 → 26.3** installed and 16.4 as the default. That is the only
hosted image series with an iOS 18 runtime, and it is not a label any workflow here
uses.

Note what that pairing rules out: an earlier draft of this file said Apple offers no
iOS 18 runtime for Xcode 26 at all. That was wrong, and the manifest on the same
page disproves it — `macos-15-arm64` has iOS 18.5/18.6 simulators installed next to
Xcode 26.0.1 through 26.3, and simulator runtimes are shared across the Xcode
installs on a machine rather than owned by one of them. What the manifest does not
say is whether Xcode 26 will **boot** an iOS 18.5 device, which is the only thing
that would actually settle the question.

## What a first try would look like (not yet added)

A dispatch-only harness row on `macos-15` is more plausible than it first looks,
because the objection that made this file say "not a one-line change" mostly
evaporates on the arm64 manifest:

- `xcode-select` to Xcode 26.3 (installed there), so the toolchain matches the
  `macos-26`/`xcode-27` builds this repo already does, and
  `RCT_USE_PREBUILT_RNCORE` / `RCT_USE_RN_DEP` resolve the same prebuilt core
  rather than a 16.4-era one;
- `IOS_VERSION=18.6` plus `IOS_SIM` for a device that exists in that runtime
  (`example/rn-harness.config.mjs` takes both per run; its default is the iOS 27
  `iPhone 17`, which is not on this image);
- a new label recorded in `.github/actionlint.yaml`, which names what may be
  scheduled.

Unproven, and the reason no row is added here: whether `simctl` will boot that
runtime under Xcode 26.3, whether the example builds on macOS 15 at all (the image
runs macOS 15.x, and this repo has never built there), and what it costs per run.
It is also a device-consuming job on an unmeasured image, i.e. the class of job
`D22`/`D25` deliberately keeps dispatch-only and local.

So the fallback check stands as: nothing in CI asserts it today; the cheapest real
step is the `macos-15` dispatch row above, tried once by hand before it becomes a
workflow row; a maintainer Mac with a downloaded iOS 18 runtime answers the same
question without any CI change. Option-for-option, that is what
`docs/tasks/FOLLOWUPS.md` asks for.

## The related hole this does *not* close

`smoke.yml` skips the RN 0.86 **iOS** row because "RN 0.86's prebuilt core hangs
at launch on an iOS 27 simulator runtime", and says it needs an image with an iOS
26.x runtime. `macos-26` has iOS 26.2/26.4/26.5, so that row is testable on a
label this repo already schedules on. That is a different question from an
iOS < 26 fallback check, and it is the cheaper of the two; it belongs to F5/the
smoke work rather than here.
