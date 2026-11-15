/**
 * The component registry: the rules that turn each `src/components/<Name>/component.json`
 * into the repo's per-component lists. Pure, so tests run it against fixtures.
 */

/** Where a manifest lives, relative to a component's directory. */
export const MANIFEST_BASENAME = 'component.json';

/** The header every generated marker carries. */
export const GENERATOR_NAME = 'scripts/gen-registry.mjs';

/** The sizing policy table, consumed by scripts/patch-nitrogen.mjs. Shipped. */
export const SIZING_TABLE_FILE = 'nitro-ui.sizing.json';

/** The prefix `scripts/patch-nitrogen.mjs` puts on a sizing key. */
export const HYBRID_PREFIX = 'Hybrid';

/** The manifest schema, as data. Unknown keys and missing required keys are errors. */
export const MANIFEST_SCHEMA = {
  name: {
    type: 'string',
    pattern: /^[A-Z][A-Za-z0-9]*$/,
    readBy:
      'the component directory, the example screen file, the Host table, the manager and fallback class names',
  },
  hybridView: {
    type: 'string',
    pattern: /^NitroUi[A-Z][A-Za-z0-9]*$/,
    readBy:
      'the NitroUi<Name>Config.json key in viewConfigs.test.ts, and the autolinking key this writes into nitro.json',
  },
  implementation: {
    type: 'string',
    pattern: /^HybridNitroUi[A-Z][A-Za-z0-9]*$/,
    readBy:
      'the Android view-manager class, and the implementationClassName this writes into nitro.json',
  },
  id: {
    type: 'string',
    pattern: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    readBy:
      'the bench component name, the smoke control name, the real-input id',
  },
  /**
   * `null` means the component is not self-sizing: it gets no row in
   * `nitro-ui.sizing.json` and no declared fallback.
   */
  sizing: {
    type: 'string',
    enum: ['intrinsic', 'fillWidth'],
    nullable: true,
    readBy:
      'nitro-ui.sizing.json, which is what makes the two NitroUiDeclaredFallbacks tables',
  },
  hostable: {
    type: 'boolean',
    readBy:
      'HOSTABLE_CONTROLS in HostChildren.ts, and - paired with `bench` - the two ' +
      'host-arm-components lists, because an arm is only scoped for a control it has cells for',
  },
  exampleTab: {
    type: 'string',
    pattern: /^[a-z][a-z0-9]*$/,
    readBy: "the example app's Screen union, TABS entry and screen switch",
  },
  // Rendered into a single-quoted JS literal, so it may hold no quote or line break.
  exampleLabel: {
    type: 'string',
    quoteSafe: true,
    readBy:
      'the example tab-bar label (the bar scrolls, so a label sets its tab\'s width; keep it one short word: "Segments", "Dates")',
  },
  bench: {
    type: 'boolean',
    readBy: 'bench ComponentName, ScenarioName and SUFFIXED_COMPONENTS',
  },
  benchUnsuffixed: {
    type: 'boolean',
    readBy:
      'the one bench component whose scenario cells keep the bare action names (`mount`, not `mount.switch`) - bench/src/plan.ts',
  },
  smoke: {
    type: 'boolean',
    readBy: 'SMOKE_CONTROLS in scripts/smoke/lib.mjs and its copy in App.tsx',
  },
  realInput: {
    type: 'boolean',
    readBy: 'the row generated into scripts/real-input/controls.mjs',
  },
  // Optional, but required when `realInput` is true.
  realInputTitle: {
    type: 'string',
    optional: true,
    quoteSafe: true,
    readBy:
      "the title of that row when the generator adds it: what the control's check proves, on both platforms",
  },
  /**
   * The hand-written Android view manager registered instead of nitrogen's generated one.
   * Needed when React Native mounts the view's children: the generated manager is a
   * `SimpleViewManager`, which cannot take child views.
   */
  androidViewManager: {
    type: 'string',
    pattern: /^NitroUi[A-Z][A-Za-z0-9]*ViewManager$/,
    optional: true,
    readBy:
      "NitroUiPackage.kt's createViewManagers: the class registered in place of the generated manager",
  },
  /**
   * The public component names the wrapper module exports, when one native view backs
   * several components. Absent means just `name`.
   */
  exports: {
    type: 'array',
    items: /^[A-Z][A-Za-z0-9]*$/,
    optional: true,
    readBy:
      "HOSTABLE_CONTROLS rows and the Host's import in HostChildren.ts, and the barrel check of src/index.ts - one per public name",
  },

  /**
   * The Hybrid Views a component owns that are not controls: a container's sub-views, such
   * as `Form.Section`. Each gets a `nitro.json` entry and an Android view manager, and
   * nothing else. Its names are derived: `Form` + `"Section"` is `FormSection`,
   * `NitroUiFormSection`, `HybridNitroUiFormSection`, `NitroUiFormSectionViewManager`.
   */
  subViews: {
    type: 'array',
    items: /^[A-Z][A-Za-z0-9]*$/,
    optional: true,
    readBy:
      'the nitro.json autolinking entry and the Android manager of each sub-view Hybrid View, ' +
      'and the cross-check that no sub-view name collides with a component name',
  },
};

/**
 * The public component names a manifest's wrapper module exports: its `exports`,
 * or just its `name`.
 *
 * @param {any} manifest a validated manifest
 * @returns {string[]}
 */
export function exportsOf(manifest) {
  return Array.isArray(manifest.exports) ? manifest.exports : [manifest.name];
}

/**
 * The sub-views of a manifest, as manifest-shaped entries with derived names.
 *
 * @param {any} manifest a validated manifest
 * @returns {any[]} one entry per declared sub-view, in declaration order
 */
