/**
 * The `androidIcon` prop: what an app may pass, and the string native is sent.
 *
 * D43 item 2: an Android icon is a vector drawable `.xml` the app *imports*, the
 * way it imports an image — `require('./icons/share.xml')`. Metro then carries
 * that one file: in a release build it becomes an ordinary drawable resource, and
 * in development it is served by the dev server, which React Native will not do
 * for an `.xml` itself (see {@link metroAssetUrl} for why). Both answers are a
 * name or a URL, so the prop crosses into native as one plain string with a
 * marker in front of it — never an AnyMap, and never by patching React Native's
 * global asset resolver, which would change how every `Image` in the app
 * resolves its sources (DECISIONS D43, "Loading").
 *
 * The Kotlin twin of the marker rules is `NitroUiIconSource` in
 * `android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt`. The name
 * rules the third form relies on stay in `src/iconName.ts`.
 *
 * Everything here is internal except {@link AndroidIconProp}, which is app API
 * because an app writes the prop it describes (DECISIONS D14). The functions are
 * exported for this repo's tests and are not a public surface.
 */

import { AssetRegistry, NativeModules, PixelRatio } from 'react-native';
import type { ImageURISource } from 'react-native';

import { normalizeAndroidIconName } from './iconName';

/**
 * What {@link Button}'s `androidIcon` accepts on Android.
 *
 * `ImageSourcePropType`, narrowed to the three things an icon can be: the id
 * `require('./icons/share.xml')` evaluates to, a source with a `uri`, or an
 * Android resource name as a string (D42 item 3, kept by D43). A source *array*
 * is left out — a control draws one glyph, not a list to pick from.
 */
export type AndroidIconProp = string | number | ImageURISource;

/** The native string asks for a file to load. */
const URL_PREFIX = 'url:';

/**
 * The three forms as native sees them.
 *
 * `url:` is the only marker, and it cannot collide with the other form: an
 * Android resource name is `[a-z][a-z0-9_]*` and so can never contain a colon.
 * Leaving the prefix off is therefore the drawable-name form — which is exactly
 * what G19 round 1 sent, so a name keeps crossing the wire unchanged.
 */
export function markAndroidIconUrl(url: string): string {
  return URL_PREFIX + url;
}

/** The URL inside a {@link markAndroidIconUrl} string, or `null` if it has none. */
export function androidIconUrl(value: string): string | null {
  return value.startsWith(URL_PREFIX) ? value.slice(URL_PREFIX.length) : null;
}

