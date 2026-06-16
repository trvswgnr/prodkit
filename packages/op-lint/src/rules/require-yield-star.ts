import { isRecordLike } from "@prodkit/shared/runtime";

const docsUrl = "https://github.com/trvswgnr/prodkit/tree/main/packages/op-lint#require-yield-star";

const opBuilderNames = new Set([
  "all",
  "allSettled",
  "any",
  "defer",
  "fail",
  "of",
  "race",
  "settle",
  "sleep",
  "try",
]);

type RangedNode = {
  type: string;
  range: readonly [number, number];
  loc?: unknown;
};

type RuleContext = {
  report(diagnostic: { node: RangedNode; messageId: "missingYieldStar" }): void;
};

type FunctionLikeNode = RangedNode & {
  generator?: boolean;
};

type ExpressionStatementNode = RangedNode & {
  type: "ExpressionStatement";
  expression: unknown;
};

type CallExpressionNode = RangedNode & {
  type: "CallExpression";
  callee: unknown;
};

type StaticMemberExpressionNode = RangedNode & {
  type: "MemberExpression";
  object: unknown;
  property: unknown;
  computed: false;
};

type IdentifierNode = RangedNode & {
  type: "Identifier";
  name: string;
};

function isNode(value: unknown): value is RangedNode {
  if (!isRecordLike(value)) return false;

  const range = value["range"];
  return (
    typeof value["type"] === "string" &&
    Array.isArray(range) &&
    range.length === 2 &&
    typeof range[0] === "number" &&
    typeof range[1] === "number"
  );
}

function isNodeWithType<T extends string>(
  value: unknown,
  type: T,
): value is RangedNode & { type: T } {
  return isNode(value) && value.type === type;
}

function isIdentifier(value: unknown): value is IdentifierNode {
  if (!isRecordLike(value)) return false;
  const name = value["name"];

  return isNodeWithType(value, "Identifier") && typeof name === "string";
}

function isIdentifierNamed(value: unknown, name: string): value is IdentifierNode {
  return isIdentifier(value) && value.name === name;
}

function isStaticMemberExpression(value: unknown): value is StaticMemberExpressionNode {
  if (!isRecordLike(value)) return false;
  const computed = value["computed"];

  return (
    isNodeWithType(value, "MemberExpression") &&
    computed === false &&
    Object.hasOwn(value, "object") &&
    Object.hasOwn(value, "property")
  );
}

function isCallExpression(value: unknown): value is CallExpressionNode {
  return (
    isRecordLike(value) && isNodeWithType(value, "CallExpression") && Object.hasOwn(value, "callee")
  );
}

function isExpressionStatement(value: unknown): value is ExpressionStatementNode {
  return (
    isRecordLike(value) &&
    isNodeWithType(value, "ExpressionStatement") &&
    Object.hasOwn(value, "expression")
  );
}

function isFunctionLike(value: unknown): value is FunctionLikeNode {
  if (!isRecordLike(value)) return false;
  const generator = value["generator"];

  return isNode(value) && typeof generator === "boolean";
}

export function isDirectOpBuilderCall(expression: unknown): expression is CallExpressionNode {
  if (!isCallExpression(expression)) return false;
  if (!isStaticMemberExpression(expression.callee)) return false;

  const { object, property } = expression.callee;

  return (
    isIdentifierNamed(object, "Op") && isIdentifier(property) && opBuilderNames.has(property.name)
  );
}

export const requireYieldStarRule = {
  meta: {
    type: "problem" as const,
    docs: {
      description: "Require composing direct Op builder calls with yield* inside generators.",
      recommended: true,
      url: docsUrl,
    },
    messages: {
      missingYieldStar: "Compose this Op with yield* so it runs inside the generator.",
    },
    schema: [],
  },
  create(context: RuleContext) {
    const functionStack: boolean[] = [];
    const enterFunction = (node: unknown) => {
      functionStack.push(isFunctionLike(node) && node.generator === true);
    };
    const exitFunction = () => {
      functionStack.pop();
    };
    const isInsideCurrentGenerator = () => functionStack.at(-1) === true;

    return {
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression() {
        functionStack.push(false);
      },
      "ArrowFunctionExpression:exit": exitFunction,
      ExpressionStatement(node: unknown) {
        if (!isInsideCurrentGenerator()) return;
        if (!isExpressionStatement(node)) return;
        if (!isDirectOpBuilderCall(node.expression)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
        });
      },
    };
  },
};