export function subViewsOf(manifest) {
  if (!Array.isArray(manifest.subViews)) return [];
  return manifest.subViews.map((sub) => {
    const name = `${manifest.name}${sub}`;
    return {
      name,
      parent: manifest.name,
      // A sub-view has no directory of its own: its module lives beside its parent's.
      directory: manifest.directory ?? manifest.name,
      hybridView: `NitroUi${name}`,
      implementation: `HybridNitroUi${name}`,
      androidViewManager: `NitroUi${name}ViewManager`,
      subView: true,
    };
  });
}

/**
 * Every manifest followed by its own sub-views, so a component's views stay grouped.
 *
 * @param {any[]} manifests validated manifests
 * @returns {any[]}
 */
export function withSubViews(manifests) {
  return manifests.flatMap((manifest) => [manifest, ...subViewsOf(manifest)]);
}

/** Every key a manifest may carry; anything else is an unknown key. */
export const MANIFEST_FIELDS = Object.keys(MANIFEST_SCHEMA);

/**
 * Validate one parsed manifest.
 *
 * @param {any} parsed the contents of a `component.json`
 * @param {string} directoryName the component's directory
 * @param {string} where the file name, for messages
 * @returns {string[]} problems; empty when the manifest is valid
 */
export function validateManifest(parsed, directoryName, where) {
  const problems = [];
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [`${where}: not a JSON object`];
  }
  for (const key of Object.keys(parsed)) {
    if (!MANIFEST_FIELDS.includes(key)) {
      problems.push(
        `${where}: unknown key "${key}" - the schema is ${MANIFEST_FIELDS.join(', ')}`
      );
    }
  }
  for (const [key, rule] of Object.entries(MANIFEST_SCHEMA)) {
    const value = parsed[key];
    if (value === undefined) {
      if (!rule.optional) {
        problems.push(
          `${where}: missing required key "${key}" (${rule.readBy})`
        );
      }
      continue;
    }
    if (value === null) {
      if (!rule.nullable)
        problems.push(`${where}: key "${key}" may not be null`);
      continue;
    }
    if (rule.type === 'array') {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.some(
          (item) => typeof item !== 'string' || !rule.items.test(item)
        ) ||
        new Set(value).size !== value.length
      ) {
        problems.push(
          `${where}: key "${key}" must be a non-empty array of distinct names matching ${rule.items}, got ${JSON.stringify(value)}`
        );
      }
      continue;
    }
    if (typeof value !== rule.type) {
      problems.push(
        `${where}: key "${key}" must be a ${rule.type}, got ${JSON.stringify(value)}`
      );
      continue;
    }
    if (rule.enum != null && !rule.enum.includes(value)) {
      problems.push(
        `${where}: key "${key}" must be one of ${rule.enum.join(', ')}, got ${JSON.stringify(value)}`
      );
    }
    if (rule.pattern != null && !rule.pattern.test(value)) {
      problems.push(
        `${where}: key "${key}" = ${JSON.stringify(value)} does not match ${rule.pattern}`
      );
    }
    if (rule.quoteSafe === true && /['"\\\n\r]/.test(value)) {
      problems.push(
        `${where}: key "${key}" = ${JSON.stringify(value)} contains a quote or a line break, which the generated line cannot carry`
      );
    }
  }
  if (problems.length > 0) return problems;

  if (parsed.name !== directoryName) {
    problems.push(
      `${where}: name "${parsed.name}" does not match its directory "${directoryName}"`
    );
  }
  if (parsed.hybridView !== `NitroUi${parsed.name}`) {
    problems.push(
      `${where}: hybridView "${parsed.hybridView}" is not NitroUi${parsed.name}`
    );
  }
  if (parsed.implementation !== `Hybrid${parsed.hybridView}`) {
    problems.push(
      `${where}: implementation "${parsed.implementation}" is not Hybrid${parsed.hybridView}`
    );
  }
  if (parsed.benchUnsuffixed && !parsed.bench) {
    problems.push(
      `${where}: benchUnsuffixed requires bench - only a benched component has a scenario name`
    );
  }
  if (parsed.realInput === true && parsed.realInputTitle === undefined) {
    problems.push(
      `${where}: realInput is true but realInputTitle is missing - it is the title of the row the generator writes into scripts/real-input/controls.mjs, and the line the report prints for that check`
    );
  }
  return problems;
}

/**
 * Parse and validate the manifests of a tree.
 *
 * @param {Array<{directory: string, text: string}>} entries one per component
 *   directory that carries a `component.json`.
 * @returns {any[]} the validated manifests, sorted by manifest-name - the order new
 *   entries are appended in.
 * @throws naming every problem found.
 */
