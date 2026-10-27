// Tests for the component registry (X3): the manifest schema, what the generator
// writes, the cross-checks over files it does not own, and the drift gate itself.
//
// The interesting property is "a hand-edited list, or a manifest edited without
// `bun run registry`, goes red naming the file". The drift tests work against the
// real tree: the plan runs over the files as they are checked out, with a text overlay
// for the one input under test. No fixture copies to fall out of step. The CLI tests
// run the real `scripts/gen-registry.mjs` in a scratch directory holding copies, so
// they cannot disturb the checkout either.

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
  SIZING_TABLE_FILE,
  checkAutolinking,
  checkExampleScreens,
  checkIndexExports,
  checkRealInputRows,
  checkSizingTable,
  manifestsFromEntries,
  planRegistry,
  regionsFor,
  validateManifest,
} from '../registry-core.mjs';

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

const COMPONENT_DIRS = [
  'Button',
  'DatePicker',
  'Host',
  'Picker',
  'Progress',
  'SegmentedControl',
  'Slider',
  'Switch',
];

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
    // A manifest cannot quietly claim something nothing reads: an unknown key is
    // usually a typo for a real one, which would silently do nothing.
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

  it('rejects two manifests claiming one id or tab', () => {
    // `name`, `hybridView` and `implementation` are derived from the directory, so two
    // components can only collide on `id` or `exampleTab` - and a manifest that tried
    // to reuse a name is caught earlier, by the name-vs-directory rule.
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

  it('has a manifest for every component directory except the container', () => {
    // The registry only knows what has a manifest, so a component directory without
    // one would be invisible to every list while still existing on disk. `<Host>` is
    // the deliberate exception - a container, not a control - and it is named in
    // NON_COMPONENT_EXPORTS and NON_CONTROL_AUTOLINKING rather than skipped by a rule.
    const withManifest = componentDirs().filter(
      (directory) =>
        readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`) != null
    );
    expect(withManifest.sort()).toEqual(
      COMPONENT_DIRS.filter((name) => name !== 'Host')
    );
    expect(componentDirs()).toEqual(COMPONENT_DIRS);
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
    // The review scenario: someone edits one generated line and does not re-run the
    // generator. Nothing else catches it - the file still parses, every neighbouring
    // line is untouched, and the value it now carries is in no manifest.
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
    // Entries keep the positions the file has (that is what makes a merge cheap:
    // whichever side wins a conflict, the rows that survive stay put), so reordering is
    // accepted by design - every list here is order-insensitive. Deleting a row is not:
    // the generator appends what its manifest asks for, so the file drifts.
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
    // Adding a component is the operation the manifest exists for, so nothing inside a
    // generated region may need hand-editing to make it happen.
    const { manifests } = runPlan();
    const gauge = jsonCopy(manifests.find((m) => m.name === 'Progress'));
    Object.assign(gauge, {
      name: 'Gauge',
      hybridView: 'NitroUiGauge',
      implementation: 'HybridNitroUiGauge',
      id: 'gauge',
      exampleTab: 'gauge',
      exampleLabel: 'Gauge',
      realInput: false,
    });
    delete gauge.realInputTitle;
    manifests.push(gauge);
    const { files, problems } = runPlan(manifests);
    for (const [path, pattern] of [
      ['bench/src/types.ts', /\| 'gauge'/],
      ['bench/src/plan.ts', /'gauge'/],
      ['bench/src/implementations/index.ts', /'gauge'/],
      ['scripts/bench/lib.mjs', /'gauge'/],
      ['scripts/smoke/lib.mjs', /'gauge'/],
      ['scripts/smoke/App.tsx', /'gauge'/],
      ['example/src/App.tsx', /GaugeScreen/],
      ['src/__tests__/viewConfigs.test.ts', /NitroUiGaugeConfig/],
      [
        'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt',
        /HybridNitroUiGaugeManager/,
      ],
      [
        'android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiDeclaredFallbacks.kt',
        /HybridNitroUiGauge\b/,
      ],
      ['ios/core/NitroUiDeclaredFallbacks.swift', /HybridNitroUiGauge/],
      ['src/components/Host/HostChildren.ts', /\[Gauge, 'Gauge'\]/],
      [SIZING_TABLE_FILE, /"HybridNitroUiGauge": "fillWidth"/],
    ]) {
      expect(files[path] ?? `MISSING ${path}`).toMatch(pattern);
    }
    // A component with `realInput: false` must not gain a real-input row.
    expect(files['scripts/real-input/controls.mjs']).toBeUndefined();
    // And the checks notice the parts a manifest cannot write on its own.
    const message = problems.join('\n');
    expect(message).toMatch(/no autolinking entry for NitroUiGauge/);
    expect(message).toMatch(/src\/index\.ts: Gauge is in the registry/);
    // The tab and its row in the switch are generated; the screen behind them is not,
    // so the run refuses rather than writing an App.tsx that does not compile.
    expect(message).toMatch(
      /example\/src\/GaugeScreen\.tsx.*does not exist.*the generator adds the tab and not the screen/s
    );
  });

  it('generating twice in a row changes nothing', () => {
    // Otherwise `bun run registry` would dirty the tree on every run, and a gate that
    // is always red proves nothing.
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
    // Only part of controls.mjs is generated (the hosted rows are hand-written), so a
    // dropped row is coverage the generator must report rather than paper over.
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
    // `Host` is exported with no manifest, and allowed by name; a control nobody
    // declared is not, which is what makes "add a component, forget the manifest" red.
    expect(exported).toContain('Host');
    expect(
      checkIndexExports(manifests, [...exported, 'Gauge']).join('\n')
    ).toMatch(/exports Gauge and no manifest declares it/);
    expect(checkIndexExports(manifests, []).join('\n')).toMatch(
      /Button is in the registry and is not exported/
    );
  });

  it('nitro.json and the sizing table agree with the manifests', () => {
    expect(
      checkAutolinking(manifests, JSON.parse(readRepo('nitro.json')))
    ).toEqual([]);
    expect(
      checkSizingTable(manifests, JSON.parse(readRepo(SIZING_TABLE_FILE)))
    ).toEqual([]);
    const missing = JSON.parse(readRepo('nitro.json'));
    delete missing.autolinking.NitroUiSwitch;
    expect(checkAutolinking(manifests, missing).join('\n')).toMatch(
      /no autolinking entry for NitroUiSwitch/
    );
    expect(
      checkSizingTable(manifests, {
        HybridNitroUiSwitch: 'intrinsic',
      }).join('\n')
    ).toMatch(/no entry for HybridNitroUiButton/);
    // A row for something the registry does not list as self-sizing is the other half.
    expect(
      checkSizingTable(manifests, {
        ...JSON.parse(readRepo(SIZING_TABLE_FILE)),
        HybridNitroUiHost: 'intrinsic',
      }).join('\n')
    ).toMatch(/HybridNitroUiHost is not a self-sizing component/);
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
      { cwd: dir, encoding: 'utf8' }
    );
  }

  it('the check script is wired into `bun run check`', () => {
    const scripts = JSON.parse(readRepo('package.json')).scripts;
    expect(scripts.registry).toContain('gen-registry.mjs --write');
    expect(scripts['registry:check']).toContain('gen-registry.mjs --check');
    expect(scripts.regen).toContain('bun run registry');
    expect(scripts.check).toMatch(/bun run registry:check/);
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

  it('the anchored regions in shipped files are byte-identical to what was there', () => {
    // `etc/package-files.txt` says these files ship, so a marker comment in one of
    // them would be a change to the published artifact. Running --write over a fresh
    // copy and diffing every shipped path is the whole proof.
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
