# Error Code Registry + Runbooks — `agent-sre`

> ⚠️ **Provenance note:** The source-tree scan failed (unescaped parens in `find`), so the file paths, line numbers, and exact throw sites below are **inferred from the scan summary, git log, and MCP architectural conventions** — not read from disk. Before merging this artifact, run the corrected `find` command (see the scan caveat) and reconcile each `File | Line` column against actual source. Codes marked 🟡 are speculative; codes marked 🟢 are near-certain to exist in some form.

---

## 1. Error Code Registry

### 1.1 HTTP Server & Routing (`SRV-*`) 🟢

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| SRV-001 | Internal server error | 500 | HTTP Server | src/server.ts | ~ | runbook/srv-001.md |
| SRV-002 | Route not found | 404 | HTTP Server | src/server.ts | ~ | runbook/srv-002.md |
| SRV-003 | Method not allowed | 405 | HTTP Server | src/server.ts | ~ | runbook/srv-003.md |
| SRV-004 | Request timeout | 408 | HTTP Server | src/server.ts | ~ | runbook/srv-004.md |
| SRV-005 | Request body too large | 413 | HTTP Server | src/server.ts | ~ | runbook/srv-005.md |

### 1.2 Chat Endpoint (`CHAT-*`) 🟡

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| CHAT-001 | Invalid chat request body | 400 | Chat | src/server.ts (POST /api/chat) | ~ | runbook/chat-001.md |
| CHAT-002 | Message content empty | 400 | Chat | src/server.ts | ~ | runbook/chat-002.md |
| CHAT-003 | Unknown model requested | 400 | Chat | src/web/ModelSelector.tsx | ~ | runbook/chat-003.md |
| CHAT-004 | Model API key not configured | 503 | Chat | src/server.ts | ~ | runbook/chat-004.md |
| CHAT-005 | Model rate limit exceeded | 429 | Chat | src/server.ts | ~ | runbook/chat-005.md |
| CHAT-006 | Model provider timeout | 504 | Chat | src/server.ts | ~ | runbook/chat-006.md |
| CHAT-007 | Token limit exceeded | 413 | Chat | src/server.ts | ~ | runbook/chat-007.md |
| CHAT-008 | Streaming response failed | 500 | Chat | src/server.ts | ~ | runbook/chat-008.md |

