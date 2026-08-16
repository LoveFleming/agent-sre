# API Contract — agent-sre

> ## ⚠️ Provenance Warning
> The automated file-tree scan **failed** (shell `find` syntax error), and no Tree-sitter source analysis or Feature Map was delivered with this run. This contract is reconstructed from **git history evidence** (commits `80b15a1`, `b655bc1`, `1ca8dfa`, `6f00301`, `edf2daa`, `f072911`) and the Architecture Map.
>
> **Confidence legend:**
> - 🟢 **High** — endpoint explicitly referenced in a commit message
> - 🟡 **Medium** — strongly implied by shipped features, path/shape unverified
> - 🔴 **Low** — plausible convention, may not exist
>
> Handler names, exact paths, and field names marked *(inferred)* have **not** been verified against source. The API Tester should treat 404s on 🔴/🟡 endpoints as "path mismatch," not server failure. **Re-run the scan with a quoted `find` expression (`\( ... \)`)** to validate before publishing this contract to `.paaw/`.

---

## Task Management APIs

*Evidence: commit `80b15a1` "feat(server): add Task management CRUD API endpoints" + `b655bc1` (CRUD UI). "CRUD" implies the full 5-endpoint set.* 🟢

### GET /api/tasks
- **Description:** List all tasks
- **Feature:** Task Management
- **File:** `server.mjs` or `src/routes/tasks.mjs` *(inferred)*
- **Handler:** inline / `listTasks` *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟢 (endpoint exists) / 🟡 (exact path)
- **Query Params:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | status | string | No | Filter by task status |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | (array) | Task[] | Array of task objects |
  | [].id | string | Task ID |
  | [].title | string | Task title |
  | [].description | string | Task details |
  | [].status | string | `pending` / `in_progress` / `done` *(enum inferred)* |
  | [].priority | string | Task priority |
  | [].createdAt | string (ISO 8601) | Creation timestamp |
- **Response 500:** Server error
- **Calls:** task store list operation (file or in-memory persistence — unverified)

### POST /api/tasks
- **Description:** Create a new task
- **Feature:** Task Management
- **File:** `server.mjs` or `src/routes/tasks.mjs` *(inferred)*
- **Handler:** inline / `createTask` *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟢 (endpoint exists) / 🟡 (exact path, body shape)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | title | string | Yes | Task title |
  | description | string | No | Task details |
  | status | string | No | Defaults to `pending` *(inferred)* |
  | priority | string | No | Task priority |
- **Response 200 (or 201):**
  | Field | Type | Description |
  |-------|------|-------------|
  | id | string | New task ID |
  | title | string | Task title |
  | status | string | Task status |
  | createdAt | string (ISO 8601) | Creation timestamp |
- **Response 400:** Invalid input (missing/invalid fields)
- **Response 500:** Server error

### GET /api/tasks/{id}
- **Description:** Get a single task by ID
- **Feature:** Task Management
- **File:** `server.mjs` or `src/routes/tasks.mjs` *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟢 / 🟡 (path)
- **Path Params:** `id` — task identifier
- **Response 200:** Full task object (same shape as list items)
- **Response 404:** Task not found
- **Response 500:** Server error

### PUT /api/tasks/{id}
- **Description:** Update an existing task *(PATCH is an equally likely variant — unverified)*
- **Feature:** Task Management
- **File:** `server.mjs` or `src/routes/tasks.mjs` *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟡 (CRUD implies update; PUT vs PATCH unverified)
- **Path Params:** `id`
- **Request Body:** Partial or full task fields (`title`, `description`, `status`, `priority`)
- **Response 200:** Updated task object
- **Response 400:** Invalid input
- **Response 404:** Task not found
- **Response 500:** Server error

### DELETE /api/tasks/{id}
- **Description:** Delete a task
- **Feature:** Task Management
- **File:** `server.mjs` or `src/routes/tasks.mjs` *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟢 / 🟡 (path)
- **Path Params:** `id`
- **Response 200:** Success confirmation (e.g., `{ ok: true }` or deleted object)
- **Response 404:** Task not found
- **Response 500:** Server error

