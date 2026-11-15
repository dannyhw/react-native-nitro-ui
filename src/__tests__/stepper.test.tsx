import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { NitroUiStepperConfig } from '../components/Stepper/NitroUiStepperConfig';
import { Stepper } from '../components/Stepper/Stepper';

beforeEach(() => {
  // `useSizingId` asks the native core for an instance id.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

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
      // `hybridRef` is a JS-only attribute the generated view drops.
      return name !== 'hybridRef' && value === undefined;
    });
    expect(missing).toEqual([]);
  });

  it('sends null, not undefined, for the nullable props an app omits', async () => {
    const view = await render(<Stepper testID="nulls" />);
    const props = nativeProps(view, 'nulls');
    expect(props.accessibilityLabel).toBeNull();
    expect(props.nuiPerfId).toBeNull();
    expect(props.value).toBeNull();
    expect(props.defaultValue).toBe(0);
    expect(props.mostRecentEventCount).toBe(0);
  });

  it('wires onValueChange even when the app passes none', async () => {
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
