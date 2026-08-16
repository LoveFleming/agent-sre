# Coding Standards — agent-sre

> **Source:** Derived from observed patterns in the codebase (ES-module server, React/Vite/Tailwind UI, MCP tool providers) and the git history. Where the codebase is silent, standards are set to the closest matching convention and marked **[established]** — these are now binding for new code.

---

## 1. Coding Rules

### 1.1 Language & Module Format

- Server code is **JavaScript ES Modules** with the `.mjs` extension. Never use CommonJS (`require`, `module.exports`) in server code.
- UI code is **JSX** (React), built with Vite.
- No TypeScript migration mid-file: stay in plain JS + JSDoc until a project-wide decision (record it as an ADR first).

### 1.2 Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Server files | `kebab-case.mjs` | `tool-loader.mjs`, `llm.mjs`, `provider.mjs` |
| UI components | `PascalCase.jsx` | `TaskPage.jsx`, `ChatTabs.jsx` |
| UI hooks | `useCamelCase` | `useChatSession` |
| Functions | `camelCase`, verb-first | `loadTools()`, `resolveProvider()` |
| Classes | `PascalCase` | `McpClient` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES` |
| Environment variables | `SCREAMING_SNAKE_CASE`, prefixed by domain | `GRAFANA_API_TOKEN`, `TCHAT_BOT_TOKEN` |
| MCP tool names | `<provider>_<action>` snake_case | `tchat_send_message`, `grafana_list_dashboards` |
| API routes | `/api/<plural-noun>`, kebab-case | `/api/tasks`, `/api/chat/sessions` |
| Git commits | Conventional Commits: `type(scope): description` | `feat(ui): ...`, `fix(server): ...` |

**Valid commit scopes:** `ui`, `server`, `console`, `security`, `paaw`, `mcp`, `docs`, `tools`. Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `rename`, `test`.

**MCP tool naming rule:** every tool exported by a provider **must** be prefixed with the provider's short name (e.g. `grafana_`, `tchat_`). The `tg_* → tchat_*` rename (commit `27db224`) established that provider prefixes match the provider's canonical name.

### 1.3 File Organization

- One primary export (class, provider definition, or route group) per server file. Small helpers may share a file.
- Server layout follows the layer it belongs to (see §2.1). Do not add a file without knowing its layer.
- UI files live next to their view; shared components go in a `components/` directory, hooks in `hooks/`.

### 1.4 Import Order

Group imports with a blank line between groups, in this order:

```js
// 1. Node builtins
import fs from 'node:fs/promises';
import path from 'node:path';

// 2. External packages
import express from 'express';
import stableStringify from 'json-stable-stringify';

