import { isRecordLike } from "@prodkit/shared/runtime";
import {
  createOpTypeDetector,
  type OpTypeDetector,
  type TypeAwareRuleContext,
} from "../op-type-detector.js";

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
  arguments?: unknown;
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

type BlockStatementNode = RangedNode & {
  type: "BlockStatement";
};

type FunctionWithParamsNode = FunctionLikeNode & {
  id?: unknown;
  params?: unknown;
};

type ImportDeclarationNode = RangedNode & {
  type: "ImportDeclaration";
  source?: unknown;
  specifiers?: unknown;
};

type VariableDeclaratorNode = RangedNode & {
  type: "VariableDeclarator";
  id?: unknown;
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

type FunctionFrame = {
  isOpGeneratorBody: boolean;
};

type BindingKind = "local" | "prodkit-op";

type BindingDeclarer = (name: string, kind: BindingKind) => void;

type FallbackOpIdentifierPredicate = (node: unknown) => node is IdentifierNode;

type OpTypeDetectorProvider = () => OpTypeDetector | undefined;

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

function isBlockStatement(value: unknown): value is BlockStatementNode {
  return isRecordLike(value) && isNodeWithType(value, "BlockStatement");
}

function isFunctionLike(value: unknown): value is FunctionLikeNode {
  if (!isRecordLike(value)) return false;
  const generator = value["generator"];

  return isNode(value) && typeof generator === "boolean";
}

function isFunctionWithParams(value: unknown): value is FunctionWithParamsNode {
  return isFunctionLike(value);
}

function isImportDeclaration(value: unknown): value is ImportDeclarationNode {
  return isRecordLike(value) && isNodeWithType(value, "ImportDeclaration");
}

function isVariableDeclarator(value: unknown): value is VariableDeclaratorNode {
  return isRecordLike(value) && isNodeWithType(value, "VariableDeclarator");
}

export function isDirectOpBuilderCall(expression: unknown): expression is CallExpressionNode {
  return directOpBuilderObject(expression)?.name === "Op";
}

function isFallbackDirectOpBuilderCall(
  expression: unknown,
  isFallbackOpIdentifier: FallbackOpIdentifierPredicate,
): boolean {
  const object = directOpBuilderObject(expression);
  return object !== undefined && isFallbackOpIdentifier(object);
}

function directOpBuilderObject(expression: unknown): IdentifierNode | undefined {
  if (!isCallExpression(expression)) return undefined;
  if (!isStaticMemberExpression(expression.callee)) return undefined;

  const { object, property } = expression.callee;

  return isIdentifier(object) && isIdentifier(property) && opBuilderNames.has(property.name)
    ? object
    : undefined;
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
    let opTypeDetector: OpTypeDetector | undefined;
    let opTypeDetectorResolved = false;
    const getOpTypeDetector: OpTypeDetectorProvider = () => {
      if (!opTypeDetectorResolved) {
        opTypeDetectorResolved = true;
        opTypeDetector = createOpTypeDetector(context);
      }

      return opTypeDetector;
    };
    const opGeneratorArgumentRanges = new Set<string>();
    const functionStack: FunctionFrame[] = [];
    const scopeStack: Array<Map<string, BindingKind>> = [new Map()];
    const prodkitOpFactoryNames = new Set<string>();
    const declareBinding = (name: string, kind: BindingKind) => {
      scopeStack.at(-1)?.set(name, kind);
    };
    const resolveBinding = (name: string): BindingKind | undefined => {
      for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
        const scope = scopeStack[index];
        const binding = scope?.get(name);
        if (binding !== undefined) return binding;
      }

      return undefined;
    };
    const isFallbackOpIdentifier = (node: unknown): node is IdentifierNode => {
      if (!isIdentifier(node)) return false;

      const binding = resolveBinding(node.name);
      if (binding === "prodkit-op") return true;
      if (binding === "local") return false;

      return prodkitOpFactoryNames.size === 0 && node.name === "Op";
    };
    const enterFunction = (node: unknown) => {
      functionStack.push({
        isOpGeneratorBody: isOpGeneratorBody(
          node,
          opGeneratorArgumentRanges,
          getOpTypeDetector,
          isFallbackOpIdentifier,
        ),
      });
      scopeStack.push(new Map());
      declareFunctionParams(node, declareBinding);
    };
    const exitFunction = () => {
      functionStack.pop();
      scopeStack.pop();
    };
    const isInsideCurrentOpGenerator = () => functionStack.at(-1)?.isOpGeneratorBody === true;

    return {
      ImportDeclaration(node: unknown) {
        for (const name of prodkitOpImportNames(node)) {
          prodkitOpFactoryNames.add(name);
          declareBinding(name, "prodkit-op");
        }
      },
      BlockStatement(node: unknown) {
        if (isBlockStatement(node)) scopeStack.push(new Map());
      },
      "BlockStatement:exit"(node: unknown) {
        if (isBlockStatement(node)) scopeStack.pop();
      },
      CallExpression(node: unknown) {
        if (!isCallExpression(node)) return;

        const generatorArgument = opFactoryGeneratorArgument(
          node,
          getOpTypeDetector,
          isFallbackOpIdentifier,
        );
        if (generatorArgument !== undefined) {
          opGeneratorArgumentRanges.add(nodeRangeKey(generatorArgument));
        }
      },
      FunctionDeclaration(node: unknown) {
        declareFunctionName(node, declareBinding);
        enterFunction(node);
      },
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      VariableDeclarator(node: unknown) {
        declareVariable(node, declareBinding);
      },
      ExpressionStatement(node: unknown) {
        if (!isInsideCurrentOpGenerator()) return;
        if (!isExpressionStatement(node)) return;
        if (!isOpExpressionStatement(node.expression, getOpTypeDetector, isFallbackOpIdentifier))
          return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.insertTextBefore(asRangedNode(node.expression), "yield* "),
        });
      },
      ReturnStatement(node: unknown) {
        if (!isInsideCurrentOpGenerator()) return;
        if (!isReturnStatement(node)) return;
        if (isYieldExpression(node.argument) || isAwaitExpression(node.argument)) return;
        if (!isOpExpression(node.argument, getOpTypeDetector, isFallbackOpIdentifier)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.insertTextBefore(asRangedNode(node.argument), "yield* "),
        });
      },
      YieldExpression(node: unknown) {
        if (!isInsideCurrentOpGenerator()) return;
        if (!isYieldExpression(node)) return;
        if (node.delegate === true) return;
        if (!isOpExpression(node.argument, getOpTypeDetector, isFallbackOpIdentifier)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.replaceTextRange(keywordRange(node, "yield"), "yield*"),
        });
      },
      AwaitExpression(node: unknown) {
        if (!isInsideCurrentOpGenerator()) return;
        if (!isAwaitExpression(node)) return;
        if (!isOpExpression(node.argument, getOpTypeDetector, isFallbackOpIdentifier)) return;

        context.report({
          node,
          messageId: "missingYieldStar",
          fix: (fixer) => fixer.replaceTextRange(keywordRange(node, "await"), "yield*"),
        });
      },
    };
  },
};

