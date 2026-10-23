// Local ESLint plugin: perf/API guardrails for react-native-nitro-ui.
// CommonJS on purpose so both `eslint.config.mjs` and Jest can load it.
// See docs/research/setup-decisions.md §6 "Static guardrails".

/** Names that memoize a callback - a `callback(...)` inside them is stable. */
const STABLE_HOOK = /^use[A-Z_]/;

const NITRO_MODULES = 'react-native-nitro-modules';

/** Type names that wrap a view's props: `type X = HybridView<P, M>`. */
const VIEW_TYPE_NAMES = new Set(['HybridView', 'NitroView']);
/** Call names that take a view's props as first type argument. */
const VIEW_PROPS_CALL_NAMES = new Set(['viewProps', 'view', 'component']);
const PROPS_BASE_NAME = 'HybridViewProps';

/** `Foo`, `ns.Foo` and `foo.bar` all resolve to the last segment. */
function lastSegment(node) {
  let current = node;
  while (current != null) {
    if (current.type === 'Identifier') {
      return current.name;
    }
    if (current.type === 'TSQualifiedName') {
      current = current.right;
      continue;
    }
    if (current.type === 'MemberExpression' && !current.computed) {
      current = current.property;
      continue;
    }
    return null;
  }
  return null;
}

function typeArguments(node) {
  return node.typeArguments?.params ?? node.typeParameters?.params ?? [];
}

/**
 * `callback(...)` is the stable-callback helper of `react-native-nitro-modules`.
 * Recognised as: the plain `callback` import (or any alias of it, such as
 * `import { callback as cb }`), a `nitroModules.callback(...)`-style member
 * call, or a bare `callback(...)` (files that import it under a different
 * binding still count, so the rule never silently stops working).
 */
function collectCallbackBindings(context) {
  const bindings = new Set(['callback']);
  for (const node of context.sourceCode.ast.body) {
    if (
      node.type !== 'ImportDeclaration' ||
      node.source.value !== NITRO_MODULES
    ) {
      continue;
    }
    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ImportSpecifier') {
        continue;
      }
      const imported =
        specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : String(specifier.imported.value);
      if (imported === 'callback') {
        bindings.add(specifier.local.name);
      }
    }
  }
  return bindings;
}

function isCallbackCallee(node, bindings) {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return bindings.has(callee.name);
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
        'Forbid callback(...) calls inside JSX attributes (including spread ' +
        'attributes) - they create a new function identity every render. Known ' +
        'gap: a callback stored in a variable (`const c = callback(fn)` in a ' +
        'render body) and then passed by name is not tracked; keep such values ' +
        'at module scope or inside a stable hook.',
    },
    schema: [],
    messages: {
      inlineCallback:
        'Inline callback() in JSX re-sends the prop on every render (identity diffing). Use the stable-callback helper (useStableCallback) or a memoized value instead.',
    },
  },
  create(context) {
    const bindings = collectCallbackBindings(context);
    const report = (node) =>
      context.report({ node, messageId: 'inlineCallback' });

    /**
     * @param {import('estree').Node | null | undefined} node
     */
    function walk(node) {
      if (node == null || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child);
        }
        return;
      }
      // Nested attributes get their own JSXAttribute/JSXSpreadAttribute visit,
      // which keeps a report at exactly one place per call.
      if (node.type === 'JSXAttribute' || node.type === 'JSXSpreadAttribute') {
        return;
      }
      if (node.type === 'CallExpression') {
        if (isCallbackCallee(node, bindings)) {
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
        walk(node[key]);
      }
    }

    function checkExpression(expression) {
      if (expression == null || expression.type === 'JSXEmptyExpression') {
        return;
      }
      walk(expression);
    }

    return {
      JSXAttribute(node) {
        checkExpression(
          node.value != null && node.value.type === 'JSXExpressionContainer'
            ? node.value.expression
            : null
        );
      },
      // <Switch {...{ onChange: callback(fn) }} /> is just as unstable.
      JSXSpreadAttribute(node) {
        checkExpression(node.argument);
      },
    };
  },
};

