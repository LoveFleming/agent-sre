/**
 * Grafana Tool Provider Handler
 *
 * Fetches data from Grafana HTTP API.
 *
 * Config (tools/grafana/config.json):
 *   {
 *     "grafana_url": "http://localhost:3000",
 *     "grafana_token": "gsk_...",
 *     "default_org_id": 1
 *   }
 */

import { existsSync, readFileSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _config = null;
/** Cached mtime (ms) of the config file the cache was loaded from. */
let _configMtime = 0;

function getConfig() {
  const ROOT = process.env.PAAW_ROOT || process.env.SRE_ROOT || resolve(__dirname, "../..");
  const configPath = join(ROOT, "tools/grafana/config.json");
  if (existsSync(configPath)) {
    // TASK-011: datasource-store hot-syncs this file via the API; watch its
    // mtime so a rotated token/url is picked up without a server restart.
    const mtime = statSync(configPath).mtimeMs;
    if (!_config || mtime !== _configMtime) {
      _config = JSON.parse(readFileSync(configPath, "utf-8"));
      _configMtime = mtime;
    }
  } else {
    // Fallback to env vars
    _config = {
      grafana_url: process.env.GRAFANA_URL || "http://localhost:3000",
      grafana_token: process.env.GRAFANA_TOKEN || "",
      default_org_id: parseInt(process.env.GRAFANA_ORG_ID || "1", 10),
    };
    _configMtime = 0;
  }
  return _config;
}

/** Grafana API base URL */
function apiBase() {
  const cfg = getConfig();
  return cfg.grafana_url.replace(/\/+$/, "") + "/api";
}

/** Auth headers for Grafana API */
function authHeaders() {
  const cfg = getConfig();
  const headers = { "Content-Type": "application/json" };
  if (cfg.grafana_token) {
    headers["Authorization"] = `Bearer ${cfg.grafana_token}`;
  } else if (cfg.grafana_user && cfg.grafana_password) {
    headers["Authorization"] = "Basic " + Buffer.from(`${cfg.grafana_user}:${cfg.grafana_password}`).toString("base64");
  }
  if (cfg.default_org_id) {
    headers["X-Grafana-Org-Id"] = String(cfg.default_org_id);
  }
  return headers;
}

/** Fetch helper */
async function gql(path, options = {}) {
  const url = apiBase() + path;
  const resp = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Grafana API ${resp.status}: ${body.slice(0, 200)}`);
  }
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) return resp.json();
  return resp.text();
}

// ── Helpers ──

/** Parse Grafana time string to epoch ms */
function parseTime(t) {
  if (!t || t === "now") return Date.now();
  if (/^\d+$/.test(t)) return parseInt(t, 10); // already epoch ms
  // Relative: now-1h, now-24h, now-7d
  const match = t.match(/^now-(\d+)([smhdwMy])$/);
  if (match) {
    const val = parseInt(match[1], 10);
    const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000, y: 31_536_000_000 };
    return Date.now() - val * (units[match[2]] || 3_600_000);
  }
  // Try Date.parse
  const parsed = Date.parse(t);
  return isNaN(parsed) ? Date.now() - 3_600_000 : parsed;
}

/** Format panel query result as readable table */
function formatTable(data) {
  if (!data?.results) return JSON.stringify(data, null, 2);

  const lines = [];
  for (const [refId, result] of Object.entries(data.results)) {
    if (result.status !== "success" && result.status !== undefined) {
      lines.push(`❌ ${refId}: ${result.status} — ${result.error || ""}`);
      continue;
    }
    const frames = result.frames || [];
    for (const frame of frames) {
      const schema = frame.schema?.fields || [];
      const fields = schema.map(f => f.name);
      const rows = frame.data?.values || [];

      if (fields.length === 0) continue;

      // Header
      lines.push(`📊 ${refId}: ${frame.schema?.name || "data"}`);
      lines.push(`| ${fields.join(" | ")} |`);
      lines.push(`| ${fields.map(() => "---").join(" | ")} |`);

      // Rows (values is columnar: [[row0val, row1val, ...], ...])
      const rowCount = rows[0]?.length || 0;
      const maxRows = Math.min(rowCount, 20); // limit display
      for (let i = 0; i < maxRows; i++) {
        const vals = rows.map(col => {
          const v = col?.[i];
          if (v === null || v === undefined) return "";
          if (typeof v === "number") {
            // Format timestamps
            if (v > 1_000_000_000_000) return new Date(v).toISOString().slice(11, 19);
            return Number.isInteger(v) ? String(v) : v.toFixed(2);
          }
          return String(v).slice(0, 40);
        });
        lines.push(`| ${vals.join(" | ")} |`);
      }
      if (rowCount > maxRows) lines.push(`... (${rowCount - maxRows} more rows)`);
      lines.push("");
    }
  }
  return lines.join("\n") || JSON.stringify(data, null, 2);
}

// ── Main handler ──

export default async function handler(args, ctx) {
  const toolName = ctx.toolName;
  const cfg = getConfig();

  if (!cfg.grafana_url) {
    return { text: "❌ Grafana URL not configured. Set tools/grafana/config.json or GRAFANA_URL env var.", error: true };
  }

  switch (toolName) {
    // ── list_dashboards ──
    case "grafana_list_dashboards": {
      const params = new URLSearchParams();
      if (args.folderId != null) params.set("folderId", String(args.folderId));
      if (args.tag) params.set("tag", args.tag);
      params.set("limit", String(args.limit || 100));
      const data = await gql(`/search?${params}`);
      if (!Array.isArray(data)) return { text: "No dashboards found." };
      const lines = data.map(d =>
        `📁 ${d.title}\n   UID: ${d.uid} | Folder: ${d.folderTitle || "General"} | Tags: ${(d.tags || []).join(", ") || "none"}`
      );
      return { text: `Found ${data.length} dashboards:\n\n${lines.join("\n\n")}`, data };
    }

    // ── get_dashboard ──
    case "grafana_get_dashboard": {
      if (!args.uid) return { text: "❌ Missing required param: uid", error: true };
      const data = await gql(`/dashboards/uid/${encodeURIComponent(args.uid)}`);
      const db = data.dashboard;
      if (!db) return { text: "Dashboard not found.", error: true };
      const panels = (db.panels || []).map(p =>
        `  📊 [${p.id}] ${p.title || "(untitled)"} (${p.type}) — datasource: ${p.datasource?.uid || p.datasource || "?"}`
      );
      const summary = [
        `📋 Dashboard: ${db.title}`,
        `   UID: ${db.uid}`,
        `   Tags: ${(db.tags || []).join(", ") || "none"}`,
        `   Time range: ${db.time?.from || "now-6h"} → ${db.time?.to || "now"}`,
        `   Panels (${db.panels?.length || 0}):`,
        ...panels,
      ].join("\n");
      return { text: summary, data: db };
    }

    // ── query_panel ──
    case "grafana_query_panel": {
      if (!args.uid || args.panelId == null) {
        return { text: "❌ Missing required params: uid, panelId", error: true };
      }

      // Step 1: Get dashboard to find panel + datasource + queries
      const dbData = await gql(`/dashboards/uid/${encodeURIComponent(args.uid)}`);
      const panel = dbData.dashboard?.panels?.find(p => p.id === args.panelId);
      if (!panel) return { text: `❌ Panel ${args.panelId} not found in dashboard ${args.uid}`, error: true };

      const from = parseTime(args.from || "now-1h");
      const to = parseTime(args.to || "now");

      // Step 2: Try datasource proxy query (Prometheus-style)
      const datasource = panel.datasource;
      const dsUid = datasource?.uid || (typeof datasource === "string" ? datasource : null);
      const queries = panel.targets || [];

      if (queries.length === 0) {
        return { text: `Panel "${panel.title}" has no queries defined.`, data: panel };
      }

      // Use /api/ds/query for unified querying
      const reqBody = {
        queries: queries.map((t, i) => ({
          refId: t.refId || String.fromCharCode(65 + i),
          datasource: { uid: dsUid, type: datasource?.type || "prometheus" },
          expr: t.expr || t.query || "",
          intervalMs: 60_000,
          maxDataPoints: 1100,
        })),
        from: String(from),
        to: String(to),
      };

      try {
        const result = await gql(`/ds/query`, {
          method: "POST",
          body: JSON.stringify(reqBody),
        });

        const format = args.format || "table";
        if (format === "raw") return { text: JSON.stringify(result, null, 2), data: result };
        if (format === "json") return { text: JSON.stringify(result, null, 2), data: result };
        return { text: formatTable(result), data: result };
      } catch (err) {
        // Fallback: try direct Prometheus proxy
        if (dsUid) {
          try {
            const firstQuery = queries[0];
            const expr = firstQuery?.expr || firstQuery?.query || "";
            if (expr) {
              const params = new URLSearchParams({
                query: expr,
                start: String(Math.floor(from / 1000)),
                end: String(Math.floor(to / 1000)),
                step: "60s",
              });
              const proxyResult = await gql(`/datasource/proxy/uid/${dsUid}/api/v1/query_range?${params}`);
              return { text: JSON.stringify(proxyResult, null, 2), data: proxyResult };
            }
          } catch (err2) {
            return { text: `❌ Query failed: ${err.message}\nFallback also failed: ${err2.message}`, error: true };
          }
        }
        return { text: `❌ Query failed: ${err.message}`, error: true };
      }
    }

    // ── list_alerts ──
    case "grafana_list_alerts": {
      // Grafana 9+: /api/alertmanagergr values, /api/prometheus/grafana/api/v1/rules
      // Grafana 8-: /api/alerts
      let alerts = [];
      try {
        // Unified Alerting API (Grafana 9+)
        const rules = await gql(`/prometheus/grafana/api/v1/rules`);
        alerts = (rules?.data?.groups || []).flatMap(g =>
          (g.rules || []).filter(r => r.type === "alerting").map(r => ({
            name: r.name,
            state: r.state,
            query: r.query,
            labels: r.labels || {},
            annotations: r.annotations || {},
            alerts: (r.alerts || []).map(a => ({
              state: a.state,
              value: a.value,
              labels: a.labels || {},
            })),
          }))
        );
      } catch {
        // Legacy alerting API (Grafana 8-)
        try {
          alerts = await gql(`/alerts`);
          alerts = (alerts || []).map(a => ({
            name: a.name,
            state: a.state,
            severity: a.severity,
            message: a.message,
            dashboardUid: a.dashboardUid,
            panelId: a.panelId,
          }));
        } catch {}
      }

      // Filter
      const stateFilter = args.state || "firing";
      const dashFilter = args.dashboardUID;
      const sevFilter = args.severity;

      let filtered = alerts;
      if (stateFilter !== "all") {
        filtered = filtered.filter(a => {
          const state = a.state || a.alerts?.[0]?.state || "";
          return state.toLowerCase().includes(stateFilter.toLowerCase());
        });
      }
      if (dashFilter) {
        filtered = filtered.filter(a => a.dashboardUid === dashFilter || a.labels?.dashboarduid === dashFilter);
      }
      if (sevFilter) {
        filtered = filtered.filter(a => (a.severity || a.labels?.severity || "").toLowerCase() === sevFilter.toLowerCase());
      }

      if (filtered.length === 0) {
        return { text: `✅ No alerts matching filters (state=${stateFilter}${dashFilter ? `, dashboard=${dashFilter}` : ""}${sevFilter ? `, severity=${sevFilter}` : ""}).` };
      }

      const lines = filtered.map(a => {
        const stateEmoji = { firing: "🔴", pending: "🟡", ok: "🟢", normal: "🟢", resolved: "🟢" }[a.state?.toLowerCase()] || "⚪";
        const detail = a.alerts?.length ? ` (value: ${a.alerts[0].value})` : a.message ? ` — ${a.message}` : "";
        return `${stateEmoji} ${a.name} [${a.state || "?"}]${detail}\n   labels: ${JSON.stringify(a.labels || {})}`;
      });

      return { text: `Found ${filtered.length} alert(s):\n\n${lines.join("\n\n")}`, data: filtered };
    }

    // ── search ──
    case "grafana_search": {
      const params = new URLSearchParams();
      params.set("query", args.query || "");
      if (args.type) params.set("type", args.type);
      const data = await gql(`/search?${params}`);
      if (!Array.isArray(data) || data.length === 0) {
        return { text: `No results for "${args.query}".` };
      }
      const lines = data.map(d =>
        `${d.type === "dash-db" ? "📊" : d.type === "dash-folder" ? "📁" : "🔔"} ${d.title} (UID: ${d.uid || "?"})`
      );
      return { text: `Search results for "${args.query}":\n\n${lines.join("\n")}`, data };
    }

    // ── list_datasources ──
    case "grafana_list_datasources": {
      const data = await gql(`/datasources`);
      if (!Array.isArray(data)) return { text: "No datasources found." };
      const lines = data.map(ds =>
        `🔌 ${ds.name} (${ds.type})\n   UID: ${ds.uid} | URL: ${ds.url} | Default: ${ds.isDefault ? "Yes" : "No"}`
      );
      return { text: `Datasources (${data.length}):\n\n${lines.join("\n\n")}`, data };
    }

    default:
      return { text: `Unknown Grafana tool: ${toolName}`, error: true };
  }
}