function prodkitOpImportNames(node: unknown): string[] {
  if (!isImportDeclaration(node)) return [];
  if (!isRecordLike(node.source) || node.source["value"] !== "@prodkit/op") return [];
  if (!Array.isArray(node.specifiers)) return [];

  const names: string[] = [];
  for (const specifier of node.specifiers) {
    if (!isRecordLike(specifier) || specifier["type"] !== "ImportSpecifier") continue;
    const imported = specifier["imported"];
    const local = specifier["local"];
    if (isIdentifierNamed(imported, "Op") && isIdentifier(local)) {
      names.push(local.name);
    }
  }

  return names;
}

function declareFunctionName(node: unknown, declareBinding: BindingDeclarer): void {
  if (!isFunctionWithParams(node)) return;
  if (isIdentifier(node.id)) declareBinding(node.id.name, "local");
}

function declareFunctionParams(node: unknown, declareBinding: BindingDeclarer): void {
  if (!isFunctionWithParams(node) || !Array.isArray(node.params)) return;

  for (const param of node.params) {
    declarePattern(param, declareBinding);
  }
}

function declareVariable(node: unknown, declareBinding: BindingDeclarer): void {
  if (!isVariableDeclarator(node)) return;

  declarePattern(node.id, declareBinding);
}

function declarePattern(pattern: unknown, declareBinding: BindingDeclarer): void {
  if (isIdentifier(pattern)) {
    declareBinding(pattern.name, "local");
    return;
  }
  if (!isRecordLike(pattern)) return;

  const type = pattern["type"];
  if (type === "RestElement") {
    declarePattern(pattern["argument"], declareBinding);
    return;
  }
  if (type === "AssignmentPattern") {
    declarePattern(pattern["left"], declareBinding);
    return;
  }
  if (type === "ArrayPattern" && Array.isArray(pattern["elements"])) {
    for (const element of pattern["elements"]) {
      declarePattern(element, declareBinding);
    }
    return;
  }
  if (type === "ObjectPattern" && Array.isArray(pattern["properties"])) {
    for (const property of pattern["properties"]) {
      if (!isRecordLike(property)) continue;
      if (property["type"] === "Property") declarePattern(property["value"], declareBinding);
      if (property["type"] === "RestElement") declarePattern(property["argument"], declareBinding);
    }
  }
}

