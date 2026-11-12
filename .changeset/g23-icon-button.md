---
'react-native-nitro-ui': minor
---

New: `IconButton`, a single-glyph button with an optional toggle form.

- `accessibilityLabel` is required, because the button has no visible text. Pass `systemImage` for iOS and `androidIcon` for Android, as with `Button`.
- `variant` is Material's four icon buttons: `'standard' | 'filled' | 'tonal' | 'outlined'`. iOS has no icon-button control, so it maps them onto its own button styles; `outlined` there is a bordered button rather than Material's ring.
- Pass `checked` / `defaultChecked` / `onCheckedChange` to make it a toggle. On iOS the toggle form ignores `variant`.
- `size` runs from `'small'` to `'xxlarge'`. `width` (`'narrow' | 'uniform' | 'wide'`) is Android-only. Small sizes still get the platform's minimum touch target.
