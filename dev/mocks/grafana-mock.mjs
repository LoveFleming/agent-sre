#!/usr/bin/env node
/**
 * Grafana Mock Server — dev fixture（TASK-008）
 *
 * 標準 Node http server（零依賴），監聽 port 3001（可用 MOCK_GRAFANA_PORT 覆寫），
 * 模擬 tools/grafana/handler.mjs 實際會打到的 Grafana API endpoints：
 *
 *   GET  /api/search                                      → dashboard 清單
 *   GET  /api/dashboards/uid/:uid                         → 單一 dashboard JSON（含 panels/targets）
 *   POST /api/ds/query                                    → panel query 結果（Grafana unified query）
 *   GET  /api/prometheus/grafana/api/v1/rules             → unified alerting rules（watchdog 用）
 *   GET  /api/datasources                                 → datasource 清單
 *   GET  /api/alerts                                      → legacy alerting fallback（Grafana 8-）
 *   GET  /api/datasource/proxy/uid/:uid/api/v1/query_range → Prometheus proxy fallback
 *   GET  /api/health                                      → Grafana health
 *
 * 情境切換（核心）：
 *   POST /__scenario  { "name": "healthy" | "firing" | "api-error" | "slow" }
 *   GET  /__scenario  → { "scenario": "<current>" }
 *
 *   - healthy  ：所有 alert rule state = ok，metric 序列偏低（CPU ~30%）
 *   - firing   ：含 firing 與 pending rule 各至少一筆（預設值，供 watchdog 判斷邏輯驗證），
 *                metric 序列偏高（CPU ~82%）
 *   - api-error：所有 /api/* 回 500 {"message":"..."}
 *   - slow     ：所有 /api/* 延遲 8 秒再回應（驗證 timeout）
 *
 * 啟動：npm run mock:grafana（或 node dev/mocks/grafana-mock.mjs）
 *
 * ⚠️ dev fixture 專用，不進 production 路徑。
 */

import { createServer } from "node:http";

const PORT = parseInt(process.env.MOCK_GRAFANA_PORT || "3001", 10);
const SLOW_DELAY_MS = 8000;
const VALID_SCENARIOS = ["healthy", "firing", "api-error", "slow"];

// 預設情境為 "firing"：rules endpoint 直接回傳 firing + pending 各至少一筆，
// 讓 watchdog / scheduler 在不切換情境的情況下就能驗證判斷邏輯。
let scenario = "firing";

const now = () => new Date().toISOString();

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const DATASOURCES = [
  {
    id: 1,
    uid: "prometheus-ds",
    name: "Prometheus",
    type: "prometheus",
    typeName: "Prometheus",
    access: "proxy",
    url: "http://prometheus:9090",
    user: "",
    database: "",
    basicAuth: false,
    isDefault: true,
    jsonData: { httpMethod: "POST", timeInterval: "15s" },
    readOnly: false,
  },
  {
    id: 2,
    uid: "loki-ds",
    name: "Loki",
    type: "loki",
    typeName: "Loki",
    access: "proxy",
    url: "http://loki:3100",
    basicAuth: false,
    isDefault: false,
    jsonData: { maxLines: 1000 },
    readOnly: false,
  },
];

const DASHBOARDS = [
  {
    uid: "node-overview",
    title: "Node Overview",
    tags: ["node", "infra"],
    folderUid: "folder-ops",
    folderTitle: "Ops",
    panels: [
      {
        id: 1,
        title: "CPU Usage",
        type: "timeseries",
        datasource: { type: "prometheus", uid: "prometheus-ds" },
        targets: [
          {
            refId: "A",
            expr: "100 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100",
          },
        ],
        fieldConfig: { defaults: { unit: "percent" }, overrides: [] },
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
      },
      {
        id: 2,
        title: "Memory Usage",
        type: "timeseries",
        datasource: { type: "prometheus", uid: "prometheus-ds" },
        targets: [
          {
            refId: "A",
            expr: "node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100",
          },
        ],
        fieldConfig: { defaults: { unit: "percent" }, overrides: [] },
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
      },
    ],
  },
  {
    uid: "k8s-cluster-health",
    title: "K8s Cluster Health",
    tags: ["kubernetes", "sre"],
    folderUid: "folder-ops",
    folderTitle: "Ops",
    panels: [
      {
        id: 1,
        title: "Ready Nodes",
        type: "stat",
        datasource: { type: "prometheus", uid: "prometheus-ds" },
        targets: [{ refId: "A", expr: "count(kube_node_status_condition{condition=\"Ready\",status=\"true\"})" }],
        gridPos: { h: 4, w: 6, x: 0, y: 0 },
      },
      {
        id: 2,
        title: "Pod CPU by namespace",
        type: "timeseries",
        datasource: { type: "prometheus", uid: "prometheus-ds" },
        targets: [
          { refId: "A", expr: "sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)" },
          { refId: "B", expr: "sum(rate(container_cpu_usage_seconds_total[5m]))" },
        ],
        gridPos: { h: 8, w: 18, x: 6, y: 0 },
      },
    ],
  },
  {
    uid: "loki-logs",
    title: "Application Logs",
    tags: ["loki", "logs"],
    folderUid: "folder-dev",
    folderTitle: "Dev",
    panels: [
      {
        id: 1,
        title: "Error logs",
        type: "logs",
        datasource: { type: "loki", uid: "loki-ds" },
        targets: [
          { refId: "A", expr: "{app=\"api-server\"} |= \"error\" | json" },
        ],
        gridPos: { h: 10, w: 24, x: 0, y: 0 },
      },
    ],
  },
];

