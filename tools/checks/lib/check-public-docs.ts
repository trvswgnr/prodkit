import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function listPublicDocRelativePaths(repoRoot: string): string[] {
  const docsDir = path.join(repoRoot, "packages/op/docs");
  const guideDocs = existsSync(docsDir)
    ? readdirSync(docsDir)
        .filter((entry) => entry.endsWith(".md"))
        .sort()
        .map((entry) => `packages/op/docs/${entry}`)
    : [];
  return ["README.md", "packages/op/README.md", ...guideDocs];
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]+)\)/g;

const GITHUB_BLOB_PREFIX = "https://github.com/trvswgnr/prodkit/blob/main/";
const GITHUB_TREE_PREFIX = "https://github.com/trvswgnr/prodkit/tree/main/";

export type DocLinkIssue = {
  doc: string;
  href: string;
  message: string;
};

/** GitHub-compatible heading slug (sufficient for shipped doc anchors). */
export function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function collectHeadingSlugs(markdown: string): string[] {
  const slugs: string[] = [];
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const heading = match[1];
    if (heading === undefined) continue;
    slugs.push(slugifyHeading(heading));
  }
  return slugs;
}

function splitHref(href: string): { target: string; anchor?: string } {
  const [target = "", anchor] = href.split("#");
  return { target, anchor };
}

function assertAnchorExists(
  repoRoot: string,
  docPath: string,
  anchor: string,
  issues: DocLinkIssue[],
  href: string,
): void {
  const content = readFileSync(path.join(repoRoot, docPath), "utf8");
  const slugs = collectHeadingSlugs(content);
  if (!slugs.includes(anchor)) {
    issues.push({
      doc: docPath,
      href,
      message: `missing heading anchor #${anchor} in ${docPath}`,
    });
  }
}

function assertRepoPathExists(
  repoRoot: string,
  docPath: string,
  relativePath: string,
  issues: DocLinkIssue[],
  href: string,
): void {
  const absolute = path.join(repoRoot, relativePath);
  if (!existsSync(absolute)) {
    issues.push({
      doc: docPath,
      href,
      message: `missing repo path ${relativePath}`,
    });
  }
}

function resolveRelativeTarget(docPath: string, target: string): string {
  const docDir = path.dirname(docPath);
  return path.normalize(path.join(docDir, target));
}

function inspectHref(
  repoRoot: string,
  docPath: string,
  rawHref: string,
  issues: DocLinkIssue[],
): void {
  const href = rawHref.trim().replace(/^<|>$/g, "").split(/\s/)[0] ?? "";
  if (href.length === 0) return;
  if (href.startsWith("mailto:")) return;

  if (href.startsWith("#")) {
    assertAnchorExists(repoRoot, docPath, href.slice(1), issues, href);
    return;
  }

  if (href.startsWith("http://") || href.startsWith("https://")) {
    if (href.startsWith(GITHUB_BLOB_PREFIX)) {
      const remainder = href.slice(GITHUB_BLOB_PREFIX.length);
      const repoRelative = decodeURIComponent(remainder.split("#")[0] ?? "");
      if (repoRelative.length > 0) {
        assertRepoPathExists(repoRoot, docPath, repoRelative, issues, href);
        const anchor = remainder.split("#")[1];
        if (anchor !== undefined && anchor.length > 0) {
          assertAnchorExists(repoRoot, repoRelative, anchor, issues, href);
        }
      }
      return;
    }
    if (href.startsWith(GITHUB_TREE_PREFIX)) {
      const repoRelative = decodeURIComponent(
        href.slice(GITHUB_TREE_PREFIX.length).split("#")[0] ?? "",
      );
      if (repoRelative.length > 0) {
        assertRepoPathExists(repoRoot, docPath, repoRelative, issues, href);
      }
      return;
    }
    return;
  }

  const { target, anchor } = splitHref(href);
  if (target.length === 0) {
    if (anchor !== undefined && anchor.length > 0) {
      assertAnchorExists(repoRoot, docPath, anchor, issues, href);
    }
    return;
  }

  const resolved = resolveRelativeTarget(docPath, target);
  assertRepoPathExists(repoRoot, docPath, resolved, issues, href);
  const anchorDoc = target.length > 0 ? resolved : docPath;
  if (anchor !== undefined && anchor.length > 0) {
    assertAnchorExists(repoRoot, anchorDoc, anchor, issues, href);
  }
}

export function checkPublicDocs(repoRoot: string): DocLinkIssue[] {
  const issues: DocLinkIssue[] = [];
  for (const docPath of listPublicDocRelativePaths(repoRoot)) {
    const absolute = path.join(repoRoot, docPath);
    if (!existsSync(absolute)) {
      issues.push({ doc: docPath, href: "", message: "missing public doc file" });
      continue;
    }
    const content = readFileSync(absolute, "utf8");
    for (const match of content.matchAll(MARKDOWN_LINK)) {
      const href = match[2];
      if (href === undefined) continue;
      inspectHref(repoRoot, docPath, href, issues);
    }
  }
  return issues;
}
