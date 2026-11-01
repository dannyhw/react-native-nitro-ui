---
'react-native-nitro-ui': patch
---

The iOS `DatePicker`'s declared fallback is now **107 × 36.33 pt** instead of 103 × 36.33, so a first `compact` `date` mount in `en_US` — and in most locales that write a date as `M/D/YYYY` — is laid out at its own size and costs no correction. The `compact` field's width is the widest string the _locale's_ date formatter produces, so the 103 that was declared is what the control measures under `en_PT`; in `en_US` the same control is 107 wide, which meant every cold mount was 4 pt narrow for a frame and then paid a horizontal correction to get it back. The height never moves with the locale and is unchanged. A locale _narrower_ than `en_US` now has the 4 pt of dead padding for one frame instead (no locale has been measured narrower than 103 wide), and `mode = "time"` is unaffected: it has its own sizing key either way.