/** GET /api/search 回應形狀（handler 讀 d.title / d.uid / d.folderTitle / d.tags） */
function searchResults(query) {
  return DASHBOARDS
    .filter(d => !query || d.title.toLowerCase().includes(query.toLowerCase()))
    .map((d, i) => ({
      id: i + 1,
      uid: d.uid,
      title: d.title,
      url: `/d/${d.uid}/${d.uid}`,
      type: "dash-db",
      tags: d.tags,
      typeSortRank: 1,
      folderId: 0,
      folderUid: d.folderUid,
      folderTitle: d.folderTitle,
      folderUrl: `/dashboards/f/${d.folderUid}/${d.folderTitle.toLowerCase()}`,
      sortMeta: 1,
    }));
}

/** GET /api/dashboards/uid/:uid 回應形狀（handler 讀 data.dashboard.{title,uid,tags,time,panels}） */
function dashboardResponse(uid) {
  const db = DASHBOARDS.find(d => d.uid === uid);
  if (!db) return null;
  return {
    dashboard: {
      id: DASHBOARDS.indexOf(db) + 1,
      uid: db.uid,
      title: db.title,
      tags: db.tags,
      time: { from: "now-6h", to: "now" },
      timezone: "browser",
      schemaVersion: 39,
      version: 1,
      refresh: "30s",
      panels: db.panels,
    },
    meta: {
      type: "db",
      canSave: true,
      canEdit: true,
      canAdmin: true,
      canStar: true,
      canDelete: true,
      slug: db.uid,
      url: `/d/${db.uid}/${db.uid}`,
      folderId: 0,
      folderUid: db.folderUid,
      folderTitle: db.folderTitle,
      folderUrl: `/dashboards/f/${db.folderUid}/${db.folderTitle.toLowerCase()}`,
      created: "2026-01-01T00:00:00Z",
      updated: now(),
      createdBy: "admin",
      updatedBy: "admin",
      provisioned: true,
    },
  };
}

/** alert rule 情境對應的 state/alerts */
const RULE_STATES = {
  // healthy：全部 ok、無 active alerts
  healthy: { HighCPUUsage: "ok", MemoryPressure: "ok", DiskAlmostFull: "ok" },
  // firing：firing + pending 各至少一筆（watchdog 判斷邏輯驗證用）
  firing: { HighCPUUsage: "firing", MemoryPressure: "pending", DiskAlmostFull: "ok" },
};

/** GET /api/prometheus/grafana/api/v1/rules（Grafana 9+ unified alerting，Prometheus 相容格式） */
function rulesResponse() {
  const states = RULE_STATES[scenario] || RULE_STATES.firing;
  const buildRule = (name, query, severity, duration, dashboardUid, summary, value) => {
    const state = states[name] || "ok";
    const labels = { severity, team: "sre", dashboarduid: dashboardUid };
    const annotations = { summary, description: `${summary} (mock fixture)` };
    return {
      name,
      query,
      duration,
      labels,
      annotations,
      alerts:
        state === "firing" || state === "pending"
          ? [{ state, value: String(value), labels, annotations, activeAt: now() }]
          : [],
      type: "alerting",
      health: "ok",
      state,
    };
  };

  return {
    status: "success",
    data: {
      groups: [
        {
          name: "node-alerts",
          file: "/etc/grafana/provisioning/alerting/node.yml",
          interval: 60,
          rules: [
            buildRule(
              "HighCPUUsage",
              "100 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100",
              "critical",
              300,
              "node-overview",
              "CPU usage above 85%",
              91.4,
            ),
            buildRule(
              "MemoryPressure",
              "node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100 < 15",
              "warning",
              300,
              "node-overview",
              "Memory available below 15%",
              12.7,
            ),
            buildRule(
              "DiskAlmostFull",
              "node_filesystem_avail_bytes{mountpoint=\"/\"} / node_filesystem_size_bytes{mountpoint=\"/\"} * 100 < 10",
              "warning",
              600,
              "node-overview",
              "Root filesystem below 10% free",
              42.3,
            ),
          ],
        },
      ],
    },
  };
}

