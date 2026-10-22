// Local ESLint plugin: perf/API guardrails for react-native-nitro-ui.
// CommonJS on purpose so both `eslint.config.mjs` and Jest can load it.
// See docs/research/setup-decisions.md §6 "Static guardrails".

/** Names that memoize a callback - a `callback(...)` inside them is stable. */
const STABLE_HOOK = /^use[A-Z_]/;

function isCallbackCallee(node) {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return callee.name === 'callback';
  }
  if (callee.type === 'MemberExpression' && !callee.computed) {
    return callee.property.name === 'callback';
  }
  return false;
}

function isStableHookCall(node) {
  return (
    node.callee.type === 'Identifier' && STABLE_HOOK.test(node.callee.name)
  );
}

const noInlineCallbackInJsx = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid inline callback(...) in JSX props - it creates a new function identity every render.',
    },
    schema: [],
    messages: {
      inlineCallback:
        'Inline callback() in JSX re-sends the prop on every render (identity diffing). Use the stable-callback helper (useStableCallback) or a memoized value instead.',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {(node: import('estree').Node) => void} report
     */
    function walk(node, report) {
      if (node == null || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child, report);
        }
        return;
      }
      if (node.type === 'CallExpression') {
        if (isCallbackCallee(node)) {
          report(node);
          return;
        }
        if (isStableHookCall(node)) {
          // useMemo(() => callback(fn), []) is stable by construction.
          return;
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent') {
          continue;
        }
        walk(node[key], report);
      }
    }

    return {
      JSXAttribute(node) {
        const expression =
          node.value != null && node.value.type === 'JSXExpressionContainer'
            ? node.value.expression
            : null;
        if (expression == null || expression.type === 'JSXEmptyExpression') {
          return;
        }
        walk(expression, (found) =>
          context.report({ node: found, messageId: 'inlineCallback' })
        );
      },
    };
  },
};

/** Only `*.nitro.ts` specs are checked by the three rules below. */
function isSpecFile(context) {
  const filename = context.filename ?? context.getFilename();
  return (
    /\.[\\/]src[\\/].*\.nitro\.tsx?$/.test(filename) ||
    /\.nitro\.tsx?$/.test(filename)
  );
}

function reportInSpecs(create) {
  return (context) => {
    if (!isSpecFile(context)) {
      return {};
    }
    return create(context);
  };
}

const noAnyMapInSpec = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid untyped AnyMap in Nitro specs - declare typed structs instead.',
    },
    schema: [],
    messages: {
      anyMap:
        'AnyMap is untyped and forces JSON-shaped props. Declare a typed struct instead.',
    },
  },
  create: reportInSpecs((context) => ({
    TSTypeReference(node) {
      if (
        node.typeName.type === 'Identifier' &&
        node.typeName.name === 'AnyMap'
      ) {
        context.report({ node, messageId: 'anyMap' });
      }
    },
  })),
};

const JSON_STRING_PROPS = /json$/i;

function annotationIsString(sourceCode, node) {
  if (node.typeAnnotation == null) {
    return false;
  }
  return /\bstring\b/.test(sourceCode.getText(node.typeAnnotation));
}

const noJsonStringProp = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid `*Json` string props in Nitro specs - use typed structs, not serialized JSON.',
    },
    schema: [],
    messages: {
      jsonString:
        'String props ending in "Json" mean serialized payloads over the bridge. Use a typed struct/array instead.',
    },
  },
  create: reportInSpecs((context) => ({
    TSPropertySignature(node) {
      const key = node.key;
      const name =
        key.type === 'Identifier'
          ? key.name
          : key.type === 'Literal'
            ? String(key.value)
            : null;
      if (name == null || !JSON_STRING_PROPS.test(name)) {
        return;
      }
      if (annotationIsString(context.sourceCode, node)) {
        context.report({ node: key, messageId: 'jsonString' });
      }
    },
  })),
};

function extendsHybridViewProps(node) {
  const heritage = node.extends || [];
  return heritage.some((clause) => {
    const expression = clause.expression;
    if (expression.type === 'Identifier') {
      return expression.name === 'HybridViewProps';
    }
    if (expression.type === 'TSQualifiedName') {
      return expression.left.name === 'HybridViewProps';
    }
    return false;
  });
}

const noOptionalViewProps = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid optional props in HybridViewProps interfaces (margelo/nitro#1184).',
    },
    schema: [],
    messages: {
      optionalProp:
        'Fabric sends `null` for removed props and Nitro only maps `undefined` to "unset" (margelo/nitro#1184), so an optional prop crashes when removed. Use `T | null`, default it in JS, and always pass it.',
    },
  },
  create: reportInSpecs((context) => ({
    TSInterfaceDeclaration(node) {
      if (!extendsHybridViewProps(node)) {
        return;
      }
      for (const member of node.body.body) {
        if (member.type === 'TSPropertySignature' && member.optional === true) {
          context.report({ node: member, messageId: 'optionalProp' });
        }
      }
    },
  })),
};

module.exports = {
  rules: {
    'no-inline-callback-in-jsx': noInlineCallbackInJsx,
    'no-anymap-in-spec': noAnyMapInSpec,
    'no-json-string-prop': noJsonStringProp,
    'no-optional-view-props': noOptionalViewProps,
  },
};
