import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getRepoRoot,
  parseArgValue,
  parseBenchRunOptions,
  resolveBenchmarkArtifact,
  type BenchRunOptions,
} from "./harness.ts";
import {
  parseTrustedRefComparisonProfileArgs,
  type TrustedRefComparisonProfileArgs,
} from "./compare-refs.ts";
import { DEFAULT_MIN_MEANINGFUL_CHANGE_RATIO } from "./official-report.ts";
import {
  publishBenchmarkArtifacts,
  type BenchmarkPublishManifest,
  type PublishBenchmarkArtifactsInput,
} from "./publish-artifacts.ts";
import {
  parseJsonFile,
  parsePositiveInteger,
  parseRecord,
  parseString,
  parseStringArray,
} from "./json-parse.ts";

export const OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION = "prodkit.official-benchmark-run.v1" as const;

const DEFAULT_BASE_REF = "main";
const DEFAULT_CONTEXT_NAME = "official-benchmark-run-context.json";
const DEFAULT_MANIFEST_NAME = "benchmark-publish-manifest.json";
const DEFAULT_BASELINE_REPORT_NAME = "comparison-report.json";
const DEFAULT_CANDIDATE_REPORT_NAME = "trusted-ref-comparison-report.json";
const AUTOMATIC_BASELINE_REFS = new Set(["main", "refs/heads/main"]);
const logger = console;

export type OfficialBenchmarkRunKind = "baseline" | "candidate-comparison";

export type OfficialBenchmarkApproval =
  | "scheduled-baseline"
  | "manual-baseline"
  | "manual-candidate-comparison";

export type OfficialBenchmarkRunCliArgs = {
  stage: "run" | "publish";
  contextPath: string;
  run?: OfficialBenchmarkRunArgs;
};

export type OfficialBenchmarkRunArgs = {
  runKind: OfficialBenchmarkRunKind;
  approval: OfficialBenchmarkApproval;
  eventName: string;
  baseRef: string;
  candidateRef?: string;
  reportPath: string;
  manifestPath: string;
  contextPath: string;
  calibrationPath?: string;
  benchOptions: BenchRunOptions;
  minMeaningfulChangeRatio?: number;
  profile: TrustedRefComparisonProfileArgs;
};

export type OfficialBenchmarkRunContext = {
  schemaVersion: typeof OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION;
  generatedAt: string;
  runKind: OfficialBenchmarkRunKind;
  approval: OfficialBenchmarkApproval;
  eventName: string;
  baseRef: string;
  candidateRef?: string;
  reportPath: string;
  manifestPath: string;
  calibrationPath?: string;
  benchArgs: string[];
  profile: TrustedRefComparisonProfileArgs;
  policy: {
    automaticBaselineRefs: string[];
    candidateApproval: Extract<OfficialBenchmarkApproval, "manual-candidate-comparison">;
  };
};

export type OfficialBenchmarkCommand = {
  command: string;
  args: string[];
};

export type OfficialBenchmarkRunPlan = {
  context: OfficialBenchmarkRunContext;
  commands: OfficialBenchmarkCommand[];
};

export type OfficialBenchmarkHistoryPost = {
  manifest: BenchmarkPublishManifest;
  report: unknown;
};

export type PublishOfficialBenchmarkRunInput = {
  contextPath: string;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  publishArtifacts?: (input: PublishBenchmarkArtifactsInput) => Promise<BenchmarkPublishManifest>;
  postHistory?: (input: OfficialBenchmarkHistoryPost) => Promise<void>;
};

function usage(): string {
  return [
    "usage: node ./op/official-runner.ts run --kind=<baseline|candidate-comparison> --approval=<approval> --event=<event>",
    "  [--base=main] [--candidate=<ref>] [--report=<path>] [--context=<path>] [--manifest=<path>]",
    "  [--calibration=<path>] [--time=300] [--warmup-time=150] [--warmup-iterations=5] [--repeats=1] [--min-change=0.02]",
    "  [--profile-capture=auto|off] [--profile-mode=both|cpu|heap] [--profile-scenario=<scenario>] [--profile-limit=1]",
    "usage: node ./op/official-runner.ts publish [--context=op/.artifacts/official-benchmark-run-context.json]",
  ].join("\n");
}

