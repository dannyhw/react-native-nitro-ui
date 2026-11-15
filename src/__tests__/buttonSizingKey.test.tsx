import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';
import { AssetRegistry, NativeModules } from 'react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Button } from '../components/Button/Button';
import { resetAndroidIconSourceForTests } from '../iconSource';

beforeEach(() => {
  // `useSizingId` asks the native core for an instance id.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

// Queries come off each test's own `render` result, not RTL's `screen`: some
// tests mount two controls.
function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

const keyOf = (view: RenderResult, testId: string): string =>
  String(nativeProps(view, testId).nuiSizingKey);

describe('Button · sizing key', () => {
  it('is the variant, the scale, both icon fields and the title', async () => {
    const view = await render(
      <Button
        title="Save"
        systemImage="square.and.arrow.down"
        variant="tonal"
        size="small"
        onPress={undefined}
        testID="plain"
      />
    );
    // The empty field is `androidIcon`. A missing value stays an empty field so
    // the fields after it do not shift.
    expect(keyOf(view, 'plain')).toBe(
      'tonal|small|square.and.arrow.down||Save'
    );
  });

  it('separates a pipe in the icon from a pipe in the title', async () => {
    // Unescaped, both of these would join to `filled|medium|x|a|b` and share one
    // cached size.
    const iconCarriesIt = await render(
      <Button title="b" systemImage="x|a" onPress={undefined} testID="icon" />
    );
    const titleCarriesIt = await render(
      <Button title="a|b" systemImage="x" onPress={undefined} testID="title" />
    );
    expect(keyOf(iconCarriesIt, 'icon')).toBe('filled|medium|x\\|a||b');
    expect(keyOf(titleCarriesIt, 'title')).toBe('filled|medium|x||a\\|b');
    expect(keyOf(iconCarriesIt, 'icon')).not.toBe(
      keyOf(titleCarriesIt, 'title')
    );
  });

  it('escapes a backslash too, so the escape cannot be forged', async () => {
    // Unescaped, an icon `a\` with title `b|c` and an icon `a\|b` with title `c`
    // would both join to `a\|b|c`. Written as expressions because a JSX attribute
    // string takes its backslashes literally.
    const backslashInIcon = await render(
      <Button
        title={'b|c'}
        systemImage={'a\\'}
        onPress={undefined}
        testID="first"
      />
    );
    const forgedIcon = await render(
      <Button
        title={'c'}
        systemImage={'a\\|b'}
        onPress={undefined}
        testID="second"
      />
    );
    expect(keyOf(backslashInIcon, 'first')).toBe('filled|medium|a\\\\||b\\|c');
    expect(keyOf(backslashInIcon, 'first')).not.toBe(
      keyOf(forgedIcon, 'second')
    );
  });

  it('tells no icon from an empty one and no title from an empty one', async () => {
    // `undefined` and `''` both reach native as "no image", so they must build
    // one key.
    const none = await render(
      <Button title="Save" onPress={undefined} testID="none" />
    );
    const empty = await render(
      <Button title="Save" systemImage="" onPress={undefined} testID="empty" />
    );
    expect(keyOf(none, 'none')).toBe(keyOf(empty, 'empty'));
  });

  it('separates two assets and refuses to key on an asset id', async () => {
    // With a dev server an asset resolves to a URL, without one to the release
    // drawable name. The assertions below hold either way.
    const sourceCode = NativeModules as { SourceCode?: unknown };
    const previous = sourceCode.SourceCode;
    sourceCode.SourceCode = {
      getConstants: () => ({
        scriptURL: 'http://10.0.2.2:8081/index.bundle?platform=android',
      }),
    };
    const register = (name: string, type: string): number =>
      AssetRegistry.registerAsset({
        fileSystemLocation: '/app/src/assets/icons',
        httpServerLocation: '/src/assets/icons',
        width: undefined,
        height: undefined,
        scales: [1],
        hash: `hash-of-${name}`,
        name,
        type,
      });
    const share = register('share_24px', 'xml');
    const star = register('star_24px', 'xml');
    const notAnIcon = register('photo', 'png');
    try {
      // The dev-server origin is read once and cached, so reset it now that
      // `SourceCode` is installed.
      resetAndroidIconSourceForTests();
      const withShare = await render(
        <Button
          title="Save"
          androidIcon={share}
          onPress={undefined}
          testID="share"
        />
      );
      const withStar = await render(
        <Button
          title="Save"
          androidIcon={star}
          onPress={undefined}
          testID="star"
        />
      );
      const withNeither = await render(
        <Button
          title="Save"
          androidIcon={notAnIcon}
          onPress={undefined}
          testID="neither"
        />
      );
      const withoutAnIcon = await render(
        <Button title="Save" onPress={undefined} testID="plain" />
      );

      expect(keyOf(withShare, 'share')).not.toBe(keyOf(withStar, 'star'));
      expect(keyOf(withShare, 'share')).toContain('share_24px');
      expect(keyOf(withStar, 'star')).toContain('star_24px');
      // Asset ids differ between bundles, so a key holding one would change with
      // every rebuild.
      expect(keyOf(withShare, 'share')).not.toContain(`|${share}|`);
      expect(keyOf(withShare, 'share')).not.toContain(`|${star}|`);
      // A `.png` asset cannot be an icon, so native is sent no icon at all.
      expect(keyOf(withNeither, 'neither')).toBe(keyOf(withoutAnIcon, 'plain'));
    } finally {
      sourceCode.SourceCode = previous;
    }
  });
});
