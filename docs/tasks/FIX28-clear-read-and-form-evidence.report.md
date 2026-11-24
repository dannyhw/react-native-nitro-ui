# FIX28 — The SearchField clear tests wait for their event; the Form keyboard failure names the field

**Branch:** `task/FIX28-clear-read-and-form-evidence` (from `main` at `ec49b1d8`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX28-qwc3g` (pair-b, both platforms / Metro 8293 and 9293)

## Summary

Both product tests now read a value they have waited for, and the Form failure says something the
driver can actually answer.

`logReached` takes the number of entries already in the log and waits until that many entries have
passed before it returns the slice, so a case can wait for the events after its own action rather
than for the whole log. The two clear cases use it: "reports the clear button as one empty edit…"
waits for the clear's `change:` before comparing the slice it reads, and "takes no submit from a
Return pressed on a query it has just cleared" waits for the same entry *before* it counts the log,
so a late `change:` cannot be counted as though it arrived after the Return. Assertions, timeouts
and the file's polling helper are unchanged, and no sleep was added.

The Form keyboard evidence no longer runs `uiautomator dump`, which cannot answer while the run
holds the device's accessibility connection (`example/e2e/README.md`, "Phase 2"). It asks the
driver for its own unmerged snapshot and lists every node whose words - text or the description the
node is announced with, which is also where an empty field's hint lands - carry the field's title,
whatever its class, with class, focusable, hittable, enabled and bounds, and prints `none` when
nothing carries it. `dumpedField`, `accessibilityDump` and the dump-parsing that only they used are
gone; `EDITABLE_CLASS` and `EVIDENCE_NODES` stay because the driver-tree line uses them. One thing
the brief asked for is not in the line: the driver's snapshot, as `os-tree.ts` shapes it, carries
no focused flag, so the evidence prints the focus flags it does carry. No shared helper was touched.

The green path of the Form case is untouched, and no library code changed.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2226 tests / 102 suites | `07fc219e17a9` | 57.3 s | start 1.9 / med 7.7 / max 9.4 |
| `harness:ios` | **PASS** | 621 tests / 30 suites + isolated 6 tests / 3 suites | `07fc219e17a9` (harness:ios digest) | 14 m 33 s | start 7.1 / med 5.2 / max 12.0 |
| `harness:android` | **PASS** | 679 tests / 31 suites + isolated 6 tests / 3 suites | `07fc219e17a9` (harness:android digest) | 18 m 28 s | start 4.7 / med 2.7 / max 4.9 |
| `real-input:ios` | **PASS** (from `merge/X62-X63`) | — | `3c9fa9b83cf7` (real-input:ios digest) | 44 m 53 s | start 4.8 / med 4.8 / max 15.0 |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:SearchField` | stale | 2 failed of 18 tests / 1 suites | 3b8401b31e9e (not this tree) | 35.3 s | start 4.0 / med 7.4 / max 7.6 |
| `real-input:android:--control:form` | **PASS** | 7 tests / 1 suites | `07fc219e17a9` (real-input:android digest) | 16 m 07 s | start 4.7 / med 4.1 / max 6.3 |

`need --for review`: `need: review is satisfied on this code tree.` - `check`, `harness:ios` and
`harness:android` green, and the filtered `real-input:android:--control:form` proof green on its own
digest. The full `real-input:android` is deliberately left for merge.

## Red proofs

- `SearchField > reports the clear button as one empty edit and keeps the focus` -> in the test's own
  `Controlled` field, the app's log skips an empty change (`if (text !== '') log(id, ...)`) ->
  `SearchField cleared: log holds [] after 5000ms; still missing ["change:"]`
- `SearchField > takes no submit from a Return pressed on a query it has just cleared` -> same
  mutation -> `SearchField recleared: log holds [] after 5000ms; still missing ["change:"]`
- `form > a field the keyboard would cover is moved clear of it` -> a throw added right after
  `await fieldAboveKeyboard(field)` in a filtered `real-input:android -- --control form` run ->
  `forced: the above-keyboard read is being proven red`, and the new evidence line printed:
  `- the driver's nodes whose words carry "Note": its snapshot holds 375 node(s), 2 of them carrying
  "Note" in its words:` / `android.widget.TextView focusable=false hittable=false enabled=true
  text="" announced="Notes" bounds=[0,1310][163,1405]` / `android.view.View focusable=false
  hittable=false enabled=true text="" announced="Note" bounds=[105,1445][975,1508]` - the title is
  on a non-editable View whose box is the editable node's, which is the split the old raw-dump line
  could never show.

## Files changed

- `example/__tests__/SearchField.harness.tsx`: `logReached` waits past the entries a case has
  already counted; both clear cases wait for the clear's `change:` before they read or count.
- `example/e2e/real-input/form.e2e.ts`: the failure reads the driver's snapshot for nodes carrying
  the field's title; the raw `uiautomator` dump and its parsing are removed.

## Follow-ups

- form: on this run the field's title sits on an `android.view.View` at the wordless `EditText`'s
  own box, so the missing-field question is about which node the driver names, not whether the
  field is on the screen - out of scope here, and the quarantined sibling is the same shape.
- agents: a proof edit to `src/` or `example/` moves the code tree, so each of the two proofs here
  cost an app rebuild before the gate would start; two rebuilds per proof round may be worth
  counting in the estimate.
