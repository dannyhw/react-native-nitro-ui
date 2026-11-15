/**
 * Turns an `androidIcon` prop into the one string sent to native: a drawable
 * name, a `res:`-marked bundler name, or a `url:`-marked file URL.
 */

import { AssetRegistry, NativeModules, PixelRatio } from 'react-native';
import type { ImageURISource } from 'react-native';

import { normalizeAndroidIconName } from './iconName';

/**
 * What an `androidIcon` prop accepts: the id `require('./icons/share.xml')`
 * evaluates to, a source with a `uri`, or an Android drawable resource name.
 */
export type AndroidIconProp = string | number | ImageURISource;

// Markers on the string sent to native; `NitroUiIconSource` on Android parses
// the same two. An Android resource name is `[a-z][a-z0-9_]*`, so an unmarked
// drawable name can never be mistaken for a marked string.
const URL_PREFIX = 'url:';

const RESOURCE_PREFIX = 'res:';

export function markAndroidIconUrl(url: string): string {
  return URL_PREFIX + url;
}

/**
 * Marks a drawable name React Native derived from an asset's path. These skip
 * the check applied to hand-typed names: a hoisted asset is named like
 * `__node_modules_expo_materialsymbols_star`, which Android still finds.
 */
export function markAndroidIconResource(name: string): string {
  return RESOURCE_PREFIX + name;
}

export function androidIconUrl(value: string): string | null {
  return value.startsWith(URL_PREFIX) ? value.slice(URL_PREFIX.length) : null;
}

export function androidIconResourceName(value: string): string | null {
  return value.startsWith(RESOURCE_PREFIX)
    ? value.slice(RESOURCE_PREFIX.length)
    : null;
}

/** The drawable name in a native `androidIcon` string; `''` for a URL. */
export function androidIconDrawableName(value: string): string {
  if (value.startsWith(URL_PREFIX)) {
    return '';
  }
  return androidIconResourceName(value) ?? value;
}

/** `http://`, `https://`, `file://`, `content://`, `asset://` — anything with a scheme. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;

/** Environment overrides, so a test can state what the process knows. */
export interface AndroidIconEnv {
  /** The dev server's origin with a trailing slash, or `null` if there is none. */
  devServerOrigin?: string | null;
  /** The device's pixel ratio, used to pick a scale the way React Native does. */
  deviceScale?: number;
}

// The dev server's origin, or `null` when the bundle is embedded. Cached,
// `null` included: icons resolve on every render and `getConstants()` is
// synchronous. Read lazily so importing this module touches no native module.
let cachedDevServerOrigin: string | null | undefined;

