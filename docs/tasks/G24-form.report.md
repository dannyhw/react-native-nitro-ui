# G24 — Form and Section

**Branch:** `task/G24-form` (from `main` at `60dda361`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G24-<id>` (pair B / Metro `<port>`)

## API

`Form` is a grouped, scrolling settings list whose rows are ordinary React Native views.

| Component | Props | Notes |
| --- | --- | --- |
| `Form` | `children`, `keyboardAvoidance` (default `true`), `style` | Not self-sizing: it takes the box it is given (`sizing: null`). Give it `flex: 1`. |
| `Form.Section` | `children`, `title`, `footer` | Strings, not nodes, in v1. Every direct child becomes one row. |
| `Form.Row` | `children`, `onPress`, `accessory: 'none' \| 'disclosure' \| 'checkmark'`, `selected`, `style` | An app names the component only to add a press or an accessory. |

Exported types: `FormAccessory`, `FormProps`, `FormSectionProps`, `FormRowProps`,
`FormComponent`. The three `hybridRef` handles stay internal (D14), written inline the way
`TextField` writes its own so api-extractor never asks for a native type.

The platform mapping, the settle-time `measure()` contract and the off-screen-row rule are in
`docs/components/form.md`.

## Summary

`Form` is iOS's list and Android's shapes. On iOS the container is a
`UICollectionView` in `.insetGrouped` appearance whose list cells hold the rows; on Android
there is no platform `Form` to host, so the rows stay exactly where Yoga put them inside
React Native's own `ScrollView` and each section draws Material 3 Expressive's segmented-list
shapes behind them (D45). A nitro-ui control in a row is the same standalone control it is
anywhere else — no `Host`, no re-parenting into Compose.

Three mechanisms carry the component, and each is the reason a spike-shaped version would not
have worked:

- **One number makes `measure()` right.** iOS lays a row out at the width a cell hands it, so
  the Form reports that width (`onContentBox`) and each row's Yoga box becomes its cell's box;
  a section reports the y the list gave it, so a row's Yoga origin is its position in the list
  content. With that, the shadow-node correction is the scroll offset, published when scrolling
  settles (`cpp/NitroUiScrollOffset.hpp`, D45 item 3). Mid-fling a measurement reads the last
  settled position, and a row outside the visible cells has no cell — both documented as
  deliberate.
- **The keyboard is insets, not a scroll hack.** Android reserves
  `WindowInsetsCompat.Type.ime()` in its scroll content and asks the scroller to make the
  focused row visible; iOS grows the list's bottom inset. The real-input check reads the
  keyboard's own top edge rather than a height guessed per system image.
- **A press belongs to the cell.** A row with `onPress` is UIKit's cell highlight and one
  button element; on Android it is M3's pressed state and one merged node that does not steal
  touches from a `Switch` or a `Pressable` in the row.

The real-input tooling fixes came first, in their own commit: `imeShown()` was asking whether
`"[object Object]"` contains `mInputShown=true`, `hideKeyboard()` was pressing Back for nobody,
and the keyboard edge was being read from the IME's window record — which from API 30 is a
full-height insets host whose `frame=` never moves. Both readers now live in
`scripts/real-input/ime-frame.mjs`, are pure, and are unit-tested, so a dumpsys format change
fails in `check` rather than in a device run.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: <pending>

## Red proofs

Host (each mutation applied to the source, reverted after the run):

- `ime-frame.test.js` -> `imeInsetTop` ignores `visible=` -> `says nothing when the source is there but not visible`
- `ime-frame.test.js` -> `imeServiceTopPx` drops the `mInputShown` gate -> `refuses the same number once the input view is down`
- `ime-frame.test.js` -> `imeInsetTop` answers `0` instead of `null` -> 4 red, incl. `says nothing, rather than 0, for a dump that never mentioned an IME`
- `scroll-offset.test.cpp` -> `scrollOffsetOf` passes a NaN through -> `5 of 16 checks FAILED`
- `scroll-offset.test.cpp` -> a negative offset clamps to `0` -> `1 of 16 checks FAILED` (the negative-offset case)
- `registry.test.js` -> `subViewsOf` stops marking sub-views -> `refuses a sub-view that claims a name another component has`
- `registry.test.js` -> a sub-view name loses its parent prefix -> 12 red, from `the tree in front of us is in step with its manifests`
- `patch-nitrogen.test.js` -> `HybridNitroUiForm` out of `CONTENT_CHILDREN_VIEWS` -> `mounts the children into the content view, inside the @implementation`
- `patch-nitrogen.test.js` -> `SCROLL_SHADOW_VIEWS` emptied -> `repoints the shadow node and keeps nitrogen's state`
- `viewConfigs.test.ts` -> the Row's config copy drops `pressable` -> `NitroUiFormRowConfig.json matches nitrogen output`
- `conformance.test.js` -> the Form's a11y case points at another screen -> `navigates once per screen, not once per case`
- `bench-gate.test.js` -> the Form's four quick-plan cells removed -> `schedules one complete component per --component, never a mix`
- `readme-components.test.js` -> no `docs/images/components/form-ios.png` -> `Form: docs/images/components/form-ios.png does not exist`

On device:

- <pending>

## Files changed

- `src/components/Form/*` — the wrapper: rows as children, the content-width box, the
  settle-time offset prop, the Android accessory reserve, the registry-generated view configs.
- `ios/components/Form/*` — the `.insetGrouped` list, cells, `UICellAccessory`, the cell
  highlight, the keyboard inset, the SwiftUI reference screen for the fidelity table.
- `android/.../HybridNitroUiForm*.kt` — the segmented shapes, the reserved header band, the
  pressed state, the IME inset, the two Material Symbols accessories.
- `cpp/NitroUiScrollOffset.hpp`, `cpp/NitroUiScrollShadow.hpp`, `scripts/patch-nitrogen.mjs`,
  `scripts/registry-core.mjs` — the scroll-corrected shadow node and the optional `subViews` key.
- `scripts/real-input/*` — the IME readers, the Form checks on both platforms, the a11y case.
- `example/__tests__/Form*.harness.tsx`, `example/src/FormScreen.tsx`,
  `example/src/stories/Form.stories.tsx` — the on-device tests, the real-input screen, the stories.
- `docs/components/form.md`, `README.md`, `docs/images/components/form-*.png`, `.changeset/`.

## Follow-ups

- <pending>
