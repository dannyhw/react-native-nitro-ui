import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AssetRegistry, PixelRatio } from 'react-native';

// React Native's own rules, taken rather than re-typed here, so that the two copies
// in `src/iconSource.ts` are pinned to the originals instead of to a second copy of
// the same string. `@react-native/asset-utils` is the package the Gradle plugin uses
// to file a bundled asset; `AssetSourceResolver` is the class React Native uses to
// name and locate one. Both are already in `node_modules`.
//
// `require`, not `import`: the resolver is not a public entry point (React Native's
// own `resolveAssetSource.js` reaches it the same way), and the package's exports map
// does not give a deep import like this a type.
import { getAndroidResourceIdentifier } from '@react-native/asset-utils';

/** The part of React Native's resolver this file compares against. */
const AssetSourceResolver = (
  require('react-native/Libraries/Image/AssetSourceResolver') as {
    default: new (
      serverUrl: string | null,
      jsbundleUrl: string | null,
      asset: unknown
    ) => { scaledAssetPath(): { uri: string } };
  }
).default;

/** The part of React Native's global asset resolver D43 says never to touch. */
const resolveAssetSource =
  require('react-native/Libraries/Image/resolveAssetSource') as {
    default: {
      addCustomSourceTransformer(transformer: unknown): void;
      setCustomSourceTransformer(transformer: unknown): void;
    };
  };

import {
  androidDrawableNameForAsset,
  type AndroidIconProp,
  androidIconDrawableName,
  androidIconResourceName,
  androidIconUrl,
  metroAssetUrl,
  resetAndroidIconSourceForTests,
  resolveAndroidIcon,
} from '../iconSource';

/**
 * The `androidIcon` wire format, from the side that writes it (task G19 fix round 1,
 * DECISIONS D43 item 2).
 *
 * `androidIcon` crossed into native as one normalised resource name in round 1. D43
 * added a second form - the `.xml` the app `require`s, which Metro carries - and this
 * file is where the two forms are kept from meaning different things in the two build
 * types:
 *
 *  - **Release:** the bundled `.xml` is an ordinary drawable, and the name native is
 *    sent is *React Native's* name for it, not one nitro-ui invented. Asserted
 *    against `getAndroidResourceIdentifier` itself, because the Gradle plugin files
 *    the copy under that name and `getIdentifier` is the lookup: an approximation
 *    that differs in one `replace` resolves to nothing, in a release build only, in
 *    front of a user.
 *  - **Development:** the same `require` is a file Metro serves, and React Native
 *    will not ask for it (`assetSupportsNetworkLoads` answers `false` for `xml` on
 *    Android). nitro-ui builds the URL instead of talking React Native out of that
 *    answer, and the spy on `addCustomSourceTransformer` is what keeps that promise
 *    rather than only stating it: registering a transformer would change how every
 *    `Image` in the app resolves its sources, which is the reason D43 says no.
 *
 * The Kotlin reader of this format is `NitroUiIconSource`
 * (`android/src/test/java/com/margelo/nitro/nitroui/NitroUiIconSourceTest.kt`).
 */

const DEV_ORIGIN = 'http://10.0.2.2:8081/';

/** What a `require('./icons/share_24px.xml')` registers, as Metro writes it. */
function registerVectorAsset(overrides: {
  httpServerLocation?: string;
  name?: string;
  type?: string;
  hash?: string;
  scales?: number[];
}): number {
  return AssetRegistry.registerAsset({
    fileSystemLocation: '/app/src/assets/icons',
    httpServerLocation: '/src/assets/icons',
    width: undefined,
    height: undefined,
    scales: [1],
    hash: 'a1b2c3d4',
    name: 'share_24px',
    type: 'xml',
    ...overrides,
  });
}

/**
 * Run [body] with `__DEV__` set to [value].
 *
 * The answer `resolveAndroidIcon` gives depends on the build type, and a unit test
 * process has exactly one of them, so the global is moved for the duration rather
 * than the function being written to take a flag the app would never pass.
 */
function withDev<T>(value: boolean, body: () => T): T {
  const dev = globalThis as unknown as { __DEV__: boolean };
  const previous = dev.__DEV__;
  dev.__DEV__ = value;
  try {
    return body();
  } finally {
    dev.__DEV__ = previous;
  }
}

let warnings: string[] = [];
let warnSpy: { mockRestore(): void } = { mockRestore: () => {} };