---

## Chat APIs

*Evidence: commits `6f00301` (multi-tab chat + model selector), `edf2daa` (chat send no response + error not displayed). Error responses are surfaced to the UI — response body contains a structured error field.* 🟢 that a send endpoint exists; 🟡 on sessions endpoint.

### POST /api/chat
- **Description:** Send a chat message and get the assistant reply
- **Feature:** Chat (Multi-tab Console)
- **File:** `server.mjs` or `src/routes/chat.mjs` *(inferred)*
- **Handler:** inline *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟢 (endpoint exists) / 🔴 (exact path — could be `/api/chat/send`, `/api/chat/message`, or `/api/messages`)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | sessionId | string | Yes | Chat tab/session ID (multi-tab support) |
  | message | string | Yes | User message |
  | model | string | No | Selected model ID (model selector) |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | sessionId | string | Session the reply belongs to |
  | reply | string | Assistant response text |
  | model | string | Model that produced the reply |
- **Response 400:** Invalid input
- **Response 500:** LLM/provider failure — structured error body (`{ error: "..." }`) rendered by console (per `edf2daa`)
- **Calls:** `llm.mjs` chat/send → `provider.mjs` provider call → MCP client tool invocations (Grafana / tchat tools) *(call chain inferred from Architecture Map)*

### GET /api/chat/sessions
- **Description:** List chat sessions (tabs)
- **Feature:** Chat (Multi-tab Console)
- **File:** `server.mjs` or `src/routes/chat.mjs` *(inferred)*
- **Auth:** None evident
- **Confidence:** 🔴 — multi-tab may be purely client-side state; endpoint may not exist
- **Response 200:** Array of sessions `{ id, title, model, createdAt, updatedAt }`
- **Response 500:** Server error

---

## LLM Model APIs

*Evidence: commit `6f00301` "model selector" — the selector must be populated from somewhere (server list or hardcoded client config).* 🟡

### GET /api/models
- **Description:** List available LLM models for the chat model selector
- **Feature:** Model Selection
- **File:** `server.mjs` / `llm.mjs` route *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟡 — endpoint may not exist if models are hardcoded in the UI
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | (array) | Model[] | Available models |
  | [].id | string | Model identifier |
  | [].provider | string | Provider name (e.g., openai, anthropic) |
- **Response 500:** Server error
- **Calls:** `llm.mjs` / `provider.mjs` model registry *(inferred)*

---

## Tool Registry & Testing APIs

*Evidence: commits `1ca8dfa` "add web UI + tool test endpoint", `f072911` (tool-loader path-traversal hardening), `55cc035` (Grafana provider, 6 tools), `795e8f0` (tchat provider, 3 tools).* The test endpoint is 🟢; its exact path is 🟡.

### GET /api/tools
- **Description:** List available MCP tools from loaded providers (grafana, tchat)
- **Feature:** Tool Registry
- **File:** `server.mjs` / `tool-loader.mjs` route *(inferred)*
- **Auth:** None evident
- **Confidence:** 🟡 — the tool-test UI likely needs a tool list; endpoint may not exist
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | (array) | Tool[] | Registered tools |
  | [].name | string | Tool name (e.g., `grafana_list_dashboards`, `tchat_send_message`) |
  | [].provider | string | Source provider |
  | [].description | string | Tool description |
- **Calls:** `tool-loader.mjs` discovery (fs read with path-traversal protection per `f072911`) *(inferred)*

### POST /api/tools/test
- **Description:** Execute a tool with test arguments and return its result
- **Feature:** Tool Testing
- **File:** `server.mjs` or `src/routes/tools.mjs` *(inferred)*
- **Handler:** inline *(inferred)*
- **Auth:** None evident
- **Rate Limiting:** None visible
- **Confidence:** 🟢 (endpoint exists per commit `1ca8dfa`) / 🟡 (exact path, body shape)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | tool | string | Yes | Tool name (e.g., `grafana_list_dashboards`) |
  | args | object | No | Tool-specific arguments |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | ok | boolean | Execution success |
  | result | object | Raw tool output |
