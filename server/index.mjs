#!/usr/bin/env node

/**
 * agent-sre — SRE Agentic Monitoring server
 *
 * Usage:
 *   node server/index.mjs               # start server
 *   SRE_PORT=8080 node server/index.mjs # custom port
 *
 * API (all behind X-API-Token except /api/health):
 *   GET  /api/health                    — health check
 *   GET  /api/monitors                  — list monitors + instance summary
 *   POST /api/monitors                  — create monitor + agent instance
 *   GET/PUT/DELETE /api/monitors/:id    — definition CRUD
 *   POST /api/monitors/:id/run          — Run Now (manual agent loop)
 *   GET/POST /api/monitors/:id/chat     — agent-scoped chat
 *   GET/PUT /api/monitors/:id/memory    — memory viewer/editor
 *   GET  /api/monitors/:id/runs         — execution history
 *   GET  /api/monitor-meta              — pickers (flows/schedules/sources)
 */

import { createServer } from "http";
import { PORT } from "./config.mjs";
import { loadAllTools } from "./tool-loader.mjs";
import { registerRoutes } from "./routes.mjs";
import { startMonitorScheduler } from "./monitor-scheduler.mjs";

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║  🤖 SRE Agentic Monitoring — Agent    ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Load tool providers (source MCP handlers underneath) ──
  const tools = await loadAllTools();
  console.log(`[tools] Loaded ${tools.length} tools:`);
  for (const t of tools) {
    console.log(`  🔧 ${t}`);
  }

  // ── Start the monitor scheduler (persistent agent instances) ──
  startMonitorScheduler();

  // ── Start HTTP server ──
  const server = createServer();
  registerRoutes(server);

  // ── API auth status (TASK-015) ──
  if (!process.env.AGENT_SRE_API_TOKEN) {
    console.warn(
      "\n⚠️  [auth] AGENT_SRE_API_TOKEN is not set — running in permissive dev mode.\n" +
      "   All /api/* endpoints (except /api/health) are UNPROTECTED.\n" +
      "   Set this env var before exposing this server beyond localhost.\n"
    );
  }

  server.listen(PORT, () => {
    console.log(`\n✅ Agent SRE listening on http://localhost:${PORT}`);
    console.log(`   Health:   GET  /api/health`);
    console.log(`   Monitors: GET  /api/monitors`);
    console.log(`   UI:       http://localhost:${PORT}/`);
  });

  // ── Graceful shutdown ──
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