beforeEach(() => {
  warnings = [];
  warnSpy = jest
    .spyOn(console, 'warn')
    .mockImplementation((...args: unknown[]) => {
      warnings.push(args.join(' '));
    });
  resetAndroidIconSourceForTests();
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('androidIcon · the release build', () => {
  it('names a bundled asset exactly the way React Native files it', () => {
    const asset = {
      httpServerLocation: '/src/assets/icons',
      name: 'share_24px',
      type: 'xml',
    };
    // The name is not nitro-ui's rule. If React Native's changes, this line is the
    // one that goes red, and it goes red here rather than in a release APK.
    expect(androidDrawableNameForAsset(asset)).toBe(
      getAndroidResourceIdentifier(
        asset as Parameters<typeof getAndroidResourceIdentifier>[0]
      )
    );
    expect(androidDrawableNameForAsset(asset)).toBe(
      'src_assets_icons_share_24px'
    );
  });

  /**
   * The asset form carries the `res:` marker; the typed form does not.
   *
   * Round 1 sent this string bare. It cannot be bare any more: the same function
   * that produced this name produces `__node_modules_expo_materialsymbols_star`
   * for an asset hoisted out of a workspace root, and native cannot tell the two
   * apart without being told which one it may look up without a second thought.
   */
  it("sends a bundled asset as that name, marked as the bundler's", () => {
    const id = registerVectorAsset({});
    const sent = withDev(false, () => resolveAndroidIcon(id));
    expect(sent).toBe('res:src_assets_icons_share_24px');
    expect(androidIconUrl(sent ?? '')).toBeNull();
    expect(androidIconDrawableName(sent ?? '')).toBe(
      'src_assets_icons_share_24px'
    );
  });

  it('files the same glyph under two paths as two drawables', () => {
    // The path is the name, so `icons/share_24px.xml` and `icons/v2/share_24px.xml`
    // are two resources. Collapsing them - `name` alone, say - would draw one
    // app's glyph for the other's, and both would look correct.
    const one = registerVectorAsset({
      httpServerLocation: '/src/assets/icons',
    });
    const two = registerVectorAsset({
      httpServerLocation: '/src/assets/icons/v2',
    });
    const [firstName, secondName] = withDev(false, () => [
      resolveAndroidIcon(one),
      resolveAndroidIcon(two),
    ]);
    expect(firstName).not.toBe(secondName);
    expect(secondName).toBe('res:src_assets_icons_v2_share_24px');
  });

  it('keeps round 1 drawable names working, unchanged', () => {
    expect(resolveAndroidIcon('Share')).toBe('share');
    expect(resolveAndroidIcon('share-24px')).toBe('share_24px');
    expect(resolveAndroidIcon('share')).toBe('share');
    expect(androidIconUrl(resolveAndroidIcon('share') ?? '')).toBeNull();
  });

  /**
   * An asset whose path walks out of the project root, which is what a monorepo
   * with hoisted `node_modules` hands Metro.
   *
   * `metro/src/Assets.js` builds `httpServerLocation` from the asset's folder
   * relative to the project root, so an icon installed once at the root of a
   * workspace is `/assets/../../node_modules/@expo/material-symbols` — and
   * React Native's own name for it starts with underscores, because the `..`s
   * survive as `_`s. That is a real name `aapt` accepted and `getIdentifier`
   * finds, and it is not a name a developer would ever write, so round 1's
   * "could this be a resource name?" gate refused it and a release build drew
   * nothing — in exactly the setup `docs/components/button.md` recommends.
   */
  it("names a hoisted asset React Native's way, and marks it as the bundler's", () => {
    const hoisted = {
      httpServerLocation: '/assets/../../node_modules/@expo/material-symbols',
      name: 'star',
      type: 'xml',
    };
    const rnName = getAndroidResourceIdentifier(
      hoisted as Parameters<typeof getAndroidResourceIdentifier>[0]
    );
    expect(androidDrawableNameForAsset(hoisted)).toBe(rnName);
    expect(rnName).toBe('__node_modules_expo_materialsymbols_star');
    // The reason the marker is needed: this passes no resource-name rule.
    expect(/^[a-z]/.test(rnName)).toBe(false);

    const id = registerVectorAsset({
      httpServerLocation: hoisted.httpServerLocation,
      name: hoisted.name,
    });
    const sent = withDev(false, () => resolveAndroidIcon(id));
    expect(sent).toBe(`res:${rnName}`);
    expect(androidIconUrl(sent ?? '')).toBeNull();
    expect(androidIconDrawableName(sent ?? '')).toBe(rnName);
    expect(androidIconResourceName(sent ?? '')).toBe(rnName);
    // A bundler-derived name is not a typo to report: the app wrote a `require`,
    // not a name, so the JS name rules have nothing to say about it.
    expect(warnings).toEqual([]);
  });
});

describe('androidIcon · the development build', () => {
  /**
   * The build type is where the bundle came from, not what `__DEV__` says.
   *
   * React Native itself decides by whether a server URL exists
   * (`AssetSourceResolver.isLoadedFromServer`), and the two can disagree: JS Dev
   * Mode off in the Expo Dev Launcher serves a `dev=false` bundle over Metro into
   * a *debug* APK, which is `__DEV__ === false` with a dev server right there.
   * Round 1 asked `__DEV__`, so that build resolved the drawable name — a file
   * Metro never put in the APK — and drew no imported icon at all.
   */
  it('asks Metro for a dev=false bundle that Metro is serving', () => {
    const id = registerVectorAsset({});
    const sent = withDev(false, () =>
      resolveAndroidIcon(id, {
        devServerOrigin: DEV_ORIGIN,
        deviceScale: 2,
      })
    );
    expect(androidIconUrl(sent ?? '')).toBe(
      'http://10.0.2.2:8081/src/assets/icons/share_24px.xml?platform=android&hash=a1b2c3d4'
    );
  });

  /**
   * …and the other way round, which is the half that costs a false warning.
   *
   * A debug build with the bundle *embedded* has no dev server and does have the
   * drawable in the APK, so the name is the right answer and there is nothing to
   * warn about. Round 1 warned "cannot reach the dev server" there, about a
   * control whose icon was drawing fine.
   */
  it('names the drawable when the bundle is embedded, and says nothing', () => {
    const id = registerVectorAsset({});
    const sent = withDev(true, () =>
      resolveAndroidIcon(id, {
        devServerOrigin: null,
        deviceScale: 2,
      })
    );
    expect(sent).toBe('res:src_assets_icons_share_24px');
    expect(warnings).toEqual([]);
  });

  it('asks Metro for the file React Native refuses to load', () => {
    const id = registerVectorAsset({});
    const sent = resolveAndroidIcon(id, {
      devServerOrigin: DEV_ORIGIN,
      deviceScale: 2,
    });
    expect(androidIconUrl(sent ?? '')).toBe(
      'http://10.0.2.2:8081/src/assets/icons/share_24px.xml?platform=android&hash=a1b2c3d4'
    );
    // And it is marked, which is what tells native to read a file rather than ask
    // the resource table - where the file does not exist in development.
    expect(sent?.startsWith('url:')).toBe(true);
  });

  /**
   * The URL is React Native's own shape, not a similar one.
   *
   * For an asset type React Native *will* serve - a `.png` - its resolver is the
   * implementation of this URL, so `metroAssetUrl` is asserted against it. The
   * single-scale case is in there deliberately: the `@1x` suffix is something Metro
   * only answers for assets it generated at that scale, and an invented one is a
   * 404 for every icon in development.
   */
  it('builds the URL React Native would build for the same asset', () => {
    // React Native's resolver owns two of the three parts of this URL — which
    // scale of the asset the device asks for, and the path that scale's file has —
    // and both are taken from it here rather than re-typed. `scaledAssetPath()` is
    // the platform-independent half, which is why the resolver can be asked at all:
    // `assetServerURL()`, the method that would be the obvious one to compare with,
    // refuses to answer without a server URL and stamps the *running* platform into
    // the result. The `platform=android` that stays hand-written is the deliberate
    // difference — an icon is only ever drawn by the Android half of the library,
    // so the URL says Android whichever platform the bundle was written on.
    for (const scales of [[1], [1, 2, 3, 4]]) {
      // The device ratio is React Native's own, not a number chosen here:
      // `scaledAssetPath()` picks a scale off `PixelRatio.get()`, so the two sides
      // only agree if the scale rule does too.
      const deviceScale = PixelRatio.get();
      const asset = {
        __packager_asset: true as const,
        fileSystemLocation: '/app/src/assets/icons',
        httpServerLocation: '/src/assets/icons',
        width: null,
        height: null,
        scales,
        hash: 'cafe1234',
        name: 'share_24px',
        // `.png` so React Native's resolver answers for it at all: `xml` is the
        // type it refuses to serve on Android, which is the whole reason
        // `metroAssetUrl` exists. The path and the scale rule are not type-dependent.
        type: 'png',
      };
      const resolver = new AssetSourceResolver(null, null, asset);
      expect(metroAssetUrl(asset, DEV_ORIGIN, deviceScale)).toBe(
        DEV_ORIGIN +
          resolver.scaledAssetPath().uri +
          '?platform=android&hash=' +
          asset.hash
      );
    }
  });

  it('refuses an asset that is not a vector drawable', () => {
    // A `.png` has no release answer this file could give: it is filed under a
    // drawable folder chosen by the *device's* density, not under one name. Refusing
    // it keeps the two build types answering the same question about the same file.
    const id = registerVectorAsset({ type: 'png' });
    expect(
      resolveAndroidIcon(id, { devServerOrigin: DEV_ORIGIN, deviceScale: 2 })
    ).toBeNull();
    expect(warnings.join('\n')).toMatch(/vector drawable \.xml/);
  });

  it('says so when an id has no asset behind it', () => {
    expect(
      resolveAndroidIcon(987654, {
        devServerOrigin: DEV_ORIGIN,
        deviceScale: 2,
      })
    ).toBeNull();
    expect(warnings.join('\n')).toMatch(/no asset registered under id 987654/);
  });

  /**
   * The whole point of D43's "Loading" decision, as an assertion.
   *
   * The way to make Android `.xml` assets load from Metro is to register a custom
   * source transformer, and that is a global: every `Image` in the app would then
   * resolve through nitro-ui's function. So nitro-ui never registers one, and a
   * spy on the registration function is the only way "never" is a fact rather than
   * a sentence. Break this by having `resolveAndroidIcon` call
   * `resolveAssetSource.addCustomSourceTransformer(...)` and it goes red.
   */
  it('never registers a transformer with React Native', () => {
    const added = jest.spyOn(
      resolveAssetSource.default,
      'addCustomSourceTransformer'
    );
    const set = jest.spyOn(
      resolveAssetSource.default,
      'setCustomSourceTransformer'
    );

    const id = registerVectorAsset({});
    const sources: (number | string | { uri: string } | null)[] = [
      id,
      'share_24px',
      { uri: 'https://example.com/share.xml' },
      null,
    ];
    for (const source of sources) {
      resolveAndroidIcon(source, {
        devServerOrigin: DEV_ORIGIN,
        deviceScale: 2,
      });
    }
    withDev(false, () => {
      resolveAndroidIcon(id);
    });

    expect(added).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    added.mockRestore();
    set.mockRestore();
  });
});

describe('androidIcon · the forms a caller can write', () => {
  it('marks a source with a remote uri so native reads it', () => {
    expect(
      androidIconUrl(
        resolveAndroidIcon({ uri: 'https://example.com/a.xml' }) ?? ''
      )
    ).toBe('https://example.com/a.xml');
    expect(
      androidIconUrl(
        resolveAndroidIcon({ uri: 'content://com.example/icon/1' }) ?? ''
      )
    ).toBe('content://com.example/icon/1');
  });

  it('reads a source with no scheme as the drawable name it also means as a string', () => {
    // `{ uri: 'share' }` and `'share'` are one configuration, not two: the same
    // word, the same drawable, and the same size configuration.
    expect(resolveAndroidIcon({ uri: 'Share' })).toBe(
      resolveAndroidIcon('Share')
    );
    expect(resolveAndroidIcon({ uri: 'share' })).toBe('share');
  });

  it('refuses the sources that cannot name artwork, and says why once each', () => {
    // A source *list* is the one `ImageSourcePropType` shape left out of
    // `AndroidIconProp`, so it arrives only from JS that skipped the type.
    expect(resolveAndroidIcon([] as unknown as AndroidIconProp)).toBeNull();
    expect(resolveAndroidIcon({ uri: '' })).toBeNull();
    expect(resolveAndroidIcon({})).toBeNull();
    expect(resolveAndroidIcon(undefined)).toBeNull();
    expect(resolveAndroidIcon(null)).toBeNull();
    // Once per reason, not once per render - a list of broken rows must not fill
    // the console, which is the same rule `warnAndroidIconName` keeps.
    resolveAndroidIcon({ uri: '' });
    expect(warnings.filter((line) => line.includes('no `uri`'))).toHaveLength(
      1
    );
  });

  it('leaves an absent icon absent', () => {
    expect(resolveAndroidIcon(null)).toBeNull();
    expect(resolveAndroidIcon(undefined)).toBeNull();
    expect(warnings).toHaveLength(0);
  });
});