/** The drawable name inside a native `androidIcon` string. */
export function androidIconDrawableName(value: string): string {
  return value.startsWith(URL_PREFIX) ? '' : value;
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

/**
 * Where the JS bundle was served from, in the form an asset URL needs.
 *
 * React Native reads it off `SourceCode` the same way (`getDevServerURL` in
 * `Libraries/Image/resolveAssetSource.js`) and, like it, this remembers the
 * answer: the bundle is not served from somewhere else halfway through a
 * session, and `resolveAndroidIcon` runs on every render of every control that
 * takes an icon, so re-asking would be a synchronous `getConstants()` per
 * Button per render. `assets://` and a `file://` bundle have no dev server, and
 * `null` is that answer - cached too, because it is an answer and not a failure.
 * It is a TurboModule rather than a root export, hence `NativeModules` — and
 * read lazily, because importing this module must not touch a native module:
 * the unit tests run it on Node.
 */
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
  // Same expression React Native uses: the origin of the URL the bundle came
  // from, with its trailing slash, and nothing else is a dev server.
  const match = scriptURL?.match(/^https?:\/\/.*?\//);
  cachedDevServerOrigin = match != null ? match[0] : null;
  return cachedDevServerOrigin;
}

/**
 * The `pickScale` of `react-native/Libraries/Image/AssetUtils.js`.
 *
 * Copied, not imported: the file is not a public entry point, and an icon has to
 * ask for the same scale of asset that an `Image` in the same app would. Metro
 * guarantees `scales` is sorted, so the first one at or above the device's is
 * the file on disk with that `@Nx` suffix.
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
 * The URL Metro serves an asset from — the file React Native refuses to load.
 *
 * `AssetSourceResolver.assetSupportsNetworkLoads()` answers `false` for
 * `type === 'xml'` on Android, on the grounds that AAPT precompiles vector
 * drawables into the resource table. That is true of a *release* build and wrong
 * about the dev server, which will happily serve the source `.xml` — and it is
 * the only copy that exists while you develop, because the file is not in the
 * APK. So nitro-ui asks for it here, with the same path and query React Native
 * itself would use for a `.png` (`assetServerURL` in `AssetSourceResolver.js`),
 * rather than registering a custom transformer to talk it out of that answer
 * (D43: patching the global resolver would change `Image` for the whole app).
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
  // Single-scale assets — every vector drawable, in practice — have no suffix,
  // and Metro 404s on one it did not generate.
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
 * The drawable name a bundled asset gets.
 *
 * In a release build the `.xml` is an ordinary resource, named after its path in
 * the app's source - `src/assets/icons/share_24px.xml` becomes
 * `src_assets_icons_share_24px` - because the bundler derives the name from the
 * path rather than keeping the file's own. These are the rules of that
 * derivation, from `@react-native/asset-utils`'s `getAndroidResourceIdentifier`
 * (`src/AndroidPathUtils.js`): what `AssetSourceResolver` answers with in a
 * release build, and what the Gradle plugin files the copied `.xml` under. Both
 * halves are React Native's, so a name built here is a name the file is actually
 * filed under - and `src/__tests__/iconSource.test.ts` asserts this copy against
 * their function, not against a second copy of the same string.
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

/** Warn once per rejected source; see `warnAndroidIconName` for the once. */
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

/**
 * Forget what this module remembers: the warning history and the dev server.
 *
 * For tests, which must each see a fresh console and, in the sizing-key suite,
 * a `SourceCode` that was only just installed.
 */
export function resetAndroidIconSourceForTests(): void {
  warnedSources.clear();
  cachedDevServerOrigin = undefined;
}

/**
 * The string native resolves an icon from, or `null` for "no icon".
 *
 * `null`, `undefined` and anything that cannot name artwork all answer `null`,
 * which is the prop being absent: the Button draws its no-icon self. The
 * rejected cases also say why, in development, because each of them is a call
 * site that looks like it should work.
 */
export function resolveAndroidIcon(
  source: AndroidIconProp | null | undefined,
  env: AndroidIconEnv = {}
): string | null {
  if (source == null) {
    return null;
  }

  // `require('./icons/share.xml')` evaluates to the asset's id in Metro's
  // registry, which is the only place the file's own path and hash exist.
  if (typeof source === 'number') {
    const asset = AssetRegistry.getAssetByID(source);
    if (asset == null) {
      // Reachable: `require` in a library that the app does not bundle the same
      // way, or an id that came from somewhere else entirely.
      warnAndroidIconSource(`has no asset registered under id ${source}`);
      return null;
    }
    // An icon is a vector drawable. `Image` takes a `.png`, and so does the
    // drawable-name form (a bitmap in `res/drawable/` draws), but a dev-server
    // load has to parse whatever bytes it is handed, and a bitmap asset has no
    // release answer this file could state: it is filed under a drawable folder the
    // *device's* density picks. So the type is the first question asked, before
    // either build type has an answer — a `.png` that loaded in development and
    // drew nothing in a release build would be one file answered two ways, which is
    // the thing this module exists to avoid.
    if (asset.type !== 'xml') {
      warnAndroidIconSource(
        `cannot use a .${asset.type} asset as an icon — pass a vector drawable .xml`
      );
      return null;
    }
    const deviceScale = env.deviceScale ?? PixelRatio.get();
    if (__DEV__) {
      const origin =
        env.devServerOrigin !== undefined
          ? env.devServerOrigin
          : devServerOriginFromNative();
      if (origin != null) {
        return markAndroidIconUrl(metroAssetUrl(asset, origin, deviceScale));
      }
      // No dev server to ask (an `assets://` bundle, say). The release answer is
      // the only one left, and it is wrong — the file is not in the APK, so this
      // resolves to the "not found" path and draws nothing.
      warnAndroidIconSource(
        `cannot reach the dev server for the asset at id ${source}`
      );
    }
    return androidDrawableNameForAsset(asset);
  }

  // A `{ uri }` source, as any `<Image>` accepts. The scheme decides which kind
  // of file it names; the same rule as for a bare string below, so the two
  // forms cannot mean different things.
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
  // Round 1's form, and round 1's rules: normalised for native, and checked for
  // the typos that a resource table could never hold (`iconName.ts`).
  return normalizeAndroidIconName(value);
}
