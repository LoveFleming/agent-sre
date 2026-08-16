# agent-sre

> A standalone multi-agent SRE assistant platform that orchestrates LLM-powered agents — equipped with Grafana and chat (tchat) tools via MCP — behind a React web console with multi-tab chat, task management, and tool testing.

> **⚠️ Provenance note:** The automated file-tree scan failed (`find` shell syntax error), and several analysis outputs (Feature Map, Code Intelligence, Test Intelligence, Error Mapping, Security scan, Coding Standards) were not delivered. This document is reconstructed primarily from git history and the Architecture Map / API Contract that were produced. Items marked *(inferred)* are unverified against source. **First task for any reader: re-run the scan with a quoted `find` expression and verify inferred paths.**

## Quick Links
- [Architecture Map](ARCHITECTURE.md) — generated; contains inferred paths requiring verification
- [Feature Map](features/FEATURES.json) — ⚠️ not yet generated
- [API Contract](specs/api-contract.md) — generated; endpoint paths carry confidence ratings (🟢/🟡/🔴)
- [Error Codes](specs/error-codes.md) — ⚠️ not yet generated (Error Mapping run incomplete)
- [Coding Standards](standards/coding-style.md) — ⚠️ not yet generated
- [Code Intelligence](code-intelligence/summary.json) — ⚠️ not yet generated
- [Security Scan](security/scan-results.json) — ⚠️ not yet generated (two security fixes exist in history — see Recent Changes)
- [Knowledge Base](.paaw/) — includes ADR-002 (multi-agent orchestration architecture)

## Tech Stack
- Language: JavaScript (ES Modules, `.mjs`) for server; JSX for UI
- Framework: React + Vite + Tailwind CSS (UI, matched to the parent PAAW stack); custom Node.js HTTP server (no web framework confirmed)
- Protocol: MCP (Model Context Protocol) — both server and client roles
- Database: None confirmed — Task persistence mechanism unverified (likely file or in-memory)
- Runtime: Node.js (server), browser (UI)
- External services: LLM provider APIs (multi-provider, model selector), Grafana API, tchat chat API

## Architecture Overview

**agent-sre** was extracted from the PAAW platform (commit `e95687c`) and rewritten as fully standalone with zero PAAW dependency (`70820ee`). It is a modular monolith: a Node.js ES-module API server plus a React SPA in one repository, with a plugin-style MCP tool-provider layer. The server exposes JSON APIs for chat, task CRUD, and tool testing; behind them sits an agent orchestration layer (multi-agent crew design recorded in `.paaw/` ADR-002) that uses an LLM abstraction (`llm.mjs`) and provider abstraction (`provider.mjs`) to call model APIs.

Tools are provided via MCP: the system includes both MCP server and client support (`c936d78`), with two shipped providers — **grafana** (6 tools: dashboards, alerts, metrics queries) and **tchat** (3 tools, renamed from Telegram) — discovered and loaded by a hardened tool-loader that blocks path traversal in its fs operations (`f072911`). Users interact through a React console: a 7-view navigation shell with a platform home page, multi-tab chat with a model selector, and a Task management page backed by dedicated CRUD endpoints.

**Layer diagram (inferred paths):**
```
React Console (web/ or ui/)  — 7-view shell · multi-tab chat · Tasks · tool testing
        ↓ HTTP (JSON)
API Server (server.mjs)      — /api/chat · /api/tasks · /api/tools/test · /api/models
        ↓
Agent Orchestration (.paaw ADR-002) → llm.mjs → provider.mjs → LLM APIs
        ↓ MCP client
Tool Loader (tool-loader)    — grafana (6 tools) · tchat (3 tools)
        ↓
Grafana API · tchat API
```

## Features
- **Multi-agent SRE crew** — orchestrated agent team for SRE tasks (design in ADR-002)
- **Multi-tab chat console** — several concurrent chat sessions with per-session model selection
- **Model selector** — choose among available LLM models/providers per chat
- **7-view navigation shell** — platform home page plus six other views
- **Task management** — full CRUD for SRE tasks: API endpoints (`80b15a1`) + dedicated UI page (`b655bc1`)
- **Tool testing** — endpoint and UI to execute registered tools with test arguments (`1ca8dfa`)
- **Grafana MCP tool provider** — 6 tools (dashboards, alerts, metrics) (`55cc035`)
- **tchat MCP tool provider** — 3 chat/messaging tools (`795e8f0`, renamed `tg_*` → `tchat_*`)
- **MCP server + client support** — the platform both exposes and consumes MCP tools (`c936d78`)
- **Standalone operation** — zero dependency on the parent PAAW platform (`70820ee`)
- **Embedded knowledge base** — `.paaw/` directory holding ADRs and architecture docs

## Getting Started

> Scripts below are the standard Vite/Node conventions — **actual `package.json` scripts were not captured** (scan failure). Verify before relying on them.

### Prerequisites
- Node.js (version unverified — check `package.json` `engines` field)
- npm (a `package-lock.json` exists in the repo)
- Network access to your LLM provider, Grafana instance, and tchat service; corresponding credentials configured via env vars *(mechanism unverified — look for `.env` handling or config module)*

### Installation
```bash
git clone <repo-url> agent-sre
cd agent-sre
npm install
```

### Running
```bash
# API server (entry file unverified — server.mjs or index.mjs)
npm start          # (inferred)

# Web console (Vite dev server)
npm run dev        # (inferred)
```