/** Only `*.nitro.ts` specs are checked by the three rules below. */
function isSpecFile(context) {
  return /\.nitro\.tsx?$/.test(context.filename ?? context.getFilename());
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

/**
 * Resolve a declared type name to its local declaration (spec files are
 * self-contained per view, so no cross-file or type-checker resolution is
 * available here).
 */
function createTypeScope(sourceCode) {
  /** @type {Map<string, import('estree').Node>} */
  const interfaces = new Map();
  /** @type {Map<string, import('estree').Node>} */
  const aliases = new Map();

  visit(sourceCode.ast, (node) => {
    if (node.type === 'TSInterfaceDeclaration') {
      interfaces.set(node.id.name, node);
    } else if (node.type === 'TSTypeAliasDeclaration') {
      aliases.set(node.id.name, node);
    }
  });

  return {
    interface(name) {
      return interfaces.get(name);
    },
    alias(name) {
      return aliases.get(name);
    },
    declarations: { interfaces, aliases },
  };
}

/** Depth-first walk over every node of a subtree. */
function visit(node, enter) {
  if (node == null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      visit(child, enter);
    }
    return;
  }
  if (typeof node.type !== 'string') {
    return;
  }
  enter(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    visit(node[key], enter);
  }
}

const noOptionalViewProps = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid optional props in Hybrid View props interfaces (margelo/nitro#1184).',
    },
    schema: [],
    messages: {
      optionalProp:
        'Fabric sends `null` for removed props and Nitro only maps `undefined` to "unset" (margelo/nitro#1184), so an optional prop crashes when removed. Use `T | null`, default it in JS, and always pass it.',
      callbackPropNotNullable:
        'RN sends callbacks as `{ f: fn }` and Nitro only unwraps `f` for props typed as a function. `fn | null` generates a variant (no unwrap) and throws while converting the prop, so declare callbacks as `fn?` (`std::optional<std::function>`) instead.',
      callbackPropMustBeOptional:
        'Declare a callback prop as `fn?` (`std::optional<std::function>`): a required one gives native a non-optional closure that cannot represent "no handler", and `fn | null` generates a variant Nitro cannot unwrap.',
    },
  },
  create: reportInSpecs((context) => ({
    Program(program) {
      const scope = createTypeScope(context.sourceCode);
      /** @type {Set<import('estree').Node>} */
      const reported = new Set();
      /** @type {Map<import('estree').Node, boolean>} */
      const propsCache = new Map();

      /** Is this a callback type - `(..) => T`, or a union containing one? */
      const isFunctionType = (node) => {
        if (node == null || typeof node !== 'object') {
          return false;
        }
        if (node.type === 'TSFunctionType') {
          return true;
        }
        if (node.type === 'TSUnionType') {
          return node.types.some((type) => isFunctionType(type));
        }
        return false;
      };

      /** Does a union type mention `null` (Nitro's `NullType`)? */
      const includesNull = (node) =>
        node?.type === 'TSNullKeyword' ||
        (node?.type === 'TSUnionType' &&
          node.types.some((type) => includesNull(type)));

      /** Does a union type mention `undefined` (which `?` already implies)? */
      const includesUndefined = (node) =>
        node?.type === 'TSUndefinedKeyword' ||
        (node?.type === 'TSUnionType' &&
          node.types.some((type) => includesUndefined(type)));

      const reportOptionalMembers = (container) => {
        if (container == null || reported.has(container)) {
          return;
        }
        reported.add(container);
        // TSInterfaceBody uses `body`, TSTypeLiteral uses `members`.
        for (const member of container.body ?? container.members ?? []) {
          if (member.type !== 'TSPropertySignature') {
            continue;
          }
          const type = member.typeAnnotation?.typeAnnotation;
          if (isFunctionType(type)) {
            // Callbacks are the one exception to the rule below: see the
            // `callbackProp*` messages.
            if (includesNull(type)) {
              context.report({
                node: member,
                messageId: 'callbackPropNotNullable',
              });
            } else if (member.optional !== true && !includesUndefined(type)) {
              context.report({
                node: member,
                messageId: 'callbackPropMustBeOptional',
              });
            }
            continue;
          }
          if (member.optional === true) {
            context.report({ node: member, messageId: 'optionalProp' });
          }
        }
      };

      /** Is this interface (transitively) extending `HybridViewProps`? */
      function isPropsInterface(node, seen = new Set()) {
        if (node == null || seen.has(node)) {
          return false;
        }
        seen.add(node);
        const cached = propsCache.get(node);
        if (cached != null) {
          return cached;
        }
        let result = false;
        for (const clause of node.extends ?? []) {
          const name = lastSegment(clause.expression);
          if (name == null) {
            continue;
          }
          if (name === PROPS_BASE_NAME) {
            result = true;
            break;
          }
          if (isPropsInterface(scope.interface(name), seen)) {
            result = true;
            break;
          }
        }
        propsCache.set(node, result);
        return result;
      }

      /** Does this type node reference props (base or a props interface)? */
      function mentionsProps(node, seen = new Set()) {
        if (node == null || typeof node !== 'object') {
          return false;
        }
        if (Array.isArray(node)) {
          return node.some((child) => mentionsProps(child, seen));
        }
        if (typeof node.type !== 'string' || seen.has(node)) {
          return false;
        }
        seen.add(node);
        switch (node.type) {
          case 'TSTypeReference': {
            const name = lastSegment(node.typeName);
            if (name === PROPS_BASE_NAME) {
              return true;
            }
            const ifce = scope.interface(name);
            if (ifce != null) {
              return isPropsInterface(ifce, seen) || mentionsProps(ifce, seen);
            }
            const alias = scope.alias(name);
            return alias != null && mentionsProps(alias.typeAnnotation, seen);
          }
          case 'TSInterfaceDeclaration':
            return (
              isPropsInterface(node, seen) ||
              (node.extends ?? []).some((clause) =>
                mentionsProps(clause.expression, seen)
              )
            );
          case 'TSIntersectionType':
          case 'TSUnionType':
            return node.types.some((type) => mentionsProps(type, seen));
          default:
            return (node.types ?? []).some((type) => mentionsProps(type, seen));
        }
      }

      /** Report optional members of every props type reachable from `node`. */
      function collectProps(node, seen = new Set()) {
        if (node == null || seen.has(node)) {
          return;
        }
        seen.add(node);
        switch (node.type) {
          case 'TSTypeLiteral':
            reportOptionalMembers(node);
            return;
          case 'TSIntersectionType':
          case 'TSUnionType':
            for (const type of node.types) {
              collectProps(type, seen);
            }
            return;
          case 'TSTypeReference': {
            const name = lastSegment(node.typeName);
            if (name === PROPS_BASE_NAME) {
              return;
            }
            const ifce = scope.interface(name);
            if (ifce != null) {
              reportOptionalMembers(ifce.body);
              for (const clause of ifce.extends ?? []) {
                collectProps(clause.expression, seen);
              }
              return;
            }
            const alias = scope.alias(name);
            if (alias != null) {
              collectProps(alias.typeAnnotation, seen);
            }
            return;
          }
          case 'Identifier':
          case 'TSQualifiedName':
          case 'MemberExpression': {
            const name = lastSegment(node);
            collectProps(scope.interface(name) ?? scope.alias(name), seen);
            return;
          }
          default:
            return;
        }
      }

      // 1) Every interface that (transitively) extends HybridViewProps, and
      //    every alias that intersects it.
      for (const ifce of scope.declarations.interfaces.values()) {
        if (isPropsInterface(ifce)) {
          reportOptionalMembers(ifce.body);
        }
      }
      for (const alias of scope.declarations.aliases.values()) {
        if (mentionsProps(alias.typeAnnotation)) {
          collectProps(alias.typeAnnotation);
        }
      }

      // 2) Props named at a view boundary: `type X = HybridView<P, M>` and
      //    `spec.viewProps<P>()`/`spec.view<P, M>()` calls. These are props even
      //    when the type never mentions HybridViewProps.
      visit(program, (node) => {
        if (node.type === 'TSTypeReference') {
          const name = lastSegment(node.typeName);
          if (VIEW_TYPE_NAMES.has(name)) {
            const args = typeArguments(node);
            if (args.length > 0) {
              collectProps(args[0]);
            }
          }
          return;
        }
        if (
          node.type === 'CallExpression' ||
          node.type === 'TSInstantiationExpression'
        ) {
          const name =
            node.callee != null
              ? lastSegment(node.callee)
              : lastSegment(node.expression);
          if (VIEW_PROPS_CALL_NAMES.has(name)) {
            const args = typeArguments(node);
            if (args.length > 0) {
              collectProps(args[0]);
            }
          }
        }
      });
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
