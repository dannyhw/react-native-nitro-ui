import { Fragment, type ReactNode, isValidElement } from 'react';

import { Switch } from '../Switch/Switch';

/**
 * The controls a Host can compose, keyed by the component itself.
 *
 * Keyed by identity, not by name: `<Switch>` from this library is what a Host
 * composes, and a component called `Switch` that is not ours (RN's own, or an
 * app's) hands the composition a view it has never seen. A `Map` so the name in
 * the error comes from the same table as the permission - hosting one more
 * control means adding one row here, and nothing else decides.
 *
 * One row today: H1 ships the Host for Switch, which is T16's condition 1 ("one
 * arm per component before it is claimed"). The rest are refused rather than
 * rendered into a composition that was never measured for them.
 */
const HOSTABLE_CONTROLS = new Map<unknown, string>([[Switch, 'Switch']]);

/** The names in {@link HOSTABLE_CONTROLS}, for the error and the docs. */
export const HOSTABLE_NAMES: readonly string[] = [
  ...HOSTABLE_CONTROLS.values(),
];

/**
 * Fail loudly, in dev, when a Host holds something it cannot compose.
 *
 * **Why a check at all.** A Host composes its direct nitro-ui children and skips
 * everything else, so an RN view inside one draws nothing on Android: the only
 * thing that could have drawn it is the composition it was never invited into.
 * That is silently wrong, and JS is the only place that can name the child - the
 * native Host sees a `View`, never a `<ScrollView>`.
 *
 * **Why it throws on iOS too**, where `<Host>` is a passthrough and a plain RN
 * child would render fine. Not to be correct there, but to be *one* contract: a
 * Host's children are its content, not RN's, on both platforms (D23), and an app
 * must not learn that on the platform it did not test.
 *
 * **What it walks:** arrays and fragments, because neither exists in the native
 * tree - a child under a fragment *is* a direct child of the Host. It does not
 * walk into another component: what one renders is not visible from here, which
 * is the same limit the native direct-parent rule has.
 */
export function assertHostChildren(children: ReactNode): void {
  if (!__DEV__) {
    return;
  }
  visit(children, '');
}

/**
 * @param position where the child sits, for the error: `2`, or `1/0` under a
 *   fragment. Positions count per list, which is what a person can find in the
 *   JSX; a flattened index would name nothing.
 */
function visit(children: ReactNode, position: string): void {
  if (children == null || typeof children === 'boolean') {
    return;
  }
  if (Array.isArray(children)) {
    children.forEach((child, index) => {
      visit(child, join(position, index));
    });
    return;
  }
  if (!isValidElement(children)) {
    throw new Error(childError(describeText(children), position));
  }
  if (HOSTABLE_CONTROLS.has(children.type)) {
    return;
  }
  if (children.type === Fragment) {
    visit((children.props as { children?: ReactNode }).children, position);
    return;
  }
  throw new Error(childError(describeElement(children.type), position));
}

function join(position: string, index: number): string {
  return position === '' ? String(index) : `${position}/${index}`;
}

/**
 * What a child looks like to someone reading an error about it.
 *
 * Not `type.name` alone: an RN built-in is a `forwardRef` object (`View`, `Text`,
 * `ScrollView`), a native component is a string, and a minified component can
 * have an empty `name` - and "child 2 is an element" is as silent as the bug.
 */
function describeElement(type: unknown): string {
  if (typeof type === 'string') {
    return `<${type}>`;
  }
  if (typeof type === 'function') {
    return `<${nameOf(type) ?? 'anonymous component'}>`;
  }
  if (typeof type === 'object' && type !== null) {
    const named = type as {
      displayName?: string;
      render?: { displayName?: string; name?: string };
    };
    return `<${nameOf(named) ?? nameOf(named.render) ?? 'component'}>`;
  }
  return 'an element';
}

function nameOf(value: unknown): string | null {
  if (typeof value !== 'object' && typeof value !== 'function') {
    return null;
  }
  const named = value as { displayName?: string; name?: string };
  return named.displayName ?? (named.name === '' ? null : (named.name ?? null));
}

function describeText(child: ReactNode): string {
  const text = String(child);
  return `the text "${text.length > 20 ? `${text.slice(0, 20)}…` : text}"`;
}

function childError(child: string, position: string): string {
  return (
    'react-native-nitro-ui: a <Host> composes its direct children into one native ' +
    `composition, and renders only ${HOSTABLE_NAMES.join(', ')}. Child ${position || '0'} ` +
    `of this <Host> is ${child}, which it would skip on Android and lay out as a ` +
    'plain view on iOS. Move it outside the <Host>, or replace it with a control ' +
    `it renders (${HOSTABLE_NAMES.join(', ')}).`
  );
}
