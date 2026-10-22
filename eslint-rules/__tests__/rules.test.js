// RuleTester coverage for the local perf/API guardrails (eslint-rules/index.js).
import { RuleTester } from 'eslint';
import * as tsParserModule from '@typescript-eslint/parser';

import nitroUi from '../index.js';

// ESLint wants the parser namespace itself (default export under real ESM).
const parser =
  typeof tsParserModule.parseForESLint === 'function'
    ? tsParserModule
    : tsParserModule.default;

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

const SPEC = 'src/Component.nitro.ts';

ruleTester.run(
  'no-inline-callback-in-jsx',
  nitroUi.rules['no-inline-callback-in-jsx'],
  {
    valid: [
      { filename: 'App.tsx', code: '<Switch onValueChange={onChange} />;' },
      { filename: 'App.tsx', code: '<Switch disabled={isDisabled()} />;' },
      {
        filename: 'App.tsx',
        code: '<Switch onValueChange={useMemo(() => callback(fn), [])} />;',
      },
      {
        filename: 'App.tsx',
        code: '<Switch onValueChange={useStableCallback(onChange)} />;',
      },
      { filename: 'App.tsx', code: '<Switch label="on" />;' },
      {
        // Spread attributes are checked, plain spreads are fine.
        filename: 'App.tsx',
        code: '<Switch {...props} />;',
      },
      {
        // Known gap (documented): a callback hoisted into a variable is not
        // tracked. Module-scope `callback()` is also the recommended pattern.
        filename: 'App.tsx',
        code: "import { callback } from 'react-native-nitro-modules';\nconst onChange = callback(fn);\n<Switch onValueChange={onChange} />;",
      },
    ],
    invalid: [
      {
        filename: 'App.tsx',
        code: '<Switch onValueChange={callback(fn)} />;',
        errors: [{ messageId: 'inlineCallback' }],
      },
      {
        filename: 'App.tsx',
        code: '<Switch onValueChange={() => callback(fn)} />;',
        errors: [{ messageId: 'inlineCallback' }],
      },
      {
        filename: 'App.tsx',
        code: '<Switch onValueChange={NitroModules.callback(fn)} />;',
        errors: [{ messageId: 'inlineCallback' }],
      },
      {
        filename: 'App.tsx',
        code: '<Row><Switch onChange={callback(save)} /></Row>;',
        errors: [{ messageId: 'inlineCallback' }],
      },
      {
        // Exactly one report, not one per enclosing JSX attribute.
        filename: 'App.tsx',
        code: '<Switch render={() => <Inner onValueChange={callback(fn)} />} />;',
        errors: [{ messageId: 'inlineCallback' }],
      },
      {
        // Aliased imports of the helper count too.
        filename: 'App.tsx',
        code: "import { callback as stable } from 'react-native-nitro-modules';\n<Switch onValueChange={stable(fn)} />;",
        errors: [{ messageId: 'inlineCallback' }],
      },
      {
        filename: 'App.tsx',
        code: '<Switch {...{ onValueChange: callback(fn) }} />;',
        errors: [{ messageId: 'inlineCallback' }],
      },
      {
        filename: 'App.tsx',
        code: '<Switch onValueChange={condition ? callback(a) : fallback} />;',
        errors: [{ messageId: 'inlineCallback' }],
      },
    ],
  }
);

ruleTester.run('no-anymap-in-spec', nitroUi.rules['no-anymap-in-spec'], {
  valid: [
    {
      filename: SPEC,
      code: 'interface P { style: Style }',
    },
    { filename: 'src/App.ts', code: 'let x: AnyMap;' },
  ],
  invalid: [
    {
      filename: SPEC,
      code: 'import type { AnyMap } from "react-native-nitro-modules";\ninterface P { config: AnyMap; }',
      errors: [{ messageId: 'anyMap' }],
    },
  ],
});

