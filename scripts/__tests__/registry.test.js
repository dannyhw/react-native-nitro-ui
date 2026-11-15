import { beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  MANIFEST_BASENAME,
  NON_CONTROL_AUTOLINKING,
  SIZING_TABLE_FILE,
  checkAndroidViewManagers,
  checkAutolinking,
  checkExampleScreens,
  checkIndexExports,
  checkRealInputRows,
  exportedComponents,
  exportedValuesByComponent,
  manifestsFromEntries,
  planRegistry,
  regionsFor,
  replaceRegion,
  subViewsOf,
  validateManifest,
  withSubViews,
} from '../registry-core.mjs';

import { childEnv } from './helpers/scrubbed-env.js';

const repoRoot = resolve(process.cwd());

/** Reads a real file of the repo, so the plan under test is the shipped one. */
function readRepo(path) {
  try {
    return readFileSync(join(repoRoot, path), 'utf8');
  } catch {
    return null;
  }
}

beforeAll(() => {
  if (!existsSync(join(repoRoot, 'package.json'))) {
    throw new Error(
      `Run jest from the repository root (looked in ${repoRoot}).`
    );
  }
});

/** The component directories of the tree, the way the CLI enumerates them. */
function componentDirs() {
  return readdirSync(join(repoRoot, 'src/components'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The component directories without a manifest: the `<Host>` container. */
const NON_COMPONENT_DIRS = ['Host'];

/**
 * A control name this tree does not use, for the tests that add one on the fly.
 */
function spareControl() {
  const used = new Set([
    ...componentDirs(),
    ...repoManifests().flatMap((m) => [m.name, m.id]),
    ...NON_COMPONENT_DIRS,
  ]);
  for (const name of ['Gauge', 'Toggle', 'Stepper', 'Accordion', 'Rating']) {
    if (!used.has(name) && !used.has(name.toLowerCase()))
      return {
        name,
        id: name.toLowerCase(),
        implementation: `HybridNitroUi${name}`,
      };
  }
  throw new Error('every spare component name this test could invent is taken');
}

function repoManifests() {
  return manifestsFromEntries(
    componentDirs()
      .map((directory) => ({
        directory,
        text: readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`),
      }))
      .filter((entry) => entry.text != null)
  );
}

/** The inputs `bun run registry:check` uses, with a text overlay applied. */
function runPlan(manifests, overrides = {}) {
  const used = manifests ?? repoManifests();
  const { files, problems, checked } = planRegistry(used, (path) =>
    path in overrides ? overrides[path] : readRepo(path)
  );
  return {
    manifests: used,
    files,
    problems,
    checked,
    drift: Object.keys(files).sort(),
  };
}

function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

const buttonManifest = () =>
  JSON.parse(readRepo(`src/components/Button/${MANIFEST_BASENAME}`));

describe('component manifest schema', () => {
  const where = 'src/components/Button/component.json';
  const check = (overrides) =>
    validateManifest({ ...buttonManifest(), ...overrides }, 'Button', where);

  it('accepts the shipped Button manifest', () => {
    expect(check({})).toEqual([]);
  });

  it('rejects a key it knows nothing about, and lists the ones it does', () => {
    // An unknown key is usually a typo for a real one, which would silently do
    // nothing.
    const problems = check({ bencTitle: 'Nitro UI' }).join('\n');
    expect(problems).toMatch(/unknown key "bencTitle"/);
    expect(problems).toMatch(/smoke/);
  });

  it('rejects a missing key, and says which list reads it', () => {
    const withoutLabel = buttonManifest();
    delete withoutLabel.exampleLabel;
    expect(validateManifest(withoutLabel, 'Button', where).join('\n')).toMatch(
      /missing required key "exampleLabel".*tab-bar label/s
    );
  });

  it('rejects a manifest whose name does not match its directory', () => {
    expect(check({ name: 'Slider' }).join('\n')).toMatch(
      /name "Slider" does not match its directory "Button"/
    );
  });

  it('rejects the names that are derived rather than chosen', () => {
    expect(check({ hybridView: 'NitroUiBtn' }).join('\n')).toMatch(
      /is not NitroUiButton/
    );
    expect(check({ implementation: 'HybridNitroUiBtn' }).join('\n')).toMatch(
      /is not HybridNitroUiButton/
    );
  });

  it('rejects an unknown sizing mode, and allows the null that means not self-sizing', () => {
    expect(check({ sizing: 'auto' }).join('\n')).toMatch(/sizing.*one of/);
    expect(check({ sizing: null })).toEqual([]);
    expect(check({ hostable: null }).join('\n')).toMatch(/may not be null/);
  });

  it('rejects a real-input control with no title to render', () => {
    expect(buttonManifest().realInput).toBe(true);
    expect(check({ realInputTitle: undefined }).join('\n')).toMatch(
      /realInputTitle is missing/
    );
    // A component with no real-input row needs no title.
    expect(check({ realInput: false, realInputTitle: undefined })).toEqual([]);
  });

  it('rejects a label or title the generated line cannot carry', () => {
    // Both are rendered inside single quotes, so an apostrophe would produce a
    // file that does not parse.
    expect(check({ exampleLabel: "Users' Switch" }).join('\n')).toMatch(
      /exampleLabel.*contains a quote or a line break/
    );
    expect(
      check({ realInputTitle: "a real tap flips the Switch's box" }).join('\n')
    ).toMatch(/realInputTitle.*contains a quote or a line break/);
    // Nothing in the tree trips the rule.
    for (const directory of componentDirs()) {
      const text = readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`);
      if (text == null) continue;
      expect(validateManifest(JSON.parse(text), directory, 'x')).toEqual([]);
    }
  });

  it('rejects two manifests claiming one id or tab', () => {
    // `name`, `hybridView` and `implementation` are derived from the directory, so
    // two components can only collide on `id` or `exampleTab`.
    const entries = componentDirs().map((directory) => ({
      directory,
      text: readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`),
    }));
    const toggle = (overrides) => ({
      directory: 'Toggle',
      text: JSON.stringify(
        {
          ...buttonManifest(),
          name: 'Toggle',
          hybridView: 'NitroUiToggle',
          implementation: 'HybridNitroUiToggle',
          ...overrides,
        },
        null,
        2
      ),
    });
    entries.push(toggle());
    expect(() => manifestsFromEntries(entries)).toThrow(
      /duplicate id "button": Button and Toggle/
    );
    entries.pop();
    entries.push(toggle({ id: 'toggle' }));
    expect(() => manifestsFromEntries(entries)).toThrow(
      /duplicate exampleTab "button"/
    );
    entries.pop();
    entries.push({
      directory: 'Toggle',
      text: JSON.stringify({ ...buttonManifest(), name: 'Toggle' }, null, 2),
    });
    expect(() => manifestsFromEntries(entries)).toThrow(
      /hybridView "NitroUiButton" is not NitroUiToggle/
    );
  });

  it('accepts an exports list of distinct component names, and nothing else', () => {
    // One native view behind several public components (Dialog: AlertDialog and
    // ConfirmationDialog). Optional: a manifest without it exports its own name.
    expect(check({ exports: ['AlertDialog', 'ConfirmationDialog'] })).toEqual(
      []
    );
    for (const bad of [
      [],
      ['AlertDialog', 'AlertDialog'],
      ['alertDialog'],
      'X',
    ]) {
      expect(check({ exports: bad }).join('\n')).toMatch(
        /key "exports" must be a non-empty array of distinct names/
      );
    }
  });

  it('rejects two manifests claiming one export', () => {
    const entries = componentDirs().map((directory) => ({
      directory,
      text: readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`),
    }));
    entries.push({
      directory: 'Sheet',
      text: JSON.stringify({
        ...buttonManifest(),
        name: 'Sheet',
        hybridView: 'NitroUiSheet',
        implementation: 'HybridNitroUiSheet',
        id: 'sheet',
        exampleTab: 'sheet',
        exports: ['ConfirmationDialog'],
      }),
    });
    expect(() => manifestsFromEntries(entries)).toThrow(
      /duplicate export "ConfirmationDialog": Dialog and Sheet cannot both claim it/
    );
  });

  it('has a manifest for every component directory except the container', () => {
    // A component directory without a manifest would be invisible to every
    // generated list. `<Host>` is the exception: a container, not a control.
    const withManifest = componentDirs().filter(
      (directory) =>
        readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`) != null
    );
    expect(withManifest.sort()).toEqual(
      componentDirs().filter((name) => !NON_COMPONENT_DIRS.includes(name))
    );
    for (const container of NON_COMPONENT_DIRS) {
      expect(componentDirs()).toContain(container);
      expect(withManifest).not.toContain(container);
    }
  });
});

describe('registry:check drift detection', () => {
  it('the tree in front of us is in step with its manifests', () => {
    // This is the point of the gate. If it goes red, `bun run registry:check` is red
    // for the same reason, and its message names the file.
    const { drift, problems, checked } = runPlan();
    expect(problems).toEqual([]);
    expect(drift).toEqual([]);
    // Not a vacuous pass: the plan really did read the lists we care about.
    for (const path of [
      'bench/src/plan.ts',
      'bench/src/types.ts',
      'example/src/App.tsx',
      'scripts/real-input/controls.mjs',
      'src/components/Host/HostChildren.ts',
      'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt',
      'ios/core/NitroUiDeclaredFallbacks.swift',
      SIZING_TABLE_FILE,
    ]) {
      expect(checked.join('\n')).toContain(path);
    }
  });

  it('a generated row edited by hand goes red, naming only that file', () => {
    const plan = readRepo('bench/src/plan.ts');
    expect(plan).toMatch(/^ {2}'date-picker',$/m);
    const changed = plan.replace(/^ {2}'date-picker',$/m, "  'datepicker',");
    const { drift, files } = runPlan(null, { 'bench/src/plan.ts': changed });
    expect(drift).toEqual(['bench/src/plan.ts']);
    // regenerating restores what the manifest says, and nothing else moves
    expect(files['bench/src/plan.ts']).toMatch(/^ {2}'date-picker',$/m);
    expect(files['bench/src/plan.ts']).not.toMatch(/'datepicker'/);
  });

  it('a manifest changed without regenerating goes red naming the list it should have changed', () => {
    // The merge scenario: take one side's manifest, forget the lists.
    const { manifests } = runPlan();
    const button = manifests.find((m) => m.name === 'Button');
    button.exampleLabel = 'Buttons';
    const { drift, files } = runPlan(manifests);
    expect(drift).toEqual(['example/src/App.tsx']);
    expect(files['example/src/App.tsx']).toMatch(/label: 'Buttons'/);
  });

  it('a row deleted from a generated list comes back, and that is the drift it reports', () => {
    // Entries keep the positions the file has, so reordering is accepted: every
    // list here is order-insensitive. A deleted row is appended again, which is
    // drift.
    const smoke = readRepo('scripts/smoke/lib.mjs');
    const lines = smoke.split('\n');
    const start = lines.findIndex((line) => line === "  'switch',");
    expect(start).toBeGreaterThan(-1);
    const withoutSwitch = lines
      .slice(0, start)
      .concat(lines.slice(start + 1))
      .join('\n');
    const { drift, files } = runPlan(null, {
      'scripts/smoke/lib.mjs': withoutSwitch,
    });
    expect(drift).toEqual(['scripts/smoke/lib.mjs']);
    const regenerated = files['scripts/smoke/lib.mjs'];
    expect(regenerated).toMatch(/^ {2}'switch',$/m);
    // the rows that were there keep their places...
    expect(
      regenerated.slice(
        regenerated.indexOf("'slider'"),
        regenerated.indexOf("'picker'")
      )
    ).toMatch(/'slider',\n {2}'button'/);
    // ...and the hand-written `host` entry outside the region is untouched
    expect(regenerated).toMatch(
      /\/\/ @end-generated\n[\s\S]*\n {2}'host',\n\]\);/
    );
  });

  it('a component added to the manifests is appended to every list it belongs to', () => {
    const { manifests } = runPlan();
    const spare = spareControl();
    const added = jsonCopy(manifests.find((m) => m.name === 'Progress'));
    Object.assign(added, {
      name: spare.name,
      hybridView: `NitroUi${spare.name}`,
      implementation: spare.implementation,
      id: spare.id,
      exampleTab: spare.id,
      exampleLabel: spare.name,
      realInput: false,
    });
    delete added.realInputTitle;
    manifests.push(added);
    const { files, problems } = runPlan(manifests);
    for (const [path, pattern] of [
      ['bench/src/types.ts', new RegExp(`\\| '${spare.id}'`)],
      ['bench/src/plan.ts', new RegExp(`'${spare.id}'`)],
      ['bench/src/implementations/index.ts', new RegExp(`'${spare.id}'`)],
      ['scripts/bench/lib.mjs', new RegExp(`'${spare.id}'`)],
      ['scripts/smoke/lib.mjs', new RegExp(`'${spare.id}'`)],
      ['scripts/smoke/App.tsx', new RegExp(`'${spare.id}'`)],
      ['example/src/App.tsx', new RegExp(`${spare.name}Screen`)],
      [
        'src/__tests__/viewConfigs.test.ts',
        new RegExp(`NitroUi${spare.name}Config`),
      ],
      [
        'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt',
        new RegExp(`HybridNitroUi${spare.name}Manager`),
      ],
      [
        'android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiDeclaredFallbacks.kt',
        new RegExp(`HybridNitroUi${spare.name}\\b`),
      ],
      [
        'ios/core/NitroUiDeclaredFallbacks.swift',
        new RegExp(`HybridNitroUi${spare.name}`),
      ],
      [
        'src/components/Host/HostChildren.ts',
        new RegExp(`\\[${spare.name}, '${spare.name}'\\]`),
      ],
      [
        SIZING_TABLE_FILE,
        new RegExp(`"HybridNitroUi${spare.name}": "fillWidth"`),
      ],
      // nitrogen reads `nitro.json` and throws for a view missing from it, so the
      // registry writes the entry.
      ['nitro.json', new RegExp(`"NitroUi${spare.name}": \\{`)],
    ]) {
      expect(files[path] ?? `MISSING ${path}`).toMatch(pattern);
    }
    expect(files['nitro.json']).toMatch(
      new RegExp(
        `"NitroUi${spare.name}": \\{\\n {6}"ios": \\{\\n {8}"language": "swift",\\n {8}"implementationClassName": "${spare.implementation}"`
      )
    );
    // A component with `realInput: false` must not gain a real-input row.
    expect(files['scripts/real-input/controls.mjs']).toBeUndefined();
    // And the checks notice the two parts a manifest cannot write on its own.
    const message = problems.join('\n');
    expect(message).toMatch(
      new RegExp(`src/index\\.ts: ${spare.name} is in the registry`)
    );
    // The tab and its row in the switch are generated; the screen behind them is not,
    // so the run refuses rather than writing an App.tsx that does not compile.
    expect(message).toMatch(
      new RegExp(
        `example/src/${spare.name}Screen\\.tsx.*does not exist.*the generator adds the tab and not the screen`
      )
    );
  });

  it('generating twice in a row changes nothing', () => {
    const first = runPlan();
    expect(first.drift).toEqual([]);
    const overlays = Object.fromEntries(
      regionsFor(first.manifests).map((spec) => [
        spec.path,
        first.files[spec.path] ?? readRepo(spec.path),
      ])
    );
    expect(runPlan(first.manifests, overlays).drift).toEqual([]);
  });
});

describe('the generated tables cover what they claim', () => {
  const { manifests } = runPlan();

  it('every real-input control has a row in the hand-written union', () => {
    // Only part of controls.mjs is generated: the hosted rows are hand-written.
    const ids = [
      ...readRepo('scripts/real-input/controls.mjs').matchAll(
        /^ {4}id: '([a-z0-9-]+)',$/gm
      ),
    ].map((m) => m[1]);
    expect(checkRealInputRows(manifests, ids)).toEqual([]);
    expect(
      checkRealInputRows(
        manifests,
        ids.filter((id) => id !== 'switch')
      ).join('\n')
    ).toMatch(/Switch.*no control row/s);
  });

  it('every tab the generated tab bar lists has a screen rendering it', () => {
    const app = readRepo('example/src/App.tsx');
    expect(checkExampleScreens(manifests, app, readRepo)).toEqual([]);
    // the tab listed and nothing behind it
    expect(
      checkExampleScreens(
        manifests,
        app.replace(
          "        {screen === 'picker' ? <PickerScreen /> : null}\n",
          ''
        ),
        readRepo
      ).join('\n')
    ).toMatch(/tab "picker".*blank body/s);
    // and the screen file itself missing, which is the state a new component is in
    // before its screen is written
    expect(
      checkExampleScreens(manifests, app, (path) =>
        path === 'example/src/PickerScreen.tsx' ? null : readRepo(path)
      ).join('\n')
    ).toMatch(/example\/src\/PickerScreen\.tsx.*does not exist/s);
  });

  it('the barrel exports every manifest, and an unmanifested export is named', () => {
    const exported = [
      ...readRepo('src/index.ts').matchAll(
        /from '\.\/components\/([A-Z]\w+)\//g
      ),
    ].map((m) => m[1]);
    expect(checkIndexExports(manifests, exported)).toEqual([]);
    // `Host` is exported with no manifest, and allowed by name. A control nobody
    // declared is not. The name must be one the tree does not use.
    expect(exported).toContain('Host');
    const spare = spareControl();
    expect(
      checkIndexExports(manifests, [...exported, spare.name]).join('\n')
    ).toMatch(new RegExp(`exports ${spare.name} and no manifest declares it`));
    expect(checkIndexExports(manifests, []).join('\n')).toMatch(
      /Button is in the registry and is not exported/
    );
  });

  it('holds a manifest with exports to each name the barrel exports', () => {
    const index = readRepo('src/index.ts');
    const exported = exportedComponents(index);
    expect(
      checkIndexExports(manifests, exported, exportedValuesByComponent(index))
    ).toEqual([]);
    // The module being exported is not enough: drop one of the two names and the
    // check names it, even though `./components/Dialog/` is still in the barrel.
    const withoutSheet = index.replace(/\n\s*ConfirmationDialog,/, '');
    expect(withoutSheet).not.toBe(index);
    expect(
      checkIndexExports(
        manifests,
        exportedComponents(withoutSheet),
        exportedValuesByComponent(withoutSheet)
      ).join('\n')
    ).toMatch(
      /ConfirmationDialog is in Dialog's exports and src\/index\.ts does not export it/
    );
    // and a type of that name does not count as the component
    const typeOnly = index.replace(
      /\n\s*ConfirmationDialog,/,
      '\n  type ConfirmationDialog,'
    );
    expect(
      checkIndexExports(
        manifests,
        exportedComponents(typeOnly),
        exportedValuesByComponent(typeOnly)
      ).join('\n')
    ).toMatch(/ConfirmationDialog is in Dialog's exports/);
  });

  it('nitro.json agrees with the manifests, and so does the sizing table', () => {
    expect(
      checkAutolinking(manifests, JSON.parse(readRepo('nitro.json')))
    ).toEqual([]);
    const missing = JSON.parse(readRepo('nitro.json'));
    delete missing.autolinking.NitroUiSwitch;
    expect(checkAutolinking(manifests, missing).join('\n')).toMatch(
      /no autolinking entry for NitroUiSwitch/
    );
    // The whole sizing table is written from the manifests, so a row with the
    // wrong policy and a row for a component that is not self-sizing are both
    // drift the plan reports.
    const table = readRepo(SIZING_TABLE_FILE);
    const wrong = runPlan(null, {
      [SIZING_TABLE_FILE]: table.replace(
        '"HybridNitroUiButton": "intrinsic"',
        '"HybridNitroUiButton": "fillWidth"'
      ),
    });
    expect(wrong.drift).toEqual([SIZING_TABLE_FILE]);
    expect(wrong.files[SIZING_TABLE_FILE]).toContain(
      '"HybridNitroUiButton": "intrinsic"'
    );
    const withHost = table.replace(
      /("(?:intrinsic|fillWidth)")\n\}\n$/,
      '$1,\n  "HybridNitroUiHost": "intrinsic"\n}\n'
    );
    expect(withHost).toContain('"HybridNitroUiHost"');
    expect(() => JSON.parse(withHost)).not.toThrow();
    const extra = runPlan(null, { [SIZING_TABLE_FILE]: withHost });
    expect(extra.drift).toEqual([SIZING_TABLE_FILE]);
    expect(extra.files[SIZING_TABLE_FILE]).not.toMatch(/HybridNitroUiHost/);
  });

  it('names an autolinking entry no manifest declares, and keeps it in the file', () => {
    // An entry that is neither a manifest's nor one of the named non-controls is
    // drift: `--write` refuses it and keeps the entry, so nobody's config is
    // silently deleted.
    const disk = JSON.parse(readRepo('nitro.json'));
    disk.autolinking.NitroUiDeleted = disk.autolinking.NitroUiSwitch;
    expect(checkAutolinking(manifests, disk, disk).join('\n')).toMatch(
      /autolinking has NitroUiDeleted and no manifest declares it/
    );
    // The named non-controls are the ones allowed to be there without one.
    for (const name of NON_CONTROL_AUTOLINKING) {
      expect(readRepo('nitro.json')).toContain(`"${name}": {`);
    }
    expect(checkAutolinking(manifests, disk).join('\n')).not.toMatch(
      /NitroUiDeleted/
    );
  });

  it('a sizing table that no longer parses is refused, not re-sorted from nothing', () => {
    // A merge conflict left in the file parses as nothing, and "nothing" plus the
    // manifests is a valid-looking table in manifest order, which a later check
    // would call clean.
    const conflicted = readRepo(SIZING_TABLE_FILE).replace(
      /^ {2}"HybridNitroUiButton.*$/m,
      (line) => `<<<<<<< HEAD\n${line}\n=======\n>>>>>>> theirs`
    );
    const { problems, files } = runPlan(null, {
      [SIZING_TABLE_FILE]: conflicted,
    });
    expect(problems.join('\n')).toMatch(
      /is not valid JSON, so its key order cannot be preserved/
    );
    // and it writes nothing for that file, so the table on disk cannot be re-ordered
    expect(files[SIZING_TABLE_FILE]).toBeUndefined();
  });

  it('a control that stops being hostable keeps its import', () => {
    // `UNHOSTABLE_CONTROLS` in HostChildren.ts names the controls a Host refuses,
    // and a row there needs its import as much as a hostable row does.
    const table = (text, name) =>
      text.slice(
        text.indexOf(`export const ${name}`),
        text.indexOf(']);', text.indexOf(`export const ${name}`))
      );
    // Both tables: a refused control is imported for its row in UNHOSTABLE_CONTROLS.
    const host = (text) =>
      table(text, 'HOSTABLE_CONTROLS') + table(text, 'UNHOSTABLE_CONTROLS');
    // One import per component directory, naming every export its manifest lists
    // (`exports`: Dialog's file exports AlertDialog and ConfirmationDialog).
    const importLines = (text) => [
      ...text.matchAll(
        /^import \{ ([A-Z][\w, ]*) \} from '\.\.\/([A-Z]\w*)\/\2';$/gm
      ),
    ];
    const imports = (text) =>
      importLines(text).flatMap((m) => m[1].split(', '));
    const importDirs = (text) => importLines(text).map((m) => m[2]);
    const rows = (text) =>
      [...host(text).matchAll(/^ {2}\[([A-Z]\w*), '[A-Z]\w*'\],$/gm)].map(
        (m) => m[1]
      );
    const before = readRepo('src/components/Host/HostChildren.ts');
    // One import per row of either table, in whatever order the two lists keep.
    expect([...imports(before)].sort()).toEqual([...rows(before)].sort());

    const flipped = repoManifests().map((m) =>
      m.name === 'Switch' ? { ...m, hostable: false } : m
    );
    const flippedRun = runPlan(flipped);
    expect(flippedRun.drift).toContain('src/components/Host/HostChildren.ts');
    const after = flippedRun.files['src/components/Host/HostChildren.ts'];
    // the row leaves HOSTABLE_CONTROLS...
    expect(
      [
        ...table(after, 'HOSTABLE_CONTROLS').matchAll(
          /^ {2}\[([A-Z]\w*), '[A-Z]\w*'\],$/gm
        ),
      ].map((m) => m[1])
    ).not.toContain('Switch');
    // ...and the import stays, because UNHOSTABLE_CONTROLS is where it goes
    expect(imports(after)).toContain('Switch');
    // and every control the library has is imported, hostable or not
    expect(importDirs(after).sort()).toEqual(
      componentDirs().filter((name) => !NON_COMPONENT_DIRS.includes(name))
    );
    // with every name its directory exports
    expect(imports(after)).toEqual(
      expect.arrayContaining(['AlertDialog', 'ConfirmationDialog'])
    );
  });

  it('the host-arm regions list the hostable *and* benched controls', () => {
    // `hostArm()` in scripts/registry-core.mjs fills the arm's `components` list
    // and `ARM_SCOPES`. An arm is only scheduled for a control it has cells to
    // render, so a hostable control with `bench: false` is not listed.
    const armIds = (text) => {
      const begin = text.indexOf('region: host-arm-components');
      expect(begin).toBeGreaterThan(-1);
      const end = text.indexOf('@end-generated', begin);
      return [
        ...text.slice(begin, end).matchAll(/^ {6}'([a-z0-9-]+)',$/gm),
      ].map((m) => m[1]);
    };
    const regions = (files) =>
      ['bench/src/implementations/index.ts', 'scripts/bench/lib.mjs'].map(
        (path) => [path, armIds(files[path] ?? readRepo(path))]
      );

    // Every hostable-and-benched control is listed.
    const shipped = runPlan();
    for (const [path, ids] of regions(shipped.files)) {
      expect([path, ids.length > 0]).toEqual([path, true]);
      expect([path, ids.includes('menu')]).toEqual([path, true]);
    }
    const hostableAndBenched = shipped.manifests
      .filter((m) => m.hostable && m.bench)
      .map((m) => m.id)
      .sort();
    for (const [path, ids] of regions(shipped.files)) {
      expect([path, [...ids].sort()]).toEqual([path, hostableAndBenched]);
    }

    // Flip a hostable control's `bench` off and its row leaves both regions,
    // while `HostChildren.ts` keeps it.
    const { manifests } = shipped;
    const flipped = manifests.map((m) =>
      m.name === 'Switch' ? { ...m, bench: false } : m
    );
    const after = runPlan(flipped);
    for (const [path, ids] of regions(after.files)) {
      expect([path, ids.includes('switch')]).toEqual([path, false]);
    }
    const menuless = manifests.map((m) =>
      m.name === 'Menu' ? { ...m, bench: false } : m
    );
    const withoutMenu = runPlan(menuless);
    for (const [path, ids] of regions(withoutMenu.files)) {
      expect([path, ids.includes('menu')]).toEqual([path, false]);
    }
    const host =
      after.files['src/components/Host/HostChildren.ts'] ??
      readRepo('src/components/Host/HostChildren.ts');
    expect(host).toContain("[Switch, 'Switch']");
  });

  it('an entry already in a shipped region is copied, not re-rendered', () => {
    // `nitro.json` accepts two spellings of an entry (a per-platform pair or a
    // shared `all` entry, both of which nitrogen emits), so a shipped entry can
    // be correct and still not be what `render` would produce. Copying keeps the
    // published bytes still.
    const spec = regionsFor(repoManifests()).find(
      (region) => region.path === 'nitro.json'
    );
    const allShape = readRepo('nitro.json').replace(
      [
        '    "NitroUiSwitch": {',
        '      "ios": {',
        '        "language": "swift",',
        '        "implementationClassName": "HybridNitroUiSwitch"',
        '      },',
        '      "android": {',
        '        "language": "kotlin",',
        '        "implementationClassName": "HybridNitroUiSwitch"',
        '      }',
        '    },',
      ].join('\n'),
      [
        '    "NitroUiSwitch": {',
        '      "all": {',
        '        "language": "kotlin",',
        '        "iosLanguage": "swift",',
        '        "implementationClassName": "HybridNitroUiSwitch"',
        '      }',
        '    },',
      ].join('\n')
    );
    expect(allShape).not.toBe(readRepo('nitro.json'));
    // valid as far as the check is concerned, and different from the render
    const manifests = repoManifests();
    expect(checkAutolinking(manifests, JSON.parse(allShape))).toEqual([]);
    const result = replaceRegion(allShape, spec);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(allShape);
    // `render` does produce the other shape, so the copy is not a no-op.
    expect(
      spec.render(manifests.find((m) => m.id === 'switch')).join('\n')
    ).not.toContain('"iosLanguage"');
  });

  it('an autolinking entry the registry does not own keeps its bytes and its place', () => {
    // `NitroUiCore` and `NitroUiHost` are autolinked but are not controls, and
    // their entries are hand-written config that no manifest could render.
    const spec = regionsFor(repoManifests()).find(
      (region) => region.path === 'nitro.json'
    );
    const result = replaceRegion(readRepo('nitro.json'), spec);
    expect(result.changed).toBe(false);
    const kept = readRepo('nitro.json')
      .split('\n')
      .findIndex((line) => line === '    "NitroUiCore": {');
    expect(kept).toBeGreaterThan(-1);
    // still exactly where it was, and still the `all` shape nitrogen reads
    expect(readRepo('nitro.json')).toMatch(
      /"NitroUiCore": \{\n {6}"all": \{\n {8}"language": "c\+\+",/
    );
  });

  it('accepts either shape nitrogen reads for an autolinking entry', () => {
    // Per-platform entries and a shared `all` entry state their languages
    // differently: `all` uses `language` for the primary platform and
    // `iosLanguage` for iOS.
    const one = (entry) => ({
      autolinking: {
        NitroUiButton: entry,
        NitroUiCore: {},
        NitroUiHost: {},
      },
    });
    const only = (entry) =>
      checkAutolinking(
        manifests.filter((m) => m.name === 'Button'),
        one(entry)
      ).join('\n');
    expect(
      only({
        ios: {
          language: 'swift',
          implementationClassName: 'HybridNitroUiButton',
        },
        android: {
          language: 'kotlin',
          implementationClassName: 'HybridNitroUiButton',
        },
      })
    ).toBe('');
    expect(
      only({
        all: {
          language: 'kotlin',
          iosLanguage: 'swift',
          implementationClassName: 'HybridNitroUiButton',
        },
      })
    ).toBe('');
    // and it still catches a real language mistake
    expect(
      only({
        all: {
          language: 'kotlin',
          implementationClassName: 'HybridNitroUiButton',
        },
      })
    ).toMatch(/NitroUiButton.ios claims language "kotlin"/);
    expect(
      only({
        ios: {
          language: 'kotlin',
          implementationClassName: 'HybridNitroUiButton',
        },
        android: {
          language: 'kotlin',
          implementationClassName: 'HybridNitroUiButton',
        },
      })
    ).toMatch(/NitroUiButton.ios claims language "kotlin"/);
    expect(
      only({
        all: {
          language: 'kotlin',
          iosLanguage: 'swift',
          implementationClassName: 'HybridNitroUiBtn',
        },
      })
    ).toMatch(/implementationClassName is "HybridNitroUiBtn"/);
  });
});

/** The scratch tree of `gen-registry on a scratch tree`, rebuilt for this suite. */
function scratchTreeOf() {
  const dir = mkdtempSync(join(tmpdir(), 'nitro-ui-registry-sub-'));
  const paths = new Set([
    'package.json',
    'nitro.json',
    'src/index.ts',
    SIZING_TABLE_FILE,
    ...regionsFor(repoManifests()).map((spec) => spec.path),
    ...repoManifests().map((m) => `example/src/${m.name}Screen.tsx`),
  ]);
  for (const path of paths) {
    const text = readRepo(path);
    if (text == null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  for (const directory of componentDirs()) {
    const path = `src/components/${directory}/${MANIFEST_BASENAME}`;
    if (readRepo(path) == null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    copyFileSync(join(repoRoot, path), join(dir, path));
  }
  return dir;
}

/** A manifest with nothing in common with a shipped one, under an invented name. */
function spareComponent(name) {
  return {
    ...buttonManifest(),
    name,
    id: name.toLowerCase(),
    exampleTab: name.toLowerCase(),
    exampleLabel: name,
    hybridView: `NitroUi${name}`,
    implementation: `HybridNitroUi${name}`,
  };
}

/** `scripts/gen-registry.mjs` in a scratch directory. */
function runIn(dir, ...args) {
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'gen-registry.mjs'), ...args],
    { cwd: dir, encoding: 'utf8', env: childEnv() }
  );
}

describe('a component with sub-views (subViews, G24)', () => {
  const form = () => repoManifests().find((m) => m.name === 'Form');
  const packageText = () =>
    readRepo(
      'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt'
    );
  const nitro = () => JSON.parse(readRepo('nitro.json'));

  it('derives the names, and keeps the parent module as the directory', () => {
    const subs = subViewsOf(form());
    expect(subs.map((s) => s.name)).toEqual(['FormSection', 'FormRow']);
    // A sub-view has no directory of its own: pointing its generated import at
    // `components/FormSection/` would name a folder that does not exist.
    for (const sub of subs) {
      expect(sub.directory).toBe('Form');
      expect(sub.parent).toBe('Form');
      expect(sub.hybridView).toBe(`NitroUi${sub.name}`);
      expect(sub.implementation).toBe(`HybridNitroUi${sub.name}`);
      expect(sub.androidViewManager).toBe(`NitroUi${sub.name}ViewManager`);
    }
    // Each follows its own parent, so a regenerated nitro.json groups one component's
    // views together rather than scattering them alphabetically.
    const names = withSubViews(repoManifests()).map((m) => m.name);
    expect(
      names.slice(names.indexOf('Form'), names.indexOf('Form') + 3)
    ).toEqual(['Form', 'FormSection', 'FormRow']);
  });

  it('autolinks every sub-view, and reports one whose entry is missing', () => {
    const { problems } = runPlan();
    expect(problems).toEqual([]);
    for (const sub of subViewsOf(form())) {
      const entry = nitro().autolinking[sub.hybridView];
      expect(entry).toBeDefined();
      expect(entry.ios.implementationClassName).toBe(sub.implementation);
      expect(entry.android.implementationClassName).toBe(sub.implementation);
    }
    const missing = jsonCopy(nitro());
    delete missing.autolinking.NitroUiFormRow;
    expect(checkAutolinking([form()], missing)).toEqual([
      expect.stringContaining(
        'no autolinking entry for NitroUiFormRow (FormRow)'
      ),
    ]);
  });

  it('registers a sub-view manager on Android, and reports one that is not', () => {
    expect(checkAndroidViewManagers([form()], packageText())).toEqual([]);
    expect(
      checkAndroidViewManagers(
        [form()],
        packageText().replace('    NitroUiFormRowViewManager(),\n', '')
      )
    ).toEqual([
      expect.stringContaining(
        'FormRow names androidViewManager NitroUiFormRowViewManager and createViewManagers does not register it'
      ),
    ]);
    expect(
      checkAndroidViewManagers(
        [form()],
        packageText().replace(
          '    NitroUiFormRowViewManager(),',
          '    NitroUiFormRowViewManager(),\n    HybridNitroUiFormRowManager(),'
        )
      )
    ).toEqual([
      expect.stringContaining(
        'FormRow registers the generated HybridNitroUiFormRowManager as well'
      ),
    ]);
  });

  it('is not a component: no Host row, no bench arm, no barrel export', () => {
    const { files } = runPlan();
    const host =
      files['src/components/Host/HostChildren.ts'] ??
      readRepo('src/components/Host/HostChildren.ts');
    expect(host).not.toContain("[FormSection, 'FormSection']");
    expect(host).not.toContain('FormRow');
    const index = files['src/index.ts'] ?? readRepo('src/index.ts');
    expect(index).not.toContain('FormSection,');
    const plan =
      files['bench/src/implementations/index.ts'] ??
      readRepo('bench/src/implementations/index.ts');
    expect(plan).not.toContain("'form-section'");
  });

  it('refuses a sub-view that claims a name another component has', () => {
    // Nothing reads two `HybridNitroUiFormButton` classes and complains, which is why the
    // collision is checked against the *derived* names rather than the chosen ones.
    const entries = componentDirs()
      .map((directory) => ({
        directory,
        text:
          directory === 'Form'
            ? JSON.stringify({
                ...JSON.parse(readRepo('src/components/Form/component.json')),
                subViews: ['Section'],
              })
            : readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`),
      }))
      .filter((entry) => entry.text != null);
    // A control that happens to be called what `Form`'s sub-view derives to.
    entries.push({
      directory: 'FormSection',
      text: JSON.stringify({
        ...spareComponent('FormSection'),
        subViews: undefined,
      }),
    });
    expect(() => manifestsFromEntries(entries)).toThrow(
      /the Form sub-view FormSection cannot both claim it/
    );
  });

  it('writes a sub-view into nitro.json and both view-config regions', () => {
    // nitrogen throws for a Hybrid View with no autolinking entry, so a component that
    // declares sub-views only builds once `--write` has put one in for each of them.
    const dir = scratchTreeOf();
    const spare = spareComponent('Subviewy');
    try {
      mkdirSync(join(dir, 'src/components/Subviewy'), { recursive: true });
      writeFileSync(
        join(dir, 'example/src/SubviewyScreen.tsx'),
        'export default function SubviewyScreen() {\n  return null\n}\n'
      );
      writeFileSync(
        join(dir, 'src/index.ts'),
        `${readFileSync(join(dir, 'src/index.ts'), 'utf8')}\nexport { Subviewy } from './components/Subviewy/Subviewy';\n`
      );
      writeFileSync(
        join(dir, `src/components/Subviewy/${MANIFEST_BASENAME}`),
        JSON.stringify({ ...spare, subViews: ['Panel'] }, null, 2) + '\n'
      );
      // The behaviour the generator still refuses to write for you: the sub-view's own
      // Android manager, which nothing but a hand-written row can register.
      const missing = runIn(dir, '--write');
      expect(missing.stderr).toMatch(
        /SubviewyPanel names androidViewManager NitroUiSubviewyPanelViewManager and createViewManagers does not register it/
      );
      const pkg =
        'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt';
      writeFileSync(
        join(dir, pkg),
        readFileSync(join(dir, pkg), 'utf8').replace(
          '    NitroUiFormViewManager(),',
          '    NitroUiFormViewManager(),\n    NitroUiSubviewyPanelViewManager(),'
        )
      );

      const written = runIn(dir, '--write');
      expect(written.stderr).toBe('');
      const nitro = JSON.parse(readFileSync(join(dir, 'nitro.json'), 'utf8'));
      expect(Object.keys(nitro.autolinking)).toContain('NitroUiSubviewyPanel');
      expect(nitro.autolinking.NitroUiSubviewyPanel.ios).toMatchObject({
        implementationClassName: 'HybridNitroUiSubviewyPanel',
      });
      const configs = readFileSync(
        join(dir, 'src/__tests__/viewConfigs.test.ts'),
        'utf8'
      );
      // The import points at the *parent's* directory, which is where the file is.
      expect(configs).toContain(
        "import { NitroUiSubviewyPanelConfig } from '../components/Subviewy/NitroUiSubviewyPanelConfig';"
      );
      expect(configs).toContain(
        "  'NitroUiSubviewyPanelConfig.json': NitroUiSubviewyPanelConfig,"
      );
      expect(runIn(dir, '--check').stdout).toMatch(/OK/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('gen-registry on a scratch tree', () => {
  /** A scratch directory holding every file the registry reads or writes. */
  function scratchTree() {
    const dir = mkdtempSync(join(tmpdir(), 'nitro-ui-registry-'));
    const paths = new Set([
      'package.json',
      'nitro.json',
      'src/index.ts',
      SIZING_TABLE_FILE,
      ...regionsFor(repoManifests()).map((spec) => spec.path),
      // the registry reads these too, to prove a tab has a screen behind it
      ...repoManifests().map((m) => `example/src/${m.name}Screen.tsx`),
    ]);
    for (const path of paths) {
      const text = readRepo(path);
      if (text == null) continue;
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    for (const directory of componentDirs()) {
      const path = `src/components/${directory}/${MANIFEST_BASENAME}`;
      if (readRepo(path) == null) continue;
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      copyFileSync(join(repoRoot, path), join(dir, path));
    }
    return dir;
  }

  function run(dir, ...args) {
    return spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts', 'gen-registry.mjs'), ...args],
      { cwd: dir, encoding: 'utf8', env: childEnv() }
    );
  }

  it('the check script is wired into `bun run check`', () => {
    const scripts = JSON.parse(readRepo('package.json')).scripts;
    expect(scripts.registry).toContain('gen-registry.mjs --write');
    expect(scripts['registry:check']).toContain('gen-registry.mjs --check');
    expect(scripts.regen).toContain('bun run registry');
    // X10 made `check` a runner over a step graph, so the chain to assert against
    // is `check:serial` - the steps the runner is required to be equal to
    // (scripts/__tests__/check-runner.test.js is what holds that together).
    expect(scripts['check:serial']).toMatch(/bun run registry:check/);
    expect(scripts.check).toContain('scripts/check.mjs');
  });

  it('--check passes on an untouched tree and --write there changes nothing', () => {
    const dir = scratchTree();
    try {
      const before = run(dir, '--check');
      expect(before.stderr).toBe('');
      expect(before.stdout).toMatch(/OK/);
      const write = run(dir, '--write');
      expect(write.stderr).toBe('');
      expect(write.stdout).not.toMatch(/wrote /);
      expect(run(dir, '--check').stdout).toMatch(/OK/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check fails when a generated row is edited by hand, naming file and line', () => {
    const dir = scratchTree();
    try {
      const path = 'scripts/smoke/App.tsx';
      const text = readFileSync(join(dir, path), 'utf8');
      expect(text).toMatch(/^ {2}'switch',$/m);
      writeFileSync(
        join(dir, path),
        text.replace(/^ {2}'switch',$/m, "  'switchy',")
      );
      const result = run(dir, '--check');
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/registry:check/);
      expect(result.stderr).toMatch(/scripts\/smoke\/App\.tsx/);
      expect(result.stderr).toMatch(/switchy/);
      expect(result.stderr).toMatch(/bun run registry/);
      // and `--write` is the fix
      expect(run(dir, '--write').stderr).toBe('');
      expect(run(dir, '--check').status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check fails when a manifest is edited without regenerating', () => {
    const dir = scratchTree();
    try {
      const manifest = `src/components/Button/${MANIFEST_BASENAME}`;
      writeFileSync(
        join(dir, manifest),
        readFileSync(join(dir, manifest), 'utf8').replace(
          '"exampleLabel": "Button"',
          '"exampleLabel": "Buttons"'
        )
      );
      const result = run(dir, '--check');
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/example\/src\/App\.tsx/);
      expect(result.stderr).toMatch(/Buttons/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check fails on a malformed manifest and says which file', () => {
    const dir = scratchTree();
    try {
      writeFileSync(
        join(dir, `src/components/Button/${MANIFEST_BASENAME}`),
        JSON.stringify({ name: 'Button', nope: true }, null, 2)
      );
      const result = run(dir, '--check');
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/src\/components\/Button\/component\.json/);
      expect(result.stderr).toMatch(/unknown key "nope"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check fails when a manifest and a file it describes disagree', () => {
    const dir = scratchTree();
    try {
      const manifest = `src/components/Button/${MANIFEST_BASENAME}`;
      writeFileSync(
        join(dir, manifest),
        readFileSync(join(dir, manifest), 'utf8').replace(
          '"hybridView": "NitroUiButton"',
          '"hybridView": "NitroUiBtn"'
        )
      );
      const result = run(dir, '--check');
      expect(result.status).toBe(1);
      // caught by the derived-name rule, and again by the autolinking cross-check
      expect(result.stderr).toMatch(/nitro\.json|is not NitroUiButton/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--write completes for a component that has no entry in nitro.json yet', () => {
    // nitrogen reads `nitro.json` and throws for a view missing from it, so
    // `--write` is what adds the entry. The autolinking check therefore runs on
    // the text the generator produces, not on the file.
    const dir = scratchTree();
    const spare = spareControl();
    try {
      const added = jsonCopy(
        JSON.parse(
          readFileSync(
            join(dir, `src/components/Button/${MANIFEST_BASENAME}`),
            'utf8'
          )
        )
      );
      Object.assign(added, {
        name: spare.name,
        hybridView: `NitroUi${spare.name}`,
        implementation: spare.implementation,
        id: spare.id,
        exampleTab: spare.id,
        exampleLabel: spare.name,
        realInput: false,
      });
      delete added.realInputTitle;
      mkdirSync(join(dir, `src/components/${spare.name}`), { recursive: true });
      writeFileSync(
        join(dir, `src/components/${spare.name}/${MANIFEST_BASENAME}`),
        JSON.stringify(added, null, 2) + '\n'
      );
      // the screen and the export are behaviour, so they are the two things this run
      // cannot write for you - it refuses rather than half-writing
      const missing = run(dir, '--write');
      expect(missing.stderr).toMatch(
        new RegExp(`${spare.name}Screen\\.tsx.*does not exist`)
      );
      expect(missing.stderr).toMatch(
        new RegExp(`src/index\\.ts: ${spare.name} is in the registry`)
      );

      writeFileSync(
        join(dir, `example/src/${spare.name}Screen.tsx`),
        `export default function ${spare.name}Screen() {\n  return null\n}\n`
      );
      writeFileSync(
        join(dir, 'src/index.ts'),
        readFileSync(join(dir, 'src/index.ts'), 'utf8') +
          `\nexport { ${spare.name} } from './components/${spare.name}/${spare.name}';\n`
      );
      const written = run(dir, '--write');
      expect(written.stderr).toBe('');
      const nitro = JSON.parse(readFileSync(join(dir, 'nitro.json'), 'utf8'));
      expect(Object.keys(nitro.autolinking)).toContain(`NitroUi${spare.name}`);
      expect(written.stdout).toMatch(/wrote nitro\.json/);
      // and nitrogen now has what it needs: an entry naming the implementation class
      expect(
        nitro.autolinking[`NitroUi${spare.name}`].ios.implementationClassName
      ).toBe(spare.implementation);
      expect(run(dir, '--check').stdout).toMatch(/OK/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the anchored regions in shipped files are byte-identical to what was there', () => {
    // `etc/package-files.txt` says these files ship, so a marker comment in one
    // of them would change the published artifact.
    const dir = scratchTree();
    try {
      const shipped = [
        ...new Set(
          regionsFor(repoManifests())
            .filter((spec) => spec.shipped)
            .map((spec) => spec.path)
        ),
      ];
      expect(shipped.length).toBeGreaterThan(0);
      expect(run(dir, '--write').stderr).toBe('');
      const listed = readRepo('etc/package-files.txt').split('\n');
      for (const path of shipped) {
        expect(readFileSync(join(dir, path), 'utf8')).toBe(readRepo(path));
        // and it really is a file the package ships
        expect(listed).toContain(path);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the unshipped regions all carry markers, so a merge can take either side', () => {
    const specs = regionsFor(repoManifests()).filter((spec) => !spec.shipped);
    expect(specs.length).toBeGreaterThan(10);
    for (const spec of specs) {
      const text = readRepo(spec.path);
      expect(text ?? `MISSING ${spec.path}`).toContain(spec.begin);
      expect(text).toContain(spec.end);
    }
  });
});

describe('a hand-written Android view manager (androidViewManager, G14)', () => {
  const sheet = () =>
    repoManifests().find((manifest) => manifest.name === 'BottomSheet');
  const packageText = () =>
    readRepo(
      'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt'
    );

  it('keeps the generated manager out of NitroUiPackage for a control that names its own', () => {
    const { problems, files } = runPlan();
    expect(problems).toEqual([]);
    const written =
      files[
        'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt'
      ] ?? packageText();
    expect(written).not.toContain('HybridNitroUiBottomSheetManager()');
    expect(written).toContain('NitroUiBottomSheetViewManager(),');
  });

  it('reports a manifest whose hand-written manager is not registered', () => {
    const text = packageText().replace(
      '    NitroUiBottomSheetViewManager(),\n',
      ''
    );
    expect(checkAndroidViewManagers([sheet()], text)).toEqual([
      expect.stringContaining(
        'names androidViewManager NitroUiBottomSheetViewManager and createViewManagers does not register it'
      ),
    ]);
  });

  it('reports the generated manager registered as well', () => {
    const text = packageText().replace(
      '    NitroUiBottomSheetViewManager(),',
      '    NitroUiBottomSheetViewManager(),\n    HybridNitroUiBottomSheetManager(),'
    );
    expect(checkAndroidViewManagers([sheet()], text)).toEqual([
      expect.stringContaining(
        'registers the generated HybridNitroUiBottomSheetManager as well'
      ),
    ]);
  });

  it('rejects a manager name that is not a view manager', () => {
    const manifest = { ...jsonCopy(sheet()), androidViewManager: 'SheetThing' };
    expect(
      validateManifest(manifest, 'BottomSheet', 'component.json').join('\n')
    ).toContain('androidViewManager');
  });
});
