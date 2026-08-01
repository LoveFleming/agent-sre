# API Contract — `agent-sre`

> **Source confidence:** The project's file-tree scan failed (unescaped parens in `find`), so the following contract is reconstructed from the JSON scan summary, the architecture map, the git log, and standard MCP/HTTP patterns. The three HTTP endpoints (`POST /api/chat`, `GET /api/tools`, `POST /api/tools/test`) come directly from the scan; their schemas, status codes, and call chains are inferred from the data models (`ChatMessage`, `ChatTab`, `McpTool`) and the MCP server/client architecture. Verify against `src/server.ts` before publishing.

---

## Chat APIs

### POST /api/chat
- **Description:** Send a user message to the SRE agent and receive an assistant reply. Messages are scoped to a chat tab and processed with a selected model.
- **Feature:** Chat (Web UI ↔ Agent)
- **File:** `src/server.ts`
- **Handler:** `handleChat` (inferred)
- **Auth:** None enforced (single-user local tool — inferred)
- **Rate Limiting:** None visible
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | message | string | Yes | User's prompt / question |
  | model | string | No | Model identifier (e.g. `gpt-4o`, `claude-3-5-sonnet`) |
  | tabId | string | No | Chat tab the message belongs to; new tab created if omitted |
  | role | string | No | Defaults to `user` |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | id | string | Server-assigned message ID |
  | role | string | `assistant` |
  | content | string | Assistant's reply text |
  | timestamp | string (ISO 8601) | Reply timestamp |
  | model | string | Model that produced the reply |
  | tabId | string | Tab ID for the conversation |
- **Response 400:** Malformed request body — missing `message`
- **Response 500:** Upstream model or MCP failure
- **Calls:** `McpClient.listTools()`, `McpClient.callTool()` (if agent decides to invoke a tool), `runCrew()` (if SRE orchestration is triggered)

---

## Tools APIs

### GET /api/tools
- **Description:** List all MCP tools registered on the server (Grafana + Tchat providers).
- **Feature:** Tool Discovery
- **File:** `src/server.ts`
- **Handler:** `handleListTools` (inferred)
- **Auth:** None enforced
- **Rate Limiting:** None visible
- **Request:** No body, no query params
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | tools | McpTool[] | Array of registered tools |
  | tools[].name | string | Tool name (e.g. `grafana_query_metrics`) |
  | tools[].description | string | Human-readable description |
  | tools[].inputSchema | object | JSON-Schema describing accepted args |
  | tools[].provider | string | `grafana` \| `tchat` |
- **Response 500:** MCP server unreachable
- **Calls:** `McpClient.listTools()`

### POST /api/tools/test
- **Description:** Manually invoke a single MCP tool with provided arguments — used by the UI's tool-test panel and as a debugging surface.
- **Feature:** Tool Invocation
- **File:** `src/server.ts`
- **Handler:** `handleToolTest` (inferred)
- **Auth:** None enforced
- **Rate Limiting:** None visible
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | toolName | string | Yes | Registered tool name (e.g. `grafana_list_dashboards`) |
  | args | object | No | Tool-specific arguments matching `inputSchema` |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | ok | boolean | `true` on success |
  | toolName | string | Echo of the invoked tool |
  | result | any | Tool-specific result payload |
- **Response 400:** Unknown `toolName` or `args` fails `inputSchema` validation
- **Response 500:** Tool provider raised an error (Grafana/Telegram API failure, network, auth)
- **Calls:** `McpClient.callTool(toolName, args)` → routes to `GrafanaProvider` or `TchatProvider`

---

## MCP Tool Catalog (exposed via `POST /api/tools/test`)

> These are not HTTP endpoints — they are the tool names accepted by `toolName` in `/api/tools/test`. Included here because the catalog is the real API surface for SRE automation.

### Grafana Provider — 6 tools (inferred names)

