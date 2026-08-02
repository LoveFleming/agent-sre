#!/usr/bin/env node

/**
 * agent-sre — Standalone AI SRE Agent Server
 *
 * Usage:
 *   node server/index.mjs              # start server
 *   SRE_PORT=8080 node server/index.mjs # custom port
 *
 * API:
 *   GET  /api/health              — health check
 *   GET  /api/crews               — list SRE crew members
 *   GET  /api/crews/:id           — get crew detail
 *   GET  /api/tools               — list registered tools
 *   POST /api/chat                — chat with crew member
 *   GET  /api/conversations/:id   — load conversation
 *   POST /api/conversations/:id   — save conversation
 *   DELETE /api/conversations/:id — clear conversation
 *   POST /api/conversations/:id/archive — archive + new session
 *   GET  /api/conversations/:id/archives — list archived
 */

import { createServer } from "http";
import { PORT } from "./config.mjs";
import { loadAllTools } from "./tool-loader.mjs";
import { loadAllCrews } from "./crew-loader.mjs";
import { registerRoutes } from "./routes.mjs";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" 
};

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     🤖 Agent SRE — Standalone        ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Load crews ──
  const crews = loadAllCrews();
  console.log(`[crew] Loaded ${crews.length} crew members:`);
  for (const c of crews) {
    console.log(`  ${c.emoji || "👤"} ${c.codename || c.title} (${c.id})`);
  }

  // ── Load tool providers ──
  const tools = await loadAllTools();
  console.log(`\n[tools] Loaded ${tools.length} built-in tools:`);
  for (const t of tools) {
    console.log(`  🔧 ${t}`);
  }

  // ── Start HTTP server ──
  const server = createServer();
  registerRoutes(server);

  server.listen(PORT, () => {
    console.log(`\n✅ Agent SRE listening on http://localhost:${PORT}`);
    console.log(`   Health:  GET  /api/health`);
    console.log(`   Crews:   GET  /api/crews`);
    console.log(`   Chat:    POST /api/chat`);
    console.log(`   UI:      http://localhost:${PORT}/`);
  });

  // ── Graceful shutdown ──
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
