import { createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRepoRoot, parseArgValue, resolveBenchmarkArtifact } from "../runtime/harness.ts";
import { parseJsonFile, parseRecord, parseString } from "../reports/json-parse.ts";
import {
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  parseOfficialBenchmarkReport,
  type BenchmarkArtifactRef,
  type OfficialBenchmarkReport,
} from "../reports/official-report.ts";
import {
  TRUSTED_REF_COMPARISON_REPORT_VERSION,
  parseTrustedRefComparisonReport,
} from "../reports/trusted-ref-comparison-report.ts";

export const BENCHMARK_PUBLISH_MANIFEST_VERSION = "prodkit.benchmark-publish.v1" as const;

const DEFAULT_MANIFEST_NAME = "benchmark-publish-manifest.json";
const R2_REGION = "auto";
const R2_SERVICE = "s3";
const logger = console;

export type BenchmarkPublishMode = "dry-run" | "upload";

export type CloudflareR2PublishTarget = {
  endpoint: string;
  bucket: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type BenchmarkPublishedArtifact = BenchmarkArtifactRef & {
  objectKey: string;
  sizeBytes: number;
  sha256: string;
};

export type BenchmarkPublishManifest = {
  schemaVersion: typeof BENCHMARK_PUBLISH_MANIFEST_VERSION;
  generatedAt: string;
  mode: BenchmarkPublishMode;
  provider: "cloudflare-r2";
  bucket: string;
  endpoint: string;
  prefix?: string;
  source: {
    reportPath: string;
    reportSchemaVersion: string;
    runIds: string[];
  };
  artifacts: BenchmarkPublishedArtifact[];
};

export type BenchmarkPublishCliArgs = {
  reportPath: string;
  manifestPath: string;
  mode: BenchmarkPublishMode;
  prefix?: string;
  extraArtifacts: BenchmarkArtifactRef[];
};

export type BenchmarkPublishPlan = {
  manifest: BenchmarkPublishManifest;
  uploads: Array<{
    sourcePath: string;
    artifact: BenchmarkPublishedArtifact;
  }>;
};

export type PublishBenchmarkArtifactsInput = {
  args: BenchmarkPublishCliArgs;
  repoRoot?: string;
  target?: CloudflareR2PublishTarget;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  uploadArtifact?: (
    target: CloudflareR2PublishTarget,
    upload: BenchmarkPublishPlan["uploads"][number],
  ) => Promise<void>;
};

function usage(): string {
  return [
    "usage: node ./op/cli/publish-artifacts.ts --report=<report.json> [--dry-run]",
    "  [--manifest=op/.artifacts/benchmark-publish-manifest.json]",
    "  [--prefix=<object-key-prefix>]",
    "  [--artifact=kind=<kind>,path=<path>[,contentType=<content-type>][,scenario=<scenario-key>][,implementation=<implementation-id>]]",
  ].join("\n");
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizePrefix(prefix: string | undefined): string | undefined {
  const trimmed = normalizeOptionalValue(prefix);
  if (trimmed === undefined) return undefined;
  return trimmed
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(sanitizeKeySegment)
    .join("/");
}

export function resolveCloudflareR2PublishTarget(
  env: NodeJS.ProcessEnv,
  input: {
    mode: BenchmarkPublishMode;
    prefix?: string;
  },
): CloudflareR2PublishTarget {
  const bucket = normalizeOptionalValue(env.PRODKIT_BENCHMARK_R2_BUCKET);
  if (bucket === undefined) {
    throw new Error("PRODKIT_BENCHMARK_R2_BUCKET is required for benchmark artifact publishing.");
  }

  const endpoint =
    normalizeOptionalValue(env.PRODKIT_BENCHMARK_R2_ENDPOINT) ??
    (() => {
      const accountId = normalizeOptionalValue(env.PRODKIT_BENCHMARK_R2_ACCOUNT_ID);
      return accountId === undefined ? undefined : `https://${accountId}.r2.cloudflarestorage.com`;
    })();
  if (endpoint === undefined) {
    throw new Error(
      "PRODKIT_BENCHMARK_R2_ACCOUNT_ID or PRODKIT_BENCHMARK_R2_ENDPOINT is required for benchmark artifact publishing.",
    );
  }

  const prefix = normalizePrefix(input.prefix ?? env.PRODKIT_BENCHMARK_R2_PREFIX);
  const target: CloudflareR2PublishTarget = {
    endpoint: normalizeEndpoint(endpoint),
    bucket,
    ...(prefix === undefined ? {} : { prefix }),
  };

  if (input.mode === "dry-run") return target;

  const accessKeyId = normalizeOptionalValue(env.PRODKIT_BENCHMARK_R2_ACCESS_KEY_ID);
  const secretAccessKey = normalizeOptionalValue(env.PRODKIT_BENCHMARK_R2_SECRET_ACCESS_KEY);
  if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      "PRODKIT_BENCHMARK_R2_ACCESS_KEY_ID and PRODKIT_BENCHMARK_R2_SECRET_ACCESS_KEY are required unless --dry-run is set.",
    );
  }

  return {
    ...target,
    accessKeyId,
    secretAccessKey,
  };
}

