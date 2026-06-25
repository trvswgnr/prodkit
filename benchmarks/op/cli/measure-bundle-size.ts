import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { getRepoRoot, resolveOpPackageDir } from "../runtime/harness.ts";

export type BundleSizeSample = {
  minBytes: number;
  gzipBytes: number;
};

export type BundleSizeBounds = {
  lower: BundleSizeSample;
  upper: BundleSizeSample;
};

const PEER_EXTERNAL = ["better-result"] as const;

function fullSurfaceEntrySource(): string {
  return [
    'import { Op } from "./dist/index.mjs";',
    'import { DI } from "./dist/di/index.mjs";',
    'import { Policy } from "./dist/policy/index.mjs";',
    'import { HKT } from "./dist/hkt.mjs";',
    "export const fullSurface = { Op, DI, Policy, HKT };",
  ].join("\n");
}

type BuildInput =
  | { kind: "file"; entryPath: string }
  | { kind: "full-surface"; packageDir: string };

async function buildEntry(input: BuildInput): Promise<BundleSizeSample & { code: Uint8Array }> {
  const result = await build(
    input.kind === "file"
      ? {
          entryPoints: [input.entryPath],
          bundle: true,
          minify: true,
          format: "esm",
          target: "es2022",
          external: [...PEER_EXTERNAL],
          write: false,
        }
      : {
          stdin: {
            contents: fullSurfaceEntrySource(),
            loader: "js",
            resolveDir: input.packageDir,
            sourcefile: "full-surface.mjs",
          },
          bundle: true,
          minify: true,
          format: "esm",
          target: "es2022",
          external: [...PEER_EXTERNAL],
          write: false,
        },
  );
  const output = result.outputFiles?.[0];
  if (output === undefined) {
    const label = input.kind === "file" ? input.entryPath : "full-surface";
    throw new Error(`bundle size measurement produced no output for ${label}`);
  }
  const code = output.contents;
  return {
    code,
    minBytes: code.byteLength,
    gzipBytes: gzipSync(code).byteLength,
  };
}

function lowerEntryPath(packageDir: string): string {
  return path.join(packageDir, "dist", "index.mjs");
}

export async function measureOpBundleSizes(packageDir: string): Promise<BundleSizeBounds> {
  const [lowerBuilt, upperBuilt] = await Promise.all([
    buildEntry({ kind: "file", entryPath: lowerEntryPath(packageDir) }),
    buildEntry({ kind: "full-surface", packageDir }),
  ]);
  const lower = { minBytes: lowerBuilt.minBytes, gzipBytes: lowerBuilt.gzipBytes };
  const upper = { minBytes: upperBuilt.minBytes, gzipBytes: upperBuilt.gzipBytes };
  if (upper.minBytes < lower.minBytes) {
    throw new Error(
      `upper bound (${upper.minBytes} B) is smaller than lower bound (${lower.minBytes} B)`,
    );
  }
  return { lower, upper };
}

export async function writeOpBundleSizeArtifacts(packageDir: string): Promise<BundleSizeBounds> {
  const outDir = path.join(packageDir, "dist", "bundle-size");
  await mkdir(outDir, { recursive: true });

  const lowerBuilt = await buildEntry({ kind: "file", entryPath: lowerEntryPath(packageDir) });
  const upperBuilt = await buildEntry({ kind: "full-surface", packageDir });
  await writeFile(path.join(outDir, "main.min.mjs"), lowerBuilt.code);
  await writeFile(path.join(outDir, "full.min.mjs"), upperBuilt.code);

  return {
    lower: { minBytes: lowerBuilt.minBytes, gzipBytes: lowerBuilt.gzipBytes },
    upper: { minBytes: upperBuilt.minBytes, gzipBytes: upperBuilt.gzipBytes },
  };
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const packageDir = resolveOpPackageDir(getRepoRoot());
  const bounds = write
    ? await writeOpBundleSizeArtifacts(packageDir)
    : await measureOpBundleSizes(packageDir);

  process.stdout.write(`${JSON.stringify(bounds)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
