# X68 — the press-feedback check times its frames by the device's clock

**Kind:** tooling · **Devices:** android · **Budget:** 2 h for round one (X67)

## Goal

On a slow Android machine, a held press on a ListItem is judged by frames the device took
while the finger was down, however long those frames take to reach the host.

## Why

`pressPaintsFeedback` counts only frames whose read finished within the 1800 ms hold, by the
host's clock. On hosted runners a `screencap -p` took 1.4 to 2.1 s, so no frame counted, though
the frames showed the ink (runs 45639240890 job 1, 45651405466 job 3: 0.8993 against 0.9700).
The same runs timed captures through a whole suite: a PNG took 130 to 1990 ms, a raw frame cut
to the row's rows on the device 40 to 1270 ms.

## Behaviour

1. Each frame is taken on the device as a raw RGBA frame, `/proc/uptime` is read once it has
   been taken, and only the sampled rows cross adb.
2. After the press, the lift's time is read from the input dispatcher's recent events.
3. A frame counts only if the device took it at least one clock step before the lift. A press
   with no lift in the dispatcher's events is red, and says so.
4. The minimum drop, the hold, the sample grid and the ink-clears check do not change.

## Proof

- Unit tests over the lift parser (a fixture from the API 35 emulator), the counting rule and
  the frame header, each shown red by a mutation.
- `node scripts/gate.mjs real-input:android -- --control list-item` passes, and goes red with
  the ListItem's indication set to null.

## Out of scope

The driver's latency, the hold length, and the other callers' screens.