function isOpGeneratorBody(
  node: unknown,
  opGeneratorArgumentRanges: ReadonlySet<string>,
  getOpTypeDetector: OpTypeDetectorProvider,
  isFallbackOpIdentifier: FallbackOpIdentifierPredicate,
): boolean {
  if (!isFunctionLike(node) || node.generator !== true) return false;
  if (opGeneratorArgumentRanges.has(nodeRangeKey(node))) return true;

  return isFirstArgumentOfOpFactoryCall(node, getOpTypeDetector, isFallbackOpIdentifier);
}

function opFactoryGeneratorArgument(
  callExpression: CallExpressionNode,
  getOpTypeDetector: OpTypeDetectorProvider,
  isFallbackOpIdentifier: FallbackOpIdentifierPredicate,
): RangedNode | undefined {
  if (!isKnownOpFactoryCallee(callExpression.callee, getOpTypeDetector, isFallbackOpIdentifier)) {
    return undefined;
  }
  if (!Array.isArray(callExpression.arguments)) return undefined;

  const [firstArgument] = callExpression.arguments;
  return isFunctionLike(firstArgument) && firstArgument.generator === true
    ? firstArgument
    : undefined;
}

function isFirstArgumentOfOpFactoryCall(
  node: unknown,
  getOpTypeDetector: OpTypeDetectorProvider,
  isFallbackOpIdentifier: FallbackOpIdentifierPredicate,
): boolean {
  if (!isRecordLike(node)) return false;

  const parent = node["parent"];
  if (!isCallExpression(parent)) return false;
  if (!isKnownOpFactoryCallee(parent.callee, getOpTypeDetector, isFallbackOpIdentifier)) {
    return false;
  }
  if (!Array.isArray(parent.arguments)) return false;

  return parent.arguments[0] === node;
}

function isKnownOpFactoryCallee(
  callee: unknown,
  getOpTypeDetector: OpTypeDetectorProvider,
  isFallbackOpIdentifier: FallbackOpIdentifierPredicate,
): boolean {
  if (isFallbackOpIdentifier(callee)) return true;
  if (!isNode(callee)) return false;

  return getOpTypeDetector()?.isOpFactoryExpression(callee) === true;
}

function isOpExpressionStatement(
  expression: unknown,
  getOpTypeDetector: OpTypeDetectorProvider,
  isFallbackOpIdentifier: FallbackOpIdentifierPredicate,
): boolean {
  if (isYieldExpression(expression) || isAwaitExpression(expression)) return false;

  return isOpExpression(expression, getOpTypeDetector, isFallbackOpIdentifier);
}

function isOpExpression(
  expression: unknown,
  getOpTypeDetector: OpTypeDetectorProvider,
  isFallbackOpIdentifier: FallbackOpIdentifierPredicate,
): boolean {
  if (isFallbackDirectOpBuilderCall(expression, isFallbackOpIdentifier)) return true;
  if (!isNode(expression)) return false;

  return getOpTypeDetector()?.isOpExpression(expression) === true;
}

function asRangedNode(node: unknown): RangedNode {
  if (isNode(node)) return node;

  throw new TypeError("Expected ranged AST node for require-yield-star autofix.");
}

function keywordRange(node: RangedNode, keyword: "await" | "yield"): [number, number] {
  return [node.range[0], node.range[0] + keyword.length];
}

function nodeRangeKey(node: RangedNode): string {
  return `${node.range[0]}:${node.range[1]}`;
}