export function manifestsFromEntries(entries) {
  const manifests = [];
  const problems = [];
  for (const { directory, text } of entries) {
    const where = `src/components/${directory}/${MANIFEST_BASENAME}`;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      problems.push(
        `${where}: ${error instanceof Error ? error.message : error}`
      );
      continue;
    }
    const before = problems.length;
    problems.push(...validateManifest(parsed, directory, where));
    if (problems.length === before) manifests.push(parsed);
  }
  const byField = new Map();
  for (const manifest of manifests) {
    for (const key of ['name', 'hybridView', 'id', 'exampleTab']) {
      const value = manifest[key];
      if (!byField.has(key)) byField.set(key, new Map());
      const seen = byField.get(key);
      if (seen.has(value)) {
        problems.push(
          `duplicate ${key} "${value}": ${seen.get(value)} and ${manifest.name} cannot both claim it`
        );
      }
      seen.set(value, manifest.name);
    }
  }
  // A sub-view's derived names must be unique across the tree too.
  for (const sub of withSubViews(manifests).filter((entry) => entry.subView)) {
    for (const key of ['name', 'hybridView', 'implementation']) {
      if (!byField.has(key)) byField.set(key, new Map());
      const seen = byField.get(key);
      if (seen.has(sub[key])) {
        problems.push(
          `duplicate ${key} "${sub[key]}": ${seen.get(sub[key])} and the ${sub.parent} sub-view ${sub.name} cannot both claim it`
        );
      }
      seen.set(sub[key], sub.name);
    }
  }
  // A public name is one component: two manifests exporting it would make the Host
  // table key one identity twice, and the barrel export one name from two modules.
  const exportedBy = new Map();
  for (const manifest of manifests) {
    for (const name of exportsOf(manifest)) {
      if (exportedBy.has(name)) {
        problems.push(
          `duplicate export "${name}": ${exportedBy.get(name)} and ${manifest.name} cannot both claim it`
        );
      }
      exportedBy.set(name, manifest.name);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `component registry is not valid:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    );
  }
  return [...manifests].sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------- regions ---------------------------------- */

/**
 * The begin marker of a generated region, with no indentation.
 *
 * `style: 'jsx'` is for a region inside JSX children, where `//` would render as text.
 */
export function regionBegin(tag, style = 'ts') {
  const text = `@generated by ${GENERATOR_NAME} (region: ${tag}) - do not edit; run bun run regen`;
  return style === 'jsx' ? `{/* ${text} */}` : `// ${text}`;
}

/** The end marker of a generated region, with no indentation. */
export function regionEnd(style = 'ts') {
  return style === 'jsx' ? '{/* @end-generated */}' : '// @end-generated';
}

/**
 * The index of a marker line, ignoring indentation: prettier re-indents a marker comment
 * that sits inside an array, object or JSX literal.
 */
export function findMarkerLine(lines, marker, from = 0) {
  const wanted = marker.trim();
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].trim() === wanted) return index;
  }
  return -1;
}

/**
 * The entries a region should carry, in the order the file should carry them.
 *
 * Keys already in the file keep their positions, new ones are appended in manifest
 * order, and keys no manifest claims are dropped.
 *
 * @param {string[]} existingKeys parsed out of the file's current region
 * @param {string[]} wanted the keys the manifests ask for, in manifest order
 * @returns {string[]}
 */
export function orderRegionEntries(existingKeys, wanted) {
  const remaining = new Set(wanted);
  const ordered = [];
  for (const key of existingKeys) {
    if (!remaining.has(key)) continue;
    ordered.push(key);
    remaining.delete(key);
  }
  for (const key of wanted) {
    if (remaining.has(key)) ordered.push(key);
  }
  return ordered;
}

/** A blank or `//`-comment line, which may separate an anchor from its entries. */
function isPreamble(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('//');
}

/**
 * The line range a region owns, or null when the file does not contain it.
 *
 * A marker region is what sits strictly between its two markers. An anchored region is
 * the run of entries that follows the anchor line, after any blank or comment lines, and
 * it ends at the first line that is not an entry. Where a region declares `entryEnds`, an
 * entry is a multi-line block.
 *
 * @returns {{from: number, to: number} | null} a half-open line range
 */
export function findRegionBounds(lines, region) {
  if (region.anchor != null) {
    const anchor = lines.indexOf(region.anchor);
    if (anchor === -1) return null;
    let from = -1;
    let to = -1;
    for (let index = anchor + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (region.entryStart.test(line)) {
        if (from === -1) from = index;
        if (region.entryEnds != null) {
          while (index < lines.length && !region.entryEnds(lines[index])) {
            index += 1;
          }
          if (index >= lines.length) return null;
        }
        to = index + 1;
        continue;
      }
      if (from === -1 && isPreamble(line)) continue;
      break;
    }
    return from === -1 ? null : { from, to };
  }
  const begin = findMarkerLine(lines, region.begin);
  if (begin === -1) return null;
  const end = findMarkerLine(lines, region.end, begin + 1);
  if (end === -1) return null;
  return { from: begin + 1, to: end };
}

/**
 * Rewrite one generated region of one file.
 *
 * @param {string} content the file as it is now
 * @param {object} region a region from {@link regionsFor}
 * @returns {{content: string, found: boolean, changed: boolean, problems: string[]}}
 */