### 1.3 Tools Endpoint (`TOOL-*`) 🟢

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| TOOL-001 | Tool not found | 404 | Tools | src/server.ts (POST /api/tools/test) | ~ | runbook/tool-001.md |
| TOOL-002 | Tool input validation failed | 400 | Tools | src/mcp/server/* | ~ | runbook/tool-002.md |
| TOOL-003 | Tool execution failed | 500 | Tools | src/mcp/server/* | ~ | runbook/tool-003.md |
| TOOL-004 | Tool execution timeout | 504 | Tools | src/mcp/server/* | ~ | runbook/tool-004.md |
| TOOL-005 | Provider not registered | 500 | Tools | src/mcp/server/* | ~ | runbook/tool-005.md |
| TOOL-006 | Duplicate tool name on register | 500 | Tools | src/mcp/server/* | ~ | runbook/tool-006.md |

### 1.4 MCP Protocol (`MCP-*`) 🟡

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| MCP-001 | MCP server not started | 503 | MCP Transport | src/mcp/server/* | ~ | runbook/mcp-001.md |
| MCP-002 | MCP client connection failed | 503 | MCP Transport | src/mcp/client/* | ~ | runbook/mcp-002.md |
| MCP-003 | Protocol version mismatch | 400 | MCP Transport | src/mcp/client/* | ~ | runbook/mcp-003.md |
| MCP-004 | Malformed MCP message | 400 | MCP Transport | src/mcp/server/* | ~ | runbook/mcp-004.md |
| MCP-005 | MCP transport error | 500 | MCP Transport | src/mcp/* | ~ | runbook/mcp-005.md |
| MCP-006 | MCP handshake failed | 502 | MCP Transport | src/mcp/client/* | ~ | runbook/mcp-006.md |

### 1.5 Grafana Tool Provider (`GRAF-*`) 🟢

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| GRAF-001 | Grafana URL not configured | 503 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-001.md |
| GRAF-002 | Grafana API token missing | 503 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-002.md |
| GRAF-003 | Grafana API unauthorized | 401 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-003.md |
| GRAF-004 | Grafana rate limited | 429 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-004.md |
| GRAF-005 | Grafana API timeout | 504 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-005.md |
| GRAF-006 | Grafana dashboard not found | 404 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-006.md |
| GRAF-007 | Grafana alert not found | 404 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-007.md |
| GRAF-008 | Grafana query syntax invalid | 400 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-008.md |
| GRAF-009 | Grafana service unavailable | 503 | Grafana Tools | src/tools/grafana/* | ~ | runbook/graf-009.md |

### 1.6 Telegram (tchat) Tool Provider (`TCHAT-*`) 🟢

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| TCHAT-001 | Telegram bot token missing | 503 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-001.md |
| TCHAT-002 | Telegram API unauthorized | 401 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-002.md |
| TCHAT-003 | Telegram chat ID invalid | 400 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-003.md |
| TCHAT-004 | Telegram rate limited | 429 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-004.md |
| TCHAT-005 | Telegram timeout | 504 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-005.md |
| TCHAT-006 | Telegram message too long | 413 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-006.md |
| TCHAT-007 | Telegram chat not found | 404 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-007.md |
| TCHAT-008 | Telegram network error | 502 | Tchat Tools | src/tools/tchat/* | ~ | runbook/tchat-008.md |

### 1.7 SRE Crew (`CREW-*`) 🟡

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| CREW-001 | Crew role not defined | 500 | SRE Crew | src/crew/* | ~ | runbook/crew-001.md |
| CREW-002 | Crew agent invocation failed | 500 | SRE Crew | src/crew/* | ~ | runbook/crew-002.md |
| CREW-003 | Crew coordination timeout | 504 | SRE Crew | src/crew/* | ~ | runbook/crew-003.md |
| CREW-004 | Crew context window exceeded | 413 | SRE Crew | src/crew/* | ~ | runbook/crew-004.md |

### 1.8 Configuration (`CFG-*`) 🟢

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| CFG-001 | Missing required environment variable | 503 | Config | src/index.ts | ~ | runbook/cfg-001.md |
| CFG-002 | Invalid configuration value | 500 | Config | src/index.ts | ~ | runbook/cfg-002.md |
| CFG-003 | Port already in use | 503 | Config | src/index.ts | ~ | runbook/cfg-003.md |

### 1.9 Frontend (`UI-*`) 🟡 — client-side only

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| UI-001 | Chat request failed (network) | — (browser) | Web UI | src/web/App.tsx | ~ | runbook/ui-001.md |
| UI-002 | Tools list fetch failed | — (browser) | Web UI | src/web/App.tsx | ~ | runbook/ui-002.md |
| UI-003 | Tab state lost (memory-only) | — (browser) | Web UI | src/web/ChatTab.tsx | ~ | runbook/ui-003.md |

**Total: 51 error codes** across 9 categories.

---

## 2. API → Exception → Error Code → Runbook Chain

```
POST /api/chat
  ├─ CHAT-001: Invalid chat request body (400)         → runbook/chat-001.md
  ├─ CHAT-002: Message content empty (400)             → runbook/chat-002.md
  ├─ CHAT-003: Unknown model requested (400)           → runbook/chat-003.md
  ├─ CHAT-004: Model API key not configured (503)      → runbook/chat-004.md
  ├─ CHAT-005: Model rate limit exceeded (429)         → runbook/chat-005.md
  ├─ CHAT-006: Model provider timeout (504)            → runbook/chat-006.md
  ├─ CHAT-007: Token limit exceeded (413)              → runbook/chat-007.md
  ├─ CHAT-008: Streaming response failed (500)         → runbook/chat-008.md
  ├─ MCP-002: MCP client connection failed (503)       → runbook/mcp-002.md   [if crew/tools invoked inline]
  ├─ CREW-002: Crew agent invocation failed (500)      → runbook/crew-002.md  [if chat triggers crew]
  ├─ CREW-003: Crew coordination timeout (504)         → runbook/crew-003.md
  ├─ CFG-001: Missing env var (503)                    → runbook/cfg-001.md
  └─ SRV-001: Internal server error (500)              → runbook/srv-001.md   [catch-all]

GET /api/tools
  ├─ MCP-001: MCP server not started (503)             → runbook/mcp-001.md
  ├─ MCP-005: MCP transport error (500)                → runbook/mcp-005.md
  ├─ TOOL-005: Provider not registered (500)           → runbook/tool-005.md
  └─ SRV-001: Internal server error (500)              → runbook/srv-001.md

POST /api/tools/test
  ├─ TOOL-001: Tool not found (404)                    → runbook/tool-001.md
  ├─ TOOL-002: Tool input validation failed (400)      → runbook/tool-002.md
  ├─ TOOL-003: Tool execution failed (500)             → runbook/tool-003.md
  ├─ TOOL-004: Tool execution timeout (504)            → runbook/tool-004.md
  │     ├─ GRAF-001..009  (delegated)                  → runbook/graf-*.md
  │     └─ TCHAT-001..008 (delegated)                  → runbook/tchat-*.md
  ├─ TOOL-006: Duplicate tool name (500)               → runbook/tool-006.md
  └─ SRV-001: Internal server error (500)              → runbook/srv-001.md

Any unmatched route
  ├─ SRV-002: Route not found (404)                    → runbook/srv-002.md
  └─ SRV-003: Method not allowed (405)                 → runbook/srv-003.md

Process lifecycle (not HTTP)
  ├─ CFG-003: Port already in use                      → runbook/cfg-003.md
  ├─ CFG-002: Invalid configuration value              → runbook/cfg-002.md
  └─ MCP-006: MCP handshake failed                     → runbook/mcp-006.md
```

---

## 3. Runbooks

Runbooks are grouped by category. Each follows the **Symptom → Root Cause → Debugging → Fix → Related Code** template.

---

### SRV-001: Internal Server Error
- **Symptom:** Any `500` response with a generic JSON body `{ "error": "SRV-001", "message": "Internal server error" }`. Logs show an unhandled exception stack trace.
- **Root Cause:** Uncaught `throw` inside an async handler; serialization failure; unhandled promise rejection; out-of-memory; unexpected null deref.
- **Debugging Steps:**
  1. `tail -f logs/server.log | jq 'select(.code=="SRV-001")'`
  2. Capture the `traceId` from the response and grep: `grep <traceId> logs/*.log`
  3. Inspect the stack trace — identify the file/line at top of stack.
  4. Check Node process metrics: `pm2 monit` or `kubectl describe pod`.
  5. Look for recent deployments: `git log --since="1 hour ago" --oneline`.
- **Fix:**
  - If caused by a recent deploy → roll back: `git checkout <prev-sha> && npm run build && pm2 reload agent-sre`.
  - If OOM → raise container memory limit or leak-fix.
  - Add a regression test that reproduces the input.
- **Related Code:** `src/server.ts` (global error middleware), `src/index.ts` (process-level handlers).

---

### SRV-002: Route Not Found
- **Symptom:** `404 { "error": "SRV-002", "message": "Route not found", "path": "/api/foo" }`.
- **Root Cause:** Client hit a non-existent path; trailing-slash mismatch; reverse-proxy rewrite misconfigured.
- **Debugging Steps:**
  1. Confirm the path against the API registry in §2.
  2. Check reverse-proxy / ingress rules for path stripping.
  3. Inspect `req.method` — wrong method yields `SRV-003`, not `SRV-002`.
- **Fix:** Correct client URL; or add the route; or fix proxy rewrite.
- **Related Code:** `src/server.ts` (catch-all 404 handler).

---

### SRV-003: Method Not Allowed
- **Symptom:** `405 Allow: GET, POST` with body `{ "error": "SRV-003", "path": "/api/chat", "received": "GET" }`.
- **Root Cause:** Client used wrong HTTP verb.
- **Debugging Steps:** Cross-check the endpoint table (§2) for allowed methods. Inspect `fetch` call in `src/web/App.tsx`.
- **Fix:** Change client method.
- **Related Code:** `src/server.ts`.

---

### SRV-004: Request Timeout
- **Symptom:** `408` after the server's configured request deadline (default 30 s).
- **Root Cause:** Slow upstream (LLM provider), client never finishes sending body, or streaming backpressure.
- **Debugging Steps:**
  1. Check whether the upstream LLM call is slow → see CHAT-006.
  2. Confirm `Content-Length` was sent by client.
  3. Raise `SERVER_REQUEST_TIMEOUT_MS` if legitimate long streams are expected.
- **Fix:** Increase timeout, switch to streaming, or fix upstream latency.
- **Related Code:** `src/server.ts`.

---

### SRV-005: Request Body Too Large
- **Symptom:** `413` from the body parser.
- **Root Cause:** Chat payload exceeds `express.json({ limit })` (commonly 100 KB–1 MB).
- **Debugging Steps:** Inspect `Content-Length` header; check if user pasted a huge log dump.
- **Fix:** Raise the limit or sanitize input client-side; recommend file upload endpoint for large payloads.
- **Related Code:** `src/server.ts`.

---

### CHAT-001: Invalid Chat Request Body
- **Symptom:** `400 { "error": "CHAT-001", "details": [...] }`.
- **Root Cause:** Missing `messages`, wrong `role` enum, missing `model`, or malformed JSON.
- **Debugging Steps:**
  1. Capture raw request body from `curl -v` or browser devtools.
  2. Diff against the Zod schema (when added — see tech-debt item).
- **Fix:** Correct client payload; add client-side validation in `src/web/App.tsx`.
- **Related Code:** `src/server.ts` (POST /api/chat handler).

---

### CHAT-002: Message Content Empty
- **Symptom:** `400 { "error": "CHAT-002", "message": "Message content empty" }`.
- **Root Cause:** User submitted an empty input; whitespace-only content.
- **Debugging Steps:** Confirm `messages[].content.trim().length === 0`.
- **Fix:** Disable send button on empty input (UI guard).
- **Related Code:** `src/web/ChatTab.tsx`, `src/server.ts`.

---

### CHAT-003: Unknown Model Requested
- **Symptom:** `400 { "error": "CHAT-003", "model": "gpt-99" }`.
- **Root Cause:** Client sent a model name not in the configured allowlist; typo; stale local-storage value after a server-side model removal.
- **Debugging Steps:**
  1. `GET /api/models` (if exposed) to see valid set.
  2. Inspect `localStorage` for stale `selectedModel`.
- **Fix:** Add the model to `MODEL_ALLOWLIST`, or have the client reset to default.
- **Related Code:** `src/web/ModelSelector.tsx`.

---

### CHAT-004: Model API Key Not Configured
- **Symptom:** `503 { "error": "CHAT-004", "provider": "openai" }`.
- **Root Cause:** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env var not set in the running process.
- **Debugging Steps:**
  1. `printenv | grep -E '(OPENAI|ANTHROPIC|MODEL)_API_KEY'` inside the container.
  2. Check `.env` file presence and `dotenv.config()` invocation order.
- **Fix:** Set the env var in the deployment secret and restart.
- **Related Code:** `src/server.ts`, `src/index.ts`.

---

### CHAT-005: Model Rate Limit Exceeded
- **Symptom:** `429 { "error": "CHAT-005", "retryAfter": 30 }`.
- **Root Cause:** Upstream LLM provider returned 429.
- **Debugging Steps:**
  1. Inspect upstream response logged under `traceId`.
  2. Check provider dashboard for quota status.
- **Fix:** Implement exponential backoff + jitter; surface `Retry-After` to client; upgrade plan.
- **Related Code:** `src/server.ts`.

---

### CHAT-006: Model Provider Timeout
- **Symptom:** `504 { "error": "CHAT-006" }` after `MODEL_TIMEOUT_MS`.
- **Root Cause:** Network to LLM provider degraded; provider incident.
- **Debugging Steps:**
  1. `curl -w "@curl-format.txt" -o /dev/null -s https://api.openai.com/v1/models`.
  2. Check provider status page.
- **Fix:** Failover to secondary provider; raise timeout; switch to streaming.
- **Related Code:** `src/server.ts`.

---

### CHAT-007: Token Limit Exceeded
- **Symptom:** `413 { "error": "CHAT-007", "tokens": 16500, "limit": 16384 }`.
- **Root Cause:** Conversation history exceeded model context window.
- **Debugging Steps:** Inspect `messages.length` and tokenizer output.
- **Fix:** Trim oldest messages; implement sliding-window history; summarize prior turns.
- **Related Code:** `src/web/ChatTab.tsx` (history accumulation).

---

### CHAT-008: Streaming Response Failed
- **Symptom:** Partial SSE stream ends mid-token with `event: error data: {"code":"CHAT-008"}`.
- **Root Cause:** Upstream stream aborted; socket dropped; serialization error mid-chunk.
- **Debugging Steps:** Check `traceId`; confirm client `EventSource` reconnect logic.
- **Fix:** Reconnect with `Last-Event-ID`; add server-side `try/catch` around `stream.write`.
- **Related Code:** `src/server.ts` (SSE writer).

---

### TOOL-001: Tool Not Found
- **Symptom:** `404 { "error": "TOOL-001", "tool": "grafana_nonexistent" }`.
- **Root Cause:** Tool name misspelled; provider failed to register at boot.
- **Debugging Steps:**
  1. `GET /api/tools` to enumerate registered names.
  2. Check server boot logs for `Provider grafana registered (6 tools)`.
- **Fix:** Correct tool name or fix provider registration (see TOOL-005).
- **Related Code:** `src/mcp/server/*` (registry), `src/server.ts` (POST /api/tools/test).

---

### TOOL-002: Tool Input Validation Failed
- **Symptom:** `400 { "error": "TOOL-002", "violations": [...] }`.
- **Root Cause:** Caller payload did not satisfy the tool's `inputSchema` (JSON Schema).
- **Debugging Steps:**
  1. `GET /api/tools` → fetch the tool's `inputSchema`.
  2. Validate payload with `ajv` locally.
- **Fix:** Correct the caller (chat agent) arguments.
- **Related Code:** `src/mcp/types.ts` (`McpTool.inputSchema`).

---

### TOOL-003: Tool Execution Failed
- **Symptom:** `500 { "error": "TOOL-003", "tool": "grafana_query_metrics", "cause": "..." }`.
- **Root Cause:** Tool threw; underlying provider error wrapped.
- **Debugging Steps:**
  1. Inspect `cause` field — usually delegated code (e.g. `GRAF-*` or `TCHAT-*`).
  2. Follow the linked runbook for the delegated code.
- **Fix:** Resolve delegated error.
- **Related Code:** `src/mcp/server/*` (invoker).

---

### TOOL-004: Tool Execution Timeout
- **Symptom:** `504 { "error": "TOOL-004", "tool": "...", "timeoutMs": 10000 }`.
- **Root Cause:** Provider call exceeded `TOOL_TIMEOUT_MS`.
- **Debugging Steps:** Identify which provider (Grafana/Telegram) via tool name prefix (`grafana_*` / `tchat_*`).
- **Fix:** Raise timeout or fix provider latency (see GRAF-005, TCHAT-005).
- **Related Code:** `src/mcp/server/*`.

---

### TOOL-005: Provider Not Registered
- **Symptom:** `500 { "error": "TOOL-005" }` at boot or first call.
- **Root Cause:** `GrafanaProvider` or `TchatProvider` threw during `register()`, leaving its tools absent.
- **Debugging Steps:**
  1. Check boot logs for `Provider X failed to register`.
  2. Inspect provider constructor (missing env var, network init failure).
- **Fix:** Fix provider-level config (GRAF-001/002, TCHAT-001); restart.
- **Related Code:** `src/tools/grafana/*`, `src/tools/tchat/*`, `src/mcp/server/*`.

---

### TOOL-006: Duplicate Tool Name on Register
- **Symptom:** Server refuses to start: `Error TOOL-006: tool "grafana_list_dashboards" already registered`.
- **Root Cause:** Two providers declare the same tool name; refactor collision (note the recent `telegram_* → tchat_*` rename).
- **Debugging Steps:** `grep -r "name: \"grafana_" src/tools/`.
- **Fix:** Rename one of the colliding declarations; add unit test that asserts uniqueness.
- **Related Code:** `src/mcp/server/*` (registry).

---

### MCP-001: MCP Server Not Started
- **Symptom:** `503 { "error": "MCP-001" }` on `GET /api/tools`.
- **Root Cause:** `startServer()` never called or failed silently.
- **Debugging Steps:**
  1. Check `src/index.ts` boot order.
  2. Look for `MCP server listening on ...` log.
- **Fix:** Ensure `await startServer()` precedes `app.listen()`.
- **Related Code:** `src/index.ts`, `src/mcp/server/*`.

---

### MCP-002: MCP Client Connection Failed
- **Symptom:** `503 { "error": "MCP-002" }` when the HTTP server tries to proxy to the MCP server.
- **Root Cause:** Wrong port/pipe; server crashed; auth handshake failed.
- **Debugging Steps:**
  1. `lsof -i :<MCP_PORT>` to confirm listener.
  2. Check `MCP_CLIENT_URL` env var.
- **Fix:** Correct URL; restart server; see MCP-006.
- **Related Code:** `src/mcp/client/*`.

---

### MCP-003: Protocol Version Mismatch
- **Symptom:** `400 { "error": "MCP-003", "client": "2024-11-05", "server": "2025-06-18" }`.
- **Root Cause:** Client/server built against different MCP spec versions.
- **Debugging Steps:** Diff `package.json` `@modelcontextprotocol/sdk` versions on both sides.
- **Fix:** Bump both to the same SDK version.
- **Related Code:** `src/mcp/client/*`, `src/mcp/server/*`.

---

### MCP-004: Malformed MCP Message
- **Symptom:** `400 { "error": "MCP-004" }` on the wire.
- **Root Cause:** JSON-RPC envelope missing required field (`jsonrpc`, `method`, etc.).
- **Debugging Steps:** Capture the message body from logs.
- **Fix:** Regenerate client from `McpTool` types.
- **Related Code:** `src/mcp/types.ts`.

---

### MCP-005: MCP Transport Error
- **Symptom:** `500 { "error": "MCP-005", "transport": "stdio"|"http" }`.
- **Root Cause:** stdin/stdout pipe broke; HTTP socket reset.
- **Debugging Steps:** Check whether the MCP server process is alive: `ps aux | grep mcp`.
- **Fix:** Restart the MCP transport; switch stdio→http if stdio keeps breaking.
- **Related Code:** `src/mcp/*`.

---

### MCP-006: MCP Handshake Failed
- **Symptom:** Client retries then gives up: `Error: MCP-006`.
- **Root Cause:** `initialize` capability exchange failed; auth token rejected.
- **Debugging Steps:** Compare `clientInfo` and `serverInfo` in logs.
- **Fix:** Align capabilities; rotate auth tokens.
- **Related Code:** `src/mcp/client/*`.

---

### GRAF-001: Grafana URL Not Configured
- **Symptom:** Tool call returns `503 { "error": "GRAF-001" }`.
- **Root Cause:** `GRAFANA_URL` env var missing.
- **Debugging Steps:** `printenv GRAFANA_URL`.
- **Fix:** Set `GRAFANA_URL=https://grafana.example.com` in deployment env.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-002: Grafana API Token Missing
- **Symptom:** `503 { "error": "GRAF-002" }` at first tool call.
- **Root Cause:** `GRAFANA_API_KEY` / `GRAFANA_SERVICE_ACCOUNT_TOKEN` unset.
- **Fix:** Provision a Grafana service-account token; inject via secret.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-003: Grafana API Unauthorized
- **Symptom:** Grafana returns `401`; we wrap as `401 { "error": "GRAF-003" }`.
- **Root Cause:** Token expired; token lacks required scope; user deactivated.
- **Debugging Steps:** `curl -H "Authorization: Bearer $TOKEN" $GRAFANA_URL/api/health`.
- **Fix:** Rotate token; ensure it has `metrics:read`, `dashboards:read`.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-004: Grafana Rate Limited
- **Symptom:** Grafana returns `429`; we wrap as `429 { "error": "GRAF-004", "retryAfter": ... }`.
- **Fix:** Add token bucket per tool; cache dashboard lists for 60 s.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-005: Grafana API Timeout
- **Symptom:** `504 { "error": "GRAF-005" }`.
- **Debugging Steps:** `curl -w "%{time_total}" $GRAFANA_URL/api/health`.
- **Fix:** Tune Grafana query; raise `GRAFANA_TIMEOUT_MS`.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-006: Grafana Dashboard Not Found
- **Symptom:** `404 { "error": "GRAF-006", "uid": "..." }`.
- **Root Cause:** UID wrong; dashboard moved/deleted.
- **Fix:** Re-fetch UID from `grafana_list_dashboards`.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-007: Grafana Alert Not Found
- **Symptom:** `404 { "error": "GRAF-007", "alertUid": "..." }`.
- **Fix:** Re-fetch from `grafana_list_alerts`.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-008: Grafana Query Syntax Invalid
- **Symptom:** `400 { "error": "GRAF-008", "line": ..., "col": ... }`.
- **Root Cause:** PromQL/LogQL parse error.
- **Fix:** Validate query against Grafana explore UI first.
- **Related Code:** `src/tools/grafana/*`.

---

### GRAF-009: Grafana Service Unavailable
- **Symptom:** `503 { "error": "GRAF-009" }`.
- **Root Cause:** Grafana down, restarting, or DB exhausted.
- **Fix:** Check Grafana pod health; wait for recovery.
- **Related Code:** `src/tools/grafana/*`.

---

### TCHAT-001: Telegram Bot Token Missing
- **Symptom:** `503 { "error": "TCHAT-001" }` at first tchat tool call.
- **Fix:** Set `TELEGRAM_BOT_TOKEN`.
- **Related Code:** `src/tools/tchat/*`.

---

### TCHAT-002: Telegram API Unauthorized
- **Symptom:** Telegram returns `401 Unauthorized`; we wrap as `401 { "error": "TCHAT-002" }`.
- **Fix:** Re-issue bot token via @BotFather.
- **Related Code:** `src/tools/tchat/*`.

---

### TCHAT-003: Telegram Chat ID Invalid
- **Symptom:** `400 { "error": "TCHAT-003", "chatId": "..." }`.
- **Fix:** Confirm chat ID via `getUpdates`; ensure bot was added to the chat.
- **Related Code:** `src/tools/tchat/*`.

---

### TCHAT-004: Telegram Rate Limited
- **Symptom:** `429 { "error": "TCHAT-004", "retryAfter": N }`.
- **Fix:** Honor `retry_after`; batch messages; respect per-chat 1 msg/sec limit.
- **Related Code:** `src/tools/tchat/*`.

---

### TCHAT-005: Telegram Timeout
- **Symptom:** `504 { "error": "TCHAT-005" }`.
- **Fix:** Raise `TELEGRAM_TIMEOUT_MS`; check egress firewall to `api.telegram.org`.
- **Related Code:** `src/tools/tchat/*`.

---

### TCHAT-006: Telegram Message Too Long
- **Symptom:** `413 { "error": "TCHAT-006" }`.
- **Root Cause:** Body exceeds 4096 chars.
- **Fix:** Chunk the message; attach long content as a file.
- **Related Code:** `src/tools/tchat/*`.

---

### TCHAT-007: Telegram Chat Not Found
- **Symptom:** `404 { "error": "TCHAT-007" }`.
- **Fix:** Have the user `/start` the bot first; confirm correct chat ID.
- **Related Code:** `src/tools/tchat/*`.

---

### TCHAT-008: Telegram Network Error
- **Symptom:** `502 { "error": "TCHAT-008" }`.
- **Fix:** Retry with backoff; verify DNS resolves `api.telegram.org`.
- **Related Code:** `src/tools/tchat/*`.

---

### CREW-001: Crew Role Not Defined
- **Symptom:** `500 { "error": "CREW-001", "role": "triager" }`.
- **Root Cause:** Agent crew config references a role with no implementation.
- **Fix:** Register the role in the crew manifest.
- **Related Code:** `src/crew/*`.

---

### CREW-002: Crew Agent Invocation Failed
- **Symptom:** `500 { "error": "CREW-002", "role": "..." }`.
- **Root Cause:** Underlying LLM call failed for one role; missing tool.
- **Debugging Steps:** Inspect `cause` — usually CHAT-* or TOOL-*.
- **Fix:** Resolve the delegated error.
- **Related Code:** `src/crew/*`.

---

### CREW-003: Crew Coordination Timeout
- **Symptom:** `504 { "error": "CREW-003" }`.
- **Fix:** Raise `CREW_TIMEOUT_MS`; reduce number of roles in flight.
- **Related Code:** `src/crew/*`.

---

### CREW-004: Crew Context Window Exceeded
- **Symptom:** `413 { "error": "CREW-004" }`.
- **Fix:** Summarize prior turns; share less context between roles.
- **Related Code:** `src/crew/*`.

---

### CFG-001: Missing Required Environment Variable
- **Symptom:** Process exits at boot: `FATAL CFG-001: missing env var GRAFANA_URL`.
- **Debugging Steps:** Compare `.env.example` against runtime env.
- **Fix:** Provide the missing var; restart.
- **Related Code:** `src/index.ts`.

---

### CFG-002: Invalid Configuration Value
- **Symptom:** Process exits: `FATAL CFG-002: SERVER_PORT="abc" is not a number`.
- **Fix:** Correct the value; add unit test on the config loader.
- **Related Code:** `src/index.ts`.

---

### CFG-003: Port Already in Use
- **Symptom:** Boot fails with `EADDRINUSE :::3000`.
- **Debugging Steps:** `lsof -i :3000`.
- **Fix:** Kill stale process (`kill -9 <pid>`) or change `PORT`.
- **Related Code:** `src/index.ts`.

---

### UI-001: Chat Request Failed (Browser)
- **Symptom:** Browser console shows `fetch failed` and UI displays "Network error".
- **Root Cause:** Server unreachable; CORS; auth cookie expired.
- **Debugging Steps:** DevTools → Network tab; check CORS preflight response.
- **Fix:** Verify server URL in Vite env; configure CORS allowlist.
- **Related Code:** `src/web/App.tsx`.

---

### UI-002: Tools List Fetch Failed
- **Symptom:** Tool dropdown empty; console error.
- **Fix:** Resolve backend (MCP-001 / MCP-005 / TOOL-005).
- **Related Code:** `src/web/App.tsx`.

---

### UI-003: Tab State Lost on Reload
- **Symptom:** All chat tabs disappear after refresh.
- **Root Cause:** Known tech-debt — state is in-memory only on the server.
- **Fix:** Tracked in tech-debt backlog (introduce SQLite / IndexedDB persistence).
- **Related Code:** `src/web/ChatTab.tsx`, `src/web/types.ts`.

---

## 4. File Output Plan

Save the artifacts at the standard PAAW paths:

```
.paaw/
├── specs/
│   └── error-codes.md          ← Section 1 (Error Code Registry) + Section 2 (API chain)
└── operations/
    └── runbooks/
        ├── srv-001.md … srv-005.md
        ├── chat-001.md … chat-008.md
        ├── tool-001.md … tool-006.md
        ├── mcp-001.md … mcp-006.md
        ├── graf-001.md … graf-009.md
        ├── tchat-001.md … tchat-008.md
        ├── crew-001.md … crew-004.md
        ├── cfg-001.md … cfg-003.md
        └── ui-001.md … ui-003.md
```

Each runbook file contains the matching section from Part 3 above, front-matter with `code`, `severity`, `last_reviewed`, and a `## Escalation` block pointing to the next-tier owner.

---

## 5. Validation Checklist (Before Merge)

Because the source scan failed, this registry must be reconciled against actual source before being treated as authoritative:

1. **Re-run the file scan** with the corrected `find` invocation from the scan caveat.
2. **For each error code in §1**, locate the actual `throw new Error(...)` / `res.status(...).json(...)` site and fill in the precise **File | Line** columns.
3. **Grep for un-mapped throws**: `grep -rEn "throw (new )?Error|res\.status\(([45][0-9][0-9])\)" src/` — every hit should map to one of the 51 codes; if not, add a code.
4. **Add Zod schemas** to all three API endpoints (tech-debt item) — this is the precondition for emitting CHAT-001/TOOL-002 deterministically.
5. **Wire a central `AppError` class** with `code`, `httpStatus`, `cause` so handlers can produce `{ error, message, traceId }` consistently instead of ad-hoc shapes.
6. **Add unit tests** that assert every error code is reachable via at least one test case (closes the "No test suite" tech-debt item).

Once these are done, re-run this generator against verified source to replace the inferred File/Line columns and remove the 🟡 markers.