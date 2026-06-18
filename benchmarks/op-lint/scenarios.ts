import {
  runEslint,
  runOxlintCli,
  setupDirectBuilderProject,
  setupOxlintCliProject,
  setupTypeAwareColdProject,
  setupTypeAwareWarmProject,
  type OpLintBenchmarkProject,
} from "./harness.ts";

export type OpLintBenchmarkScenario = {
  description: string;
  name: string;
  profileIterations: {
    cpu: number;
    heap: number;
  };
  run(): number;
  tinybench?: {
    time?: number;
    warmupTime?: number;
    warmupIterations?: number;
  };
};

export type OpLintBenchmarkSuite = {
  cleanup(): void;
  scenarios: readonly OpLintBenchmarkScenario[];
};

type SuiteOptions = {
  cliFileCount?: number;
  cliPrograms?: number;
  coldFileCount?: number;
  coldPrograms?: number;
  directPrograms?: number;
  includeCli?: boolean;
  warmPrograms?: number;
};

export function createOpLintBenchmarkSuite(options: SuiteOptions = {}): OpLintBenchmarkSuite {
  const directProject = setupDirectBuilderProject(options.directPrograms);
  const warmProject = setupTypeAwareWarmProject(options.warmPrograms);
  const coldProject = setupTypeAwareColdProject(options.coldFileCount, options.coldPrograms);
  const projects: OpLintBenchmarkProject[] = [directProject, warmProject, coldProject];
  let coldIndex = 0;

  const scenarios: OpLintBenchmarkScenario[] = [
    {
      description:
        "Direct Op builder calls inside generator bodies. Tracks rule traversal and the current detector setup cost for simple files.",
      name: "op-lint.requireYieldStar.directBuilders",
      profileIterations: { cpu: 1_000, heap: 200 },
      run: () => runEslint(directProject, directProject.files[0]),
    },
    {
      description:
        "Type-aware detection on an already cached TypeScript project and source-file index.",
      name: "op-lint.requireYieldStar.typeAwareWarmProject",
      profileIterations: { cpu: 750, heap: 150 },
      run: () => runEslint(warmProject, warmProject.files[0]),
    },
    {
      description:
        "Type-aware detection across rotating files excluded from tsconfig include, forcing project cache churn.",
      name: "op-lint.requireYieldStar.typeAwareColdProject",
      profileIterations: { cpu: 80, heap: 40 },
      run: () => {
        const file = coldProject.files[coldIndex % coldProject.files.length];
        coldIndex += 1;
        return runEslint(coldProject, file);
      },
      tinybench: {
        time: 500,
        warmupIterations: 2,
        warmupTime: 100,
      },
    },
  ];

  if (options.includeCli !== false) {
    const cliProject = setupOxlintCliProject(options.cliFileCount, options.cliPrograms);
    projects.push(cliProject);
    scenarios.push({
      description:
        "Full Oxlint JavaScript-plugin walltime on a small generated project. Useful for bridge and process-level regressions, not V8 flame graphs.",
      name: "op-lint.requireYieldStar.oxlintCliProject",
      profileIterations: { cpu: 5, heap: 2 },
      run: () => runOxlintCli(cliProject),
      tinybench: {
        time: 1_000,
        warmupIterations: 1,
        warmupTime: 250,
      },
    });
  }

  return {
    cleanup() {
      for (const project of projects) project.cleanup();
    },
    scenarios,
  };
}
