#!/usr/bin/env node
/**
 * Builds the a11y rule's test fixtures from real `uiautomator` dumps of the example app
 * running on the device `ANDROID_SERIAL` names.
 *
 * Usage: make-a11y-fixtures.mjs [outDir] [--only <id>[,<id>…]]
 *   outDir   where the `.xml` files go (default `scripts/__tests__/fixtures/a11y`)
 *   --only   refresh only the named controls' fixtures
 *
 * Each fixture keeps the named node, its ancestors and, for a group, the actable nodes inside
 * its box, verbatim and in document order.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import { A11Y_CONTROLS } from '../real-input/a11y.mjs';
import { parseHierarchy } from '../real-input/uiautomator.mjs';

const serial = process.env.ANDROID_SERIAL ?? 'emulator-5570';

const outDir = process.argv[2] ?? 'scripts/__tests__/fixtures/a11y';

const onlyAt = process.argv.indexOf('--only');
const only =
  onlyAt >= 0 && process.argv[onlyAt + 1] != null
    ? new Set(process.argv[onlyAt + 1].split(',').map((entry) => entry.trim()))
    : null;

const TAB_LABEL = {
  switch: 'Switch',
  slider: 'Slider',
  button: 'Button',
  progress: 'Progress',
  segmented: 'Segments',
  datepicker: 'Dates',
  picker: 'Picker',
  menu: 'Menu',
  chip: 'Chip',
  host: 'Host',
  textfield: 'Text',
  searchfield: 'Search',
  contextmenu: 'Context',
  checkbox: 'Checkbox',
  iconbutton: 'Icons',
  form: 'Form',
  stepper: 'Stepper',
  buttongroup: 'Groups',
  listitem: 'List items',
};

function adb(args) {
  return execFileSync('adb', ['-s', serial, 'shell', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function dump() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const out = adb(['uiautomator', 'dump', '/sdcard/x4-fixture.xml']).trim();
    if (!out.includes('could not get idle state')) {
      const xml = adb(['cat', '/sdcard/x4-fixture.xml']);
      if (xml.includes('<node')) return xml;
    }
    sleep(900);
  }
  throw new Error('uiautomator dump never succeeded');
}

function tapAt(x, y) {
  adb(['input', 'tap', String(Math.round(x)), String(Math.round(y))]);
}

function swipe(direction) {
  adb(
    direction === 'up'
      ? ['input', 'swipe', '540', '1800', '540', '700', '350']
      : ['input', 'swipe', '540', '700', '540', '1900', '350']
  );
}

function scrollToTop() {
  for (let i = 0; i < 14; i += 1) swipe('down');
  sleep(500);
}

function actable(node) {
  return (
    node.clickable === 'true' ||
    node.checkable === 'true' ||
    node.focusable === 'true'
  );
}

// `parseHierarchy` returns a flat list, so ancestry is derived from box containment.
function subtree(xml, label) {
  const nodes = parseHierarchy(xml);
  const named = nodes.find(
    (node) => node.contentDesc === label && node.bounds.height > 0
  );
  if (named == null) return null;
  const inside = (a, b) =>
    a.bounds.x1 <= b.bounds.x1 &&
    a.bounds.y1 <= b.bounds.y1 &&
    a.bounds.x2 >= b.bounds.x2 &&
    a.bounds.y2 >= b.bounds.y2;
  const kept = nodes.filter(
    (node) =>
      node === named ||
      inside(node, named) ||
      // A group's members are siblings of the merged node, not children of it, so the
      // actable nodes inside its box are kept as well.
      (node !== named && inside(named, node) && actable(node))
  );
  const raw = [...xml.matchAll(/<node\b[^>]*?\/?>/g)];
  const lines = kept.map((node) => {
    const index = nodes.indexOf(node);
    return raw[index][0];
  });
  return {
    xml:
      `<!-- Measured, not written: the ${label} subtree of a real \`uiautomator\n` +
      `     dump\` from the example app, ancestors and the named node verbatim.\n` +
      `     Regenerate with scripts/conformance/make-a11y-fixtures.mjs. -->\n` +
      `<hierarchy rotation="0">\n${lines.join('\n')}\n</hierarchy>\n`,
    named,
  };
}

// The tab bar scrolls sideways and keeps its position between screens. Controls are visited
// in tab order, so swiping forward until the tab shows is enough.
function findTab(label) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const tab = parseHierarchy(dump()).find(
      (node) =>
        node.contentDesc === label &&
        node.bounds.y1 > 100 &&
        node.bounds.y1 < 300
    );
    if (tab != null) {
      return tab;
    }
    // A leftward swipe on the bar's own row: the tab strip, not the page.
    adb(['input', 'swipe', '900', '200', '120', '200', '300']);
    sleep(600);
  }
  return null;
}

mkdirSync(outDir, { recursive: true });
const seen = new Set();
for (const control of A11Y_CONTROLS) {
  if (only != null && !only.has(control.id)) {
    continue;
  }
  if (!seen.has(control.screen)) {
    seen.add(control.screen);
    scrollToTop();
    const tab = findTab(TAB_LABEL[control.screen]);
    if (tab == null) throw new Error(`no ${control.screen} tab`);
    tapAt(tab.bounds.cx, tab.bounds.cy);
    sleep(2500);
    if (control.screen === 'progress') {
      // The 60 Hz writer makes `uiautomator dump` refuse outright.
      const toggle = parseHierarchy(dump()).find((node) =>
        node.text.includes('Stop the 60 Hz writes')
      );
      if (toggle != null) {
        tapAt(toggle.bounds.cx, toggle.bounds.cy);
        sleep(800);
      }
    }
  }
  scrollToTop();
  let found = null;
  for (let i = 0; i < 8 && found == null; i += 1) {
    found = subtree(dump(), control.label);
    if (found == null) {
      swipe('up');
      sleep(700);
    }
  }
  if (found == null) {
    console.log(`${control.id}: NOT FOUND on ${control.screen}`);
    continue;
  }
  writeFileSync(`${outDir}/${control.id}.xml`, found.xml);
  console.log(
    `${control.id.padEnd(18)} ${String(found.xml.length).padStart(6)} bytes  ` +
      `${found.named.className} ${found.named.bounds.width}x` +
      `${String(found.named.bounds.height)}`
  );
}
