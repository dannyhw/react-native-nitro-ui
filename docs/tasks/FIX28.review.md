# FIX28 review (round 1)

## Verdict

Fix round needed: one finding in the sibling SearchField case. The Form change is approved as written.

## Blocking findings

1. `example/__tests__/SearchField.harness.tsx:632` and `:641`: the sibling case's wait can stop on
   the wrong entry. `typed` is counted 30 ms after the last typed character, with nothing awaited,
   so it can be short of `change:ru`. `logReached` returns on entry count alone and never checks
   that the entry is `change:`. On a slow runner the late `change:ru` meets the wait, `before` is
   counted, and the clear's `change:` arrives after the Return. That is the exact CI result
   (`['change:']` where `[]` is expected), so the new wait does not close the race it was added for.
   Fix: take the count from a log that has caught up, e.g.
   `const typed = (await logReached('recleared', ['focus', 'change:r', 'change:ru'])).length;`.
   The submit case shows the log order is `focus`, then one `change:` per character. Line 558 has
   the same weakness: `before` follows a native-only `stateWhen`, so a late `change:hi` would make
   line 568 read `['change:hi']`. Anchor it the same way
   (`(await logReached('cleared', ['focus', 'change:h', 'change:hi'])).length`). Assertions and
   timeouts stay as they are.

## Non-blocking

- Question 1, otherwise: the changed cases add no sleep, no retry and no longer timeout (the default
  is still 5000 ms, the file's usual value), and `expect(reported).toEqual(['change:'])` is the
  same assertion as before. In the sibling case the wait comes before the Return, and `before` is
  counted after the wait. A `submit:`, a `blur` or a second `change:` caused by the Return still
  lands in the slice that line 646 checks against `[]`, so the wait cannot hide what the case
  exists to catch. A second `change:` from the clear itself could be absorbed, but the clear case's
  `toEqual(['change:'])` and `nativeEvents + 1` guard that.
- Red proofs: the "withhold the empty change" mutation reaches both new waits, since the quoted
  messages are `logReached`'s own (`cleared` / `recleared` ... still missing `["change:"]`). Neither
  proof shows a late entry being waited for. The brief did not require that, and finding 1 is the
  gap it would have exposed.
- `form.e2e.ts`: every hunk is inside the failure-only evidence block plus the
  `keyboardEvidence` list, so the passing path is unchanged. `git grep` finds no remaining use of
  `dumpedField`, `accessibilityDump`, `dumpTree`, `dumpEntries`, `dumpLine`, `linesInside`,
  `APP_PACKAGE`, `DumpNode` or `DumpEntry`. `adbShell` is still used by the dumpsys reads.
- `form.e2e.ts:456-458`: the hint sentence is accurate in general but does not apply here. "Note"
  is the field's `accessibilityLabel` (`example/src/FormScreen.tsx:491`); its placeholder is
  "Near the bottom of the list". The match still covers the brief's "text, content description or
  hint".
- `form.e2e.ts` `noteLine`: `hittable || 'not written'` can never fall back, because `asTreeNode`
  always writes `'true'` or `'false'`. Harmless.
- The report states openly that the driver's snapshot has no focused flag. Accepted.
- Comment rules: the new comments explain a platform constraint or what the code does. None cites
  a task, document or history. No shared e2e helper (support, os-tree, reader, device-read,
  keyboard, press-feedback) is in the diff.
- CodeRabbit: PR #126 has no inline comments (it hit its review rate limit), so there was nothing
  to check.

## Follow-ups

- Form keyboard CI failure: the passing-run evidence puts "Note" on an `android.view.View` sharing
  the wordless `EditText`'s box. CI's one editable, `(no words)` at [105,346][975,421], has the
  field's x-span and sits high on the screen, so the field was probably moved clear and the
  `getByRole('textbox').filter({ has: getByLabel('Note') })` lookup lost the label-to-editable
  link. That points at the driver lookup or the locator, not the library's avoidance. The next CI
  failure's "Note" line will confirm it.
