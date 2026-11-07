# G19 — `androidIcon` and IconButton

**Worktree / branch:** named in your delegation message (`task/G19-android-icon-iconbutton`). **Round cap:** 1 round,
plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G19 --boot`).

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING's "README
  screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D17, D39, D40 item 2 and **D42**: config plugins are allowed, and the size ladder gains
  `xlarge`/`xxlarge`.
- `docs/PLAN.md` principle 3, as amended by D42.
- **`docs/tasks/Q9-buttongroup-iconbutton-design.report.md`, Appendix C (all of it) and Appendix D row G-A.** This is
  your design. Where this brief and Q9 differ, the brief wins.
- Button and Menu-trigger code as it is on `main`: E1's `NitroUiM3Button`, the size ladder and `shape`.

## Do

1. **The icon resolver (C1).** Build a shared Kotlin resolver and cache for drawable names.
   - It goes through React Native's `ResourceDrawableIdHelper`.
   - Each icon is loaded once per process, tinted with the control's content colour, and sized by the size ladder.
   - A missing name draws nothing, takes no space and logs one warning under the `NitroUi` tag.
2. **`androidIcon` on Button**, with Menu's trigger through `NitroUiM3Button`. On iOS the prop is accepted and ignored,
   because `systemImage` is iOS's. Document both.
3. **The size ladder** gains `xlarge` and `xxlarge` (D42 item 4).
   - Map Button's new sizes to Material's L/XL height tokens, and keep the 48 dp minimum touch target.
   - iOS maps them to the nearest `controlSize` (`.extraLarge` where available, otherwise `.large`); write the
     mapping in the doc.
4. **IconButton (C4)**, on both platforms.
   - **Android:** `IconButton(onClick, shapes, …)` with the XS–XL sizes (small…xxlarge), `width:
     'narrow'|'uniform'|'wide'`, the `standard`/`filled`/`tonal`/`outlined` variants and `shape`.
   - **iOS:** `Button` + `Label` `.iconOnly`.
   - **Labels:** `accessibilityLabel` is required, in the types and at runtime in dev.
   - **Toggling:** `checked`/`defaultChecked`/`onCheckedChange` use the existing event-count handshake.
   - **Plumbing:** registry entry, sizing through the core path with conformance rules and a fallback size,
     recycling with a full reset, and stable callbacks.
5. **Shipping drawables (C3 and D42 item 3).**
   - **Expo:** add a config plugin, `react-native-nitro-ui/plugin` with `{ androidIcons: "<dir>" }`. At prebuild it
     copies the folder's `.xml` vector drawables into `res/drawable/`, and writes a `res/raw/` keep file listing
     them, so resource shrinking can't remove them.
     - Installing the library must still need no plugin when `androidIcon` isn't used.
     - The plugin is Node code built with the package. Check the package files and `check`'s package checks
       include it.
     - Add a test that runs the plugin on a fixture project.
   - **Bare apps:** document copying the files by hand, plus the keep file.
   - **Docs:** write C3's user-facing section into the docs, and add short README usage for IconButton.
6. **The example app** ships a few test drawables (Material Symbols vectors; check the licence, which is Apache 2.0)
   for the stories and tests.
7. **README and docs.** IconButton gets:
   - its README Components row;
   - its name in the README import block and a Usage section;
   - both screenshots (`docs/images/components/icon-button-{ios,android}.png`, 804/720 px);
   - `docs/components/icon-button.md`.

   Update `button.md` for `androidIcon` and the new sizes. Add a minor changeset.

   adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
   preference afterwards, and restore any setting you change (read it first; don't use `cmd uimode night`).

## Tests, each shown red first

Follow Q9's C4 test plan. At minimum:
- **The resolver:** a known name resolves, and a missing name draws nothing and takes no space (a JVM unit test where
  possible). The cache loads each name once.
- **`androidIcon` on Button:** the icon draws, which a pixel probe or the node tree shows, and the size grows by the
  icon plus its gap, against a fixture that does not coincide with the plain button's size.
- **IconButton:**
  - each size and width;
  - the 48 dp touch target at XS;
  - the toggle handshake, including a refused change reverting;
  - the recycle reset;
  - the required label;
  - real-input taps on both platforms.
- **The config plugin:** it copies the files and writes the keep file, on a fixture project.

## Not in scope

ButtonGroup (G20), `androidIcon` on Menu/ContextMenu rows, SplitButton and Chip (G21), and anything else, which goes
as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G19-android-icon-iconbutton.report.md`, with the APIs at the top and benchmark numbers for IconButton.
Export the ledger with `gate.mjs export --task G19`.

## Fix round 1: the icon source changes (D43 item 2)

The owner chose Metro assets for `androidIcon`, so this round reworks round 1's icon handling before review.
IconButton stays out of G19; it becomes its own task after G19 merges.

1. **`androidIcon` accepts a Metro asset:** `require('./icons/share.xml')`, an Android vector drawable. Keep round 1's
   drawable-name string as the second form. The type is `ImageSourcePropType | string`, narrowed to what this means.
   - The wrapper resolves the asset in JS and passes native a plain string (no AnyMap), with a marker for which form
     it is.
   - **Release builds:** the asset is an ordinary drawable resource. Resolve it through round 1's resolver.
   - **Development:** React Native won't load Android `.xml` assets from Metro (`assetSupportsNetworkLoads` in
     `AssetSourceResolver.js`). Build the Metro asset URL in the wrapper, not by patching React Native's global
     `Image.resolveAssetSource` (D43). Load the file natively and parse it into an `ImageVector`, off the main
     thread, cached per URL for the process. Write our own parser; don't copy @expo/ui's code.
   - **Sizing:** the icon slot's size comes from the size ladder, so measurement never waits for the file. While a
     dev load is in flight, the slot is reserved and empty. A load that fails draws nothing, logs one warning, and
     keeps the size round 1 gives a missing name, whatever round 1's rule is. Say which.
2. **Remove the config plugin** (`react-native-nitro-ui/plugin`): its code, tests, package entry and docs. Metro does
   its job now.
3. **Docs:** the user-facing icon section explains:
   - passing a `.xml` file;
   - where to get Material Symbols (Google's download, Android format);
   - for Expo apps, `@expo/material-symbols` (`require('@expo/material-symbols/share.xml')`), described as an option
     that works with nitro-ui, not a dependency;
   - the drawable-name form for apps that already ship drawables;
   - that iOS uses `systemImage`.

   Update `button.md` and the README usage. The example app's test icons become `.xml` assets required from JS.
4. **Tests, each shown red first:**
   - The dev path: an asset loads from Metro and draws, the slot's size doesn't change when it arrives, and a 404
     draws nothing.
   - The release path, the resource lookup for a bundled asset's name, at least as a JVM test.
   - The parser, against a real Material Symbols file and one malformed file.
   - The wrapper: it never calls `addCustomSourceTransformer`.
   - The sizing key separates two different assets.