function devServerOriginFromNative(): string | null {
  if (cachedDevServerOrigin !== undefined) {
    return cachedDevServerOrigin;
  }
  const sourceCode = (
    NativeModules as unknown as {
      SourceCode?: {
        getConstants?(): { scriptURL?: string };
        constants?: { scriptURL?: string };
      };
    }
  ).SourceCode;
  const scriptURL =
    sourceCode?.getConstants?.().scriptURL ?? sourceCode?.constants?.scriptURL;
  // The match React Native uses: only an http(s) bundle URL is a dev server.
  const match = scriptURL?.match(/^https?:\/\/.*?\//);
  cachedDevServerOrigin = match != null ? match[0] : null;
  return cachedDevServerOrigin;
}

/**
 * A copy of React Native's `pickScale` (`Libraries/Image/AssetUtils.js` is
 * not a public entry point), so an icon asks for the scale an `Image` would.
 * Metro sorts `scales` ascending.
 */
function pickScale(scales: readonly number[], deviceScale: number): number {
  for (const scale of scales) {
    if (scale >= deviceScale) {
      return scale;
    }
  }
  return scales[scales.length - 1] || 1;
}

/**
 * The URL Metro serves an asset from, built the way React Native builds one
 * for a `.png`. React Native will not load an `.xml` asset over the network
 * on Android, but in development the dev server holds the only copy.
 */
export function metroAssetUrl(
  asset: {
    httpServerLocation: string;
    name: string;
    type: string;
    hash: string;
    scales: readonly number[];
  },
  origin: string,
  deviceScale: number
): string {
  const basePath = asset.httpServerLocation.startsWith('/')
    ? asset.httpServerLocation.slice(1)
    : asset.httpServerLocation;
  const scale = pickScale(asset.scales, deviceScale);
  // A single-scale asset has no suffix, and Metro 404s on a scale it lacks.
  const scaleSuffix = scale === 1 ? '' : `@${scale}x`;
  return (
    origin +
    basePath +
    '/' +
    asset.name +
    scaleSuffix +
    '.' +
    asset.type +
    '?platform=android&hash=' +
    asset.hash
  );
}

/**
 * The drawable name a bundled asset gets in a release build, derived from its
 * path: `src/assets/icons/share_24px.xml` is `src_assets_icons_share_24px`.
 * Must match `getAndroidResourceIdentifier` in `@react-native/asset-utils`.
 */
export function androidDrawableNameForAsset(asset: {
  httpServerLocation: string;
  name: string;
}): string {
  const basePath = asset.httpServerLocation.startsWith('/')
    ? asset.httpServerLocation.slice(1)
    : asset.httpServerLocation;
  return (basePath + '/' + asset.name)
    .toLowerCase()
    .replace(/\//g, '_') // Encode the folder structure in the name
    .replace(/[^a-z0-9_]/g, '') // Drop what a resource table cannot hold
    .replace(/^(?:assets|assetsunstable_path)_/, ''); // and the assets/ prefix
}

const warnedSources = new Set<string>();

function warnAndroidIconSource(detail: string): void {
  if (!__DEV__ || warnedSources.has(detail)) {
    return;
  }
  warnedSources.add(detail);
  console.warn(
    `nitro-ui: androidIcon ${detail}. Nothing will be drawn for it. ` +
      `See docs/components/button.md, "Android icons".`
  );
}

export function resetAndroidIconSourceForTests(): void {
  warnedSources.clear();
  cachedDevServerOrigin = undefined;
}

/**
 * The string native resolves an icon from, or `null` for no icon.
 *
 * An imported asset resolves by where the bundle came from, not by `__DEV__`:
 * Metro can serve a `dev=false` bundle, and a debug build can embed its own.
 */
export function resolveAndroidIcon(
  source: AndroidIconProp | null | undefined,
  env: AndroidIconEnv = {}
): string | null {
  if (source == null) {
    return null;
  }

  // `require('./icons/share.xml')` evaluates to an id in Metro's registry.
  if (typeof source === 'number') {
    const asset = AssetRegistry.getAssetByID(source);
    if (asset == null) {
      warnAndroidIconSource(`has no asset registered under id ${source}`);
      return null;
    }
    // Vector drawables only: a release build files a bitmap asset under a
    // density-specific drawable folder, so it has no single name to send.
    if (asset.type !== 'xml') {
      warnAndroidIconSource(
        `cannot use a .${asset.type} asset as an icon — pass a vector drawable .xml`
      );
      return null;
    }
    const deviceScale = env.deviceScale ?? PixelRatio.get();
    const origin =
      env.devServerOrigin !== undefined
        ? env.devServerOrigin
        : devServerOriginFromNative();
    if (origin != null) {
      return markAndroidIconUrl(metroAssetUrl(asset, origin, deviceScale));
    }
    // No dev server: the bundle is embedded and the file is a drawable resource.
    return markAndroidIconResource(androidDrawableNameForAsset(asset));
  }

  if (typeof source === 'object') {
    const uri = source.uri;
    if (typeof uri !== 'string' || uri.length === 0) {
      warnAndroidIconSource('was given a source with no `uri`');
      return null;
    }
    return resolveAndroidIconString(uri);
  }

  if (typeof source !== 'string') {
    warnAndroidIconSource(
      `was given a ${Array.isArray(source) ? 'list of sources' : typeof source}`
    );
    return null;
  }

  return resolveAndroidIconString(source);
}

/** A string is a URL if it has a scheme, and a drawable name if it has none. */
function resolveAndroidIconString(value: string): string | null {
  if (SCHEME.test(value)) {
    return markAndroidIconUrl(value);
  }
  return normalizeAndroidIconName(value);
}