function normalizeOfficialBenchmarkCliArgv(argv: readonly string[]): readonly string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

function isOfficialBenchmarkRunKind(value: string): value is OfficialBenchmarkRunKind {
  return value === "baseline" || value === "candidate-comparison";
}

function parseRunKind(value: string | undefined): OfficialBenchmarkRunKind {
  if (value !== undefined && isOfficialBenchmarkRunKind(value)) return value;
  throw new Error("Invalid --kind value. Expected baseline or candidate-comparison.");
}

function isOfficialBenchmarkApproval(value: string): value is OfficialBenchmarkApproval {
  return (
    value === "scheduled-baseline" ||
    value === "manual-baseline" ||
    value === "manual-candidate-comparison"
  );
}

function parseApproval(value: string | undefined): OfficialBenchmarkApproval {
  if (value !== undefined && isOfficialBenchmarkApproval(value)) return value;
  throw new Error(
    "Invalid --approval value. Expected scheduled-baseline, manual-baseline, or manual-candidate-comparison.",
  );
}

function parseEventName(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  const value = parseArgValue(argv, "--event=") ?? env.GITHUB_EVENT_NAME;
  if (value === undefined || value.trim().length === 0) {
    throw new Error("Trusted official benchmark runs require --event or GITHUB_EVENT_NAME.");
  }
  return value.trim();
}

function parseMinMeaningfulChangeRatio(argv: readonly string[]): number | undefined {
  const value = parseArgValue(argv, "--min-change=");
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Invalid --min-change value. Expected a non-negative ratio.");
  }
  return parsed;
}

function parseOfficialProfileArgs(
  argv: readonly string[],
  runKind: OfficialBenchmarkRunKind,
): TrustedRefComparisonProfileArgs {
  const profile = parseTrustedRefComparisonProfileArgs(argv);
  const captureArg = parseArgValue(argv, "--profile-capture=");
  const capture =
    captureArg === undefined && runKind === "candidate-comparison" ? "auto" : profile.capture;
  if (runKind === "baseline" && capture !== "off") {
    throw new Error("Official profile capture is only supported for candidate comparisons.");
  }
  return {
    ...profile,
    capture,
  };
}

function defaultReportPath(runKind: OfficialBenchmarkRunKind): string {
  return resolveBenchmarkArtifact(
    runKind === "baseline" ? DEFAULT_BASELINE_REPORT_NAME : DEFAULT_CANDIDATE_REPORT_NAME,
  );
}

function defaultContextPath(): string {
  return resolveBenchmarkArtifact(DEFAULT_CONTEXT_NAME);
}

function defaultManifestPath(): string {
  return resolveBenchmarkArtifact(DEFAULT_MANIFEST_NAME);
}

export function parseOfficialBenchmarkRunCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): OfficialBenchmarkRunCliArgs {
  const [stage, ...rest] = normalizeOfficialBenchmarkCliArgv(argv);
  if (stage !== "run" && stage !== "publish") {
    throw new Error(usage());
  }
  const contextPath = parseArgValue(rest, "--context=") ?? defaultContextPath();
  if (stage === "publish") {
    return {
      stage,
      contextPath,
    };
  }

  const runKind = parseRunKind(parseArgValue(rest, "--kind="));
  const reportPath = parseArgValue(rest, "--report=") ?? defaultReportPath(runKind);
  return {
    stage,
    contextPath,
    run: {
      runKind,
      approval: parseApproval(parseArgValue(rest, "--approval=")),
      eventName: parseEventName(rest, env),
      baseRef: parseArgValue(rest, "--base=") ?? DEFAULT_BASE_REF,
      ...(parseArgValue(rest, "--candidate=") === undefined
        ? {}
        : { candidateRef: parseArgValue(rest, "--candidate=") }),
      reportPath,
      manifestPath: parseArgValue(rest, "--manifest=") ?? defaultManifestPath(),
      contextPath,
      ...(parseArgValue(rest, "--calibration=") === undefined
        ? {}
        : { calibrationPath: parseArgValue(rest, "--calibration=") }),
      benchOptions: parseBenchRunOptions(rest),
      ...(parseMinMeaningfulChangeRatio(rest) === undefined
        ? {}
        : { minMeaningfulChangeRatio: parseMinMeaningfulChangeRatio(rest) }),
      profile: parseOfficialProfileArgs(rest, runKind),
    },
  };
}