/** GET /api/alerts（legacy Grafana 8- fallback） */
function legacyAlertsResponse() {
  const states = RULE_STATES[scenario] || RULE_STATES.firing;
  return [
    {
      id: 1,
      dashboardId: 1,
      dashboardUid: "node-overview",
      panelId: 1,
      name: "HighCPUUsage",
      state: states.HighCPUUsage === "ok" ? "ok" : states.HighCPUUsage,
      severity: "critical",
      message: "CPU usage above 85%",
      newStateDate: now(),
      evalData: { noData: false, evalMatches: [] },
      executionError: "",
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// /api/ds/query 序列產生（canned、deterministic）
// ─────────────────────────────────────────────────────────────

/** 從 PromQL expr 裡粗略抽出 metric 名（取最長 identifier） */
function metricFromExpr(expr) {
  const tokens = String(expr || "").match(/[a-zA-Z_:][a-zA-Z0-9_:]*/g) || [];
  return tokens.sort((a, b) => b.length - a.length)[0] || "mock_value";
}

/**
 * 產生固定 20 點的時間序列。
 * healthy 情境偏低（~30%）、firing 情境偏高（~82%），供 panel 查詢與 alert 狀態呼應。
 */
function seriesValues(fromMs, toMs, seed) {
  const { base, amp } = scenario === "firing" ? { base: 82, amp: 10 } : { base: 30, amp: 15 };
  const count = 20;
  const times = [];
  const values = [];
  const step = Math.max(1, Math.floor((toMs - fromMs) / (count - 1)));
  for (let i = 0; i < count; i++) {
    times.push(fromMs + i * step);
    values.push(Number((base + amp * Math.sin(i / 2 + seed)).toFixed(2)));
  }
  return { times, values };
}

/**
 * POST /api/ds/query 回應形狀。
 * handler 的 formatTable() 檢查 result.status — 必須是 "success" 或 undefined，
 * 這裡固定回 "success"（真實 Grafana 回 HTTP code 200，會踩到 handler 的顯示分支）。
 */
function dsQueryResponse(body) {
  const results = {};
  const queries = Array.isArray(body?.queries) ? body.queries : [];
  const from = /^\d+$/.test(String(body?.from ?? "")) ? parseInt(body.from, 10) : Date.now() - 3_600_000;
  const to = /^\d+$/.test(String(body?.to ?? "")) ? parseInt(body.to, 10) : Date.now();

  if (queries.length === 0) {
    results.A = {
      status: "success",
      frames: [
        {
          schema: {
            name: "mock",
            refId: "A",
            fields: [
              { name: "Time", type: "time" },
              { name: "Value", type: "number", labels: { __name__: "mock_value" } },
            ],
          },
          data: { values: [[], []] },
        },
      ],
    };
    return { results };
  }

  for (const q of queries) {
    const refId = q.refId || "A";
    const metric = metricFromExpr(q.expr);
    const seed = refId.charCodeAt(0) % 7;
    const { times, values } = seriesValues(from, to, seed);
    results[refId] = {
      status: "success",
      frames: [
        {
          schema: {
            name: metric,
            refId,
            fields: [
              { name: "Time", type: "time" },
              {
                name: "Value",
                type: "number",
                labels: { __name__: metric, job: "node", instance: "node-1:9100" },
              },
            ],
          },
          data: { values: [times, values] },
        },
      ],
    };
  }
  return { results };
}

/** GET /api/datasource/proxy/uid/:uid/api/v1/query_range（Prometheus matrix 格式 fallback） */
function queryRangeResponse(searchParams) {
  const expr = searchParams.get("query") || "up";
  const metric = metricFromExpr(expr);
  const { times, values } = seriesValues(Date.now() - 3_600_000, Date.now(), 3);
  return {
    status: "success",
    data: {
      resultType: "matrix",
      result: [
        {
          metric: { __name__: metric, job: "node", instance: "node-1:9100" },
          values: times.map((t, i) => [Math.floor(t / 1000), String(values[i])]),
        },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────
// HTTP plumbing
// ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || "GET";

  const log = (status, extra = "") =>
    console.log(`[grafana-mock] ${method} ${path} → ${status} (scenario=${scenario}${extra ? " " + extra : ""})`);

  try {
    // ── 情境控制（不受 api-error / slow 影響，否則切不出來）──
    if (path === "/__scenario") {
      if (method === "GET") {
        log(200);
        return sendJson(res, 200, { scenario });
      }
      if (method === "POST") {
        const raw = await readBody(req);
        let name;
        try {
          name = JSON.parse(raw).name;
        } catch {
          return sendJson(res, 400, { message: `invalid JSON body: ${raw.slice(0, 100)}` });
        }
        if (!VALID_SCENARIOS.includes(name)) {
          log(400, `invalid=${name}`);
          return sendJson(res, 400, {
            message: `unknown scenario "${name}"`,
            valid: VALID_SCENARIOS,
            current: scenario,
          });
        }
        const prev = scenario;
        scenario = name;
        log(200, `${prev} → ${name}`);
        return sendJson(res, 200, { ok: true, previous: prev, scenario });
      }
      return sendJson(res, 405, { message: "method not allowed" });
    }

    // 非 /api/ 前綴 → 404
    if (!path.startsWith("/api/")) {
      log(404);
      return sendJson(res, 404, { message: "not found" });
    }

    // ── slow 情境：延遲 8 秒（驗證 client timeout）──
    if (scenario === "slow") {
      console.log(`[grafana-mock] ${method} ${path} … sleeping ${SLOW_DELAY_MS}ms (scenario=slow)`);
      await sleep(SLOW_DELAY_MS);
    }

    // ── api-error 情境：所有 /api/* 回 500 ──
    if (scenario === "api-error") {
      log(500);
      return sendJson(res, 500, { message: "mock scenario: api-error (internal server error)" });
    }

    // ── 路由 ──
    if (path === "/api/health" && method === "GET") {
      log(200);
      return sendJson(res, 200, { commit: "mock-commit", database: "ok", version: "11.0.0-mock" });
    }

    if (path === "/api/search" && method === "GET") {
      const data = searchResults(url.searchParams.get("query"));
      log(200, `count=${data.length}`);
      return sendJson(res, 200, data);
    }

    const dashMatch = path.match(/^\/api\/dashboards\/uid\/([^/]+)$/);
    if (dashMatch && method === "GET") {
      const uid = decodeURIComponent(dashMatch[1]);
      const data = dashboardResponse(uid);
      if (!data) {
        log(404, `uid=${uid}`);
        return sendJson(res, 404, { message: `dashboard ${uid} not found` });
      }
      log(200, `uid=${uid}`);
      return sendJson(res, 200, data);
    }

    if (path === "/api/ds/query" && method === "POST") {
      const raw = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { message: "invalid JSON body" });
      }
      const data = dsQueryResponse(body);
      log(200, `refIds=${Object.keys(data.results).join(",")}`);
      return sendJson(res, 200, data);
    }

    if (path === "/api/prometheus/grafana/api/v1/rules" && method === "GET") {
      const data = rulesResponse();
      const states = data.data.groups[0].rules.map((r) => r.state);
      log(200, `states=[${states.join(",")}]`);
      return sendJson(res, 200, data);
    }

    if (path === "/api/alerts" && method === "GET") {
      const data = legacyAlertsResponse();
      log(200, `states=[${data.map((a) => a.state).join(",")}]`);
      return sendJson(res, 200, data);
    }

    if (path === "/api/datasources" && method === "GET") {
      log(200);
      return sendJson(res, 200, DATASOURCES);
    }

    const proxyMatch = path.match(/^\/api\/datasource\/proxy\/uid\/([^/]+)\/api\/v1\/query_range$/);
    if (proxyMatch && method === "GET") {
      log(200, `ds=${decodeURIComponent(proxyMatch[1])}`);
      return sendJson(res, 200, queryRangeResponse(url.searchParams));
    }

    log(404);
    return sendJson(res, 404, { message: `no mock route for ${method} ${path}` });
  } catch (err) {
    console.error("[grafana-mock] unhandled error:", err);
    if (!res.headersSent) {
      sendJson(res, 500, { message: `mock internal error: ${err.message}` });
    } else {
      res.end();
    }
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[grafana-mock] ❌ port ${PORT} 已被占用。用 MOCK_GRAFANA_PORT=3002 npm run mock:grafana 換 port。`);
    process.exit(1);
  }
  console.error("[grafana-mock] server error:", err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[grafana-mock] 🎛️  Grafana mock server listening on http://localhost:${PORT}`);
  console.log(`[grafana-mock] scenario=${scenario}（切換：curl -X POST localhost:${PORT}/__scenario -d '{"name":"healthy"}'）`);
  console.log(`[grafana-mock] valid scenarios: ${VALID_SCENARIOS.join(" | ")}`);
});
