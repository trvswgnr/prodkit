import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as v from "valibot";
import { Op } from "@prodkit/op";
import { TaggedError } from "better-result";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import { readRepoRoot, RepoRootNotFoundError } from "./repo-root.ts";

export { createLogger } from "./logger.ts";
export { readRepoRoot };

type OwnPropertyValue<T, K extends PropertyKey> =
  // if it's not an object, we don't know anything about the type
  T extends object
    ? T extends (...args: never[]) => unknown // it could actually be a function which overlaps with `object` type
      ? unknown
      : object extends T // or it could literally be the `object` type
        ? unknown
        : K extends keyof T // best case: we know the object type, and the property exists
          ? T[K] // exact match, we know the type of the value
          : undefined // not a key of the object, so definitely undefined
    : unknown;

export const getOwnPropertyValue = <T, K extends PropertyKey>(
  value: T,
  key: K,
): OwnPropertyValue<T, K> => {
  return unsafeCoerce(
    typeof value === "object" && value !== null && Object.hasOwn(value, key)
      ? Reflect.get(value, key)
      : undefined,
  );
};

type RaiseFn = (cause: unknown) => never;
const raise: RaiseFn = (cause) => {
  throw cause;
};

export class InvalidJsonError extends TaggedError("InvalidJsonError")<{
  cause: SyntaxError;
  input: string;
}>() {}

export const parseJson = Op(function* (input: string) {
  return yield* Op.try(
    (): unknown => JSON.parse(input),
    (cause) => new InvalidJsonError({ cause: unsafeCoerce<SyntaxError>(cause), input }),
  );
});

// oxlint-disable-next-line typescript/no-explicit-any clever hack for non-empty string type
export type NonEmptyString = `${any}${string}`;
export const NonEmptyString: v.BaseSchema<string, NonEmptyString, v.StringIssue> = unsafeCoerce(
  v.pipe(v.string(), v.nonEmpty()),
);

export type NonEmptyArray<T> = [T, ...T[]];
export const NonEmptyArray = <S extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: S,
): v.BaseSchema<
  v.InferInput<S>[],
  NonEmptyArray<v.InferOutput<S>>,
  v.ArrayIssue | v.InferIssue<S>
> => unsafeCoerce(v.pipe(v.array(schema), v.nonEmpty()));

export const PackageJson = v.object({
  name: NonEmptyString,
  version: v.optional(NonEmptyString),
  main: v.optional(NonEmptyString),
  module: v.optional(NonEmptyString),
  exports: v.optional(
    v.record(NonEmptyString, v.union([NonEmptyString, v.record(NonEmptyString, NonEmptyString)])),
  ),
});
export type PackageJson = v.InferOutput<typeof PackageJson>;

export class ParseError extends TaggedError("ParseError")<{
  message?: string;
  issues: v.BaseIssue<unknown>[];
  input: unknown;
}>() {}
export const parse = <S extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: S,
  input: unknown,
) =>
  Op(function* () {
    const result = v.safeParse(schema, input);
    if (!result.success) {
      return yield* new ParseError({ issues: result.issues, input });
    }
    return result.output;
  });

export class NoEntError extends TaggedError("NoEntError")<{ path: string }>() {}

export class FileError extends TaggedError("FileError")<{
  type: "read" | "write";
  cause: unknown;
  path: string;
}>() {}

export const readFile = Op(function* (filepath: string, encoding?: BufferEncoding) {
  encoding ??= "utf8";
  return yield* Op.try(
    (signal) => fs.readFile(filepath, { encoding, signal }),
    (cause) => new FileError({ type: "read", cause, path: filepath }),
  );
});

export const writeFile = Op(function* (params: {
  filepath: string | URL;
  content: string;
  encoding?: BufferEncoding;
}) {
  const { filepath, content, encoding = "utf8" } = params;
  return yield* Op.try(
    (signal) => fs.writeFile(filepath, content, { encoding, signal }),
    (cause) => new FileError({ type: "write", path: filepath.toString(), cause }),
  );
});

export const readPackageJson = Op(function* (filepath: string) {
  if (!existsSync(filepath) || statSync(filepath).isDirectory()) {
    return yield* new NoEntError({ path: filepath });
  }
  const parsedJson = yield* parseJson(readFileSync(filepath, "utf8"));
  return yield* parse(PackageJson, parsedJson);
});

export const getRepoRoot = Op.try(readRepoRoot, (cause) =>
  cause instanceof RepoRootNotFoundError ? new NoEntError({ path: cause.path }) : raise(cause),
);

export const fromRepoRoot = Op(function* (relativePath: string) {
  const repoRoot = yield* getRepoRoot();
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return yield* new NoEntError({ path: absolutePath });
  return absolutePath;
});
