import { isRecordLike } from "@prodkit/shared/runtime";
import { createOpTypeDetector, type TypeAwareRuleContext } from "../op-type-detector.js";

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

type RuleContext = TypeAwareRuleContext & {
  report(diagnostic: { node: RangedNode; messageId: "missingYieldStar"; fix?: FixFunction }): void;
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

type ReturnStatementNode = RangedNode & {
  type: "ReturnStatement";
  argument?: unknown;
};

type YieldExpressionNode = RangedNode & {
  type: "YieldExpression";
  argument?: unknown;
  delegate?: boolean;
};

type AwaitExpressionNode = RangedNode & {
  type: "AwaitExpression";
  argument?: unknown;
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

type Fix = {
  range: [number, number];
  text: string;
};

type Fixer = {
  insertTextBefore(nodeOrToken: RangedNode, text: string): Fix;
  replaceTextRange(range: [number, number], text: string): Fix;
};

type FixFunction = (fixer: Fixer) => Fix | Fix[] | Iterable<Fix> | null;

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

function isReturnStatement(value: unknown): value is ReturnStatementNode {
  return (
    isRecordLike(value) &&
    isNodeWithType(value, "ReturnStatement") &&
    Object.hasOwn(value, "argument")
  );
}

function isYieldExpression(value: unknown): value is YieldExpressionNode {
  return (
    isRecordLike(value) &&
    isNodeWithType(value, "YieldExpression") &&
    Object.hasOwn(value, "argument")
  );
}

function isAwaitExpression(value: unknown): value is AwaitExpressionNode {
  return (
    isRecordLike(value) &&
    isNodeWithType(value, "AwaitExpression") &&
    Object.hasOwn(value, "argument")
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
      description: "Require composing Ops with yield* inside generators.",
      recommended: true,
      url: docsUrl,
    },
    fixable: "code" as const,
    messages: {
      missingYieldStar: "Compose this Op with yield* so it runs inside the generator.",
    },
    schema: [],
  },
  create(context: RuleContext) {
    const opTypeDetector = createOpTypeDetector(context);
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
        if (!isOpExpressionStatement(node.expression, opTypeDetector)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.insertTextBefore(asRangedNode(node.expression), "yield* "),
        });
      },
      ReturnStatement(node: unknown) {
        if (!isInsideCurrentGenerator()) return;
        if (!isReturnStatement(node)) return;
        if (isYieldExpression(node.argument) || isAwaitExpression(node.argument)) return;
        if (!isOpExpression(node.argument, opTypeDetector)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.insertTextBefore(asRangedNode(node.argument), "yield* "),
        });
      },
      YieldExpression(node: unknown) {
        if (!isInsideCurrentGenerator()) return;
        if (!isYieldExpression(node)) return;
        if (node.delegate === true) return;
        if (!isOpExpression(node.argument, opTypeDetector)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.replaceTextRange(keywordRange(node, "yield"), "yield*"),
        });
      },
      AwaitExpression(node: unknown) {
        if (!isInsideCurrentGenerator()) return;
        if (!isAwaitExpression(node)) return;
        if (!isOpExpression(node.argument, opTypeDetector)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.replaceTextRange(keywordRange(node, "await"), "yield*"),
        });
      },
    };
  },
};

function isOpExpressionStatement(
  expression: unknown,
  opTypeDetector: ReturnType<typeof createOpTypeDetector>,
): boolean {
  if (isYieldExpression(expression) || isAwaitExpression(expression)) return false;

  return isOpExpression(expression, opTypeDetector);
}

function isOpExpression(
  expression: unknown,
  opTypeDetector: ReturnType<typeof createOpTypeDetector>,
): boolean {
  if (isDirectOpBuilderCall(expression)) return true;
  if (opTypeDetector === undefined || !isNode(expression)) return false;

  return opTypeDetector.isOpExpression(expression);
}

function asRangedNode(node: unknown): RangedNode {
  if (isNode(node)) return node;

  throw new TypeError("Expected ranged AST node for require-yield-star autofix.");
}

function keywordRange(node: RangedNode, keyword: "await" | "yield"): [number, number] {
  return [node.range[0], node.range[0] + keyword.length];
}
