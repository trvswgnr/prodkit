export type BenchmarkHistoryDashboardOptions = {
  apiBasePath?: string;
  artifactBaseUrl?: string;
};

const DEFAULT_API_BASE_PATH = "/api/benchmarks";

type DashboardConfig = {
  apiBasePath: string;
  artifactBaseUrl?: string;
};

function jsonScriptValue(value: DashboardConfig): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function dashboardConfig(options: BenchmarkHistoryDashboardOptions = {}): DashboardConfig {
  return {
    apiBasePath: options.apiBasePath ?? DEFAULT_API_BASE_PATH,
    ...(options.artifactBaseUrl === undefined || options.artifactBaseUrl.trim().length === 0
      ? {}
      : { artifactBaseUrl: options.artifactBaseUrl.trim() }),
  };
}

export function isBenchmarkHistoryDashboardRoute(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/")) return false;
  return (
    pathname === "/" ||
    pathname === "/runs" ||
    pathname.startsWith("/runs/") ||
    pathname === "/scenarios" ||
    pathname.startsWith("/scenarios/")
  );
}

export function benchmarkHistoryDashboardResponse(
  request: Request,
  options: BenchmarkHistoryDashboardOptions = {},
): Response {
  const config = jsonScriptValue(dashboardConfig(options));
  const html = dashboardHtml(config);
  return new Response(request.method === "HEAD" ? null : html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function dashboardHtml(config: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>prodkit benchmark history</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f8;
      --surface: #ffffff;
      --surface-quiet: #eef1f3;
      --text: #172026;
      --muted: #5d6870;
      --line: #d8dde1;
      --strong: #11181d;
      --accent: #0f766e;
      --accent-quiet: #dff5f1;
      --danger: #b42318;
      --danger-quiet: #fde8e7;
      --warn: #9a6700;
      --warn-quiet: #fff2c2;
      --ok: #1a7f37;
      --ok-quiet: #e3f7e8;
      --shadow: 0 12px 36px rgba(17, 24, 29, 0.08);
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      min-width: 320px;
    }

    a {
      color: var(--accent);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    .topbar {
      background: var(--surface);
      border-bottom: 1px solid var(--line);
    }

    .topbar-inner {
      width: min(1180px, calc(100vw - 32px));
      min-height: 72px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      align-items: center;
    }

    .brand {
      display: grid;
      gap: 4px;
    }

    .brand-title {
      margin: 0;
      font-size: 22px;
      line-height: 1.15;
      font-weight: 750;
      letter-spacing: 0;
    }

    .brand-subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .nav {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .nav a,
    .control {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--strong);
      font: inherit;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
    }

    .nav a[aria-current="page"],
    .control.primary {
      border-color: #0f766e;
      background: var(--accent);
      color: #ffffff;
    }

    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }

    .page-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 20px;
      align-items: end;
      margin-bottom: 20px;
    }

    .page-title {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      font-weight: 750;
      letter-spacing: 0;
    }

    .page-meta {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 16px;
    }

    .panel {
      grid-column: span 12;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .span-4 {
      grid-column: span 4;
    }

    .span-6 {
      grid-column: span 6;
    }

    .span-8 {
      grid-column: span 8;
    }

    .panel-head {
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .panel-title {
      margin: 0;
      font-size: 15px;
      line-height: 1.25;
      font-weight: 700;
      letter-spacing: 0;
    }

    .panel-body {
      padding: 18px;
    }

    .metric-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .metric {
      min-height: 86px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfc;
    }

    .metric-label {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .metric-value {
      margin: 0;
      font-size: 24px;
      line-height: 1.1;
      font-weight: 760;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }

    .meta-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 18px;
      margin: 0;
    }

    .meta-item {
      min-width: 0;
    }

    .meta-item dt {
      margin: 0 0 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }

    .meta-item dd {
      margin: 0;
      font-size: 14px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      min-width: 680px;
      border-collapse: collapse;
      font-size: 13px;
      line-height: 1.4;
    }

    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
      background: #fbfcfc;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .status {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
    }

    .status.improvement {
      background: var(--ok-quiet);
      color: var(--ok);
    }

    .status.regression {
      background: var(--danger-quiet);
      color: var(--danger);
    }

    .status.inconclusive,
    .status.neutral {
      background: var(--warn-quiet);
      color: var(--warn);
    }

    .empty,
    .loading,
    .error {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      background: var(--surface);
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .error {
      border-color: #f4b7b2;
      background: var(--danger-quiet);
      color: var(--danger);
    }

    .loading {
      background: var(--surface-quiet);
    }

    .artifact-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .artifact {
      display: grid;
      gap: 3px;
      min-width: 0;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }

    .artifact:last-child {
      border-bottom: 0;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      color: #29343b;
      overflow-wrap: anywhere;
    }

    .chart {
      width: 100%;
      min-height: 260px;
      display: block;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfc;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .field {
      display: grid;
      gap: 4px;
      min-width: 180px;
    }

    .field label {
      color: var(--muted);
      font-size: 12px;
    }

    .field input {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 13px;
    }

    @media (max-width: 860px) {
      .topbar-inner,
      .page-head {
        grid-template-columns: 1fr;
        align-items: start;
      }

      .nav,
      .toolbar {
        justify-content: flex-start;
      }

      .span-4,
      .span-6,
      .span-8 {
        grid-column: span 12;
      }

      .metric-row,
      .meta-list {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <h1 class="brand-title">prodkit benchmark history</h1>
          <p class="brand-subtitle" data-subtitle>Official performance runs</p>
        </div>
        <nav class="nav" aria-label="Benchmark dashboard">
          <a href="/" data-route data-nav="overview">Overview</a>
        </nav>
      </div>
    </header>
    <main data-app>
      <div class="loading">Loading benchmark history.</div>
    </main>
  </div>
  <script>
    window.__PRODKIT_BENCHMARK_DASHBOARD__ = ${config};
  </script>
  <script>
    (function () {
      var config = window.__PRODKIT_BENCHMARK_DASHBOARD__;
      var app = document.querySelector("[data-app]");
      var subtitle = document.querySelector("[data-subtitle]");
      var nav = document.querySelector("[data-nav='overview']");
      var apiBase = String(config.apiBasePath || "/api/benchmarks").replace(/\\/$/, "");
      var artifactBaseUrl =
        typeof config.artifactBaseUrl === "string" && config.artifactBaseUrl.length > 0
          ? config.artifactBaseUrl.replace(/\\/$/, "")
          : "";

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function apiUrl(path) {
        return apiBase + path;
      }

      async function readError(response) {
        try {
          var body = await response.json();
          return body && typeof body.error === "string" ? body.error : response.statusText;
        } catch (_error) {
          return response.statusText;
        }
      }

      async function fetchJson(path) {
        var response = await fetch(apiUrl(path), {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        return response.json();
      }

      async function fetchJsonOrNull(path) {
        var response = await fetch(apiUrl(path), {
          headers: { accept: "application/json" },
        });
        if (response.status === 404) return null;
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        return response.json();
      }

      function formatDate(value) {
        if (!value) return "n/a";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      }

      function formatNumber(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
      }

      function formatPercent(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
        return new Intl.NumberFormat(undefined, {
          style: "percent",
          maximumFractionDigits: 2,
          signDisplay: "exceptZero",
        }).format(value);
      }

      function formatBytes(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
        var units = ["B", "KB", "MB", "GB"];
        var size = value;
        var index = 0;
        while (size >= 1024 && index < units.length - 1) {
          size = size / 1024;
          index += 1;
        }
        return formatNumber(size) + " " + units[index];
      }

      function shortSha(value) {
        return typeof value === "string" && value.length > 12 ? value.slice(0, 12) : value || "n/a";
      }

      function status(value) {
        var safe = escapeHtml(value || "neutral");
        return '<span class="status ' + safe + '">' + safe + "</span>";
      }

      function setLoading(title) {
        app.innerHTML =
          '<section class="page-head"><div><h2 class="page-title">' +
          escapeHtml(title) +
          '</h2><p class="page-meta">Loading current benchmark data.</p></div></section>' +
          '<div class="loading">Loading benchmark history.</div>';
      }

      function setError(title, error) {
        app.innerHTML =
          '<section class="page-head"><div><h2 class="page-title">' +
          escapeHtml(title) +
          '</h2><p class="page-meta">The dashboard could not load this view.</p></div></section>' +
          '<div class="error">' +
          escapeHtml(error && error.message ? error.message : error) +
          "</div>";
      }

      function metric(label, value) {
        return (
          '<div class="metric"><p class="metric-label">' +
          escapeHtml(label) +
          '</p><p class="metric-value">' +
          escapeHtml(value) +
          "</p></div>"
        );
      }

      function meta(items) {
        return (
          '<dl class="meta-list">' +
          items
            .map(function (item) {
              return (
                '<div class="meta-item"><dt>' +
                escapeHtml(item[0]) +
                "</dt><dd>" +
                item[1] +
                "</dd></div>"
              );
            })
            .join("") +
          "</dl>"
        );
      }

      function panel(title, body, span) {
        return (
          '<section class="panel ' +
          (span || "") +
          '"><div class="panel-head"><h3 class="panel-title">' +
          escapeHtml(title) +
          '</h3></div><div class="panel-body">' +
          body +
          "</div></section>"
        );
      }

      function artifactHref(artifact) {
        if (!artifactBaseUrl || !artifact.objectKey) return "";
        return (
          artifactBaseUrl +
          "/" +
          String(artifact.objectKey)
            .split("/")
            .map(function (part) {
              return encodeURIComponent(part);
            })
            .join("/")
        );
      }

      function artifactList(artifacts) {
        if (!Array.isArray(artifacts) || artifacts.length === 0) {
          return '<div class="empty">No published artifacts are attached.</div>';
        }
        return (
          '<ul class="artifact-list">' +
          artifacts
            .map(function (artifact) {
              var href = artifactHref(artifact);
              var target = artifact.objectKey || artifact.path || "";
              var link = href
                ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(target) + "</a>"
                : "<code>" + escapeHtml(target) + "</code>";
              return (
                '<li class="artifact"><strong>' +
                escapeHtml(artifact.kind || "artifact") +
                "</strong>" +
                link +
                "<code>" +
                escapeHtml(
                  [
                    artifact.contentType,
                    artifact.sizeBytes === undefined ? "" : formatBytes(artifact.sizeBytes),
                    artifact.sha256 ? "sha256 " + artifact.sha256.slice(0, 12) : "",
                  ]
                    .filter(Boolean)
                    .join(" | "),
                ) +
                "</code></li>"
              );
            })
            .join("") +
          "</ul>"
        );
      }

      function comparisonTable(comparison) {
        if (!comparison || !Array.isArray(comparison.scenarios) || comparison.scenarios.length === 0) {
          return '<div class="empty">No comparison verdicts are indexed yet.</div>';
        }
        return (
          '<div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Verdict</th><th>Base</th><th>Candidate</th><th>Delta</th><th>Threshold</th></tr></thead><tbody>' +
          comparison.scenarios
            .map(function (scenario) {
              var scenarioPath =
                "/scenarios/" +
                encodeURIComponent(scenario.key) +
                "?implementation=" +
                encodeURIComponent(scenario.implementationId || "op");
              return (
                "<tr><td><a data-route href='" +
                escapeHtml(scenarioPath) +
                "'>" +
                escapeHtml(scenario.label || scenario.key) +
                "</a></td><td>" +
                status(scenario.verdict) +
                "</td><td>" +
                escapeHtml(formatNumber(scenario.baseHz)) +
                "</td><td>" +
                escapeHtml(formatNumber(scenario.candidateHz)) +
                "</td><td>" +
                escapeHtml(formatPercent(scenario.deltaRatio)) +
                "</td><td>" +
                escapeHtml(formatPercent(scenario.noiseThresholdRatio)) +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table></div>"
        );
      }

      function scenarioRows(scenarios) {
        if (!Array.isArray(scenarios) || scenarios.length === 0) {
          return '<div class="empty">No scenarios are attached to this run.</div>';
        }
        return (
          '<div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Group</th><th>Implementation</th><th>Ops/sec</th><th>RME</th><th>Samples</th></tr></thead><tbody>' +
          scenarios
            .map(function (scenario) {
              var path =
                "/scenarios/" +
                encodeURIComponent(scenario.key) +
                "?implementation=" +
                encodeURIComponent(scenario.implementationId || "op");
              return (
                "<tr><td><a data-route href='" +
                escapeHtml(path) +
                "'>" +
                escapeHtml(scenario.label || scenario.key) +
                "</a></td><td>" +
                escapeHtml(scenario.group || "n/a") +
                "</td><td>" +
                escapeHtml(scenario.implementationLabel || scenario.implementationId || "n/a") +
                "</td><td>" +
                escapeHtml(formatNumber(scenario.stats && scenario.stats.hz)) +
                "</td><td>" +
                escapeHtml(formatPercent((scenario.stats && scenario.stats.rme) / 100)) +
                "</td><td>" +
                escapeHtml(formatNumber(scenario.stats && scenario.stats.sampleCount)) +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table></div>"
        );
      }

      function historyTable(history) {
        if (!Array.isArray(history) || history.length === 0) {
          return '<div class="empty">No history samples are indexed for this scenario.</div>';
        }
        return (
          '<div class="table-wrap"><table><thead><tr><th>Run</th><th>Generated</th><th>Commit</th><th>Runner</th><th>Ops/sec</th><th>RME</th></tr></thead><tbody>' +
          history
            .map(function (sample) {
              return (
                "<tr><td><a data-route href='/runs/" +
                encodeURIComponent(sample.runId) +
                "'>" +
                escapeHtml(sample.runId) +
                "</a></td><td>" +
                escapeHtml(formatDate(sample.generatedAt)) +
                "</td><td>" +
                escapeHtml(shortSha(sample.commitHeadSha)) +
                "</td><td>" +
                escapeHtml(sample.runnerId || "n/a") +
                "</td><td>" +
                escapeHtml(formatNumber(sample.stats && sample.stats.hz)) +
                "</td><td>" +
                escapeHtml(formatPercent((sample.stats && sample.stats.rme) / 100)) +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table></div>"
        );
      }

      function trendChart(history) {
        if (!Array.isArray(history) || history.length === 0) {
          return '<div class="empty">No samples available for a trend chart.</div>';
        }
        var samples = history.slice().reverse();
        var values = samples.map(function (sample) {
          return sample.stats && typeof sample.stats.hz === "number" ? sample.stats.hz : 0;
        });
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var range = max - min || 1;
        var width = 720;
        var height = 260;
        var pad = 34;
        var points = values
          .map(function (value, index) {
            var x =
              samples.length === 1
                ? width / 2
                : pad + (index / (samples.length - 1)) * (width - pad * 2);
            var y = height - pad - ((value - min) / range) * (height - pad * 2);
            return x.toFixed(2) + "," + y.toFixed(2);
          })
          .join(" ");
        var circles = samples
          .map(function (sample, index) {
            var point = points.split(" ")[index].split(",");
            return (
              '<circle cx="' +
              point[0] +
              '" cy="' +
              point[1] +
              '" r="4"><title>' +
              escapeHtml(formatDate(sample.generatedAt) + ": " + formatNumber(values[index]) + " ops/sec") +
              "</title></circle>"
            );
          })
          .join("");
        return (
          '<svg class="chart" viewBox="0 0 ' +
          width +
          " " +
          height +
          '" role="img" aria-label="Scenario throughput trend">' +
          '<line x1="' +
          pad +
          '" y1="' +
          (height - pad) +
          '" x2="' +
          (width - pad) +
          '" y2="' +
          (height - pad) +
          '" stroke="#d8dde1"/>' +
          '<line x1="' +
          pad +
          '" y1="' +
          pad +
          '" x2="' +
          pad +
          '" y2="' +
          (height - pad) +
          '" stroke="#d8dde1"/>' +
          '<text x="' +
          pad +
          '" y="20" fill="#5d6870" font-size="12">max ' +
          escapeHtml(formatNumber(max)) +
          '</text><text x="' +
          pad +
          '" y="' +
          (height - 8) +
          '" fill="#5d6870" font-size="12">min ' +
          escapeHtml(formatNumber(min)) +
          '</text><polyline points="' +
          points +
          '" fill="none" stroke="#0f766e" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><g fill="#0f766e">' +
          circles +
          "</g></svg>"
        );
      }

      function calibrationPanel(detail, scenarioKey) {
        if (!detail || !detail.calibration) {
          return panel("Noise context", '<div class="empty">No calibration attachment is indexed for the latest sample.</div>', "span-4");
        }
        var calibration = detail.calibration;
        var summary =
          Array.isArray(calibration.scenarioSummaries) &&
          calibration.scenarioSummaries.find(function (item) {
            return item.key === scenarioKey;
          });
        var micro = calibration.recommendations && calibration.recommendations.microbenchmark;
        var body = meta([
          ["Decision", status(micro && micro.decision ? micro.decision : "neutral")],
          ["Worst band", escapeHtml(formatPercent(micro && micro.worstNoiseBandRatio))],
          ["Threshold", escapeHtml(formatPercent(micro && micro.thresholdRatio))],
          ["Scenario p95", escapeHtml(formatPercent(summary && summary.p95AbsoluteDeltaRatio))],
          ["Scenario band", escapeHtml(formatPercent(summary && summary.noiseBandRatio))],
          ["Samples", escapeHtml(formatNumber(summary && summary.sampleCount))],
        ]);
        return panel("Noise context", body, "span-4");
      }

      async function renderOverview() {
        nav.setAttribute("aria-current", "page");
        subtitle.textContent = "Latest run, trusted deltas, and raw artifacts";
        setLoading("Benchmark overview");
        try {
          var latest = await fetchJsonOrNull("/latest?kind=comparison");
          var comparisons = await fetchJson("/comparisons?limit=10");
          var latestComparison =
            comparisons && Array.isArray(comparisons.comparisons) ? comparisons.comparisons[0] : null;
          var body =
            '<section class="page-head"><div><h2 class="page-title">Benchmark overview</h2><p class="page-meta">Official history from the Cloudflare index.</p></div></section><div class="grid">';
          if (latest) {
            body += panel(
              "Latest official run",
              '<div class="metric-row">' +
                metric("Scenarios", latest.scenarioCount) +
                metric("Artifacts", latest.artifactCount) +
                metric("Generated", formatDate(latest.generatedAt)) +
                "</div>" +
                meta([
                  ["Run", "<a data-route href='/runs/" + encodeURIComponent(latest.id) + "'>" + escapeHtml(latest.id) + "</a>"],
                  ["Commit", escapeHtml(shortSha(latest.commit && latest.commit.headSha))],
                  ["Runner", escapeHtml(latest.runner && latest.runner.id)],
                  ["Package", escapeHtml((latest.packages && latest.packages[0] && latest.packages[0].name) || "n/a")],
                ]),
              "span-8",
            );
          } else {
            body += panel("Latest official run", '<div class="empty">No comparison runs are indexed yet.</div>', "span-8");
          }
          if (latestComparison) {
            body += panel(
              "Base and candidate",
              meta([
                ["Base", escapeHtml(latestComparison.base.ref + " at " + shortSha(latestComparison.base.sha))],
                ["Candidate", escapeHtml(latestComparison.candidate.ref + " at " + shortSha(latestComparison.candidate.sha))],
                ["Improved", escapeHtml(formatNumber(latestComparison.summary.improvement))],
                ["Regressed", escapeHtml(formatNumber(latestComparison.summary.regression))],
                ["Inconclusive", escapeHtml(formatNumber(latestComparison.summary.inconclusive))],
                ["Generated", escapeHtml(formatDate(latestComparison.generatedAt))],
              ]),
              "span-4",
            );
            body += panel("Scenario verdicts", comparisonTable(latestComparison), "");
            body += panel("Comparison artifacts", artifactList(latestComparison.artifacts), "");
          } else {
            body += panel("Scenario verdicts", '<div class="empty">No trusted base/candidate comparisons are indexed yet.</div>', "");
          }
          body += "</div>";
          app.innerHTML = body;
        } catch (error) {
          setError("Benchmark overview", error);
        }
      }

      async function renderRun(runId) {
        nav.removeAttribute("aria-current");
        subtitle.textContent = "Run detail";
        setLoading("Run detail");
        try {
          var detail = await fetchJson("/runs/" + encodeURIComponent(runId));
          app.innerHTML =
            '<section class="page-head"><div><h2 class="page-title">Run detail</h2><p class="page-meta">' +
            escapeHtml(detail.id) +
            '</p></div></section><div class="grid">' +
            panel(
              "Metadata",
              meta([
                ["Generated", escapeHtml(formatDate(detail.generatedAt))],
                ["Kind", escapeHtml(detail.kind)],
                ["Commit", escapeHtml(shortSha(detail.commit && detail.commit.headSha))],
                ["Dirty", escapeHtml(detail.commit && detail.commit.dirty ? "yes" : "no")],
                ["Runner", escapeHtml(detail.runner && detail.runner.id)],
                ["Runtime", escapeHtml((detail.environment && detail.environment.node) || "n/a")],
              ]),
              "span-8",
            ) +
            panel(
              "Benchmark options",
              meta([
                ["Time", escapeHtml(formatNumber(detail.benchOptions && detail.benchOptions.time) + " ms")],
                [
                  "Warmup",
                  escapeHtml(formatNumber(detail.benchOptions && detail.benchOptions.warmupTime) + " ms"),
                ],
                [
                  "Warmup iterations",
                  escapeHtml(formatNumber(detail.benchOptions && detail.benchOptions.warmupIterations)),
                ],
                ["Repeats", escapeHtml(formatNumber(detail.benchOptions && detail.benchOptions.repeats))],
              ]),
              "span-4",
            ) +
            panel("Scenario results", scenarioRows(detail.scenarios), "") +
            panel("Published artifacts", artifactList(detail.artifacts), "") +
            "</div>";
        } catch (error) {
          setError("Run detail", error);
        }
      }

      async function renderScenario(scenarioKey) {
        nav.removeAttribute("aria-current");
        var params = new URLSearchParams(window.location.search);
        var implementation = params.get("implementation") || "op";
        subtitle.textContent = "Scenario history";
        setLoading("Scenario history");
        try {
          var historyResult = await fetchJson(
            "/scenarios/" +
              encodeURIComponent(scenarioKey) +
              "/history?implementation=" +
              encodeURIComponent(implementation) +
              "&limit=20",
          );
          var history = historyResult.history || [];
          var latestDetail = history.length > 0 ? await fetchJsonOrNull("/runs/" + encodeURIComponent(history[0].runId)) : null;
          app.innerHTML =
            '<section class="page-head"><div><h2 class="page-title">Scenario history</h2><p class="page-meta">' +
            escapeHtml(scenarioKey) +
            '</p></div><form class="toolbar" data-scenario-form><div class="field"><label for="implementation">Implementation</label><input id="implementation" name="implementation" value="' +
            escapeHtml(implementation) +
            '"></div><button class="control primary" type="submit">Apply</button></form></section><div class="grid">' +
            panel("Trend", trendChart(history), "span-8") +
            calibrationPanel(latestDetail, scenarioKey) +
            panel("Recent samples", historyTable(history), "") +
            panel("Latest sample artifacts", artifactList(history[0] && history[0].artifacts), "") +
            "</div>";
          var form = document.querySelector("[data-scenario-form]");
          if (form) {
            form.addEventListener("submit", function (event) {
              event.preventDefault();
              var data = new FormData(form);
              var nextImplementation = String(data.get("implementation") || "op").trim() || "op";
              navigate(
                "/scenarios/" +
                  encodeURIComponent(scenarioKey) +
                  "?implementation=" +
                  encodeURIComponent(nextImplementation),
              );
            });
          }
        } catch (error) {
          setError("Scenario history", error);
        }
      }

      function route() {
        var pathname = window.location.pathname;
        if (pathname.startsWith("/runs/")) {
          return { kind: "run", id: decodeURIComponent(pathname.slice("/runs/".length)) };
        }
        if (pathname.startsWith("/scenarios/")) {
          return { kind: "scenario", key: decodeURIComponent(pathname.slice("/scenarios/".length)) };
        }
        return { kind: "overview" };
      }

      function render() {
        var current = route();
        if (current.kind === "run") {
          void renderRun(current.id);
          return;
        }
        if (current.kind === "scenario") {
          void renderScenario(current.key);
          return;
        }
        void renderOverview();
      }

      function navigate(path) {
        window.history.pushState(null, "", path);
        render();
      }

      document.addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var link = target.closest("a[data-route]");
        if (!link) return;
        var href = link.getAttribute("href");
        if (!href) return;
        event.preventDefault();
        navigate(href);
      });

      window.addEventListener("popstate", render);
      render();
    })();
  </script>
</body>
</html>`;
}