function parseArtifactFields(value: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  for (const part of value.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      throw new Error(
        `Invalid --artifact value "${value}". Expected comma-separated key=value fields.`,
      );
    }
    const key = part.slice(0, index).trim();
    const fieldValue = part.slice(index + 1).trim();
    if (key.length === 0 || fieldValue.length === 0) {
      throw new Error(`Invalid --artifact value "${value}". Expected non-empty key=value fields.`);
    }
    fields[key] = fieldValue;
  }
  return fields;
}

function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json" || ext === ".cpuprofile" || ext === ".heapprofile") {
    return "application/json";
  }
  return "application/octet-stream";
}

function inferArtifactKind(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".cpuprofile") return "cpu-profile";
  if (ext === ".heapprofile") return "heap-profile";
  if (ext === ".json") return "report";
  return "artifact";
}

export function parsePublishArtifactArg(value: string): BenchmarkArtifactRef {
  const fields = parseArtifactFields(value);
  const artifactPath = fields.path;
  if (artifactPath === undefined) {
    throw new Error(`Invalid --artifact value "${value}". Missing path=... field.`);
  }

  return {
    kind: fields.kind ?? inferArtifactKind(artifactPath),
    path: artifactPath,
    contentType: fields.contentType ?? inferContentType(artifactPath),
    ...(fields.scenario === undefined ? {} : { scenarioKey: fields.scenario }),
    ...(fields.implementation === undefined ? {} : { implementationId: fields.implementation }),
  };
}

export function parseBenchmarkPublishArgs(argv: readonly string[]): BenchmarkPublishCliArgs {
  const reportPath = parseArgValue(argv, "--report=");
  if (reportPath === undefined) {
    throw new Error(usage());
  }

  const dryRun = argv.includes("--dry-run");
  const manifestPath =
    parseArgValue(argv, "--manifest=") ?? resolveBenchmarkArtifact(DEFAULT_MANIFEST_NAME);
  const prefix = parseArgValue(argv, "--prefix=");
  const extraArtifacts = argv
    .filter((arg) => arg.startsWith("--artifact="))
    .map((arg) => parsePublishArtifactArg(arg.slice("--artifact=".length)));

  return {
    reportPath,
    manifestPath,
    mode: dryRun ? "dry-run" : "upload",
    ...(prefix === undefined ? {} : { prefix }),
    extraArtifacts,
  };
}

function repoRelativePath(repoRoot: string, candidatePath: string): string {
  const absolutePath = path.resolve(candidatePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return absolutePath;
  return relative.replace(/\\/g, "/");
}

function resolveArtifactSourcePath(
  repoRoot: string,
  reportPath: string,
  artifact: BenchmarkArtifactRef,
): string {
  if (path.isAbsolute(artifact.path)) return artifact.path;

  const repoCandidate = path.resolve(repoRoot, artifact.path);
  if (existsSync(repoCandidate)) return repoCandidate;

  const reportCandidate = path.resolve(path.dirname(path.resolve(reportPath)), artifact.path);
  if (existsSync(reportCandidate)) return reportCandidate;

  return repoCandidate;
}

function sanitizeKeySegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._=-]+/g, "_").replace(/^\.+$/, "_");
  return sanitized.length > 0 ? sanitized : "_";
}

