import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { NitroUiStepperConfig } from '../components/Stepper/NitroUiStepperConfig';
import { Stepper } from '../components/Stepper/Stepper';

/**
 * Wrapper-level tests for the Stepper (task G25).
 *
 * The device suite owns the value rules, the bounds and the geometry. These cover
 * what a device run cannot see from outside the JS side:
 *
 * - **the dev throw** for a `step` that is not greater than 0. A step of 0 is not a
 *   small step, it is no step: `NitroUiSliderValue.quantize` reads 0 as *continuous*,
 *   so the control would sit at one value and report nothing while looking like it
 *   worked. That is a wrong answer, not a small one, and the wrapper is the last
 *   place a message can reach a developer.
 * - **every prop always passed** (nitro#1184). No optional native prop may go
 *   `undefined` between two commits, so each key in the view config has to be
 *   present on every render, whatever the caller did or did not pass.
 * - **the empty sizing key**, which is the claim `docs/components/stepper.md` makes
 *   about the box: nothing a caller sends changes a Stepper's size. A harness sees
 *   only the sizes that come out of the cache this keys, so the string itself is a
 *   JS-side assertion.
 */
beforeEach(() => {
  // `useSizingId` asks native for an instance id; the root mock keeps a registry of
  // fakes for exactly that.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

/** The props the wrapper gave the native view with `testID`. */
function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

describe('Stepper · a step that is not a step', () => {
  it('throws in development when the step is 0', async () => {
    await expect(render(<Stepper step={0} testID="zero" />)).rejects.toThrow(
      /step.*must be greater than 0/s
    );
  });

  it('throws for a negative step, and for one that is not a number', async () => {
    await expect(
      render(<Stepper step={-1} testID="negative" />)
    ).rejects.toThrow(/must be greater than 0/);
    // `NaN` fails `step > 0` too, which is the point of the comparison being written
    // that way round rather than as `step <= 0`.
    await expect(
      render(<Stepper step={Number.NaN} testID="nan" />)
    ).rejects.toThrow(/must be greater than 0/);
  });

  it('says what it received', async () => {
    await expect(
      render(<Stepper step={0.5 / 2} testID="quarter" />)
    ).resolves.toBeTruthy();
    await expect(render(<Stepper step={-2.5} testID="says" />)).rejects.toThrow(
      /received -2\.5/
    );
  });
});

describe('Stepper · every prop, every render', () => {
  it('passes every prop the view config declares, none of them undefined', async () => {
    const view = await render(<Stepper testID="bare" />);
    const props = nativeProps(view, 'bare');
    const missing = Object.keys(
      NitroUiStepperConfig.validAttributes ?? {}
    ).filter((name) => {
      const value = props[name];
      // `hybridRef` is a JS-only attribute the generated view drops; `undefined` for
      // a native prop is the thing nitro#1184 forbids, so that is what is checked.
      return name !== 'hybridRef' && value === undefined;
    });
    expect(missing).toEqual([]);
  });

  it('sends null, not undefined, for the nullable props an app omits', async () => {
    const view = await render(<Stepper testID="nulls" />);
    const props = nativeProps(view, 'nulls');
    expect(props.accessibilityLabel).toBeNull();
    expect(props.nuiPerfId).toBeNull();
    // Uncontrolled: `value` is *null*, which is what tells native to keep its own
    // displayed value, and the seed rides `defaultValue` instead.
    expect(props.value).toBeNull();
    expect(props.defaultValue).toBe(0);
    expect(props.mostRecentEventCount).toBe(0);
  });

  it('wires onValueChange even when the app passes none', async () => {
    // Its own echo is what lets native accept the next `value` write (D7b), so the
    // prop may never become `null` mid-mount just because the caller is uncontrolled.
    const view = await render(<Stepper testID="silent" />);
    expect(nativeProps(view, 'silent').onValueChange).toBeDefined();
    expect(nativeProps(view, 'silent').onValueChange).not.toBeNull();
  });

  it('passes the defaults the docs promise', async () => {
    const view = await render(<Stepper testID="defaults" />);
    const props = nativeProps(view, 'defaults');
    expect(props.minimumValue).toBe(0);
    expect(props.maximumValue).toBe(100);
    expect(props.step).toBe(1);
    expect(props.disabled).toBe(false);
  });

  it('sends a controlled value, and the bottom of the range as an uncontrolled seed', async () => {
    const controlled = await render(
      <Stepper maximumValue={10} minimumValue={2} testID="on" value={4} />
    );
    expect(nativeProps(controlled, 'on').value).toBe(4);

    // `<Stepper minimumValue={20} />` must not seed a displayed value of 0: the
    // control would be showing a number it cannot legally hold.
    const floored = await render(
      <Stepper minimumValue={20} testID="floored" />
    );
    expect(nativeProps(floored, 'floored').value).toBeNull();
    expect(nativeProps(floored, 'floored').defaultValue).toBe(20);

    const seeded = await render(
      <Stepper defaultValue={7} minimumValue={20} testID="seeded" />
    );
    expect(nativeProps(seeded, 'seeded').defaultValue).toBe(7);
  });
});

describe('Stepper · the sizing configuration', () => {
  it('has one configuration, whatever the caller sends', async () => {
    // `''` is the claim: `minimumValue`, `maximumValue`, `step` and `disabled` decide
    // which numbers the control steps through and what its halves look like, never
    // how wide they are. A cache key per range would be forty entries of the same
    // size; a *missing* key for a prop that does move the box would be one entry for
    // two sizes. `Stepper.harness.tsx`'s one-box test is the device half of this.
    const view = await render(
      <View4
        a={<Stepper maximumValue={2} testID="small" value={1} />}
        b={
          <Stepper
            disabled
            maximumValue={2000}
            minimumValue={-500}
            step={0.5}
            testID="big"
            value={0}
          />
        }
      />
    );
    expect(nativeProps(view, 'small').nuiSizingKey).toBe('');
    expect(nativeProps(view, 'big').nuiSizingKey).toBe('');
    expect(nativeProps(view, 'small').nuiSizingId).toBe(1);
  });
});

/** Two children, one render, so two controls share a test's queries. */
function View4({ a, b }: { a: React.ReactNode; b: React.ReactNode }) {
  return (
    <>
      {a}
      {b}
    </>
  );
}
