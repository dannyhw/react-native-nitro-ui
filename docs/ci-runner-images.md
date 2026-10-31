# GitHub-hosted runner images: which iOS simulator runtimes they ship

Why this file exists: "verify the declared fallbacks on an iOS older than our
deployment target" (FOLLOWUPS 6 and 12, F4 rows 6/12) is only actionable if some
runner CI can schedule on actually has such a runtime. That answer is a fact about
a published image manifest, it changes when an image is rebuilt, and it costs an
hour of someone's life to re-derive. So it is written down, with its source and the
date it was read.

Read on 2026-10-31 from `actions/runner-images`' published manifests on `main`
(`images/macos/<image>-Readme.md`), read-only. Nothing was downloaded onto a
maintainer machine to check it.

## The two labels this repo schedules on

| Label in `.github/workflows` | Image | iOS simulator runtimes installed | iOS 18? |
| ---------------------------- | ----- | -------------------------------- | ------- |
| `macos-26` (`native-tests`, `release.yml`'s `version`) | macOS 26.6.1, image `20260824.0517.1`, Xcode 26.2 → 26.6 (default 26.6) | 26.2, 26.4, 26.5 | **no** |
| `xcode-27` (`harness-ios`, smoke's iOS jobs) | `xcode-27-arm64`, Xcode 27 | 27.0, 27.1 (`27.1` only for iPhone Duo) | **no** |

So **neither image this repo uses can run an iOS 18 simulator.** `macos-26`'s
floor is iOS 26.2; the SDK list is iOS 26.0 → 26.5 and the simulator list starts
at 26.2. There is no older runtime to select with `IOS_VERSION`, and Apple does
not offer an iOS 18 runtime for Xcode 26 or 27 at all.

## Where an iOS 18 simulator does exist

`macos-15` and `macos-15-arm64` (image manifests on the same page) install
**iOS 18.5 and iOS 18.6** simulators alongside iOS 26.0 – 26.2, with Xcode
16.0 → 26.3 installed and **16.4 as the default**. That is the only hosted image
series with an iOS 18 runtime, and it is not a label any workflow here uses.

Moving a job there is not a one-line change:

- the example asks its harness config for an iOS 27 simulator
  (`DEFAULT_IOS_VERSION` in `example/rn-harness.config.mjs`), overridable per run
  with `IOS_VERSION`, so the device selection is the easy half;
- the default Xcode on `macos-15` is 16.4, and `RCT_USE_PREBUILT_RNCORE` /
  `RCT_USE_RN_DEP` resolve a prebuilt React core **per Xcode version** - which
  prebuilt exists for RN 0.88 on that image is an experiment, not a read;
- `.github/actionlint.yaml` names the self-hosted labels permitted, and a new
  hosted label would want recording there too;
- it is a device-consuming job on an image the repo has never measured, i.e. the
  class of job `D22`/`D25` deliberately keeps dispatch-only and local.

## The related hole this does *not* close

`smoke.yml` skips the RN 0.86 **iOS** row because "RN 0.86's prebuilt core hangs
at launch on an iOS 27 simulator runtime", and says it needs an image with an iOS
26.x runtime. `macos-26` has iOS 26.2/26.4/26.5, so that row is testable on a
label this repo already schedules on. That is a different question from an
iOS < 26 fallback check, and it is the cheaper of the two; it belongs to F5/the
smoke work rather than here.

## What that means for the fallback check

Nothing in CI can assert the declared-fallback behaviour on an iOS 18 simulator
today. The options, in the order I would try them:

1. a physical device or a locally-downloaded iOS 18 runtime on a maintainer Mac
   (no CI change, no Apple-toolchain question, one manual run recorded in a
   report);
2. a dispatch-only harness row on `macos-15` with `IOS_VERSION=18.6`, once someone
   has proved an example app builds there at all (the four bullets above);
3. leave it as a documented manual step, which is where it stands now.

Option 1 is what the follow-up line in `docs/tasks/FOLLOWUPS.md` asks for.
