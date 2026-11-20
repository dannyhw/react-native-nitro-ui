import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { A11Y_CONTROLS } from '../real-input/a11y.mjs';
import { runA11ySweepOnDevice } from '../real-input/a11y-sweep-device.mjs';
import { drawnAncestor } from '../real-input/a11y-evidence.mjs';

const hostedDatePicker = A11Y_CONTROLS.filter(
  (entry) => entry.id === 'hosted-date-picker'
);

/**
 * The Host screen as a dump answers it: the tab bar, the screen's echo, a drawn
 * neighbour that is not an ancestor, and the date picker's Host wrapping `pickerBounds`.
 */
function hostDump(pickerBounds) {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" bounds="[0,0][1080,2424]">
<node index="0" text="" resource-id="example-tabs" class="android.widget.HorizontalScrollView" content-desc="" scrollable="true" bounds="[0,120][1080,260]" />
<node index="1" text="" resource-id="" class="android.widget.ScrollView" content-desc="" scrollable="true" bounds="[0,384][1080,2424]">
<node index="0" text="7" resource-id="host-controlled-value" class="android.widget.TextView" content-desc="" bounds="[42,420][300,470]" />
<node index="1" text="" resource-id="host-slider" class="android.view.View" content-desc="Hosted slider" bounds="[42,900][1038,1000]" />
<node index="2" text="" resource-id="host-datepicker" class="com.nitroui.HostView" content-desc="" bounds="[42,1103][1038,1891]">
<node index="0" text="" resource-id="" class="android.view.View" content-desc="" bounds="[0,0][0,0]">
<node index="0" text="" resource-id="" class="android.view.View" content-desc="Hosted date picker" clickable="true" focusable="true" bounds="${pickerBounds}" />
</node>
</node>
</node>
</node>
</hierarchy>`;
}

/** A device that answers every read with `xml`, and records what it was asked. */
function standInDevice(xml) {
  const commands = [];
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
  ]);
  return {
    commands,
    png,
    adbShell(command) {
      commands.push(command);
      if (command.startsWith('wm size')) return 'Physical size: 1080x2424';
      if (command.startsWith('uiautomator dump')) return 'UI hierchary dumped';
      if (command.startsWith('cat ')) return xml;
      if (command.startsWith('base64 ')) return png.toString('base64');
      return '';
    },
  };
}

function collector() {
  const lines = [];
  return {
    lines,
    begin() {
      return {
        check(description, ok) {
          lines.push(`${ok ? '✓' : '✗'} ${description}`);
          return ok;
        },
        note(message) {
          lines.push(`· ${message}`);
        },
        warn() {},
        retried() {},
      };
    },
  };
}

async function sweep(xml) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-evidence-'));
  const device = standInDevice(xml);
  const { begin, lines } = collector();
  await runA11ySweepOnDevice(begin, {
    adbShell: device.adbShell,
    stopDaemon() {},
    tabs: [{ id: 'host', label: 'Host' }],
    appId: 'nitroui.example',
    cases: hostedDatePicker,
    out,
  });
  return { out, device, lines };
}

/** Every file under `dir`, relative to it. */
const filesIn = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name))
    );

describe('a red a11y sweep case keeps what it was graded on', () => {
  it('writes the final dump, takes a screenshot, and names both with the drawn ancestor', async () => {
    const xml = hostDump('[0,0][0,0]');
    const { out, device, lines } = await sweep(xml);

    const red = lines.find((line) => line.startsWith('✗'));
    expect(red).toContain('zero-sized box');
    expect(red).toContain('final dump a11y-sweep/hosted-date-picker.xml');
    expect(red).toContain('screenshot a11y-sweep/hosted-date-picker.png');
    expect(red).toContain(
      'nearest drawn ancestor of "Hosted date picker": [42,1103][1038,1891] ' +
        'com.nitroui.HostView resource-id "host-datepicker"'
    );

    expect(
      fs.readFileSync(
        path.join(out, 'a11y-sweep/hosted-date-picker.xml'),
        'utf8'
      )
    ).toBe(xml);
    expect(device.commands.some((c) => c.startsWith('screencap -p '))).toBe(
      true
    );
    expect(
      fs.readFileSync(path.join(out, 'a11y-sweep/hosted-date-picker.png'))
    ).toEqual(device.png);
  });

  it('a passing case writes nothing', async () => {
    const { out, device, lines } = await sweep(hostDump('[42,1565][386,1691]'));
    expect(lines.filter((line) => line.startsWith('✗'))).toEqual([]);
    expect(filesIn(out)).toEqual([]);
    expect(device.commands.some((c) => c.startsWith('screencap'))).toBe(false);
  });
});

describe('drawnAncestor', () => {
  it('skips undrawn ancestors and drawn nodes that only precede the named one', () => {
    expect(drawnAncestor(hostDump('[0,0][0,0]'), 'Hosted date picker')).toEqual(
      {
        bounds: '[42,1103][1038,1891]',
        className: 'com.nitroui.HostView',
        resourceId: 'host-datepicker',
      }
    );
  });

  it('answers null when the name has a box', () => {
    expect(
      drawnAncestor(hostDump('[42,1565][386,1691]'), 'Hosted date picker')
    ).toBeNull();
  });
});
