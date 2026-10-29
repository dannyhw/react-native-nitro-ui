#!/usr/bin/env node
/**
 * Measure the a11y shape of every control in `A11Y_CONTROLS`, from real dumps.
 *
 * Not a gate: a scratch reader whose output is what the rule table in
 * `scripts/real-input/a11y.mjs` is written from, and whose dumps become the fixtures in
 * `scripts/__tests__/real-input-a11y.test.js`. The rule's whole claim is about *which*
 * node carries a name, so a table written from imagination would be worth nothing.
 *
 * Scrolls before dumping (a hosted control below the fold answers with no box), and
 * stops the Progress screen's 60 Hz writer first, because a screen that never goes idle
 * makes `uiautomator dump` fail outright.
 */
import { execFileSync } from 'node:child_process';

import { A11Y_CONTROLS } from '../real-input/a11y.mjs';
import { parseHierarchy } from '../real-input/uiautomator.mjs';

const serial = process.env.ANDROID_SERIAL ?? 'emulator-5570';
const outDir = process.argv[2] ?? '/tmp/x4-dumps';

const TAB_LABEL = {
  switch: 'Switch',
  slider: 'Slider',
  button: 'Button',
  progress: 'Progress',
  segmented: 'Segments',
  datepicker: 'Dates',
  picker: 'Picker',
  host: 'Host',
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
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const out = adb([
      'uiautomator',
      'dump',
      '/sdcard/x4-measure.xml',
    ]).trim();
    if (!out.includes('could not get idle state')) {
      const xml = adb(['cat', '/sdcard/x4-measure.xml']);
      if (xml.includes('<node')) return xml;
    }
    sleep(900);
  }
  return '';
}

function tapAt(x, y) {
  adb(['input', 'tap', String(Math.round(x)), String(Math.round(y))]);
}

function swipeUp() {
  adb(['input', 'swipe', '540', '1800', '540', '700', '400']);
}

function tabRect(tree, label) {
  return tree.find(
    (node) =>
      node.contentDesc === label && node.bounds.y1 < 300 && node.bounds.y1 > 100
  );
}

function go(tab) {
  const tree = parseHierarchy(dump());
  const tabNode = tabRect(tree, TAB_LABEL[tab]);
  if (tabNode == null) throw new Error(`no ${tab} tab`);
  tapAt(tabNode.bounds.cx, tabNode.bounds.cy);
  sleep(2500);
}

/** The scroll position that shows `label`, or false when three swipes did not. */
function scrollUntil(label) {
  for (let i = 0; i < 6; i += 1) {
    const nodes = parseHierarchy(dump()).filter(
      (node) => node.contentDesc === label
    );
    if (nodes.some((node) => node.bounds.height > 0)) return true;
    swipeUp();
    sleep(700);
  }
  return false;
}

function scrollToTop() {
  for (let i = 0; i < 6; i += 1) swipeUp();
  sleep(400);
  for (let i = 0; i < 12; i += 1) {
    adb(['input', 'swipe', '540', '700', '540', '1900', '300']);
  }
  sleep(600);
}

const seen = new Set();
for (const control of A11Y_CONTROLS) {
  if (!seen.has(control.screen)) {
    seen.add(control.screen);
    scrollToTop();
    go(control.screen);
    if (control.screen === 'progress') {
      // The default writer repaints at 60 Hz and `uiautomator dump` then refuses.
      const tree = parseHierarchy(dump());
      const toggle = tree.find((node) => node.text.includes('Stop'));
      if (toggle != null) {
        tapAt(toggle.bounds.cx, toggle.bounds.cy);
        sleep(800);
      }
    }
  }
  scrollToTop();
  const reached = scrollUntil(control.label);
  const tree = parseHierarchy(dump());
  const named = tree.filter((node) => node.contentDesc === control.label);
  const node = named.find((n) => n.bounds.height > 0);
  if (node == null) {
    console.log(`${control.id}: NO NAMED NODE with a box (reached=${String(reached)})`);
    continue;
  }
  const actionOf = (n) =>
    [
      n.clickable === 'true' && 'click',
      n.checkable === 'true' && 'check',
      n.focusable === 'true' && 'focus',
    ]
      .filter(Boolean)
      .join('+') || 'none';
  const containing = tree
    .filter(
      (n) =>
        n !== node &&
        n.bounds.x1 <= node.bounds.x1 &&
        n.bounds.y1 <= node.bounds.y1 &&
        n.bounds.x2 >= node.bounds.x2 &&
        n.bounds.y2 >= node.bounds.y2 &&
        actionOf(n) !== 'none' &&
        !n.className.includes('ScrollView')
    )
    .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
  const box = node.bounds;
  console.log(
    `${control.id.padEnd(18)} ${String(named.length)}x ${node.className.padEnd(24)} ` +
      `${actionOf(node).padEnd(6)} ${box.width}x${box.height}@${box.y1} ` +
      `inner-actionable=${
        containing[0] == null
          ? 'none'
          : `${containing[0].className.split('.').pop()} ` +
            `${String(containing[0].bounds.width)}x${String(containing[0].bounds.height)}` +
            ` ${actionOf(containing[0])}`
      }`
  );
}
