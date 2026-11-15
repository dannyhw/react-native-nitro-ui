import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AssetRegistry, PixelRatio } from 'react-native';

import { getAndroidResourceIdentifier } from '@react-native/asset-utils';

// `require`, not `import`: neither module is a public entry point of React
// Native, so a deep import has no types.
const AssetSourceResolver = (
  require('react-native/Libraries/Image/AssetSourceResolver') as {
    default: new (
      serverUrl: string | null,
      jsbundleUrl: string | null,
      asset: unknown
    ) => { scaledAssetPath(): { uri: string } };
  }
).default;

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
    expect(androidDrawableNameForAsset(asset)).toBe(
      getAndroidResourceIdentifier(
        asset as Parameters<typeof getAndroidResourceIdentifier>[0]
      )
    );
    expect(androidDrawableNameForAsset(asset)).toBe(
      'src_assets_icons_share_24px'
    );
  });

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

  // Metro builds `httpServerLocation` relative to the project root, so an asset
  // hoisted to a workspace root gets a path that walks out of the project.
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
    // Not a name the hand-typed rules accept, hence the marker.
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
    expect(warnings).toEqual([]);
  });
});

describe('androidIcon · the development build', () => {
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
    expect(sent?.startsWith('url:')).toBe(true);
  });

  it('builds the URL React Native would build for the same asset', () => {
    // `scaledAssetPath()` rather than `assetServerURL()`, which needs a server
    // URL and stamps the running platform into the result.
    for (const scales of [[1], [1, 2, 3, 4]]) {
      // `scaledAssetPath()` picks its scale from `PixelRatio.get()`.
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
        // `.png`, because React Native refuses to resolve an `xml` on Android.
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
    expect(resolveAndroidIcon({ uri: 'Share' })).toBe(
      resolveAndroidIcon('Share')
    );
    expect(resolveAndroidIcon({ uri: 'share' })).toBe('share');
  });

  it('refuses the sources that cannot name artwork, and says why once each', () => {
    // A source list is not an `AndroidIconProp`; only untyped JS can pass one.
    expect(resolveAndroidIcon([] as unknown as AndroidIconProp)).toBeNull();
    expect(resolveAndroidIcon({ uri: '' })).toBeNull();
    expect(resolveAndroidIcon({})).toBeNull();
    expect(resolveAndroidIcon(undefined)).toBeNull();
    expect(resolveAndroidIcon(null)).toBeNull();
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