function assertManualEvent(args: OfficialBenchmarkRunArgs): void {
  if (args.eventName === "workflow_dispatch") return;
  throw new Error(`${args.approval} requires workflow_dispatch.`);
}

export function assertTrustedRunPolicy(args: OfficialBenchmarkRunArgs): void {
  if (args.eventName === "pull_request" || args.eventName === "pull_request_target") {
    throw new Error("Official benchmark publishing is not allowed from pull request events.");
  }

  if (args.runKind === "baseline") {
    if (args.candidateRef !== undefined) {
      throw new Error("Baseline official runs must not include --candidate.");
    }
    if (args.approval === "scheduled-baseline") {
      if (args.eventName !== "schedule") {
        throw new Error("scheduled-baseline approval requires the schedule event.");
      }
      if (!AUTOMATIC_BASELINE_REFS.has(args.baseRef)) {
        throw new Error("Scheduled baseline runs may only target main.");
      }
      return;
    }
    if (args.approval === "manual-baseline") {
      assertManualEvent(args);
      return;
    }
    throw new Error("Baseline official runs require scheduled-baseline or manual-baseline.");
  }

  if (args.approval !== "manual-candidate-comparison") {
    throw new Error("Candidate comparisons require manual-candidate-comparison approval.");
  }
  assertManualEvent(args);
  if (args.candidateRef === undefined) {
    throw new Error("Candidate comparisons require --candidate.");
  }
  if (args.calibrationPath === undefined) {
    throw new Error("Candidate comparisons require --calibration.");
  }
}

function benchOptionArgs(options: BenchRunOptions): string[] {
  return [
    ...(options.time === undefined ? [] : [`--time=${options.time}`]),
    ...(options.warmupTime === undefined ? [] : [`--warmup-time=${options.warmupTime}`]),
    ...(options.warmupIterations === undefined
      ? []
      : [`--warmup-iterations=${options.warmupIterations}`]),
    ...(options.repeats === undefined ? [] : [`--repeats=${options.repeats}`]),
  ];
}

function profileOptionArgs(profile: TrustedRefComparisonProfileArgs): string[] {
  return [
    `--profile-capture=${profile.capture}`,
    `--profile-mode=${profile.mode}`,
    `--profile-limit=${profile.limit}`,
    ...(profile.scenario === undefined ? [] : [`--profile-scenario=${profile.scenario}`]),
  ];
}

function reportCommandArgs(args: OfficialBenchmarkRunArgs): string[] {
  const common = [
    `--report=${args.reportPath}`,
    ...(args.calibrationPath === undefined ? [] : [`--calibration=${args.calibrationPath}`]),
    ...benchOptionArgs(args.benchOptions),
  ];
  if (args.runKind === "baseline") return common;
  const candidateRef = args.candidateRef;
  if (candidateRef === undefined) {
    throw new Error("Candidate comparisons require --candidate.");
  }
  return [
    `--base=${args.baseRef}`,
    `--candidate=${candidateRef}`,
    ...common,
    `--min-change=${args.minMeaningfulChangeRatio ?? DEFAULT_MIN_MEANINGFUL_CHANGE_RATIO}`,
    ...profileOptionArgs(args.profile),
  ];
}