### Testing
⚠️ No test directory or test runner was detected. See [Development → How to Run Tests](#how-to-run-tests).

## Project Structure

> **Paths marked (inferred)** — the automated file tree failed; verify with:
> `find . -type f \( -name '*.mjs' -o -name '*.js' -o -name '*.jsx' \) -not -path '*/node_modules/*' -not -path '*/.git/*'`

```
agent-sre/
├── server.mjs (or index.mjs)   # API server entry + route definitions (inferred)
├── llm.mjs                     # LLM abstraction layer (confirmed by name in commits)
├── provider.mjs                # LLM provider abstraction (confirmed by name in commits)
├── tool-loader(.mjs / dir)     # MCP tool discovery & loading, path-traversal hardened
├── web/ (or ui/)               # React + Vite + Tailwind console (inferred)
│   └── src/                    # 7-view shell, chat, tasks, tool test pages (inferred)
├── .paaw/                      # Knowledge base: ADRs, architecture docs
│   └── ADR-002                 # Multi-agent orchestration architecture
├── package.json / package-lock.json
└── PROJECT.md                  # This file
```

## Development

### Coding Standards
No standards document exists yet. Conventions observable from history:
- ES Modules (`.mjs`) on the server; no TypeScript detected
- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs(scope):`, `rename:`
- Tool naming: `<provider>_<action>` (e.g., `grafana_list_dashboards`, `tchat_send_message`)
- Security-aware: deterministic JSON serialization (`json-stable-stringify`) in LLM/provider paths; fs operations must guard against path traversal

### How to Add a New Feature
1. **Server side:** add handler/route near existing chat/tasks/tools routes; keep JSON request/response with structured `{ "error": "..." }` bodies.
2. **UI side:** add a view component and register it in the 7-view navigation shell; use Tailwind for styling (match PAAW conventions).
3. **Task-like CRUD:** follow the Task pattern — API endpoints first, then the management page.
4. Update the [API Contract](specs/api-contract.md) and this document.

### How to Add a New Tool Provider
1. Create an MCP provider module following the **grafana** (6 tools) or **tchat** (3 tools) examples.
2. Name tools `<provider>_<action>`; register via the tool-loader (its fs operations block path traversal — keep loads within the sanctioned directory).
3. Verify the tool appears via the tool list and exercise it through the tool-test endpoint/UI.
4. Add external-service credentials via the same env/config mechanism as existing providers.

### How to Add a New API Endpoint
1. Define the route in the server entry (or routes module if one exists — unverified).
2. Return JSON; use 400 (bad input), 404 (missing resource), 500 (server error) consistent with the Task CRUD endpoints.
3. No auth layer exists — do **not** assume `Authorization` headers; flag if the endpoint needs protection before exposing it.
4. Document in [API Contract](specs/api-contract.md) with request/response schemas and a JSON example.

### How to Run Tests
⚠️ **No tests or test runner detected.** Until one is added:
- Manual smoke: start server + UI, exercise Task CRUD, chat send (including error display — regression fixed in `edf2daa`), and tool test endpoint.
- Recommended first step: add a minimal runner (`node --test` or `vitest`, which pairs with the existing Vite setup) and cover the Task CRUD endpoints and tool-loader path-traversal guard.

## Operations

### Error Codes
No error catalogue exists yet (Error Mapping run incomplete). Known behavior:
| Signal | Behavior | Source |
|---|---|---|
| HTTP 400 / 404 / 500 | Standard codes on Task CRUD and tool-test endpoints | API Contract (partially inferred) |
| `{ "error": "<message>" }` | Structured error body surfaced in the chat console | commit `edf2daa` |
| Path traversal attempt | Blocked in tool-loader fs operations | commit `f072911` |

**Action:** generate the Error Map to fill [specs/error-codes.md](specs/error-codes.md).

### Runbooks
None exist. SRE runbook authoring is a natural extension of this platform's purpose (the agent crew could consume them), but nothing is shipped yet.

### Monitoring
No application monitoring/telemetry detected. Note: **Grafana is integrated as a data source the agent queries — it is not monitoring of this application.** No health-check endpoint confirmed (a `GET /health` is a reasonable first addition).

### Security Posture (from history)
- ✅ Path traversal blocked in tool-loader fs operations (`f072911`)
- ✅ `json-stable-stringify` warnings resolved in `llm.mjs` and `provider.mjs` (`c895498`)
- ⚠️ No authentication on any API endpoint — fine for local use; must be addressed before any network exposure
- ⚠️ Formal security scan pending

## Recent Changes
Summary of the last 20 commits (newest first):

- **Task management (current focus):** Task CRUD API endpoints (`80b15a1`) followed by the Task management UI page (`b655bc1`).
- **Security hardening:** blocked path traversal in tool-loader fs operations (`f072911`); fixed `json-stable-stringify` warnings in `llm.mjs`/`provider.mjs` (`c895498`).
- **Architecture decisions:** ADR-002 added for multi-agent orchestration in `.paaw/` (`6c5dec0`).
- **Console fixes:** chat send returning no response + errors not displayed (`edf2daa`).
- **UI buildout:** 7-view navigation shell + platform home (`e7f7dc4`); multi-tab chat + model selector (`6f00301`); React + Vite + Tailwind stack matching PAAW (`c6a0c48`); initial web UI + tool test endpoint (`1ca8dfa`).
- **Tool providers:** `tg_*` → `tchat_*` tool rename (`27db224`), telegram → tchat rename (`017f00a`), tchat provider with 3 tools (`795e8f0`), Grafana provider with 6 tools (`55cc035`), MCP server + client support (`c936d78`).
- **Project origin:** rewritten fully standalone with zero PAAW dependency (`70820ee`); extracted from PAAW as an independent repo (`e95687c`).