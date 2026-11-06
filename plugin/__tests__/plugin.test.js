/**
 * `react-native-nitro-ui/plugin`, run against a fixture Android project.
 *
 * The plugin's promise is two filesystem facts — the vectors land where
 * `androidIcon` can find them, and they are named where the resource shrinker
 * will not delete them — so this is a filesystem test, not a call-count test: it
 * runs the plugin on a throwaway project and reads the files back.
 *
 * `expo/config-plugins` is not a dependency of this package (see the header of
 * `plugin/index.js` for why it is required lazily), so the half that goes through
 * `withDangerousMod` runs against a virtual mock that hands the mod straight
 * back. Everything the mod calls — the copy, the name rules, the keep-file merge —
 * is the real code.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.mock(
  'expo/config-plugins',
  () => ({
    withDangerousMod: (config, [platform, mod]) => {
      config.__mod = { platform, mod };
      return config;
    },
  }),
  { virtual: true }
);

const plugin = require('../index.js');
const { applyAndroidIcons } = require('../index.js');

const ICONS = path.join(__dirname, '..', '__fixtures__', 'android-icons');
const tempDirs = [];

/**
 * A generated-looking Android project with an `icons/` folder beside it, in a temp
 * directory that `afterEach` deletes. Nothing here writes into the repo.
 */
function project(keepFile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-plugin-'));
  tempDirs.push(root);
  const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
  fs.mkdirSync(res, { recursive: true });
  fs.cpSync(ICONS, path.join(root, 'icons'), { recursive: true });
  if (keepFile != null) {
    fs.mkdirSync(path.join(res, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(res, 'raw', 'keep.xml'), keepFile, 'utf8');
  }
  return {
    root,
    drawable: path.join(res, 'drawable'),
    keep: path.join(res, 'raw', 'keep.xml'),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

/** The plugin exactly as `app.json` configures it: a config, a props object. */
function runPlugin(projectRoot, props) {
  const config = {
    modRequest: {
      projectRoot,
      platformProjectRoot: path.join(projectRoot, 'android'),
    },
  };
  const returned = plugin(config, props);
  expect(returned.__mod.platform).toBe('android');
  return returned.__mod.mod(returned);
}

/** The same call without Expo in the picture. */
function apply(projectRoot, iconsDir) {
  return applyAndroidIcons({
    projectRoot,
    platformProjectRoot: path.join(projectRoot, 'android'),
    iconsDir,
  });
}

describe('react-native-nitro-ui/plugin', () => {
  it('copies the vectors and names them in the shrinker keep file', () => {
    const p = project();
    runPlugin(p.root, { androidIcons: './icons' });

    expect(fs.readdirSync(p.drawable).sort()).toEqual([
      'bold.xml',
      'legacy_badge.xml',
      'share.xml',
    ]);
    // Byte-for-byte: a rewritten vector is a different icon on screen.
    expect(
      fs.readFileSync(path.join(p.drawable, 'share.xml'), 'utf8')
    ).toContain('android:pathData="M2,2h20v20h-20z"');

    const keep = fs.readFileSync(p.keep, 'utf8');
    expect(keep).toContain(
      'tools:keep="@drawable/bold,@drawable/legacy_badge,@drawable/share"'
    );
    expect(keep).toContain('xmlns:tools="http://schemas.android.com/tools"');
  });

  it('hands back the config it was given, with its modRequest intact', () => {
    const p = project();
    expect(
      runPlugin(p.root, { androidIcons: 'icons' }).modRequest.projectRoot
    ).toBe(p.root);
  });

  it('leaves out what aapt would reject, and says why', () => {
    const p = project();
    const warnings = [];
    const spy = jest
      .spyOn(console, 'warn')
      .mockImplementation((line) => warnings.push(String(line)));
    try {
      runPlugin(p.root, { androidIcons: 'icons' });
    } finally {
      spy.mockRestore();
    }
    const copied = fs.readdirSync(p.drawable).sort();
    // `Not_A_Valid_Name.xml` and `share-24px.xml` are the two names `aapt`
    // rejects; copying either would break the build rather than miss an icon.
    expect(copied).toEqual(['bold.xml', 'legacy_badge.xml', 'share.xml']);
    expect(warnings.join('\n')).toMatch(/Not_A_Valid_Name\.xml/);
    expect(warnings.join('\n')).toMatch(/share-24px\.xml/);
    // A `<layer-list>` is a legal resource that a control may not be able to draw,
    // so it is copied and warned about rather than dropped.
    expect(warnings.join('\n')).toMatch(/legacy_badge\.xml is not a <vector>/);
    // `notes.txt` is not a drawable and gets no line at all.
    expect(warnings.join('\n')).not.toMatch(/notes\.txt/);
  });

  it('is a no-op the second time prebuild runs it', () => {
    const p = project();
    apply(p.root, 'icons');
    const keepOnce = fs.readFileSync(p.keep, 'utf8');
    const drawablesOnce = fs.readdirSync(p.drawable).sort();

    apply(p.root, 'icons');
    expect(fs.readFileSync(p.keep, 'utf8')).toBe(keepOnce);
    expect(fs.readdirSync(p.drawable).sort()).toEqual(drawablesOnce);
    // One attribute, not two: the merge has to replace `tools:keep`, because the
    // shrinker reads the attribute, not the file's history.
    expect(
      (fs.readFileSync(p.keep, 'utf8').match(/tools:keep=/g) ?? []).length
    ).toBe(1);
  });

  it('keeps the app’s own keep rules when it merges', () => {
    const p = project(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@font/brand" />\n'
    );
    apply(p.root, 'icons');
    const keep = fs.readFileSync(p.keep, 'utf8');
    expect(keep).toContain('@font/brand');
    expect(keep).toContain('@drawable/share');
    expect((keep.match(/tools:keep=/g) ?? []).length).toBe(1);
  });

  it('adds the tools namespace to a keep file that has none', () => {
    const p = project(
      '<?xml version="1.0" encoding="utf-8"?>\n<resources />\n'
    );
    apply(p.root, 'icons');
    const keep = fs.readFileSync(p.keep, 'utf8');
    expect(keep).toContain('xmlns:tools="http://schemas.android.com/tools"');
    expect(keep).toContain('tools:keep="@drawable/bold');
  });

  it('refuses to overwrite a keep file it cannot read', () => {
    const p = project(
      '<?xml version="1.0" encoding="utf-8"?>\n<notResources />\n'
    );
    expect(() => apply(p.root, 'icons')).toThrow(/no <resources> element/);
  });

  it('says so when androidIcons is not a folder', () => {
    const p = project();
    expect(() => apply(p.root, 'icons-that-were-never-shipped')).toThrow(
      /is not a folder/
    );
  });

  it('does nothing, without failing prebuild, when there is no Android project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-plugin-ios-'));
    tempDirs.push(root);
    fs.cpSync(ICONS, path.join(root, 'icons'), { recursive: true });
    const result = applyAndroidIcons({
      projectRoot: root,
      platformProjectRoot: path.join(root, 'ios'),
      iconsDir: 'icons',
    });
    expect(result.status).toBe('no-android-project');
    expect(result.copied).toEqual([]);
    expect(result.warnings.join(' ')).toContain('no Android app folder');
  });

  it('is opt-in: no androidIcons prop copies nothing', () => {
    const p = project();
    expect(apply(p.root, undefined).status).toBe('no-androidIcons');
    expect(fs.existsSync(p.drawable)).toBe(false);
    expect(fs.existsSync(p.keep)).toBe(false);
  });
});