// 3. Internal modules (relative paths)
import { loadTools } from './tool-loader.mjs';
import { resolveProvider } from './provider.mjs';
```

- Always use `node:` prefix for builtins.
- Internal imports must include the `.mjs` extension.
- No circular imports — see Quality Checklist.

### 1.5 Export Patterns

- Server modules use **named exports** exclusively. No default exports in server code (default exports break refactor/grep workflows in a modular monolith).
- React components may use default exports (Vite convention), one per file.
- MCP providers export a registration object/function shaped consistently: `{ name, tools }`.

---

## 2. Architecture Rules

### 2.1 Layer Structure & Allowed Dependencies

```
UI (React)  →  API (HTTP)  →  Agent/Orchestration  →  Tools (MCP providers)  →  External systems
```

Arrows are the **only** allowed dependency direction.

| Layer | Contains | May depend on | Must never |
|---|---|---|---|
| **UI** | React views, hooks, Tailwind styling | API layer (via HTTP only) | Import server code, touch fs, call LLM/external APIs directly |
| **API** | Route handlers, request validation, response shaping | Agent/Orchestration, Tool layer (for the tool test endpoint) | Contain business logic, call external services directly |
| **Agent/Orchestration** | `llm.mjs`, `provider.mjs`, crew orchestration | Tool layer (via MCP client), LLM providers | Know about HTTP requests/responses |
| **Tools (MCP)** | Grafana provider, tchat provider, `tool-loader` | External systems, Node builtins | Import from API or Agent layers, know about the web console |

**Hard rules:**

- The UI communicates with the server **only** through the HTTP API. No direct fs/db/LLM access from browser code.
- Route handlers delegate to the orchestration/tool layers; if a route handler exceeds ~50 lines of logic, extract it downward.
- MCP providers are **plugins**: they must be addable/removable without touching the API or orchestration layers beyond registration.
- Zero external platform dependencies — this repo is standalone (per commit `70820ee`). Any dependency on the parent platform (PAAW) must be justified in an ADR first.

### 2.2 Module Boundaries

- No cross-layer imports that skip a layer (e.g., UI → tool-loader).
- Providers do not import each other; shared tool utilities go in the tool layer's common module.
- New external tool providers follow the established pattern: register N tools with `<provider>_` prefixed names, expose via MCP, add a test path through the tool test endpoint.

### 2.3 Separation of Concerns

- **Routes** = parse/validate input → call layer below → shape HTTP response.
- **Business logic** (agent orchestration, crew coordination) lives in the agent layer, framework-agnostic (no `req`/`res` objects).
- **Data access / external calls** live in the tool layer or provider modules only.

---

## 3. Pattern Guidelines

### 3.1 Error Handling

- **Every external call** (LLM API, Grafana, tchat, fs operations) is wrapped in `try/catch`. No bare `await` on external I/O.
- Errors must propagate with context — wrap and rethrow or return structured errors:

```js
try {
  return await provider.complete(messages);
} catch (err) {
  throw new Error(`LLM call failed (${provider.name}): ${err.message}`, { cause: err });
}
```

- **API error responses** use one envelope (see §3.4). Never leak stack traces or raw upstream errors to the client.
- **fs operations in tool-loader** must validate paths against traversal (established by `fix(security)` commit `f072911`). Any new fs-touching code reuses the existing path validation helper — do not write your own `path.join` on user input.
- New error classes/types are documented in `.paaw/` error map with a runbook pointer.

### 3.2 Async Patterns

- `async/await` only. No raw `.then()` chains except in one-liner fire-and-forget.
- No unhandled promise rejections: top-level server entry points catch and log.
- Sequential awaits unless operations are independent — then use `Promise.all` explicitly.
- Long-running agent operations must have a timeout / cancellation path.

### 3.3 Deterministic Serialization **[established]**

- Where JSON output ordering matters (LLM payloads, cache keys, signatures), use `json-stable-stringify` — not `JSON.stringify` (established by commit `c895498`).

### 3.4 API Response Format **[established]**

All JSON endpoints respond with a consistent envelope:

```json
// success
{ "ok": true, "data": { ... } }

// error
{ "ok": false, "error": { "code": "string", "message": "human-readable" } }
```

- `code` is a stable machine-readable string (e.g. `TASK_NOT_FOUND`, `LLM_TIMEOUT`) — never reuse HTTP status text as a code.
- The chat send path must surface errors to the UI (regression fixed in `edf2daa` — errors must always be displayed, never silently dropped).

### 3.5 State Management (UI)

- Local component state via `useState` for view-local concerns.
- Server state via explicit fetch hooks (`useX` pattern); no global store unless a second view needs shared mutable state — then propose an ADR before introducing one.
- Multi-tab chat state (tabs, selected model) is owned by the chat view, not by a global store.

### 3.6 Testing Patterns

- Tests for critical paths: tool-loader path validation, API CRUD handlers, MCP tool registration/invocation.
- One test file per source file, named `<source>.test.mjs`, colocated or in a `test/` directory mirroring source layout.
- External calls in tests are mocked; no test hits real Grafana/LLM/tchat endpoints.
- Every new API endpoint ships with at least: happy path, validation-failure path, and one error-mapping test payload.

---

## 4. Quality Checklist

Run before every PR/merge:

- [ ] No hardcoded secrets — all tokens/keys via environment variables
- [ ] Error handling (`try/catch` + structured error) for all external calls (LLM, Grafana, tchat, fs)
- [ ] Input validation on all API endpoints (type, required fields, bounds)
- [ ] Consistent naming per §1.2 (files, functions, tools, routes, commits)
- [ ] No circular dependencies (verify: imports flow strictly downward per §2.1)
- [ ] No default exports in server modules
- [ ] fs paths validated against traversal (reuse `tool-loader` helper)
- [ ] `json-stable-stringify` used where output ordering matters
- [ ] API responses use the `ok/data/error` envelope
- [ ] New MCP tools follow `<provider>_<action>` naming
- [ ] Errors from async paths are surfaced to the UI (no silent drops)
- [ ] Tests cover critical paths; external calls mocked
- [ ] Commit message follows `type(scope): description`
- [ ] Architecture-affecting changes recorded as an ADR in `.paaw/`

---

*Maintained at `.paaw/standards/coding-style.md`. Propose changes via PR; deviations require an ADR.*