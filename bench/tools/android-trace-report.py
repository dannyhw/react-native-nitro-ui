#!/usr/bin/env python3
"""Read the traces from android-trace.sh.

  self-time  name=File.atrace [name=File.atrace ...]
      Per-slice self time on the app UI thread, in ms per measured iteration.
      Self time = slice duration minus its children, so a row adds up once
      instead of counting every nesting level.

  buckets    name=File.atrace [...]
      The same self time folded into cost buckets, so two arms can be compared
      by where the time goes rather than by which slice has the longest name.

  meminfo    name=Dir-or-prefix [...]
      Memory growth between the "empty" and "full" dumpsys snapshots of the
      memory cell, per instance.

One launch runs 5 warmup + 20 measured iterations, so traces divide by 25. The
window includes process start, so startup slices are real but amortised: read
these as an attribution of a shape, and the bench's own CPU columns as the
measurement. Self time is wall-clock inside traced slices, so it includes lock
waits - that is exactly why "GC / ART reclaim" shows up as UI-thread cost.
"""

import collections
import glob
import os
import re
import sys

ITER = 25
PKG = "nitroui.bench"

LINE = re.compile(
    r"^\s*(?P<comm>.+?)-(?P<tid>\d+)\s+\(\s*(?P<pid>-?\d+)\)\s+\[\d+\]\s+\S+\s+"
    r"(?P<ts>[\d.]+):\s+tracing_mark_write:\s+(?P<body>.*)$"
)
FTRACE = re.compile(r"^\s*(?P<comm>[^\s]+)-(?P<tid>\d+)\s+\(\s*(?P<pid>-?\d+)\)")

# Order matters: the first match wins, so the specific buckets come first.
BUCKETS = [
    ("GC / ART reclaim", r"^(GC[:_]|ProcessMarkStack|Compact|ScanGray|MarkRoots|Allocation|Rollback|Reclaim|FreeList|Background|ConcurrentCopy|Compaction|Gc|Suspending|Threading|LaunchGCTask|ProcessReferences|FullSuspendCheck)"),
    ("Compose content (recompose/apply)", r"^Compose:(recompose|applyChanges|sideEffects|onRemembered|onForgotten|onPositionedCallbacks|Precompose|subcomposition|slotTable|Tracker|snapshot)"),
    ("Compose host init", r"^Compose:(initializeView|InitializeComposition|InitializeCompositionAndRestore)"),
    ("Compose measure/layout/draw", r"^AndroidOwner:|^Subcomposition"),
    ("Fabric mount instructions", r"^IntBufferBatchMountItem|^MountItemDispatcher|^SurfaceMountingManager::createViewUnsafe|^FabricEventEmitter|^ReactSurfaceView"),
    ("View traverse / draw (whole screen)", r"^(traversal|draw-VRI|Record View#draw|dispatchApplyInsets|VRI\[|Hwc|composite|partitionLayers|updateLayerSnapshots|DisplayCallback|setupGpuLayers|UpdateSnapshots|presentAndGet)"),
    ("ART / dex / class loading", r"^(OpenDex|Open oat|DexChecksum|VerifyClass|LoadedPackage|SoLoader|CompileMethod|APM|JIT)"),
    ("App startup & lifecycle", r"^(performCreate|performStart|performResume|activityStart|activityResume|activityStop|performStop|ZygoteInit|ActivityThreadMain|clientTransaction|windowInsets|broadcastReceive|bindApplication|Startup|processStart)"),
]


def app_pids(path):
    pids = set()
    with open(path, errors="replace") as handle:
        for line in handle:
            if PKG in line:
                match = LINE.match(line) or FTRACE.search(line)
                if match:
                    pids.add(int(match.group("pid")))
    return pids


def parse(path):
    """Self and inclusive ms per slice name, for the app's UI thread only."""
    pids = app_pids(path)
    if not pids:
        # A trace the app never appeared in parses fine and reports every bucket
        # as zero, which is the one result worse than an error: it looks like a
        # measurement.
        sys.exit(f"{path}: no {PKG} lines - atrace captured nothing for this app")
    self_time = collections.Counter()
    stacks = collections.defaultdict(list)
    with open(path, errors="replace") as handle:
        for line in handle:
            match = LINE.match(line)
            if not match:
                continue
            # On Android the UI thread's tid equals the pid.
            if int(match.group("pid")) not in pids:
                continue
            tid = match.group("tid")
            if tid != match.group("pid"):
                continue
            ts = float(match.group("ts")) * 1000.0
            body = match.group("body")
            if body.startswith("B|"):
                label = body.split("|", 2)
                stacks[tid].append([(label[2].strip() if len(label) > 2 else "?"), ts, 0.0])
            elif body.startswith("E|") and stacks[tid]:
                label, start, children = stacks[tid].pop()
                duration = ts - start
                key = re.sub(r"numInstructions=\d+|\d+$", "", label).strip(": ")
                self_time[key] += duration - children
                if stacks[tid]:
                    stacks[tid][-1][2] += duration
    return self_time


