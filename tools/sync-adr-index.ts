import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger } from "./logger.ts";
import { readRepoRoot } from "./utils.ts";

const logger = createLogger();

const ADR_DIR = "docs/adr";
const ADR_README = "docs/adr/README.md";
const ADR_FILE = /^(\d{4})-[\w-]+\.md$/;
const INDEX_START = "<!-- adr-index:start -->";
const INDEX_END = "<!-- adr-index:end -->";
const ADR_STATUSES = new Set(["proposed", "accepted", "deprecated", "superseded"]);

type AdrRecord = {
  number: string;
  filename: string;
  title: string;
  status: string;
  packages: string[];
};

function parseScalarValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatterBlock(block: string): {
  title: string;
  status: string;
  packages: string[];
} {
  const lines = block.split(/\r?\n/);
  let title: string | undefined;
  let status: string | undefined;
  const packages: string[] = [];
  let inPackages = false;

  for (const line of lines) {
    if (line.trim() === "") continue;

    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (inPackages && listMatch) {
      packages.push(parseScalarValue(listMatch[1] ?? ""));
      continue;
    }

    inPackages = false;

    const scalarMatch = line.match(/^([\w-]+):\s*(.*)$/);
    if (!scalarMatch) {
      throw new Error(`unsupported frontmatter line: ${line}`);
    }

    const [, key, rawValue] = scalarMatch;
    if (key === "title") {
      title = parseScalarValue(rawValue ?? "");
      continue;
    }
    if (key === "status") {
      status = parseScalarValue(rawValue ?? "");
      continue;
    }
    if (key === "packages") {
      if ((rawValue ?? "").trim() !== "") {
        throw new Error(`packages must be a YAML list, not a scalar`);
      }
      inPackages = true;
      continue;
    }

    throw new Error(`unknown frontmatter field: ${key}`);
  }

  if (!title) throw new Error("missing required frontmatter field: title");
  if (!status) throw new Error("missing required frontmatter field: status");
  if (packages.length === 0) throw new Error("missing required frontmatter field: packages");

  return { title, status, packages };
}

function splitAdr(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error("ADR must start with YAML frontmatter delimited by ---");
  }
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function readHeading(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function loadAdrs(root: string): AdrRecord[] {
  const dir = path.join(root, ADR_DIR);
  const files = readdirSync(dir)
    .filter((name) => ADR_FILE.test(name))
    .sort((a, b) => a.localeCompare(b));

  return files.map((filename) => {
    const number = ADR_FILE.exec(filename)?.[1];
    if (!number) throw new Error(`invalid ADR filename: ${filename}`);

    const content = readFileSync(path.join(dir, filename), "utf8");
    const { frontmatter, body } = splitAdr(content);
    const meta = parseFrontmatterBlock(frontmatter);

    if (!ADR_STATUSES.has(meta.status)) {
      throw new Error(
        `${filename}: status must be one of ${[...ADR_STATUSES].join(", ")}, got "${meta.status}"`,
      );
    }

    const heading = readHeading(body);
    if (!heading) {
      throw new Error(`${filename}: missing H1 heading after frontmatter`);
    }
    if (heading !== meta.title) {
      throw new Error(
        `${filename}: frontmatter title must match H1 heading.\n  frontmatter: ${meta.title}\n  heading:     ${heading}`,
      );
    }

    return {
      number,
      filename,
      title: meta.title,
      status: meta.status,
      packages: meta.packages,
    };
  });
}

function formatPackages(packages: string[]): string {
  return packages.map((pkg) => `\`${pkg}\``).join(", ");
}

function renderIndexTable(records: AdrRecord[]): string {
  const lines = [
    "| ADR | Status | Package | Title |",
    "| --- | --- | --- | --- |",
    ...records.map(
      (record) =>
        `| [${record.number}](${record.filename}) | ${record.status} | ${formatPackages(record.packages)} | ${record.title} |`,
    ),
  ];
  return lines.join("\n");
}

function replaceIndex(readme: string, table: string): string {
  const start = readme.indexOf(INDEX_START);
  const end = readme.indexOf(INDEX_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`README is missing ${INDEX_START} / ${INDEX_END} markers`);
  }

  const before = readme.slice(0, start + INDEX_START.length);
  const after = readme.slice(end);
  return `${before}\n\n${table}\n\n${after}`;
}

function main(): void {
  const write = process.argv.includes("--write");
  const root = readRepoRoot();
  const readmePath = path.join(root, ADR_README);

  if (!existsSync(readmePath)) {
    throw new Error(`missing ${ADR_README}`);
  }

  const records = loadAdrs(root);
  const table = renderIndexTable(records);
  const readme = readFileSync(readmePath, "utf8");
  const expected = replaceIndex(readme, table);

  if (readme === expected) {
    logger.info(`ADR index is up to date (${records.length} records)`);
    process.exit(0);
  }

  if (write) {
    writeFileSync(readmePath, expected, "utf8");
    logger.info(`updated ${ADR_README} (${records.length} records)`);
    process.exit(0);
  }

  logger.error(`ADR index is out of date. Run: pnpm --filter @prodkit/tools run adr:sync`);
  process.exit(1);
}

try {
  main();
} catch (error) {
  logger.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