function safePathSegments(value: string): string[] {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .map(sanitizeKeySegment);
}

function joinObjectKey(prefix: string | undefined, parts: readonly string[]): string {
  const normalizedPrefix = normalizePrefix(prefix);
  const segments = [
    ...(normalizedPrefix === undefined ? [] : normalizedPrefix.split("/")),
    ...parts.flatMap((part) => safePathSegments(part)),
  ];
  return segments.join("/");
}

function officialArtifactObjectKey(
  prefix: string | undefined,
  report: OfficialBenchmarkReport,
  artifact: BenchmarkArtifactRef,
): string {
  const scope =
    artifact.scenarioKey === undefined
      ? ["run"]
      : ["scenario", artifact.scenarioKey, artifact.implementationId ?? "unknown"];
  return joinObjectKey(prefix, [
    "official",
    report.run.kind,
    report.run.id,
    ...scope,
    artifact.kind,
    path.basename(artifact.path),
  ]);
}

function trustedReportObjectKey(input: {
  prefix?: string;
  baseReport: OfficialBenchmarkReport;
  candidateReport: OfficialBenchmarkReport;
  reportPath: string;
}): string {
  return joinObjectKey(input.prefix, [
    "official",
    "trusted-ref-comparison",
    `${input.baseReport.run.id}__${input.candidateReport.run.id}`,
    "run",
    "report",
    path.basename(input.reportPath),
  ]);
}

function withObjectKey(
  artifact: BenchmarkArtifactRef,
  objectKey: string,
  content: Buffer,
): BenchmarkPublishedArtifact {
  return {
    ...artifact,
    objectKey,
    sizeBytes: content.byteLength,
    sha256: hashHex(content),
  };
}

async function officialReportUploads(input: {
  repoRoot: string;
  reportPath: string;
  report: OfficialBenchmarkReport;
  target: CloudflareR2PublishTarget;
  extraArtifacts: readonly BenchmarkArtifactRef[];
}): Promise<BenchmarkPublishPlan["uploads"]> {
  const artifacts = [
    ...input.report.run.artifacts,
    ...input.report.scenarioResults.flatMap((result) => result.artifacts),
    ...input.extraArtifacts,
  ];
  const uploads: BenchmarkPublishPlan["uploads"] = [];
  const seenKeys = new Set<string>();

  for (const artifact of artifacts) {
    const objectKey =
      artifact.objectKey ?? officialArtifactObjectKey(input.target.prefix, input.report, artifact);
    if (seenKeys.has(objectKey)) continue;
    seenKeys.add(objectKey);
    const sourcePath = resolveArtifactSourcePath(input.repoRoot, input.reportPath, artifact);
    const content = await readFile(sourcePath);
    uploads.push({
      sourcePath,
      artifact: withObjectKey(artifact, objectKey, content),
    });
  }

  return uploads;
}

async function trustedRefComparisonUploads(input: {
  repoRoot: string;
  reportPath: string;
  report: {
    baseReport: OfficialBenchmarkReport;
    candidateReport: OfficialBenchmarkReport;
  };
  target: CloudflareR2PublishTarget;
  extraArtifacts: readonly BenchmarkArtifactRef[];
}): Promise<BenchmarkPublishPlan["uploads"]> {
  const reportPath = repoRelativePath(input.repoRoot, input.reportPath);
  const topLevelArtifact: BenchmarkArtifactRef = {
    kind: "report",
    path: reportPath,
    contentType: "application/json",
  };
  const topLevelContent = await readFile(input.reportPath);
  const uploads: BenchmarkPublishPlan["uploads"] = [
    {
      sourcePath: input.reportPath,
      artifact: withObjectKey(
        topLevelArtifact,
        trustedReportObjectKey({
          prefix: input.target.prefix,
          baseReport: input.report.baseReport,
          candidateReport: input.report.candidateReport,
          reportPath: input.reportPath,
        }),
        topLevelContent,
      ),
    },
  ];

  for (const nestedReport of [input.report.baseReport, input.report.candidateReport]) {
    const scenarioArtifacts = nestedReport.scenarioResults.flatMap((result) => result.artifacts);
    const nestedUploads = await officialReportUploads({
      repoRoot: input.repoRoot,
      reportPath: input.reportPath,
      report: nestedReport,
      target: input.target,
      extraArtifacts: scenarioArtifacts,
    });
    uploads.push(...nestedUploads.filter((upload) => upload.artifact.kind !== "report"));
  }

  if (input.extraArtifacts.length > 0) {
    const extraUploads = await officialReportUploads({
      repoRoot: input.repoRoot,
      reportPath: input.reportPath,
      report: input.report.candidateReport,
      target: input.target,
      extraArtifacts: input.extraArtifacts,
    });
    uploads.push(...extraUploads);
  }

  const seenKeys = new Set<string>();
  return uploads.filter((upload) => {
    if (seenKeys.has(upload.artifact.objectKey)) return false;
    seenKeys.add(upload.artifact.objectKey);
    return true;
  });
}

