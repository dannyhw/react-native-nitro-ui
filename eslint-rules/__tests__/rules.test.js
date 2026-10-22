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
    ],
  }
);
