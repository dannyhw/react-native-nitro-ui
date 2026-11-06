import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Button } from '../components/Button/Button';
import {
  androidIconNameProblem,
  normalizeAndroidIconName,
  resetAndroidIconNameWarningsForTests,
  warnAndroidIconName,
} from '../iconName';

/**
 * The JavaScript half of the `androidIcon` name rules (task G19).
 *
 * Android answers "that is not a resource name" and "you did not ship that file"
 * with the same thing — no id, no icon, no exception — and only one of the two is
 * something the developer can fix while writing the screen. `androidIconNameProblem`
 * is the function that tells them apart before anything is shipped, so its table
 * is the whole value of the feature and it is asserted name by name rather than by
 * round-tripping the same regular expression.
 *
 * The Kotlin twin is `NitroUiIconNames`
 * (`android/src/test/java/com/margelo/nitro/nitroui/NitroUiIconTest.kt`), tested
 * from the same table. Two languages, two copies of a rule, and one shared list of
 * cases is the only thing that keeps them from drifting into different answers for
 * the same typo.
 */
beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
  resetAndroidIconNameWarningsForTests();
});

function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

describe('androidIcon name rules', () => {
  it('reads a name the way the file had to be renamed to build', () => {
    expect(normalizeAndroidIconName('Share')).toBe('share');
    expect(normalizeAndroidIconName('share-24px')).toBe('share_24px');
    expect(normalizeAndroidIconName('share.24px')).toBe('share_24px');
    expect(normalizeAndroidIconName('share')).toBe('share');
  });

  it('accepts every name a resource table could hold', () => {
    expect(androidIconNameProblem('share')).toBeNull();
    expect(androidIconNameProblem('ic_share_2')).toBeNull();
    expect(androidIconNameProblem('share24')).toBeNull();
    // Normalised first, so these are fine too - which is the point of normalising.
    expect(androidIconNameProblem('Share')).toBeNull();
    expect(androidIconNameProblem('share-24px')).toBeNull();
  });

  it('names the reason a name can never resolve', () => {
    // Each of these reaches `getIdentifier` as a name the resource table cannot
    // contain, and comes back indistinguishable from a missing file.
    expect(androidIconNameProblem('')).toMatch(/empty/);
    expect(androidIconNameProblem('24px_share')).toMatch(/resource name/);
    expect(androidIconNameProblem('share icon')).toMatch(/resource name/);
    expect(androidIconNameProblem('drawable/share')).toMatch(/resource name/);
    expect(androidIconNameProblem('_share')).toMatch(/resource name/);
  });

  it('warns once per bad name, and never about a good one', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      warnAndroidIconName('Button', 'androidIcon', 'Share Icon');
      warnAndroidIconName('Button', 'androidIcon', 'Share Icon');
      warnAndroidIconName('Button', 'androidIcon', 'Share Icon');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(
        /is not a valid Android resource name/
      );
      warnAndroidIconName('Button', 'androidIcon', 'share');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Button · androidIcon', () => {
  it('sends the normalised name, not the one that was typed', async () => {
    const view = await render(
      <Button title="Share" androidIcon="Share-24px" testID="a" />
    );
    expect(nativeProps(view, 'a').androidIcon).toBe('share_24px');
  });

  it('sends null when the prop is left out, so it cannot go missing between commits', async () => {
    const view = await render(<Button title="Share" testID="b" />);
    expect(nativeProps(view, 'b').androidIcon).toBeNull();
  });

  it('is part of the size configuration, because a glyph makes the control wider', async () => {
    // Two Buttons that differ only in `androidIcon` share one cached size if the
    // key omits it, and the second is laid out at the first one's width for the
    // life of the process - a wrong size that no device test can attribute.
    const plain = await render(<Button title="Share" testID="plain" />);
    const withIcon = await render(
      <Button title="Share" androidIcon="share" testID="icon" />
    );
    expect(nativeProps(withIcon, 'icon').nuiSizingKey).not.toBe(
      nativeProps(plain, 'plain').nuiSizingKey
    );
    expect(String(nativeProps(plain, 'plain').nuiSizingKey)).toBe(
      'filled|medium|||Share'
    );
  });

  it('escapes a pipe in the drawable name, spelled out', async () => {
    // Pinned as the literal key rather than as "these two keys differ". A
    // collision needs two *unescaped* fields to forge each other, and `title` is
    // escaped on its own, so dropping the escape on `androidIcon` alone would
    // still leave every pair of Buttons distinguishable - a test built as a
    // collision check therefore stays green over the very bug it is meant to
    // catch. The string is what says the field was escaped before it was joined.
    const view = await render(
      <Button title="c" androidIcon={'a|b'} testID="first" />
    );
    expect(nativeProps(view, 'first').nuiSizingKey).toBe(
      'filled|medium||a\\|b|c'
    );
  });

  it('warns in development about a name the app can never ship', async () => {
    // The call site, not the function: a rule nobody calls is a rule that does
    // not exist, and this is the line a developer actually sees.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await render(
        <Button title="Share" androidIcon="Share Icon" testID="c" />
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(
        /is not a valid Android resource name/
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing about a name that is merely unusual', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await render(
        <Button title="Share" androidIcon="Share-24px" testID="d" />
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