export async function createBenchmarkPublishPlan(input: {
  repoRoot: string;
  reportPath: string;
  target: CloudflareR2PublishTarget;
  mode: BenchmarkPublishMode;
  extraArtifacts: readonly BenchmarkArtifactRef[];
  now: Date;
}): Promise<BenchmarkPublishPlan> {
  const rawReport = await parseJsonFile(input.reportPath);
  const record = parseRecord(rawReport, "report");
  const reportSchemaVersion = parseString(record.schemaVersion, "report.schemaVersion");
  let uploads: BenchmarkPublishPlan["uploads"];
  let runIds: string[];

  if (reportSchemaVersion === OFFICIAL_BENCHMARK_REPORT_VERSION) {
    const officialReport = parseOfficialBenchmarkReport(rawReport);
    uploads = await officialReportUploads({
      repoRoot: input.repoRoot,
      reportPath: input.reportPath,
      report: officialReport,
      target: input.target,
      extraArtifacts: input.extraArtifacts,
    });
    runIds = [officialReport.run.id];
  } else if (reportSchemaVersion === TRUSTED_REF_COMPARISON_REPORT_VERSION) {
    const trustedReport = parseTrustedRefComparisonReport(rawReport);
    uploads = await trustedRefComparisonUploads({
      repoRoot: input.repoRoot,
      reportPath: input.reportPath,
      report: {
        baseReport: trustedReport.base.report,
        candidateReport: trustedReport.candidate.report,
      },
      target: input.target,
      extraArtifacts: input.extraArtifacts,
    });
    runIds = [trustedReport.base.report.run.id, trustedReport.candidate.report.run.id];
  } else {
    throw new Error(
      `Unsupported benchmark report schema "${reportSchemaVersion}". Expected ${OFFICIAL_BENCHMARK_REPORT_VERSION} or ${TRUSTED_REF_COMPARISON_REPORT_VERSION}.`,
    );
  }

  return {
    manifest: {
      schemaVersion: BENCHMARK_PUBLISH_MANIFEST_VERSION,
      generatedAt: input.now.toISOString(),
      mode: input.mode,
      provider: "cloudflare-r2",
      bucket: input.target.bucket,
      endpoint: input.target.endpoint,
      ...(input.target.prefix === undefined ? {} : { prefix: input.target.prefix }),
      source: {
        reportPath: repoRelativePath(input.repoRoot, input.reportPath),
        reportSchemaVersion,
        runIds,
      },
      artifacts: uploads.map((upload) => upload.artifact),
    },
    uploads,
  };
}

function hashHex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectPath(bucket: string, objectKey: string): string {
  return `/${awsEncode(bucket)}/${objectKey.split("/").map(awsEncode).join("/")}`;
}

function canonicalHeaderLines(headers: Record<string, string>): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonicalHeaders: entries.map(([key, value]) => `${key}:${value}\n`).join(""),
    signedHeaders: entries.map(([key]) => key).join(";"),
  };
}

