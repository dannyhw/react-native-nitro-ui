// ESLint core rules that oxlint does not implement natively, rewritten to report
// what ESLint's versions report. CommonJS so both oxlint and Jest can load it.

const VALID_IDENTIFIER = /^[a-zA-Z_$][\w$]*$/u;

/** ES3 reserved words: ESLint's `dot-notation` exempts them unless `allowKeywords`. */
const ES3_KEYWORDS = new Set(
  (
    'abstract boolean break byte case catch char class const continue debugger ' +
    'default delete do double else enum export extends false final finally float ' +
    'for function goto if implements import in instanceof int interface long ' +
    'native new null package private protected public return short static super ' +
    'switch synchronized this throw throws transient true try typeof var void ' +
    'volatile while with'
  ).split(' ')
);

const dotNotation = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use dot notation where a key is a valid identifier' },
    schema: [
      {
        type: 'object',
        properties: {
          allowKeywords: { type: 'boolean' },
          allowPattern: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useDot: '[{{key}}] is better written in dot notation.',
      useBrackets: '.{{key}} is a syntax error.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowKeywords = options.allowKeywords !== false;
    const allowPattern = options.allowPattern
      ? new RegExp(options.allowPattern, 'u')
      : null;

    function check(node, value, display) {
      if (
        VALID_IDENTIFIER.test(value) &&
        (allowKeywords || !ES3_KEYWORDS.has(value)) &&
        !(allowPattern != null && allowPattern.test(value))
      ) {
        context.report({
          node: node.property,
          messageId: 'useDot',
          data: { key: display },
        });
      }
    }

    return {
      MemberExpression(node) {
        if (!node.computed) {
          if (
            !allowKeywords &&
            node.property.type === 'Identifier' &&
            ES3_KEYWORDS.has(node.property.name)
          ) {
            context.report({
              node: node.property,
              messageId: 'useBrackets',
              data: { key: node.property.name },
            });
          }
          return;
        }
        const property = node.property;
        if (
          property.type === 'Literal' &&
          (typeof property.value === 'string' ||
            typeof property.value === 'boolean' ||
            (property.value === null &&
              property.regex == null &&
              property.bigint == null))
        ) {
          check(node, String(property.value), JSON.stringify(property.value));
        } else if (
          property.type === 'TemplateLiteral' &&
          property.expressions.length === 0
        ) {
          const cooked = property.quasis[0].value.cooked;
          check(node, cooked, `\`${cooked}\``);
        }
      },
    };
  },
};

const consistentThis = {
  meta: {
    type: 'suggestion',
    docs: { description: "Name the one variable that holds 'this'" },
    schema: { type: 'array', items: { type: 'string', minLength: 1 } },
    messages: {
      aliasNotAssignedToThis:
        "Designated alias '{{name}}' is not assigned to 'this'.",
      unexpectedAlias: "Unexpected alias '{{name}}' for 'this'.",
    },
  },
  create(context) {
    const aliases = context.options.length > 0 ? context.options : ['that'];
    const sourceCode = context.sourceCode;

    function checkAssignment(node, name, value) {
      const isThis = value.type === 'ThisExpression';
      if (aliases.includes(name)) {
        if (!isThis || (node.operator != null && node.operator !== '=')) {
          context.report({
            node,
            messageId: 'aliasNotAssignedToThis',
            data: { name },
          });
        }
      } else if (isThis) {
        context.report({ node, messageId: 'unexpectedAlias', data: { name } });
      }
    }

    function checkWasAssigned(alias, scope) {
      const variable = scope.set.get(alias);
      if (variable == null) return;
      if (
        variable.defs.some(
          (def) =>
            def.node.type === 'VariableDeclarator' && def.node.init != null
        )
      ) {
        return;
      }
      const assignedThis = variable.references.some((reference) => {
        const write = reference.writeExpr;
        return (
          reference.from === scope &&
          write != null &&
          write.type === 'ThisExpression' &&
          write.parent.operator === '='
        );
      });
      if (!assignedThis) {
        for (const def of variable.defs) {
          context.report({
            node: def.node,
            messageId: 'aliasNotAssignedToThis',
            data: { name: alias },
          });
        }
      }
    }

    function ensureWasAssigned(node) {
      const scope = sourceCode.getScope(node);
      // A module's top-level bindings live in the module scope under the global one.
      const moduleScope =
        node.type === 'Program' && node.sourceType === 'module'
          ? scope.childScopes.find((child) => child.type === 'module')
          : null;
      for (const alias of aliases) {
        checkWasAssigned(alias, scope);
        if (moduleScope != null) checkWasAssigned(alias, moduleScope);
      }
    }

    return {
      'Program:exit': ensureWasAssigned,
      'FunctionExpression:exit': ensureWasAssigned,
      'FunctionDeclaration:exit': ensureWasAssigned,
      'VariableDeclarator'(node) {
        if (node.init != null && node.id.type === 'Identifier') {
          checkAssignment(node, node.id.name, node.init);
        }
      },
      'AssignmentExpression'(node) {
        if (node.left.type === 'Identifier') {
          checkAssignment(node, node.left.name, node.right);
        }
      },
    };
  },
};

const CONSTANT_BINDINGS = new Set(['const', 'using', 'await using']);

const noUndefInit = {
  meta: {
    type: 'suggestion',
    docs: { description: "Do not initialise a variable to 'undefined'" },
    schema: [],
    messages: {
      unnecessaryUndefinedInit:
        "It's not necessary to initialize '{{name}}' to undefined.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function undefinedIsShadowed(scope) {
      for (let current = scope; current != null; current = current.upper) {
        const variable = current.set.get('undefined');
        if (variable != null) return variable.defs.length > 0;
      }
      return false;
    }

    return {
      VariableDeclarator(node) {
        if (
          node.init?.type === 'Identifier' &&
          node.init.name === 'undefined' &&
          !CONSTANT_BINDINGS.has(node.parent.kind) &&
          !undefinedIsShadowed(sourceCode.getScope(node))
        ) {
          context.report({
            node,
            messageId: 'unnecessaryUndefinedInit',
            data: { name: sourceCode.getText(node.id) },
          });
        }
      },
    };
  },
};

module.exports = {
  meta: { name: 'eslint-core' },
  rules: {
    'dot-notation': dotNotation,
    'consistent-this': consistentThis,
    'no-undef-init': noUndefInit,
  },
};