- **Response 400:** Unknown tool or invalid args
- **Response 500:** Tool execution failure
- **Calls:** `tool-loader.mjs` load → MCP client `callTool` → provider (Grafana API / tchat API) *(inferred)*

---

## Cross-cutting Notes

| Concern | Finding |
|---------|---------|
| **Auth** | No authentication/authorization layer evident anywhere in git history or architecture map. All endpoints assumed open. ⚠️ Flag for the API Tester: do **not** send `Authorization` headers. |
| **Rate limiting** | None visible |
| **Error format** | Structured error body exists at least for chat (commit `edf2daa` mentions displaying errors) — assumed `{ "error": "<message>" }` *(inferred)* |
| **Content type** | `application/json` on all request/response bodies |

---

## API Examples (JSON)

```json-examples
[
  {
    "method": "GET",
    "endpoint": "/api/tasks",
    "description": "List all tasks",
    "request": {
      "headers": { "Content-Type": "application/json" }
    },
    "response": {
      "status": 200,
      "body": [
        {
          "id": "task-001",
          "title": "Investigate HighMemoryUsage alert on api-gateway",
          "description": "Alert firing since 08:10 UTC on the payments dashboard; identify top memory-consuming pods.",
          "status": "in_progress",
          "priority": "high",
          "createdAt": "2025-01-15T08:24:00Z",
          "updatedAt": "2025-01-15T09:02:00Z"
        },
        {
          "id": "task-002",
          "title": "Review Grafana dashboard for checkout latency",
          "description": "Check p99 latency panels after the 2x spike reported by on-call.",
          "status": "pending",
          "priority": "medium",
          "createdAt": "2025-01-15T09:10:00Z",
          "updatedAt": "2025-01-15T09:10:00Z"
        }
      ]
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/tasks",
    "description": "Create a new task",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "title": "Investigate HighMemoryUsage alert on api-gateway",
        "description": "Alert firing since 08:10 UTC on the payments dashboard; identify top memory-consuming pods.",
        "status": "pending",
        "priority": "high"
      }
    },
    "response": {
      "status": 201,
      "body": {
        "id": "task-003",
        "title": "Investigate HighMemoryUsage alert on api-gateway",
        "description": "Alert firing since 08:10 UTC on the payments dashboard; identify top memory-consuming pods.",
        "status": "pending",
        "priority": "high",
        "createdAt": "2025-01-15T09:30:00Z"
      }
    }
  },
  {
    "method": "GET",
    "endpoint": "/api/tasks/{id}",
    "description": "Get task by ID",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "params": { "id": "task-001" }
    },
    "response": {
      "status": 200,
      "body": {
        "id": "task-001",
        "title": "Investigate HighMemoryUsage alert on api-gateway",
        "description": "Alert firing since 08:10 UTC on the payments dashboard; identify top memory-consuming pods.",
        "status": "in_progress",
        "priority": "high",
        "createdAt": "2025-01-15T08:24:00Z",
        "updatedAt": "2025-01-15T09:02:00Z"
      }
    }
  },
  {
    "method": "PUT",
    "endpoint": "/api/tasks/{id}",
    "description": "Update a task",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "params": { "id": "task-001" },
      "body": {
        "status": "done",
        "description": "Resolved: memory leak in payment-worker v2.4.1; rollback to v2.4.0 completed."
      }
    },
    "response": {
      "status": 200,
      "body": {
        "id": "task-001",
        "title": "Investigate HighMemoryUsage alert on api-gateway",
        "description": "Resolved: memory leak in payment-worker v2.4.1; rollback to v2.4.0 completed.",
        "status": "done",
        "priority": "high",
        "createdAt": "2025-01-15T08:24:00Z",
        "updatedAt": "2025-01-15T10:15:00Z"
      }
    }
  },
  {
    "method": "DELETE",
    "endpoint": "/api/tasks/{id}",
    "description": "Delete a task",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "params": { "id": "task-002" }
    },
    "response": {
      "status": 200,
      "body": { "ok": true }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/chat",
    "description": "Send a chat message and receive the assistant reply",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "sessionId": "sess-4f8a-latency",
        "message": "Why did checkout service p99 latency spike at 14:00 UTC yesterday?",
        "model": "gpt-4o"
      }
    },
    "response": {
      "status": 200,
      "body": {
        "sessionId": "sess-4f8a-latency",
        "reply": "Checkout p99 latency rose from 210ms to 480ms between 14:00–14:25 UTC, correlating with a deploy of checkout-api v3.12. The payments dashboard shows elevated downstream latency to the payment-provider at the same window. Recommended next step: compare error rates across the two versions.",
        "model": "gpt-4o"
      }
    }
  },
  {
    "method": "GET",
    "endpoint": "/api/chat/sessions",
    "description": "List chat sessions (multi-tab) — LOW CONFIDENCE, may not exist",
    "request": {
      "headers": { "Content-Type": "application/json" }
    },
    "response": {
      "status": 200,
      "body": [
        {
          "id": "sess-4f8a-latency",
          "title": "Checkout latency spike",
          "model": "gpt-4o",
          "createdAt": "2025-01-15T08:02:00Z",
          "updatedAt": "2025-01-15T09:44:00Z"
        },
        {
          "id": "sess-91c2-alerts",
          "title": "Firing alerts triage",
          "model": "claude-sonnet-4-5",
          "createdAt": "2025-01-15T07:30:00Z",
          "updatedAt": "2025-01-15T08:15:00Z"
        }
      ]
    }
  },
  {
    "method": "GET",
    "endpoint": "/api/models",
    "description": "List available models for the model selector",
    "request": {
      "headers": { "Content-Type": "application/json" }
    },
    "response": {
      "status": 200,
      "body": [
        { "id": "gpt-4o", "provider": "openai" },
        { "id": "gpt-4o-mini", "provider": "openai" },
        { "id": "claude-sonnet-4-5", "provider": "anthropic" }
      ]
    }
  },
  {
    "method": "GET",
    "endpoint": "/api/tools",
    "description": "List registered MCP tools",
    "request": {
      "headers": { "Content-Type": "application/json" }
    },
    "response": {
      "status": 200,
      "body": [
        { "name": "grafana_list_dashboards", "provider": "grafana", "description": "List Grafana dashboards matching a query" },
        { "name": "grafana_query_metrics", "provider": "grafana", "description": "Run a PromQL query against Grafana" },
        { "name": "tchat_send_message", "provider": "tchat", "description": "Send a message to a tchat channel" }
      ]
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/tools/test",
    "description": "Execute a tool with test arguments",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "tool": "grafana_list_dashboards",
        "args": { "query": "payments" }
      }
    },
    "response": {
      "status": 200,
      "body": {
        "ok": true,
        "result": {
          "dashboards": [
            { "id": 42, "title": "Payments - Service Overview", "uid": "payments-overview" },
            { "id": 57, "title": "Payments - Provider Latency", "uid": "payments-latency" }
          ]
        }
      }
    }
  }
]
```

---

## Validation Checklist (before publishing to `.paaw/`)

1. **Re-run the scan** with corrected `find` syntax: `find . -type f \( -name '*.mjs' -o -name '*.js' ... \)` — the `(` must be escaped/quoted.
2. **Verify exact paths** for chat send (`/api/chat` vs `/api/chat/send`) and tool test (`/api/tools/test` vs `/api/tool/test`).
3. **Confirm Task schema field names** (`title`/`name`, `status` enum values, `priority` presence).
4. **Verify session persistence** — if multi-tab is client-only, delete the `/api/chat/sessions` entry from `api-examples.json`.
5. **Check response codes** — create may return 200 or 201.
6. **Confirm no auth layer** — if one was added later, update all examples with auth headers.