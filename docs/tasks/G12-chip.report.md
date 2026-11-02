# G12 — Chip

**Branch:** `task/G12-chip` (from `main` at `98c3eed`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G12-h83ki` (iPhone 17 iOS 27.0 `F08675D3` / `nitroui_t03` `emulator-5574` / Metro `8295`)

## API (settled before building)

```tsx
import { Chip } from 'react-native-nitro-ui';

<Chip label="Vegan" selected={vegan} onSelectedChange={setVegan} />;   // filter (default)
<Chip variant="assist" label="Add to calendar" systemImage="calendar" onPress={add} />;
```

| Prop               | Type                                     | Default    | Notes |
| ------------------ | ---------------------------------------- | ---------- | ----- |
| `label`            | `string`                                 | required   | The text, the default a11y label, and part of the sizing key. |
| `variant`          | `'filter' \| 'assist'`                   | `'filter'` | Unknown strings resolve to `'filter'` (Button's rule). |
| `selected`         | `boolean \| undefined`                   | unset      | Filter only. Controlled, through Switch's event-count handshake. |
| `defaultSelected`  | `boolean \| undefined`                   | `false`    | Filter only. Initial value of an uncontrolled chip. |
| `onSelectedChange` | `(selected: boolean) => void`            | —          | Filter only. Every user toggle, with the value native shows. |
| `onPress`          | `() => void`                             | —          | Assist only. One per tap. |
| `disabled`         | `boolean \| undefined`                   | `false`    | Native `.disabled` / `enabled = false`. |
| `systemImage`      | `string \| undefined`                    | —          | Leading SF Symbol, iOS only, ignored on Android: Button's convention. |
| `testID`, `accessibilityLabel` | `string \| undefined`        | —          | As Button; the label falls back to `label`. |
| `hybridRef`, `nuiPerfId` | internal                           | —          | As Button (D14). |

Decisions inside the brief's latitude:

- **v1 is filter and assist only.** `variant` is a string union, so `input` and `suggestion` can be added
  without a breaking change. An unknown variant is `filter`, not an error, so an app written against a later
  version still renders.
- **No `tintColor` in v1.** It is not in the brief's list; the iOS tint and the M3 selected-container colour map
  cleanly, so it is a follow-up rather than a design question.
- **The sizing key is `variant|selected|systemImage|label`**, with `systemImage` and `label` escaped as G10 did for
  Button. `selected` is a real field on Android, where M3's selected filter chip gains a leading check, and
  always `0` on iOS, where `Toggle(.button)` keeps its size (asserted in the harness, so the iOS half is
  measured rather than assumed). An assist chip's `selected` field is always `0`.
- **An uncontrolled filter chip re-renders once per toggle on Android**, so the key follows what native paints.
  It is Picker's rule (G6 review M1), for the same reason: a key that names the previous selection would file
  the new width under the old configuration. iOS keeps Switch's zero-render uncontrolled toggle.
- **`hostable: false`, `bench: false`.** Every other control is hostable, but that needs Host coverage the brief
  does not ask for. A `<Host>` refuses a Chip with its usual dev error until a follow-up adds it. Bench arms are a
  follow-up (below).
