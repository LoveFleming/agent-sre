```markdown
# agent-sre

> A standalone SRE agent platform that exposes Grafana and Telegram chat tools via the Model Context Protocol (MCP), driven by an SRE agent crew and surfaced through a React multi-tab chat UI.

## Quick Links
- [Architecture Map](ARCHITECTURE.md)
- [Feature Map](features/FEATURES.json)
- [API Contract](specs/api-contract.md)
- [Error Codes](specs/error-codes.md)
- [Coding Standards](standards/coding-style.md)
- [Code Intelligence](code-intelligence/summary.json)
- [Security Scan](security/scan-results.json)

## Tech Stack
- **Language:** TypeScript (Node.js + browser)
- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** Node.js HTTP server (`src/server.ts`)
- **Protocol:** Model Context Protocol (MCP) — custom server + client
- **Integrations:** Grafana API, Telegram Bot API
- **Persistence:** None — in-memory only (tech-debt item)
- **Build:** Vite (UI), `tsc`/`tsx` (server)

## Architecture Overview

`agent-sre` is a **modular monolith** with an internal tool-provider plugin pattern. The HTTP server in `src/server.ts` exposes a small API surface (`POST /api/chat`, `GET /api/tools`, `POST /api/tools/test`) that proxies requests into a custom **MCP** layer. The MCP server (`src/mcp/server`) registers tool providers — currently **Grafana** (6 tools) and **Tchat** (3 tools, renamed from `telegram_*`) — while the MCP client (`src/mcp/client`) discovers and invokes them. An **SRE crew** (`src/crew`) orchestrates multi-role agent workflows for incident response and observability tasks, calling tools through the MCP client.

The **React UI** (`src/web`) is a single-page app providing a multi-tab chat interface with a model selector, matching the PAAW visual stack (React + Vite + Tailwind) for ergonomic consistency. The project is a fully standalone rewrite with **zero dependency on PAAW** (commit `70820ee`).

## Features

- **Multi-tab chat** — concurrent conversation threads, each with independent model selection and history.
- **Model selector** — choose between configured LLM providers (e.g. `gpt-4o`, `claude-3-5-sonnet`) per tab.
- **SRE agent crew** — orchestrates multiple agent roles for incident triage, investigation, and remediation guidance.
- **MCP tool discovery** — `GET /api/tools` enumerates every tool registered on the server with its input schema.
- **Tool testing panel** — `POST /api/tools/test` invokes any registered tool with caller-supplied args for debugging.
- **Grafana provider (6 tools)** — list/get dashboards, list alerts, query PromQL metrics, list datasources, fetch annotations.
- **Tchat provider (3 tools)** — send, read, and list Telegram chats (renamed `telegram_*` → `tchat_*` in commit `017f00a`).

## Getting Started

### Prerequisites
- Node.js (LTS recommended)
- Grafana instance + service-account token (`GRAFANA_URL`, `GRAFANA_API_KEY` / `GRAFANA_SERVICE_ACCOUNT_TOKEN`)
- Telegram bot token (`TELEGRAM_BOT_TOKEN`)
- LLM provider API key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)

### Installation
```bash
git clone <repo-url> agent-sre
cd agent-sre
npm install
cp .env.example .env  # then edit values
```

### Running
```bash
# Development — Vite dev server + Node backend
npm run dev