| Tool Name | Description | Key Args |
|-----------|-------------|----------|
| `grafana_list_dashboards` | List available dashboards | `tag?`, `limit?` |
| `grafana_get_dashboard` | Fetch a dashboard by UID | `uid` |
| `grafana_list_alerts` | List current alert states | `state?` |
| `grafana_query_metrics` | Run a PromQL query | `query`, `start`, `end` |
| `grafana_list_datasources` | List configured datasources | — |
| `grafana_get_annotations` | Fetch dashboard annotations | `dashboardUID?`, `from`, `to` |

### Tchat Provider — 3 tools (renamed `telegram_*` → `tchat_*`)

| Tool Name | Description | Key Args |
|-----------|-------------|----------|
| `tchat_send_message` | Send a message to a chat | `chatId`, `text` |
| `tchat_read_messages` | Read recent messages from a chat | `chatId`, `limit?` |
| `tchat_list_chats` | List available chats | — |

---

## Cross-Cutting Concerns

| Concern | Status |
|---------|--------|
| Authentication | **None enforced** (single-user local tool — inferred) |
| Authorization / RBAC | Not present |
| Rate Limiting | Not present |
| Request Schema Validation | **Missing** — flagged as tech debt; recommend Zod |
| Error Code Taxonomy | **Missing** — errors are passed through, no centralized mapping |
| Persistence | In-memory only; chat history and tab state lost on restart |
| CORS | Presumed permissive for local Vite dev server |

---

## Open Questions for Source Verification
1. Exact handler function names in `src/server.ts` (`handleChat` / `handleListTools` / `handleToolTest` are guesses).
2. Real list of 6 Grafana tool names and 3 Tchat tool names — verify in `src/tools/grafana/*` and `src/tools/tchat/*`.
3. Whether `POST /api/chat` returns the full assistant message object or just plain text.
4. Whether `/api/tools/test` wraps results in `{ ok, result }` or returns the raw tool output.
5. Whether any auth middleware exists despite the scan reporting `hasAuth: false`.

---

