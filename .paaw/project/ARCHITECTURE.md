# Architecture Map — agent-sre

> **Data provenance note:** The automated file-tree scan failed (`find` command shell error), and no Tree-sitter source analysis or `package.json` content was delivered. This map is reconstructed from the git history (20 commits), naming conventions visible in commits (`llm.mjs`, `provider.mjs`, `tool-loader`), and the `.paaw/` ADR references. Items marked **(inferred)** have not been verified against actual file contents. A re-scan with a corrected `find` expression (quoting the `\( ... \)` group) is recommended to validate paths.

---

## 1. System Overview

**agent-sre** is a standalone multi-agent SRE (Site Reliability Engineering) assistant platform. It was extracted from a parent platform (PAAW) into an independent repository and rewritten to have zero PAAW dependency. The system runs an LLM-driven "agent crew" that can be orchestrated to perform SRE tasks, with tool capabilities provided via the Model Context Protocol (MCP) — currently Grafana (6 tools: dashboards/alerts/metrics) and a chat/messaging provider, `tchat` (3 tools, renamed from Telegram). Users interact with the system through a React web console featuring multi-tab chat with a model selector, a 7-view navigation shell, and a Task management CRUD interface backed by dedicated API endpoints.

**Tech stack:**
- **Language:** JavaScript (ES Modules, `.mjs` files) for the server; JSX/React for the UI
- **Runtime:** Node.js (server), browser (UI)
- **UI:** React + Vite + Tailwind CSS (explicitly matched to the PAAW stack)
- **Key libraries:** MCP SDK (server + client), `json-stable-stringify` (seen in security fixes)
- **External services:** LLM provider APIs, Grafana API, Telegram/chat API

**Architecture style:** Modular monolith in a single repository — a Node.js API server plus a React SPA, with a plugin-style MCP tool-provider layer. Not a monorepo with separate packages; server and UI live in one repo with an embedded knowledge base (`.paaw/`).

---

## 2. Layer Structure

```
Presentation Layer
  - Web Console (React + Vite + Tailwind) — directory (inferred): web/ or ui/
    - 7-view navigation shell
    - Platform home page
    - Multi-tab Chat view + model selector        (commit 6f00301)
    - Task management page (CRUD UI)               (commit b655bc1)

API Layer
  - HTTP server, Node.js ES modules                (entry inferred: server.mjs / index.mjs)
  - Chat/session endpoints                         (edf2daa — chat send/response + error display fixes)
  - Task management CRUD endpoints                 (commit 80b15a1)
  - Tool test endpoint                             (commit 1ca8dfa)

Agent / Orchestration Layer
  - Multi-agent crew orchestration                 (.paaw/ ADR-002)
  - LLM abstraction — llm.mjs                      (commit c895498)
  - Provider abstraction — provider.mjs            (commit c895498)

Tool Layer (MCP)
  - MCP server + MCP client support                (commit c936d78)
  - Tool loader — tool-loader (fs ops, hardened
    against path traversal)                        (commit f072911)
  - Grafana MCP tool provider (6 tools)            (commit 55cc035)
  - tchat MCP tool provider (3 tools, ex-Telegram) (commits 795e8f0, 017f00a, 27db224)

Data Layer
  - Task store (CRUD persistence — mechanism unverified: file or in-memory)
  - File storage (tool definitions/configs read by tool-loader)
  - External APIs: Grafana, Telegram/tchat, LLM providers

Knowledge / Governance
  - .paaw/ — ADRs (ADR-002: multi-agent orchestration architecture)
  - data/semgrep-rules/ — security scanning rules
```

---

## 3. Module Dependencies

**Internal dependency flow (inferred from commit topology):**

- **Web Console → API Server** — UI consumes chat, task, and tool-test endpoints over HTTP.
- **API Layer → Agent/Orchestration Layer** — chat endpoints drive the agent crew; task endpoints persist task data.
- **Orchestration → `llm.mjs` → `provider.mjs`** — LLM calls are abstracted through a provider layer (multi-model support, consistent with the UI's model selector). `llm.mjs` and `provider.mjs` are tightly coupled (patched together in c895498).
- **Orchestration → tool-loader → MCP client → Tool Providers** — tools are dynamically loaded; the loader performs filesystem operations (now path-traversal-blocked) and hands off to MCP.
- **Tool Providers → External Services** — Grafana provider → Grafana API; tchat provider → chat/Telegram API.

**Circular dependencies:** None observed in the available evidence. Closest coupling is `llm.mjs` ↔ `provider.mjs`, which change as a unit — worth verifying for a shared abstraction leak.

**External dependencies:**
- MCP SDK (server + client modes)
- `json-stable-stringify` (deterministic JSON serialization in LLM/provider paths)
- LLM provider APIs (model selector in UI implies ≥2 models/providers)
- Grafana HTTP API
- Telegram/chat API
- React, Vite, Tailwind (UI build chain)

---

## 4. Key Patterns

- **Provider / Adapter pattern** — two applications: `provider.mjs` abstracts LLM backends (enables the UI model selector), and MCP tool providers wrap external systems behind a uniform tool interface.
- **Plugin architecture** — tools are loaded dynamically via `tool-loader`; providers (Grafana, tchat) are additive, as shown by sequential provider commits. Renaming `tg_*` → `tchat_*` (3 commits) suggests a tool-name registry/namespacing convention.
- **Multi-agent orchestration ("crew" pattern)** — formalized in ADR-002; multiple cooperating agents rather than a single chat loop.
- **MCP client/server duality** — the system both *consumes* external tools (client) and *exposes* its own tools (server).
- **CRUD REST** — conventional resource-oriented endpoints for Task management (server endpoints + matching UI page, added in paired commits).
- **State management (UI)** — no evidence of Redux/Zustand et al.; likely React local state given the app's size **(inferred)**.
- **Routing (UI)** — client-side view routing for the 7-view shell (mechanism unverified — React Router vs. custom shell).
- **Error handling** — errors surfaced to the chat UI (fixed in edf2daa); security-focused error rejection in `tool-loader` (path traversal). No evidence of a centralized error-code map.
- **Governance** — ADR-driven decisions in `.paaw/`; security scanning via semgrep rules.

---

## 5. Entry Points

| Entry Point | Path | Status |
|---|---|---|
| **API server** | `server.mjs` or `index.mjs` at repo root **(inferred)** | Unverified — file scan failed |
| **Web UI** | Vite standard: `index.html` → `src/main.jsx|tsx` under `web/` or `ui/` **(inferred)** | Unverified — file scan failed |
| **CLI** | No evidence of a CLI entry point in git history | Likely none |

---

### Recommended Follow-ups
1. Re-run the file scan with escaped `find` predicates: `find . -type f \( -name '*.mjs' -o ... \)` — the unquoted parentheses caused the shell syntax error.
2. Verify the true server entry point and whether the HTTP layer uses a framework (Express/Fastify) or raw `http`.
3. Confirm Task persistence mechanism (file vs. in-memory) — affects the Data Layer description.
4. Resolve the module boundary between `llm.mjs` and `provider.mjs` to rule out hidden coupling.