# Architecture Map — `agent-sre`

> **Note on confidence:** The file-tree scan failed (unescaped parens in `find`), so paths, export names, and dependency edges below are inferred from the git log and the JSON scan summary. Treat the graph as a working hypothesis to verify against real source.

---

## 1. System Overview

**agent-sre** is a standalone Site Reliability Engineering agent platform. It exposes operational tools — currently **Grafana** (6 tools: dashboards, alerts, metrics queries, etc.) and **Telegram chat** (3 tools for sending/reading/managing messages, renamed `telegram_*` → `tchat_*`) — via the **Model Context Protocol (MCP)**. An SRE "crew" orchestrates multiple agent roles for incident response and observability workflows, coordinating tool calls through an MCP client. A React-based web UI provides a multi-tab chat interface with a model selector, backed by a small HTTP API that proxies chat and tool-testing requests to the MCP layer.

The project is a **fully standalone rewrite** (per commit `70820ee`), with **zero dependency on PAAW**. The frontend deliberately matches the PAAW stack (React + Vite + Tailwind) for visual/ergonomic consistency.

**Tech Stack**
- **Language:** TypeScript (Node.js + browser)
- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** Node.js HTTP server (`src/server.ts`)
- **Protocol:** Model Context Protocol (MCP) — custom server + client implementation
- **Integrations:** Grafana API, Telegram Bot API
- **Build:** Vite (UI), `tsc`/`tsx` (server, inferred)
- **Persistence:** None — in-memory only

**Architecture Style:** **Modular monolith** with a clear internal plugin (tool-provider) pattern. Frontend and backend live in the same repository (single-package, not a formal monorepo). MCP acts as the internal RPC seam between the chat UI / crew orchestration and the tool providers.

---

## 2. Layer Structure

```
Presentation Layer
  - React App root         (src/web/main.tsx)
  - App shell              (src/web → App)
  - Multi-tab Chat         (src/web → ChatTab)
  - Model Selector         (src/web → ModelSelector)
  - Shared UI types        (src/web/types.ts)

API Layer (HTTP)
  - Routes                 (src/server.ts)
      • POST /api/chat
      • GET  /api/tools
      • POST /api/tools/test
  - Middleware             (inferred inline in server.ts; no formal chain)
  - No request/response schemas, no error-code mapping

MCP Protocol Layer
  - MCP Server             (src/mcp/server → McpServer, startServer)
  - MCP Client             (src/mcp/client → McpClient, listTools, callTool)
  - MCP types              (src/mcp/types.ts → McpTool)

Tool Provider Layer (plugins registered with MCP server)
  - Grafana Provider       (src/tools/grafana → grafanaTools, GrafanaProvider) — 6 tools
  - Tchat Provider         (src/tools/tchat → tchatTools, TchatProvider) — 3 tools

Business Logic / Orchestration Layer
  - SRE Crew               (src/crew → SreCrew, runCrew)
      coordinates multi-role agents for incident response

Data Layer
  - In-memory state only
      • ChatMessage  { id, role, content, timestamp, model, tabId }
      • ChatTab      { id, title, messages, model }
      • McpTool      { name, description, inputSchema, provider }
  - External Systems
      • Grafana HTTP API
      • Telegram Bot API
```

---

## 3. Module Dependencies

### Internal dependency graph

```
                        ┌──────────────┐
                        │   web-ui     │  (React: App, ChatTab, ModelSelector)
                        └──────┬───────┘
                               │ uses
                               ▼
                        ┌──────────────┐
                        │  mcp-client  │  (McpClient, listTools, callTool)
                        └──────┬───────┘
                               │ connects to
                               ▼
        ┌──────────────────────────────────────────┐
        │                mcp-server                │
        │        (McpServer, startServer)          │
        └──────────┬────────────────────┬──────────┘
                   │ registers          │ registers
                   ▼                    ▼
          ┌────────────────┐    ┌────────────────┐
          │  tool-grafana  │    │   tool-tchat   │
          │ (6 tools)      │    │ (3 tools)      │
          └────────────────┘    └────────────────┘
                   ▲                    ▲
                   │                    │
                   └─────────┬──────────┘
                             │ orchestrates
                             ▼
                        ┌──────────────┐
                        │   sre-crew   │  (SreCrew, runCrew)
                        │  also → mcp-client
                        └──────────────┘

  HTTP entry:  src/server.ts  → mcp-server, sre-crew, mcp-client (chat proxy)
  CLI/primary: src/index.ts   → (inferred) boots mcp-server and/or crew
```