function signingKey(secretAccessKey: string, dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, R2_REGION);
  const serviceKey = hmac(regionKey, R2_SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function signedPutHeaders(input: {
  url: URL;
  target: Required<Pick<CloudflareR2PublishTarget, "accessKeyId" | "secretAccessKey">>;
  contentType: string;
  payloadHash: string;
  now: Date;
}): Record<string, string> {
  const requestDate = amzDate(input.now);
  const dateStamp = requestDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const headers = {
    "content-type": input.contentType,
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": requestDate,
  };
  const { canonicalHeaders, signedHeaders } = canonicalHeaderLines(headers);
  const canonicalRequest = [
    "PUT",
    input.url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    requestDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signature = hmacHex(signingKey(input.target.secretAccessKey, dateStamp), stringToSign);

  return {
    ...headers,
    authorization: [
      `AWS4-HMAC-SHA256 Credential=${input.target.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", "),
  };
}

export async function uploadArtifactToCloudflareR2(
  target: CloudflareR2PublishTarget,
  upload: BenchmarkPublishPlan["uploads"][number],
): Promise<void> {
  if (target.accessKeyId === undefined || target.secretAccessKey === undefined) {
    throw new Error("Cloudflare R2 credentials are required for upload mode.");
  }

  const body = await readFile(upload.sourcePath);
  const payloadHash = hashHex(body);
  const url = new URL(
    `${normalizeEndpoint(target.endpoint)}${encodeObjectPath(target.bucket, upload.artifact.objectKey)}`,
  );
  const headers = signedPutHeaders({
    url,
    target: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
    contentType: upload.artifact.contentType,
    payloadHash,
    now: new Date(),
  });
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Cloudflare R2 upload failed for ${upload.artifact.path} to ${upload.artifact.objectKey}: ${response.status} ${response.statusText}${responseBody.length > 0 ? `: ${responseBody}` : ""}. Check the bucket, endpoint, prefix, and R2 token object write permission.`,
    );
  }
}

async function writeManifest(
  manifestPath: string,
  manifest: BenchmarkPublishManifest,
): Promise<void> {
  const absolutePath = path.resolve(manifestPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

export async function publishBenchmarkArtifacts(
  input: PublishBenchmarkArtifactsInput,
): Promise<BenchmarkPublishManifest> {
  const repoRoot = input.repoRoot ?? getRepoRoot();
  const target =
    input.target ??
    resolveCloudflareR2PublishTarget(input.env ?? process.env, {
      mode: input.args.mode,
      prefix: input.args.prefix,
    });
  const plan = await createBenchmarkPublishPlan({
    repoRoot,
    reportPath: input.args.reportPath,
    target,
    mode: input.args.mode,
    extraArtifacts: input.args.extraArtifacts,
    now: input.now ?? new Date(),
  });

  if (input.args.mode === "dry-run") {
    return plan.manifest;
  }

  const uploadArtifact = input.uploadArtifact ?? uploadArtifactToCloudflareR2;
  for (const upload of plan.uploads) {
    await uploadArtifact(target, upload);
  }
  await writeManifest(input.args.manifestPath, plan.manifest);
  return plan.manifest;
}

function printManifest(manifest: BenchmarkPublishManifest): void {
  logger.info(
    JSON.stringify(
      {
        ...manifest,
        artifacts: manifest.artifacts.map((artifact) => ({
          kind: artifact.kind,
          path: artifact.path,
          contentType: artifact.contentType,
          objectKey: artifact.objectKey,
          scenarioKey: artifact.scenarioKey,
          implementationId: artifact.implementationId,
          sizeBytes: artifact.sizeBytes,
        })),
      },
      null,
      2,
    ),
  );
}

export async function runBenchmarkPublishCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseBenchmarkPublishArgs(argv);
  const manifest = await publishBenchmarkArtifacts({ args });
  printManifest(manifest);
  if (args.mode === "dry-run") {
    logger.info(
      "Dry run only. No Cloudflare request was made and no publish manifest was written.",
    );
  } else {
    logger.info(`Wrote publish manifest: ${path.resolve(args.manifestPath)}`);
  }
}

if (import.meta.main) {
  runBenchmarkPublishCli().catch((error) => {
    logger.error(error);
    process.exitCode = 1;
  });
}