export function createOfficialBenchmarkRunPlan(
  args: OfficialBenchmarkRunArgs,
  now: Date = new Date(),
): OfficialBenchmarkRunPlan {
  assertTrustedRunPolicy(args);
  const benchArgs = reportCommandArgs(args);
  const commands: OfficialBenchmarkCommand[] =
    args.runKind === "baseline"
      ? [
          {
            command: "pnpm",
            args: ["--filter", "@prodkit/op", "run", "build"],
          },
          {
            command: "pnpm",
            args: ["--filter", "@prodkit/benchmarks", "run", "compare", "--", ...benchArgs],
          },
        ]
      : [
          {
            command: "pnpm",
            args: ["--filter", "@prodkit/benchmarks", "run", "compare:refs", "--", ...benchArgs],
          },
        ];

  return {
    context: {
      schemaVersion: OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION,
      generatedAt: now.toISOString(),
      runKind: args.runKind,
      approval: args.approval,
      eventName: args.eventName,
      baseRef: args.baseRef,
      ...(args.candidateRef === undefined ? {} : { candidateRef: args.candidateRef }),
      reportPath: args.reportPath,
      manifestPath: args.manifestPath,
      ...(args.calibrationPath === undefined ? {} : { calibrationPath: args.calibrationPath }),
      benchArgs,
      profile: args.profile,
      policy: {
        automaticBaselineRefs: [...AUTOMATIC_BASELINE_REFS].sort(),
        candidateApproval: "manual-candidate-comparison",
      },
    },
    commands,
  };
}