```json-examples
[
  {
    "method": "POST",
    "endpoint": "/api/chat",
    "description": "Send a chat message and receive an assistant reply",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "message": "Why did the checkout service latency spike at 14:32 UTC?",
        "model": "gpt-4o",
        "tabId": "tab-incident-2024-09-12",
        "role": "user"
      }
    },
    "response": {
      "status": 200,
      "body": {
        "id": "msg-7f3a9c2e",
        "role": "assistant",
        "content": "At 14:32 UTC, checkout-service p95 latency rose from 180ms to 2.4s. The Grafana dashboard shows a correlated spike in DB connection pool saturation on orders-db-1. Recommend checking the connection pool size and recent deployment of checkout-service v3.4.1.",
        "timestamp": "2024-09-12T14:34:08.117Z",
        "model": "gpt-4o",
        "tabId": "tab-incident-2024-09-12"
      }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/chat",
    "description": "Send a chat message without an existing tab (new tab created)",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "message": "Summarize the last 24 hours of alerts for the payments namespace.",
        "model": "claude-3-5-sonnet"
      }
    },
    "response": {
      "status": 200,
      "body": {
        "id": "msg-2b8e1d4f",
        "role": "assistant",
        "content": "Over the last 24h, the payments namespace fired 12 alerts: 8 HighPaymentLatency, 3 PodCrashLoopBackOff on payments-worker, and 1 DBReplicaLag. The latency alerts cluster between 02:00–04:00 UTC, coinciding with the nightly batch run.",
        "timestamp": "2024-09-12T15:01:22.883Z",
        "model": "claude-3-5-sonnet",
        "tabId": "tab-3c91ab78"
      }
    }
  },
  {
    "method": "GET",
    "endpoint": "/api/tools",
    "description": "List all MCP tools registered on the server",
    "request": {
      "headers": {},
      "params": {}
    },
    "response": {
      "status": 200,
      "body": {
        "tools": [
          {
            "name": "grafana_list_dashboards",
            "description": "List Grafana dashboards, optionally filtered by tag",
            "inputSchema": {
              "type": "object",
              "properties": {
                "tag": { "type": "string", "description": "Filter by dashboard tag" },
                "limit": { "type": "number", "default": 50, "maximum": 200 }
              }
            },
            "provider": "grafana"
          },
          {
            "name": "grafana_query_metrics",
            "description": "Run a PromQL query against Grafana datasources",
            "inputSchema": {
              "type": "object",
              "required": ["query"],
              "properties": {
                "query": { "type": "string" },
                "start": { "type": "string", "description": "RFC3339 or unix timestamp" },
                "end": { "type": "string" }
              }
            },
            "provider": "grafana"
          },
          {
            "name": "tchat_send_message",
            "description": "Send a message to a Telegram chat",
            "inputSchema": {
              "type": "object",
              "required": ["chatId", "text"],
              "properties": {
                "chatId": { "type": "number" },
                "text": { "type": "string", "maxLength": 4096 }
              }
            },
            "provider": "tchat"
          }
        ]
      }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/tools/test",
    "description": "Invoke grafana_query_metrics with a PromQL query",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "toolName": "grafana_query_metrics",
        "args": {
          "query": "rate(http_requests_total{service=\"checkout\",code=~\"5..\"}[5m])",
          "start": "2024-09-12T14:00:00Z",
          "end": "2024-09-12T14:45:00Z"
        }
      }
    },
    "response": {
      "status": 200,
      "body": {
        "ok": true,
        "toolName": "grafana_query_metrics",
        "result": {
          "series": [
            {
              "labels": { "service": "checkout", "code": "500", "instance": "checkout-1:8080" },
              "samples": [
                { "timestamp": 1726147200, "value": "0.4" },
                { "timestamp": 1726147260, "value": "12.7" },
                { "timestamp": 1726147320, "value": "18.3" }
              ]
            }
          ]
        }
      }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/tools/test",
    "description": "Invoke grafana_list_dashboards filtered by tag",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "toolName": "grafana_list_dashboards",
        "args": { "tag": "payments", "limit": 10 }
      }
    },
    "response": {
      "status": 200,
      "body": {
        "ok": true,
        "toolName": "grafana_list_dashboards",
        "result": [
          { "uid": "payments-overview", "title": "Payments Overview", "tags": ["payments", "prod"] },
          { "uid": "payments-latency", "title": "Payments Latency SLO", "tags": ["payments", "slo"] }
        ]
      }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/tools/test",
    "description": "Invoke tchat_send_message to notify an incident channel",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "toolName": "tchat_send_message",
        "args": {
          "chatId": -1002384719203,
          "text": "🚨 SEV-2: checkout-service p95 latency exceeded 2s at 14:32 UTC. Investigating DB connection pool saturation on orders-db-1."
        }
      }
    },
    "response": {
      "status": 200,
      "body": {
        "ok": true,
        "toolName": "tchat_send_message",
        "result": {
          "messageId": 4827,
          "chatId": -1002384719203,
          "sentAt": "2024-09-12T14:33:01.412Z"
        }
      }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/tools/test",
    "description": "Invoke tchat_read_messages to fetch recent incident-channel updates",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "toolName": "tchat_read_messages",
        "args": { "chatId": -1002384719203, "limit": 5 }
      }
    },
    "response": {
      "status": 200,
      "body": {
        "ok": true,
        "toolName": "tchat_read_messages",
        "result": [
          { "messageId": 4827, "from": "SRE Bot", "text": "🚨 SEV-2: checkout-service p95 latency exceeded 2s...", "timestamp": "2024-09-12T14:33:01Z" },
          { "messageId": 4828, "from": "alice", "text": "On-call acknowledged, checking Grafana.", "timestamp": "2024-09-12T14:33:24Z" },
          { "messageId": 4829, "from": "bob", "text": "Rolling back checkout-service v3.4.1.", "timestamp": "2024-09-12T14:35:11Z" }
        ]
      }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/tools/test",
    "description": "Bad request — unknown tool name",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "toolName": "grafana_delete_everything",
        "args": {}
      }
    },
    "response": {
      "status": 400,
      "body": {
        "ok": false,
        "error": "UNKNOWN_TOOL",
        "message": "No tool registered with name 'grafana_delete_everything'"
      }
    }
  }
]
```