---
'react-native-nitro-ui': patch
---

The Android `inline` / `wheel` `DatePicker`'s calendar is no longer clipped inside a box narrower than 360 dp. Its seven weekday columns used to be laid out unevenly there, so the ones on the right lost width and the day's own highlight drew over its neighbour; all seven are equal now. In a box narrower than 360 dp the calendar lays its grid out at 40 dp touch targets instead of Material's 48 dp, which is what lets them fit; the month's previous/next buttons and the year toggle shrink with it. 40 dp is above WCAG 2.2 AA's 24 px minimum and below Material's recommended 48 dp, so a squeezed calendar is smaller to tap than a roomy one, and nothing is lost at widths where 48 dp already fitted — a calendar 360 dp or wider is unchanged. A box narrower than 304 dp is still too small for a week's worth of days and is not made to pretend otherwise. `compact` is unchanged: its dialog is a window laid out at Material's 360 dp.