export function replaceRegion(content, region) {
  const lines = content.split('\n');
  const bounds = findRegionBounds(lines, region);
  if (bounds == null) {
    return {
      content,
      found: false,
      changed: false,
      problems: [
        `${region.path}: ${region.describe} not found (${
          region.anchor != null
            ? `no entry of its shape follows ${JSON.stringify(region.anchor)}`
            : `no line is ${JSON.stringify(region.begin.trim())}`
        })`,
      ],
    };
  }
  // Read the entries as blocks; a line in the region that is not an entry is a problem.
  const existing = [];
  const problems = [];
  let index = bounds.from;
  while (index < bounds.to) {
    const match = region.entryStart.exec(lines[index]);
    if (match == null) {
      problems.push(
        `${region.path}: line ${String(index + 1)} is inside the generated ${region.describe} and is not an entry: ${JSON.stringify(lines[index])}`
      );
      index += 1;
      continue;
    }
    const from = index;
    index += 1;
    if (region.entryEnds != null) {
      while (index < bounds.to && !region.entryEnds(lines[index])) index += 1;
      if (index < bounds.to) index += 1;
    }
    const block = lines.slice(from, index);
    // A multi-line entry names itself inside the block rather than on its first
    // line (a real-input row opens with `{` and its id is the next line).
    const key =
      typeof region.entryKey === 'function'
        ? region.entryKey(block)
        : (match[1] ?? null);
    if (key == null) {
      problems.push(
        `${region.path}: the entry at line ${String(from + 1)} of the generated ${region.describe} does not name itself`
      );
      continue;
    }
    existing.push({ key, lines: block });
  }
  if (problems.length > 0) {
    return { content, found: true, changed: false, problems };
  }

  const byKey = new Map(existing.map((entry) => [entry.key, entry]));
  const wantedByKey = new Map(
    region.entries.map((manifest) => [region.keyOf(manifest), manifest])
  );
  // Entries with no manifest that the region is told to keep, such as `nitro.json`'s
  // autolinking entries for HybridObjects that are not controls.
  const kept = existing
    .map((entry) => entry.key)
    .filter(
      (key) =>
        !wantedByKey.has(key) && region.keep?.(key, region.manifests) === true
    );
  const ordered = orderRegionEntries(
    existing.map((entry) => entry.key),
    [...wantedByKey.keys(), ...kept]
  );
  const blocks = ordered.map((key) => {
    const current = byKey.get(key);
    const manifest = wantedByKey.get(key);
    // A kept key has no manifest to render from, so its lines are copied.
    if (manifest == null) return current.lines;
    // A shipped file must stay byte-identical, so an entry already there is copied rather
    // than re-rendered. An unshipped region is always rendered from the manifest.
    if (current != null && region.shipped === true) return current.lines;
    const rendered = region.render(manifest);
    return Array.isArray(rendered) ? [...rendered] : [rendered];
  });

  // A region whose last entry ends a statement (`… | 'picker';`) owns that `;`,
  // because prettier insists it sits on the member's own line and the end marker has
  // to come after it. So appending or dropping a member has to move the terminator.
  if (region.terminator != null) {
    const strip = (block) => {
      const last = block.length - 1;
      if (block[last].endsWith(region.terminator)) {
        block[last] = block[last].slice(0, -region.terminator.length);
      }
    };
    blocks.forEach(strip);
    const last = blocks.at(-1);
    if (last != null) last[last.length - 1] += region.terminator;
  }

  // The mirror case, for a JSON object: every member but the last is followed by a
  // comma, so appending or dropping an entry has to move the separator too.
  if (region.jsonSeparator === true) {
    for (const block of blocks) {
      const last = block.length - 1;
      if (block[last].endsWith(',')) block[last] = block[last].slice(0, -1);
    }
    for (const block of blocks.slice(0, -1)) {
      const last = block.length - 1;
      block[last] += ',';
    }
  }

  const body = blocks.flat();
  const nextText = [
    ...lines.slice(0, bounds.from),
    ...body,
    ...lines.slice(bounds.to),
  ].join('\n');
  return {
    content: nextText,
    found: true,
    changed: nextText !== content,
    problems: [],
  };
}

/* --------------------------- the generated lists --------------------------- */

/**
 * Every generated region, as data: the file, its marker or anchor, how to recognise
 * the start of one entry, which manifests it wants, how a manifest is keyed in that
 * file, and how to render a new entry.
 *
 * @param {any[]} manifests validated, in manifest-name order
 * @returns {object[]}
 */