# Production build + start
npm run build
npm start
```

### Testing
> ⚠️ **No test suite exists** (high-severity tech debt). Tests are planned for MCP tool providers (unit) and server/client round-trip (integration). Until added, manual validation goes through `POST /api/tools/test`.

## Project Structure

| Path | Purpose |
|------|---------|
| `src/index.ts` | Process entry — boot order, env loading, starts server + MCP. |
| `src/server.ts` | HTTP server: `POST /api/chat`, `GET /api/tools`, `POST /api/tools/test`. |
| `src/mcp/server/` | `McpServer`, `startServer` — registers providers, routes tool calls. |
| `src/mcp/client/` | `McpClient`, `listTools`, `callTool` — used by HTTP layer and crew. |
| `src/mcp/types.ts` | `McpTool` type (`name`, `description`, `inputSchema`, `provider`). |
| `src/tools/grafana/` | `grafanaTools`, `GrafanaProvider` — 6 Grafana tools. |
| `src/tools/tchat/` | `tchatTools`, `TchatProvider` — 3 Telegram tools. |
| `src/crew/` | `SreCrew`, `runCrew` — multi-role agent orchestration. |
| `src/web/` | React UI: `main.tsx`, `App`, `ChatTab`, `ModelSelector`, `types.ts`. |
| `vite.config.ts` | Vite build/dev config for the frontend. |

## Development

### Coding Standards
> ⚠️ **No formal coding-standards doc exists** (low-severity tech debt). Conventions inferred from the codebase:
> - TypeScript strict mode (verify in `tsconfig.json`)
> - Tool providers implement a uniform `register(server)` interface
> - Tool names are namespaced by provider: `grafana_*`, `tchat_*`
> - React components are functional, Tailwind-styled, co-located types in `src/web/types.ts`

### How to Add a New Feature
1. For a **new tool provider**:
   - Create `src/tools/<provider>/` exporting `<provider>Tools` and `<Provider>` (see Grafana/Tchat as templates).
   - Register it in the MCP server boot sequence (`src/index.ts` or `src/mcp/server/*`).
   - Namespaces tool names as `<provider>_<verb>_<noun>` to avoid `TOOL-006`.
2. For a **new UI capability**:
   - Add a component in `src/web/`.
   - Extend `src/web/types.ts` if new state is needed.
   - Wire API calls through `src/web/App.tsx`.
3. For a **new agent role** in the crew:
   - Register the role in the crew manifest in `src/crew/` (else `CREW-001`).

### How to Add a New API Endpoint
1. Add the route in `src/server.ts`.
2. **Define a Zod request/response schema** (currently missing — tech debt; without this, `CHAT-001` / `TOOL-002` cannot be raised deterministically).
3. Map errors through a central `AppError` class with `code`, `httpStatus`, `cause` (planned — see error registry).
4. Update `specs/api-contract.md` and `specs/error-codes.md`.
5. Add an example payload in the API spec.

### How to Run Tests
Tests are **not yet implemented**. When added, the expected layout is:
```bash
npm test           # unit + integration
npm run test:watch
npm run test:coverage
```
Until then, smoke-test via `curl`:
```bash
curl localhost:3000/api/tools
curl -X POST localhost:3000/api/tools/test \
  -H 'Content-Type: application/json' \
  -d '{"toolName":"grafana_list_dashboards","args":{}}'
```

## Operations

### Error Codes
The error registry (see [Error Codes](specs/error-codes.md)) defines **51 codes** across 9 categories:

| Prefix | Category | Count | Example |
|--------|----------|-------|---------|
| `SRV-*` | HTTP server & routing | 5 | `SRV-001` Internal server error |
| `CHAT-*` | Chat endpoint | 8 | `CHAT-005` Model rate limit exceeded |
| `TOOL-*` | Tools endpoint | 6 | `TOOL-001` Tool not found |
| `MCP-*` | MCP protocol | 6 | `MCP-002` Client connection failed |
| `GRAF-*` | Grafana provider | 9 | `GRAF-003` Grafana API unauthorized |
| `TCHAT-*` | Tchat provider | 8 | `TCHAT-006` Message too long |
| `CREW-*` | SRE crew orchestration | 4 | `CREW-003` Coordination timeout |
| `CFG-*` | Configuration | 3 | `CFG-001` Missing env var |
| `UI-*` | Frontend (browser-only) | 3 | `UI-003` Tab state lost |

> ⚠️ The registry is **inferred** from architectural conventions because the source-tree scan failed. Every `File | Line` cell must be reconciled against actual source before this becomes authoritative — see validation checklist in `specs/error-codes.md`.

### Runbooks
Per-code runbooks live in `operations/runbooks/<code>.md` and follow the **Symptom → Root Cause → Debugging → Fix → Related Code** template. Use the API → error-code chain in `specs/error-codes.md` to navigate from a failing endpoint to the relevant runbook.

### Monitoring
- No external monitoring wired up.
- Process health: rely on Node's default signal handling; restart policy is the deployer's responsibility.
- Recommended additions: structured JSON logs with `traceId`, Grafana dashboard mirroring the host's own metrics, alerting on `SRV-001` and `MCP-005` rates.

## Recent Changes

From the git log (most → least recent):

- **`6f00301`** — Multi-tab chat UI + model selector
- **`c6a0c48`** — React + Vite + Tailwind UI matching the PAAW stack
- **`1ca8dfa`** — Web UI + tool test endpoint
- **`27db224`** — Rename `tg_*` → `tchat_*` tool names
- **`017f00a`** — Rename `telegram` → `tchat` (provider module)
- **`795e8f0`** — Telegram MCP tool provider (3 tools)
- **`55cc035`** — Grafana MCP tool provider (6 tools)
- **`c936d78`** — MCP server + client support
- **`70820ee`** — **Major:** rewrite as fully standalone, zero PAAW dependency
- **`e95687c`** — Extract SRE agent crew into independent repo

## Known Tech Debt

| Area | Severity | Suggested Fix |
|------|----------|---------------|
| No test suite | **High** | Unit tests for providers, integration tests for server↔client round-trip |
| No API request/response schemas | Medium | Add Zod validation on all three endpoints |
| No error code taxonomy | Medium | Centralize the 51 codes via an `AppError` class (registry already drafted) |
| No documentation directory | Low | Add README, architecture overview, provider docs (this entry + linked specs) |
| In-memory only persistence | Medium | SQLite or IndexedDB for chat tabs / message history (causes `UI-003`) |

## Confidence & Verification

> ⚠️ The project file-tree scan failed (unescaped parens in `find`). Everything above — module paths, export names, dependency edges, API handler names, data-model fields, and the error registry — is **inferred from the JSON scan summary, git log, and standard MCP/HTTP conventions**. Before treating this as authoritative:
>
> 1. Re-run the scan with properly escaped parens:
>    ```bash
>    find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' \) \
>      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*'
>    ```
> 2. Reconcile every `File | Line` cell in `specs/error-codes.md`.
> 3. Confirm the 6 Grafana and 3 Tchat tool names against `src/tools/grafana/*` and `src/tools/tchat/*`.
> 4. Verify HTTP handlers (`handleChat`, `handleListTools`, `handleToolTest`) and response envelope shapes (`{ ok, result }` vs raw) in `src/server.ts`.
```