def bucket(name):
    for label, pattern in BUCKETS:
        if re.match(pattern, name):
            return label
    return "other / unclassified"


def columns(argv):
    names, paths = [], []
    for spec in argv:
        name, path = spec.split("=", 1)
        names.append(name)
        paths.append(path)
    return names, paths


def cmd_self_time(argv):
    names, paths = columns(argv)
    arms = {n: parse(p) for n, p in zip(names, paths)}
    keys = sorted(set().union(*[set(a) for a in arms.values()]),
                  key=lambda k: -max(a.get(k, 0) for a in arms.values()))
    print(f"self time on the app UI thread, ms per iteration (n={ITER} per launch)")
    print(f"{'slice':<52}" + "".join(f"{n:>14}" for n in names))
    for key in keys:
        vals = [arms[n].get(key, 0) / ITER for n in names]
        if max(vals) < 0.08:
            continue
        print(f"{key[:51]:<53}" + "".join(f"{v:14.3f}" for v in vals))
    print(f"{'TOTAL traced':<53}" +
          "".join(f"{sum(arms[n].values()) / ITER:14.3f}" for n in names))


def cmd_buckets(argv):
    names, paths = columns(argv)
    arms = {n: parse(p) for n, p in zip(names, paths)}
    grouped = collections.defaultdict(dict)
    for name, slices in arms.items():
        for key, ms in slices.items():
            grouped[bucket(key)][name] = grouped[bucket(key)].get(name, 0) + ms / ITER
    order = [label for label, _ in BUCKETS] + ["other / unclassified"]
    print(f"self time on the app UI thread folded into cost buckets, ms per iteration")
    print(f"{'bucket':<38}" + "".join(f"{n:>13}" for n in names))
    for label in order:
        if label not in grouped:
            continue
        vals = [grouped[label].get(n, 0) for n in names]
        if max(vals) < 0.05:
            continue
        print(f"{label:<39}" + "".join(f"{v:13.2f}" for v in vals))
    print(f"{'TOTAL':<39}" +
          "".join(f"{sum(arms[n].values()) / ITER:13.2f}" for n in names))


SECTION = re.compile(r"^\s*(?P<name>[A-Za-z][\w. ]*?)\s{2,}(?P<nums>-?\d[\d ]*)$")
ROWS = ("Native Heap", "Dalvik Heap", "Dalvik Other", ".art mmap", "Unknown", "TOTAL")


def parse_meminfo(path):
    out = {}
    with open(path) as handle:
        text = handle.read()
    for line in text.splitlines():
        match = SECTION.match(line)
        if not match:
            continue
        nums = [int(x) for x in match.group("nums").split()]
        if match.group("name") in ROWS and len(nums) >= 8:
            # Pss total, private dirty, private clean, swap, Rss, heap size/alloc/free
            out[match.group("name")] = {"pss": nums[0], "rss": nums[4],
                                        "heap_alloc": nums[6]}
    for key in ("Java Heap", "Native Heap", "Code", "Stack"):
        match = re.search(rf"^\s*{re.escape(key)}:\s+(\d+)", text, re.M)
        if match:
            out.setdefault("summary", {})[key] = int(match.group(1))
    for key in ("TOTAL PSS", "Views"):
        match = re.search(rf"{re.escape(key)}:\s+(\d+)", text)
        if match:
            out.setdefault("summary", {})[key.replace(" ", "_")] = int(match.group(1))
    return out


def cmd_meminfo(argv):
    for spec in argv:
        name, prefix = spec.split("=", 1)
        empty = parse_meminfo(f"{prefix}-empty.txt")
        full = parse_meminfo(f"{prefix}-full.txt")
        n = int(os.environ.get("N", "200"))
        print(f"== {name}: N={n} controls, KiB added between the two snapshots ==")
        for row in ROWS:
            if row not in empty or row not in full:
                continue
            for field in ("pss", "heap_alloc"):
                if empty[row][field] is None:
                    continue
                delta = full[row][field] - empty[row][field]
                print(f"  {row:<14} {field:<11}{delta:>8} KiB{delta / n:>10.1f} KiB/control")
        summary = full.get("summary", {})
        for key, value in summary.items():
            base = empty.get("summary", {}).get(key)
            if base is None:
                continue
            print(f"  {'summary:' + key:<26}{value - base:>8}"
                  f"{(value - base) / n:>10.1f} per control")
        print()


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    cmd, rest = argv[0], argv[1:]
    if not rest:
        print(__doc__)
        return 1
    if cmd == "self-time":
        cmd_self_time(rest)
    elif cmd == "buckets":
        cmd_buckets(rest)
    elif cmd == "meminfo":
        cmd_meminfo(rest)
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