ruleTester.run('no-json-string-prop', nitroUi.rules['no-json-string-prop'], {
  valid: [
    { filename: SPEC, code: 'interface P { config: Config; }' },
    { filename: SPEC, code: 'interface P { label: string | null; }' },
    {
      filename: SPEC,
      code: 'interface P { jsonData: Record<string, string>[]; }',
    },
  ],
  invalid: [
    {
      filename: SPEC,
      code: 'interface P { configJson: string; }',
      errors: [{ messageId: 'jsonString' }],
    },
    {
      filename: SPEC,
      code: 'interface P { styleJSON: string | null; }',
      errors: [{ messageId: 'jsonString' }],
    },
  ],
});

ruleTester.run(
  'no-optional-view-props',
  nitroUi.rules['no-optional-view-props'],
  {
    valid: [
      {
        filename: SPEC,
        code: 'interface Props extends HybridViewProps { value: boolean; label: string | null; }',
      },
      {
        // Methods interfaces and plain structs may keep optional members.
        filename: SPEC,
        code: 'interface Methods extends HybridViewMethods { measure(): void; reset?(): void; }',
      },
      {
        // A plain struct is not view props.
        filename: SPEC,
        code: 'interface FrameRateRange { minimum: number; preferred?: number; }\ninterface Props extends HybridViewProps { frameRate: FrameRateRange; }',
      },
      {
        filename: SPEC,
        code: 'interface Props extends HybridViewProps { label: string | null; }\ntype View = HybridView<Props, Methods>\ninterface Methods extends HybridViewMethods {}',
      },
      {
        // Callback props must be optional: Nitro only unwraps RN's `{ f: fn }`
        // for props typed as functions, and `fn | null` (a variant) cannot.
        filename: SPEC,
        code: 'interface Props extends HybridViewProps { onValueChange?: (value: boolean, eventCount: number) => void; }',
      },
      {
        // `| undefined` is what `?` means, so it is equally fine.
        filename: SPEC,
        code: 'interface Props extends HybridViewProps { onValueChange: ((value: boolean) => void) | undefined; }',
      },
    ],
    invalid: [
      {
        filename: SPEC,
        code: 'interface Props extends HybridViewProps { label?: string; }',
        errors: [{ messageId: 'optionalProp' }],
      },
      {
        filename: SPEC,
        code: 'interface Props extends BaseViewProps, HybridViewProps { a?: number; b?: string; }',
        errors: [{ messageId: 'optionalProp' }, { messageId: 'optionalProp' }],
      },
      {
        // Indirect base: the shared control-props interface is the one that
        // extends HybridViewProps, the concrete props interface inherits it.
        filename: SPEC,
        code: 'interface ControlProps extends HybridViewProps {}\ninterface SwitchProps extends ControlProps { label?: string; }',
        errors: [{ messageId: 'optionalProp' }],
      },
      {
        // Type alias with an intersection instead of an interface.
        filename: SPEC,
        code: 'type Props = HybridViewProps & { tint?: string };',
        errors: [{ messageId: 'optionalProp' }],
      },
      {
        // Qualified base name (import * as n from '...'; extends n.HybridViewProps).
        filename: SPEC,
        code: 'interface Props extends n.HybridViewProps { label?: string; }',
        errors: [{ messageId: 'optionalProp' }],
      },
      {
        // Props named at the view boundary, without mentioning the base type.
        filename: SPEC,
        code: 'interface Props { label?: string; }\ninterface Methods extends HybridViewMethods {}\nexport type SwitchView = HybridView<Props, Methods>;',
        errors: [{ messageId: 'optionalProp' }],
      },
      {
        filename: SPEC,
        code: 'interface Methods extends HybridViewMethods {}\nexport type SwitchView = HybridView<{ label?: string }, Methods>;',
        errors: [{ messageId: 'optionalProp' }],
      },
      {
        // A nullable callback generates `std::variant<std::function, NullType>`,
        // which Nitro cannot convert (the `{ f: fn }` wrapper stays wrapped).
        filename: SPEC,
        code: 'interface Props extends HybridViewProps { onValueChange: ((value: boolean) => void) | null; }',
        errors: [{ messageId: 'callbackPropNotNullable' }],
      },
      {
        filename: SPEC,
        code: 'interface Props extends HybridViewProps { onValueChange: (value: boolean) => void; }',
        errors: [{ messageId: 'callbackPropMustBeOptional' }],
      },
    ],
  }
);