function runCommand(command: OfficialBenchmarkCommand, cwd: string): void {
  const result = spawnSync(command.command, command.args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command.command} ${command.args.join(" ")} failed.`);
  }
}

async function writeRunContext(
  context: OfficialBenchmarkRunContext,
  contextPath: string,
): Promise<void> {
  const absolutePath = path.resolve(contextPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(context, null, 2) + "\n", "utf8");
}

export async function runOfficialBenchmarkReport(args: OfficialBenchmarkRunArgs): Promise<void> {
  const repoRoot = getRepoRoot();
  const plan = createOfficialBenchmarkRunPlan(args);
  for (const command of plan.commands) {
    runCommand(command, repoRoot);
  }
  await writeRunContext(plan.context, args.contextPath);
  logger.info(`Wrote official benchmark run context: ${path.resolve(args.contextPath)}`);
}

function parseRunKindValue(value: unknown, location: string): OfficialBenchmarkRunKind {
  const runKind = parseString(value, location);
  if (isOfficialBenchmarkRunKind(runKind)) return runKind;
  throw new Error(`${location}: expected baseline or candidate-comparison`);
}

function parseApprovalValue(value: unknown, location: string): OfficialBenchmarkApproval {
  const approval = parseString(value, location);
  if (isOfficialBenchmarkApproval(approval)) return approval;
  throw new Error(
    `${location}: expected scheduled-baseline, manual-baseline, or manual-candidate-comparison`,
  );
}

function parseProfileCaptureValue(
  value: unknown,
  location: string,
): TrustedRefComparisonProfileArgs["capture"] {
  const capture = parseString(value, location);
  if (capture === "off" || capture === "auto") return capture;
  throw new Error(`${location}: expected off or auto`);
}

function parseProfileModeValue(
  value: unknown,
  location: string,
): TrustedRefComparisonProfileArgs["mode"] {
  const mode = parseString(value, location);
  if (mode === "both" || mode === "cpu" || mode === "heap") return mode;
  throw new Error(`${location}: expected both, cpu, or heap`);
}

function parseProfileArgs(value: unknown): TrustedRefComparisonProfileArgs {
  if (value === undefined) {
    return {
      capture: "off",
      mode: "both",
      limit: 1,
    };
  }
  const record = parseRecord(value, "context.profile");
  return {
    capture: parseProfileCaptureValue(record.capture, "context.profile.capture"),
    mode: parseProfileModeValue(record.mode, "context.profile.mode"),
    ...(record.scenario === undefined
      ? {}
      : { scenario: parseString(record.scenario, "context.profile.scenario") }),
    limit: parsePositiveInteger(record.limit, "context.profile.limit"),
  };
}

export function parseOfficialBenchmarkRunContext(input: unknown): OfficialBenchmarkRunContext {
  const record = parseRecord(input, "context");
  if (record.schemaVersion !== OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION) {
    throw new Error(`context.schemaVersion: expected ${OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION}`);
  }
  const policy = parseRecord(record.policy, "context.policy");
  return {
    schemaVersion: OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION,
    generatedAt: parseString(record.generatedAt, "context.generatedAt"),
    runKind: parseRunKindValue(record.runKind, "context.runKind"),
    approval: parseApprovalValue(record.approval, "context.approval"),
    eventName: parseString(record.eventName, "context.eventName"),
    baseRef: parseString(record.baseRef, "context.baseRef"),
    ...(record.candidateRef === undefined
      ? {}
      : { candidateRef: parseString(record.candidateRef, "context.candidateRef") }),
    reportPath: parseString(record.reportPath, "context.reportPath"),
    manifestPath: parseString(record.manifestPath, "context.manifestPath"),
    ...(record.calibrationPath === undefined
      ? {}
      : { calibrationPath: parseString(record.calibrationPath, "context.calibrationPath") }),
    benchArgs: parseStringArray(record.benchArgs, "context.benchArgs"),
    profile: parseProfileArgs(record.profile),
    policy: {
      automaticBaselineRefs: parseStringArray(
        policy.automaticBaselineRefs,
        "context.policy.automaticBaselineRefs",
      ),
      candidateApproval:
        policy.candidateApproval === "manual-candidate-comparison"
          ? "manual-candidate-comparison"
          : (() => {
              throw new Error(
                "context.policy.candidateApproval: expected manual-candidate-comparison",
              );
            })(),
    },
  };
}

function historyApiUrl(env: NodeJS.ProcessEnv): string {
  const baseUrl = env.PRODKIT_BENCHMARK_HISTORY_API?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error("PRODKIT_BENCHMARK_HISTORY_API is required for official benchmark indexing.");
  }
  return `${baseUrl.replace(/\/+$/, "")}/api/benchmarks/index`;
}

function historyWriteToken(env: NodeJS.ProcessEnv): string {
  const token = env.PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN?.trim();
  if (token === undefined || token.length === 0) {
    throw new Error(
      "PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN is required for official benchmark indexing.",
    );
  }
  return token;
}

export async function postBenchmarkHistoryIndex(input: {
  manifest: BenchmarkPublishManifest;
  report: unknown;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const response = await fetch(historyApiUrl(input.env), {
    method: "POST",
    headers: {
      authorization: `Bearer ${historyWriteToken(input.env)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      manifest: input.manifest,
      report: input.report,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Benchmark history indexing failed: ${response.status} ${response.statusText}${responseBody.length > 0 ? `: ${responseBody}` : ""}`,
    );
  }
}

export async function publishOfficialBenchmarkRun(
  input: PublishOfficialBenchmarkRunInput,
): Promise<BenchmarkPublishManifest> {
  const env = input.env ?? process.env;
  const context = parseOfficialBenchmarkRunContext(await parseJsonFile(input.contextPath));
  const publishArtifacts = input.publishArtifacts ?? publishBenchmarkArtifacts;
  const manifest = await publishArtifacts({
    repoRoot: input.repoRoot,
    env,
    now: input.now,
    args: {
      reportPath: context.reportPath,
      manifestPath: context.manifestPath,
      mode: "upload",
      extraArtifacts: [],
    },
  });
  const report = await parseJsonFile(context.reportPath);
  const postHistory =
    input.postHistory ??
    ((post) =>
      postBenchmarkHistoryIndex({
        ...post,
        env,
      }));
  await postHistory({ manifest, report });
  logger.info(`Published and indexed official benchmark run: ${context.reportPath}`);
  return manifest;
}

export async function runOfficialBenchmarkCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseOfficialBenchmarkRunCliArgs(argv);
  if (args.stage === "run") {
    if (args.run === undefined) throw new Error(usage());
    await runOfficialBenchmarkReport(args.run);
    return;
  }
  await publishOfficialBenchmarkRun({ contextPath: args.contextPath });
}

if (import.meta.main) {
  runOfficialBenchmarkCli().catch((error) => {
    logger.error(error);
    process.exitCode = 1;
  });
}