export function regionsFor(manifests) {
  const where = (field) => manifests.filter((m) => m[field] === true);
  /** The bench components whose scenario cells carry the component's name. */
  const suffixed = () =>
    manifests.filter((m) => m.bench === true && m.benchUnsuffixed !== true);
  /** The self-sizing components: the ones with a row in the sizing table. */
  const selfSizing = () => manifests.filter((m) => m.sizing != null);
  /**
   * The controls the `nitro-ui-host` bench arm is listed for: hostable and benched. A
   * hostable control with no bench has no cells to list.
   */
  const hostArm = () =>
    manifests.filter((m) => m.hostable === true && m.bench === true);
  /** The controls Android registers through nitrogen's generated manager. */
  const generatedManagers = () =>
    manifests.filter((m) => m.androidViewManager == null);
  const withManifests = (spec) => ({
    ...spec,
    manifests,
    ...(spec.anchor != null
      ? null
      : {
          begin: regionBegin(spec.marker, spec.style),
          end: regionEnd(spec.style),
        }),
  });
  const NAME = (manifest) => manifest.name;
  /** The directory a component's module lives in (a sub-view's is its parent's). */
  const DIRECTORY = (manifest) => manifest.directory ?? manifest.name;
  const ID = (manifest) => manifest.id;
  const TAB = (manifest) => manifest.exampleTab;
  const QUOTED_ID = /^ {2}'([a-z0-9-]+)',$/;
  const quotedId = (manifest) => `  '${manifest.id}',`;

  return [
    // ── Shipped: anchored, no marker, byte-identical output ───────────────────
    //
    // `nitro.json` is written rather than checked: nitrogen reads it and throws for a
    // Hybrid View missing from `autolinking`, so the entry must exist before nitrogen runs.
    withManifests({
      path: 'nitro.json',
      anchor: '  "autolinking": {',
      describe: 'the autolinking entries',
      shipped: true,
      // Sub-views included: nitrogen needs an autolinking entry for every Hybrid View.
      entries: withSubViews(manifests),
      keyOf: (manifest) => manifest.hybridView,
      // An entry is its key's whole object: it opens at `"Key": {` and ends at the `}`
      // that closes it.
      entryStart: /^ {4}"([A-Za-z][A-Za-z0-9]*)": \{$/,
      entryEnds: (line) => /^ {4}\},?$/.test(line),
      entryKey: (block) =>
        /^ {4}"([A-Za-z][A-Za-z0-9]*)": \{$/.exec(block[0])?.[1] ?? null,
      jsonSeparator: true,
      keep: (key) => NON_CONTROL_AUTOLINKING.includes(key),
      render: (m) => [
        `    "${m.hybridView}": {`,
        '      "ios": {',
        '        "language": "swift",',
        `        "implementationClassName": "${m.implementation}"`,
        '      },',
        '      "android": {',
        '        "language": "kotlin",',
        `        "implementationClassName": "${m.implementation}"`,
        '      }',
        '    }',
      ],
    }),
    withManifests({
      path: 'src/components/Host/HostChildren.ts',
      anchor: "} from 'react-native';",
      describe: 'the control imports',
      shipped: true,
      // Every control, hostable or not: the file's `UNHOSTABLE_CONTROLS` rows need the
      // import too.
      entries: manifests,
      keyOf: NAME,
      // One import line per manifest, naming every public component it exports.
      entryStart: /^import \{ [A-Z][\w, ]* \} from '\.\.\/([A-Z]\w*)\/\1';$/,
      render: (m) =>
        `import { ${exportsOf(m).join(', ')} } from '../${m.name}/${m.name}';`,
    }),
    withManifests({
      path: 'src/components/Host/HostChildren.ts',
      anchor: 'export const HOSTABLE_CONTROLS = new Map<unknown, string>([',
      describe: 'HOSTABLE_CONTROLS rows',
      shipped: true,
      // One row per public component, not per manifest: the table is keyed by the
      // component an app writes in JSX.
      entries: where('hostable').flatMap((m) =>
        exportsOf(m).map((exportName) => ({ ...m, exportName }))
      ),
      keyOf: (entry) => entry.exportName,
      entryStart: /^ {2}\[([A-Z]\w*), '[A-Z]\w*'\],$/,
      render: (entry) => `  [${entry.exportName}, '${entry.exportName}'],`,
    }),
    withManifests({
      path: 'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt',
      // The `core.NitroUiDeclaredFallbacks` import is the last one that is not a
      // manager, so the run of manager imports starts on the line after it.
      anchor: 'import com.margelo.nitro.nitroui.core.NitroUiDeclaredFallbacks',
      describe: 'the view-manager imports',
      shipped: true,
      entries: generatedManagers(),
      keyOf: NAME,
      entryStart:
        /^import com\.margelo\.nitro\.nitroui\.views\.HybridNitroUi([A-Z]\w*)Manager$/,
      render: (m) =>
        `import com.margelo.nitro.nitroui.views.HybridNitroUi${m.name}Manager`,
    }),
    withManifests({
      path: 'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt',
      anchor: '  ): List<ViewManager<*, *>> = listOf(',
      describe: 'the createViewManagers rows',
      shipped: true,
      entries: generatedManagers(),
      keyOf: NAME,
      entryStart: /^ {4}HybridNitroUi([A-Z]\w*)Manager\(\),$/,
      render: (m) => `    HybridNitroUi${m.name}Manager(),`,
    }),
    withManifests({
      path: 'android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiDeclaredFallbacks.kt',
      anchor: 'package com.margelo.nitro.nitroui.core',
      describe: 'the component imports',
      shipped: true,
      entries: selfSizing(),
      keyOf: NAME,
      entryStart:
        /^import com\.margelo\.nitro\.nitroui\.HybridNitroUi([A-Z]\w*)$/,
      render: (m) => `import com.margelo.nitro.nitroui.HybridNitroUi${m.name}`,
    }),
    withManifests({
      path: 'android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiDeclaredFallbacks.kt',
      anchor: '  fun registerAll() {',
      describe: 'the registerAll rows',
      shipped: true,
      entries: selfSizing(),
      keyOf: NAME,
      entryStart: /^ {4}HybridNitroUi([A-Z]\w*)\.declareFallback\(\)$/,
      render: (m) => `    HybridNitroUi${m.name}.declareFallback()`,
    }),
    withManifests({
      path: 'ios/core/NitroUiDeclaredFallbacks.swift',
      anchor: '  private static let hasRegistered: Bool = {',
      describe: 'the registerAll rows',
      shipped: true,
      entries: selfSizing(),
      keyOf: NAME,
      entryStart: /^ {4}HybridNitroUi([A-Z]\w*)\.declareFallback\(\)$/,
      render: (m) => `    HybridNitroUi${m.name}.declareFallback()`,
    }),

    // ── Unshipped: between @generated markers ─────────────────────────────────
    withManifests({
      path: 'src/__tests__/viewConfigs.test.ts',
      marker: 'config-imports',
      describe: 'the view-config imports',
      // Sub-views included: nitrogen writes a `Config.json` for every Hybrid View.
      entries: withSubViews(manifests),
      keyOf: NAME,
      // A sub-view's config lives in its parent's directory, so only the file name
      // carries the key.
      entryStart:
        /^import \{ NitroUi([A-Z]\w*)Config \} from '\.\.\/components\/[A-Z]\w*\/NitroUi\1Config';$/,
      render: (m) =>
        `import { NitroUi${m.name}Config } from '../components/${DIRECTORY(m)}/NitroUi${m.name}Config';`,
    }),
    withManifests({
      path: 'src/__tests__/viewConfigs.test.ts',
      marker: 'config-copies',
      describe: 'the `copies` rows',
      entries: withSubViews(manifests),
      keyOf: NAME,
      entryStart: /^ +'NitroUi([A-Z]\w*)Config\.json': NitroUi\1Config,$/,
      render: (m) => `  'NitroUi${m.name}Config.json': NitroUi${m.name}Config,`,
    }),
    withManifests({
      path: 'bench/src/types.ts',
      marker: 'component-names',
      describe: 'ComponentName',
      entries: where('bench'),
      keyOf: ID,
      // Prettier puts the union's closing `;` on the last member's line, so the region
      // owns it.
      entryStart: /^ {2}\| '([a-z0-9-]+)';?$/,
      terminator: ';',
      render: (m) => `  | '${m.id}'`,
    }),
    withManifests({
      path: 'bench/src/types.ts',
      marker: 'scenario-names',
      describe: 'ScenarioName',
      entries: suffixed(),
      keyOf: ID,
      entryStart: /^ {2}\| `\$\{ScenarioAction\}\.([a-z0-9-]+)`;?$/,
      terminator: ';',
      render: (m) => `  | \`\${ScenarioAction}.${m.id}\``,
    }),
    withManifests({
      path: 'bench/src/plan.ts',
      marker: 'suffixed-components',
      describe: 'SUFFIXED_COMPONENTS',
      entries: suffixed(),
      keyOf: ID,
      entryStart: QUOTED_ID,
      render: quotedId,
    }),
    withManifests({
      path: 'bench/src/implementations/index.ts',
      marker: 'host-arm-components',
      describe: 'the nitro-ui-host arm components',
      entries: hostArm(),
      keyOf: ID,
      entryStart: /^ {6}'([a-z0-9-]+)',$/,
      render: (m) => `      '${m.id}',`,
    }),
    withManifests({
      path: 'scripts/bench/lib.mjs',
      marker: 'host-arm-components',
      describe: 'the nitro-ui-host arm components',
      entries: hostArm(),
      keyOf: ID,
      entryStart: /^ {6}'([a-z0-9-]+)',$/,
      render: (m) => `      '${m.id}',`,
    }),
    withManifests({
      path: 'scripts/smoke/lib.mjs',
      marker: 'smoke-controls',
      describe: 'SMOKE_CONTROLS',
      entries: where('smoke'),
      keyOf: ID,
      entryStart: QUOTED_ID,
      render: quotedId,
    }),
    withManifests({
      path: 'scripts/smoke/App.tsx',
      marker: 'smoke-controls',
      describe: 'SMOKE_CONTROLS',
      entries: where('smoke'),
      keyOf: ID,
      entryStart: QUOTED_ID,
      render: quotedId,
    }),
    withManifests({
      path: 'scripts/real-input/controls.mjs',
      marker: 'control-rows',
      describe: 'the REAL_INPUT_CONTROL_ROWS rows',
      entries: where('realInput'),
      keyOf: ID,
      // A row is a multi-line object literal: the block opens at `{`, closes at
      // `},`, and names itself on the `id:` line inside it.
      entryStart: /^ {2}\{$/,
      entryEnds: (line) => line === '  },',
      entryKey: (block) =>
        /^ {4}id: '([a-z0-9-]+)',$/.exec(block[1] ?? '')?.[1] ?? null,
      render: (m) => realInputRow(m),
    }),
    withManifests({
      path: 'example/src/App.tsx',
      marker: 'screen-imports',
      describe: 'the example screen imports',
      entries: manifests,
      keyOf: NAME,
      entryStart: /^import ([A-Z]\w*)Screen from '\.\/\1Screen';$/,
      render: (m) => `import ${m.name}Screen from './${m.name}Screen';`,
    }),
    withManifests({
      path: 'example/src/App.tsx',
      marker: 'screens',
      describe: 'the Screen union',
      entries: manifests,
      keyOf: TAB,
      entryStart: /^ {2}\| '([a-z0-9]+)'$/,
      render: (m) => `  | '${m.exampleTab}'`,
    }),
    withManifests({
      path: 'example/src/App.tsx',
      marker: 'tabs',
      describe: 'TABS',
      entries: manifests,
      keyOf: TAB,
      entryStart: /^ {2}\{ id: '([a-z0-9]+)', label: '[^']*' \},$/,
      render: (m) => `  { id: '${m.exampleTab}', label: '${m.exampleLabel}' },`,
    }),
    withManifests({
      path: 'example/src/App.tsx',
      marker: 'screens-body',
      describe: 'the screen switch',
      // These lines are JSX children, so the markers have to be JSX comments.
      style: 'jsx',
      entries: manifests,
      keyOf: TAB,
      entryStart:
        /^ {8}\{screen === '([a-z0-9]+)' \? <[A-Z]\w*Screen \/> : null\}$/,
      render: (m) =>
        `        {screen === '${m.exampleTab}' ? <${m.name}Screen /> : null}`,
    }),
  ];
}

/**
 * One `REAL_INPUT_CONTROL_ROWS` row (`id` / `title` / `screen`).
 *
 * The title wraps exactly where prettier would wrap it (past 80 columns), so formatting
 * the file does not change what the generator wrote.
 */
export function realInputRow(manifest) {
  const lines = ['  {', `    id: '${manifest.id}',`];
  const single = `    title: '${manifest.realInputTitle}',`;
  if (single.length <= 80) lines.push(single);
  else lines.push('    title:', `      '${manifest.realInputTitle}',`);
  lines.push(`    screen: '${manifest.exampleTab}',`, '  },');
  return lines;
}

/* ------------------------------ generated file ----------------------------- */

/**
 * The text of `nitro-ui.sizing.json`, which `scripts/patch-nitrogen.mjs` consumes.
 *
 * The file is shipped, so existing keys keep their positions and new ones are appended
 * in manifest-name order.
 *
 * @param {any[]} manifests
 * @param {Record<string, string> | null} current the file as it is now, or null
 * @param {string} [currentText] the raw text, so a file that does not parse is refused
 *   rather than re-ordered from nothing
 * @returns {string} the file's text, with a trailing newline
 */
export function sizingTableContent(manifests, current, currentText) {
  if (current == null && currentText != null) {
    // With nothing parsed, the key order would come from the manifests alone and
    // re-sort the file.
    throw new Error(
      `${SIZING_TABLE_FILE}: is not valid JSON, so its key order cannot be preserved - resolve it (a merge conflict?) and run bun run registry`
    );
  }
  const wanted = new Map(
    manifests
      .filter((m) => m.sizing != null)
      .map((m) => [`${HYBRID_PREFIX}${m.hybridView}`, m.sizing])
  );
  const keys = orderRegionEntries(Object.keys(current ?? {}), [
    ...wanted.keys(),
  ]);
  const body = keys.map(
    (key) => `  ${JSON.stringify(key)}: ${JSON.stringify(wanted.get(key))}`
  );
  return `{\n${body.join(',\n')}\n}\n`;
}

/* ---------------------------- cross-checks --------------------------------- */

/**
 * Autolinked HybridObjects that are not components with a manifest. Listed by name so
 * that any other unknown key in `nitro.json` is still reported.
 */
export const NON_CONTROL_AUTOLINKING = [
  'NitroUiCore',
  'NitroUiHost',
  'NitroUiMaterialTheme',
];

/**
 * Exports from `src/index.ts` whose directory has no manifest. Listed by name so that any
 * other unknown export is still reported.
 */
export const NON_COMPONENT_EXPORTS = ['Host'];

/**
 * The autolinking entries of `nitro.json`, checked against the manifests: every manifest
 * has an entry that names its implementation and language, and no entry is undeclared.
 *
 * @param {any[]} manifests
 * @param {any} nitro the parsed `nitro.json` the generator produced
 * @param {any} [onDisk] the parsed file as checked out. Undeclared entries are looked for
 *   here, because the generator's output has already dropped them.
 */
export function checkAutolinking(manifests, nitro, onDisk) {
  const problems = [];
  manifests = withSubViews(manifests);
  const autolinking = nitro?.autolinking;
  if (autolinking == null || typeof autolinking !== 'object') {
    return ['nitro.json has no autolinking section - run bun run registry'];
  }
  for (const manifest of manifests) {
    const entry = autolinking[manifest.hybridView];
    if (entry == null) {
      problems.push(
        `nitro.json: no autolinking entry for ${manifest.hybridView} (${manifest.name}) - run bun run registry`
      );
      continue;
    }
    for (const platform of ['ios', 'android']) {
      const language = platform === 'ios' ? 'swift' : 'kotlin';
      // An entry is either one object per platform or a shared `all` object, where
      // `language` is Android's and `iosLanguage` overrides it for iOS.
      const perPlatform = entry[platform];
      const claim = perPlatform ?? entry.all;
      if (claim == null) {
        problems.push(
          `nitro.json: ${manifest.hybridView} has no ${platform} autolinking entry`
        );
        continue;
      }
      if (claim.implementationClassName !== manifest.implementation) {
        problems.push(
          `nitro.json: ${manifest.hybridView}.${platform}.implementationClassName is "${claim.implementationClassName}", the manifest says "${manifest.implementation}"`
        );
      }
      const claimed =
        perPlatform != null
          ? perPlatform.language
          : platform === 'ios'
            ? (claim.iosLanguage ?? claim.language)
            : claim.language;
      if (claimed != null && claimed !== language) {
        problems.push(
          `nitro.json: ${manifest.hybridView}.${platform} claims language "${claimed}", this library is ${language} there`
        );
      }
    }
  }
  const known = new Set([
    ...manifests.map((m) => m.hybridView),
    ...NON_CONTROL_AUTOLINKING,
  ]);
  for (const key of Object.keys(onDisk?.autolinking ?? {})) {
    if (!known.has(key)) {
      problems.push(
        `nitro.json: autolinking has ${key} and no manifest declares it - remove its entry from nitro.json, or add its src/components/<Name>/${MANIFEST_BASENAME}`
      );
    }
  }
  return problems;
}

/** Where Android's view managers are registered. */
export const ANDROID_PACKAGE_FILE =
  'android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt';

/**
 * The hand-written Android view managers against the manifests that name one: the package
 * must register that class, and must not also register the generated manager.
 *
 * @param {any[]} manifests
 * @param {string | null} packageText `NitroUiPackage.kt` as the plan produced it
 */
export function checkAndroidViewManagers(manifests, packageText) {
  const problems = [];
  if (packageText == null) return problems;
  const lines = packageText.split('\n').map((line) => line.trim());
  for (const manifest of withSubViews(manifests)) {
    if (manifest.androidViewManager == null) continue;
    if (!lines.includes(`${manifest.androidViewManager}(),`)) {
      problems.push(
        `${ANDROID_PACKAGE_FILE}: ${manifest.name} names androidViewManager ${manifest.androidViewManager} and createViewManagers does not register it - add \`${manifest.androidViewManager}(),\` to its listOf`
      );
    }
    if (lines.includes(`HybridNitroUi${manifest.name}Manager(),`)) {
      problems.push(
        `${ANDROID_PACKAGE_FILE}: ${manifest.name} registers the generated HybridNitroUi${manifest.name}Manager as well as ${manifest.androidViewManager} - remove the generated row`
      );
    }
  }
  return problems;
}

/**
 * The real-input table against the manifests: every manifest that claims a real-input
 * check has a control row.
 */
export function checkRealInputRows(manifests, controlIds) {
  const problems = [];
  const present = new Set(controlIds);
  for (const manifest of manifests) {
    if (manifest.realInput !== true) continue;
    if (!present.has(manifest.id)) {
      problems.push(
        `scripts/real-input/controls.mjs: ${manifest.name} says realInput: true and has no control row - run bun run registry, and add the matching check on both platforms (RealInputTests.swift, CHECKS in scripts/real-input/android.mjs)`
      );
    }
  }
  return problems;
}

/**
 * The example app can render every tab the generated tab bar lists: the screen switch has
 * a branch for the tab, the branch renders that component's screen, and the screen file
 * exists.
 */
export function checkExampleScreens(manifests, appText, readFile) {
  const problems = [];
  const rendered = new Map([
    ...renderedTabs(appText).map((match) => [match.tab, match.screen]),
  ]);
  for (const manifest of manifests) {
    const screen = rendered.get(manifest.exampleTab);
    if (screen == null) {
      problems.push(
        `example/src/App.tsx: tab "${manifest.exampleTab}" lists ${manifest.name} and no branch of the screen switch renders it, so the tab lands on a blank body`
      );
      continue;
    }
    if (screen !== `${manifest.name}Screen`) {
      problems.push(
        `example/src/App.tsx: tab "${manifest.exampleTab}" renders <${screen} /> and the manifest's component is ${manifest.name}`
      );
    }
    const path = `example/src/${screen}.tsx`;
    if (readFile(path) == null) {
      problems.push(
        `${path}: ${manifest.name}'s tab renders this screen and the file does not exist - write it, the generator adds the tab and not the screen`
      );
    }
  }
  return problems;
}

/**
 * `src/index.ts` exports every component the registry knows about, and nothing the
 * registry does not. The barrel is hand-written, so this is a check rather than a region.
 *
 * @param {any[]} manifests
 * @param {string[]} exportedNames the `<Name>` of every component the barrel exports
 */
export function checkIndexExports(
  manifests,
  exportedNames,
  exportedValues = null
) {
  const problems = [];
  const exported = new Set(exportedNames);
  for (const manifest of manifests) {
    if (!exported.has(manifest.name)) {
      problems.push(
        `src/index.ts: ${manifest.name} is in the registry and is not exported, so an app cannot import it`
      );
      continue;
    }
    // A manifest with `exports` must have each of those names exported, not just its module.
    if (exportedValues == null || !Array.isArray(manifest.exports)) continue;
    const fromModule = exportedValues.get(manifest.name) ?? new Set();
    for (const name of manifest.exports) {
      if (!fromModule.has(name)) {
        problems.push(
          `src/index.ts: ${name} is in ${manifest.name}'s exports and src/index.ts does not export it from ./components/${manifest.name}/`
        );
      }
    }
  }
  const manifested = new Set([
    ...manifests.map((m) => m.name),
    ...NON_COMPONENT_EXPORTS,
  ]);
  for (const name of exported) {
    if (!manifested.has(name)) {
      problems.push(
        `src/index.ts: exports ${name} and no manifest declares it - add its src/components/${name}/${MANIFEST_BASENAME}, or take it out of NON_COMPONENT_EXPORTS`
      );
    }
  }
  return problems;
}

/* ------------------------------ running it --------------------------------- */

/** Parse a JSON file's text, or null. */
function parseJson(text) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The tabs `example/src/App.tsx` renders, with the screen each one renders. */
export function renderedTabs(appText) {
  return [
    ...(appText ?? '').matchAll(
      /\{screen === '([a-z0-9]+)' \? <([A-Z]\w*)Screen \/>/g
    ),
  ].map((match) => ({ tab: match[1], screen: `${match[2]}Screen` }));
}

/** The control ids `scripts/real-input/controls.mjs` publishes. */
export function realInputControlIds(controlsText) {
  return [...(controlsText ?? '').matchAll(/^ {4}id: '([a-z0-9-]+)',$/gm)].map(
    (match) => match[1]
  );
}

/** The components `src/index.ts` exports, by wrapper name. */
export function exportedComponents(indexText) {
  return [
    ...(indexText ?? '').matchAll(/from '\.\/components\/([A-Z]\w+)\//g),
  ].map((match) => match[1]);
}

/**
 * The value names `src/index.ts` exports from each component directory: `type`
 * members are left out, because a type is not a component an app can render.
 *
 * @returns {Map<string, Set<string>>} directory -> exported value names
 */
export function exportedValuesByComponent(indexText) {
  const byDirectory = new Map();
  for (const match of (indexText ?? '').matchAll(
    /export \{([^}]*)\} from '\.\/components\/([A-Z]\w+)\//g
  )) {
    const names = byDirectory.get(match[2]) ?? new Set();
    for (const member of match[1].split(',')) {
      const name = member.trim();
      if (name.length > 0 && !name.startsWith('type ')) names.add(name);
    }
    byDirectory.set(match[2], names);
  }
  return byDirectory;
}

/**
 * Produce all generated output for a set of manifests, and check what the generator
 * does not write.
 *
 * A file can carry several regions, so each region is applied to the result of the one
 * before it. Only files whose final text differs from what is on disk are returned.
 *
 * @param {any[]} manifests
 * @param {(path: string) => string | null} readFile repo-relative; `null` for a
 *   file that does not exist.
 * @returns {{files: Record<string, string>, problems: string[], checked: string[]}}
 */
export function planRegistry(manifests, readFile) {
  const files = {};
  const problems = [];
  const checked = new Set();
  const original = new Map();
  const working = new Map();
  for (const spec of regionsFor(manifests)) {
    if (!working.has(spec.path)) {
      const current = readFile(spec.path);
      original.set(spec.path, current);
      working.set(spec.path, current);
      if (current == null) {
        problems.push(
          `${spec.path}: not found, but the registry writes into it`
        );
      }
    }
    const current = working.get(spec.path);
    if (current == null) continue;
    const result = replaceRegion(current, spec);
    problems.push(...result.problems);
    if (!result.found) continue;
    checked.add(spec.path);
    working.set(spec.path, result.content);
  }
  for (const [path, text] of working) {
    if (text != null && text !== original.get(path)) files[path] = text;
  }
  const sizingText = readFile(SIZING_TABLE_FILE);
  if (sizingText == null) {
    problems.push(
      `${SIZING_TABLE_FILE}: not found, but the registry writes it`
    );
  } else {
    checked.add(SIZING_TABLE_FILE);
    try {
      const sizing = sizingTableContent(
        manifests,
        parseJson(sizingText),
        sizingText
      );
      if (sizingText !== sizing) files[SIZING_TABLE_FILE] = sizing;
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  // Cross-checks of files something else owns. A file this plan writes is checked as
  // produced, so a new component's own entry is not reported missing before it is written.
  problems.push(
    ...checkAutolinking(
      manifests,
      parseJson(working.get('nitro.json') ?? readFile('nitro.json')),
      // Undeclared entries are looked for in the file as checked out.
      parseJson(readFile('nitro.json'))
    )
  );
  problems.push(
    ...checkIndexExports(
      manifests,
      exportedComponents(readFile('src/index.ts')),
      exportedValuesByComponent(readFile('src/index.ts'))
    )
  );
  problems.push(
    ...checkExampleScreens(
      manifests,
      working.get('example/src/App.tsx') ?? readFile('example/src/App.tsx'),
      readFile
    )
  );
  problems.push(
    ...checkAndroidViewManagers(
      manifests,
      working.get(ANDROID_PACKAGE_FILE) ?? readFile(ANDROID_PACKAGE_FILE)
    )
  );
  return { files, problems, checked: [...checked] };
}