**Edge summary**
- `web-ui` → `mcp-client`
- `mcp-client` → `mcp-server` (runtime, via MCP transport)
- `mcp-server` ← `tool-grafana`, `tool-tchat` (providers register themselves)
- `sre-crew` → `mcp-client`, `tool-grafana`, `tool-tchat`
- `src/server.ts` (HTTP) wires the API layer to `mcp-client` / `sre-crew`
- `src/index.ts` (inferred bootstrap) → `mcp-server`, `sre-crew`

**Circular dependencies**
- None detected from the import graph in the scan summary. Worth re-verifying: `tool-grafana`/`tool-tchat` declare `dependsOn: ["mcp-server"]`, while `mcp-server` registration implies a *runtime* (not import-time) reference back to providers — this is a plugin inversion, not a cycle, **provided** providers receive the server via DI rather than importing it directly.

**External dependencies (inferred)**
- **MCP runtime** (custom in-repo implementation of Model Context Protocol)
- **Grafana API client** (HTTP; exact lib unknown)
- **Telegram Bot API client** (`node-telegram-bot-api`, `telegraf`, or raw HTTP — unconfirmed)
- **React / ReactDOM**, **Vite**, **Tailwind CSS**
- An LLM client library for the chat/crew layer (not visible in scan — possibly OpenAI SDK or similar, given "model selector")

---

## 4. Key Patterns

| Concern | Pattern / Approach |
|---|---|
| **Overall architecture** | Modular monolith with a **plugin (tool-provider)** model behind an MCP RPC seam |
| **RPC protocol** | **Model Context Protocol** — server registers tools, client discovers & invokes |
| **Tool providers** | Provider pattern (`GrafanaProvider`, `TchatProvider`) — each exports a `*Tools` registry + a class/factory |
| **Orchestration** | **Crew pattern** (`SreCrew`, `runCrew`) — multi-role agent coordination for incident response |
| **API style** | Thin REST handlers in a single `server.ts` (no router module, no middleware framework visible) |
| **State management** | In-memory only; React component state (no Redux/Zustand flagged). Tab + message state lost on restart |
| **Routing (UI)** | Vite SPA — no client-side router mentioned; tab switching is component-state driven |
| **Routing (server)** | Inline path dispatch in `src/server.ts`; three endpoints only |
| **Validation** | **None** — `hasRequestSchema: false`, `hasResponseSchema: false` on all routes (tech-debt flag) |
| **Error handling** | **Ad hoc** — no error-code taxonomy, no centralized mapper (tech-debt flag) |
| **Persistence** | None — all data models marked `persistence: memory` |
| **Build** | Vite for the browser bundle; server presumed `tsx`/`tsc` |

---

## 5. Entry Points

| Entry | Path | Role |
|---|---|---|
| **Primary / CLI bootstrap** | `src/index.ts` | Likely boots the MCP server and/or SRE crew as a long-running process (inferred — needs source verification) |
| **HTTP API server** | `src/server.ts` | Node HTTP server exposing `/api/chat`, `/api/tools`, `/api/tools/test`; bridges the web UI to the MCP client + crew |
| **UI bootstrap (browser)** | `src/web/main.tsx` | React root mount (Vite dev + production bundle entry) |
| **Build config** | `vite.config.ts` | Vite configuration for the frontend bundle |

**Boot flow (hypothesized):**
1. `src/index.ts` (or `src/server.ts` directly) starts the HTTP server.
2. Server starts `McpServer` (`startServer`), which registers `GrafanaProvider` and `TchatProvider`.
3. On a `/api/chat` request, the server uses `McpClient` (and optionally `SreCrew`) to dispatch tool calls.
4. The browser loads `src/web/main.tsx` → `App`, which renders `ChatTab`s + `ModelSelector` and calls back into the HTTP API.

---

### Verification checklist (re-run scan with escaped parens)
- [ ] Confirm exact file paths under `src/mcp/`, `src/tools/`, `src/crew/`, `src/web/`
- [ ] Confirm whether `src/index.ts` vs `src/server.ts` is the true process entry
- [ ] Verify there are no import-time circular deps between providers and the MCP server
- [ ] Enumerate actual `package.json` dependencies (the scan returned an empty dependency list — likely a parse gap)
- [ ] Inspect error-handling patterns inside tool providers (the `errorCodes: []` result may be a scan artifact, not reality)