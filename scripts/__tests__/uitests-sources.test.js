import { describe, expect, it } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '../..');
const UITESTS_DIR = join(REPO, 'example/ios/NitroUiExampleUITests');
const PBXPROJ = join(
  REPO,
  'example/ios/NitroUiExample.xcodeproj/project.pbxproj'
);

/** The file that identifies the UI-test target: every other source shares its phase. */
const ANCHOR = 'RealInputTests.swift';

/**
 * The source names each `PBXSourcesBuildPhase` compiles: a phase lists build-file ids,
 * a build file names a file reference, and a file reference carries the file's name.
 *
 * @param {string} pbxproj
 * @returns {Array<{id: string, names: string[]}>}
 */
function sourcesPhases(pbxproj) {
  const buildFiles = new Map();
  const buildFileRe =
    /^\t\t([0-9A-Fa-f]{8,}) \/\* (.+?) in Sources \*\/ = \{isa = PBXBuildFile; fileRef = ([0-9A-Fa-f]{8,})/gm;
  let match;
  while ((match = buildFileRe.exec(pbxproj)) !== null) {
    buildFiles.set(match[1], { name: match[2], fileRef: match[3] });
  }

  const references = new Set();
  const fileRefRe =
    /^\t\t([0-9A-Fa-f]{8,}) \/\* (.+?) \*\/ = \{isa = PBXFileReference;/gm;
  while ((match = fileRefRe.exec(pbxproj)) !== null) {
    references.add(match[1]);
  }

  const phases = [];
  const phaseRe =
    /\t\t([0-9A-Fa-f]{8,}) \/\* Sources \*\/ = \{\n\t\t\tisa = PBXSourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\n\t\t\t\);/g;
  while ((match = phaseRe.exec(pbxproj)) !== null) {
    const names = [];
    for (const line of match[2].split('\n')) {
      const entry = line.match(/([0-9A-Fa-f]{8,}) \/\* (.+?) in Sources/);
      if (entry == null) continue;
      const buildFile = buildFiles.get(entry[1]);
      // An entry whose build file or file reference is gone is reported by name too.
      if (buildFile == null || !references.has(buildFile.fileRef)) {
        names.push(`(unresolvable: ${entry[2]})`);
        continue;
      }
      names.push(buildFile.name);
    }
    phases.push({ id: match[1], names });
  }
  return phases;
}

/**
 * @param {string} pbxproj
 * @param {string} [anchor] the source that identifies the UI-test target
 * @returns {string[] | null} the names that target compiles, or null if no target does
 */
function uiTestSources(pbxproj, anchor = ANCHOR) {
  const phase = sourcesPhases(pbxproj).find((p) => p.names.includes(anchor));
  return phase == null ? null : [...phase.names].sort();
}

/**
 * A project file for the fixtures: an app target plus a UI-test target that compiles
 * `compiled` out of a folder that holds `folder`.
 *
 * @param {{folder: string[], compiled: string[], dropReference?: string}} shape
 * @returns {string}
 */
function fakeProject({ folder, compiled, dropReference = null }) {
  const ids = new Map();
  let next = 0;
  for (const name of new Set([...folder, ...compiled])) {
    next += 1;
    ids.set(name, {
      build: `B${String(next).padStart(23, '0')}`,
      file: `F${String(next).padStart(23, '0')}`,
    });
  }
  const line = (text) => `\t\t${text}\n`;
  const buildFiles = compiled
    .map((name) =>
      line(
        `${ids.get(name).build} /* ${name} in Sources */ = {isa = PBXBuildFile; fileRef = ${ids.get(name).file} /* ${name} */; };`
      )
    )
    .join('');
  const fileRefs = folder
    .filter((name) => name !== dropReference)
    .map((name) =>
      line(
        `${ids.get(name).file} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = ${name}; path = ${name}; sourceTree = "<group>"; };`
      )
    )
    .join('');
  const phaseBody = (names) =>
    names
      .map((name) =>
        ids.has(name)
          ? `\t\t\t\t${ids.get(name).build} /* ${name} in Sources */,\n`
          : `\t\t\t\t761780ED2CA45674006654EE /* ${name} in Sources */,\n`
      )
      .join('');
  return [
    '// !$*UTF8*$!',
    '{',
    '\tobjects = {',
    '',
    '/* Begin PBXBuildFile section */',
    buildFiles +
      line(
        '761780ED2CA45674006654EE /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 761780EC2CA45674006654EE /* AppDelegate.swift */; };'
      ) +
      '/* End PBXBuildFile section */',
    '',
    '/* Begin PBXFileReference section */',
    fileRefs +
      line(
        '761780EC2CA45674006654EE /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = AppDelegate.swift; path = NitroUiExample/AppDelegate.swift; sourceTree = "<group>"; };'
      ) +
      '/* End PBXFileReference section */',
    '',
    '/* Begin PBXSourcesBuildPhase section */',
    '\t\t13B07F871A680F5B00A75B9A /* Sources */ = {\n' +
      '\t\t\tisa = PBXSourcesBuildPhase;\n' +
      '\t\t\tbuildActionMask = 2147483647;\n' +
      '\t\t\tfiles = (\n' +
      phaseBody(['AppDelegate.swift']) +
      '\t\t\t);\n' +
      '\t\t\trunOnlyForDeploymentPostprocessing = 0;\n' +
      '\t\t};\n',
    '\t\tE21CF03965E7B9D0EFC69F1D /* Sources */ = {\n' +
      '\t\t\tisa = PBXSourcesBuildPhase;\n' +
      '\t\t\tbuildActionMask = 2147483647;\n' +
      '\t\t\tfiles = (\n' +
      phaseBody(compiled) +
      '\t\t\t);\n' +
      '\t\t\trunOnlyForDeploymentPostprocessing = 0;\n' +
      '\t\t};\n',
    '/* End PBXSourcesBuildPhase section */',
    '};',
    '}',
  ].join('\n');
}

describe('the iOS UI-test target compiles every file in its folder', () => {
  it('has a project file and a UI-test folder to read', () => {
    expect(existsSync(PBXPROJ)).toBe(true);
    expect(existsSync(UITESTS_DIR)).toBe(true);
  });

  it('reads the sources a project file compiles', () => {
    const compiled = uiTestSources(
      fakeProject({
        folder: [ANCHOR, 'A11yFrameStability.swift'],
        compiled: [ANCHOR, 'A11yFrameStability.swift'],
      })
    );
    expect(compiled).toEqual([ANCHOR, 'A11yFrameStability.swift'].sort());
  });

  it('names the sources on disk and the sources in the project', () => {
    const onDisk = readdirSync(UITESTS_DIR)
      .filter((name) => name.endsWith('.swift'))
      .sort();
    expect(onDisk.length).toBeGreaterThan(1);

    const compiled = uiTestSources(readFileSync(PBXPROJ, 'utf8'));
    expect(compiled).not.toBeNull();
    expect(compiled).toEqual(onDisk);
  });

  it('catches a target that compiles one helper and not the other', () => {
    const compiled = uiTestSources(
      fakeProject({
        folder: [ANCHOR, 'A11yFrameStability.swift', 'GestureSettlement.swift'],
        compiled: [ANCHOR, 'GestureSettlement.swift'],
      })
    );
    expect(compiled).toEqual([ANCHOR, 'GestureSettlement.swift'].sort());
    expect(compiled).not.toContain('A11yFrameStability.swift');
  });

  it('catches a compiled entry with no file reference behind it', () => {
    const compiled = uiTestSources(
      fakeProject({
        folder: [ANCHOR, 'A11yFrameStability.swift'],
        compiled: [ANCHOR, 'A11yFrameStability.swift'],
        dropReference: 'A11yFrameStability.swift',
      })
    );
    expect(compiled).toContain('(unresolvable: A11yFrameStability.swift)');
  });

  it('refuses to answer when no target compiles the anchor', () => {
    expect(
      uiTestSources(fakeProject({ folder: [ANCHOR], compiled: [] }), ANCHOR)
    ).toBeNull();
  });
});
