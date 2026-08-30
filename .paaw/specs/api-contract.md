# API Contract — agent-sre

## Agent Management APIs

### POST /api/agents/:id/run
- **Description:** Manually trigger a run for a specific agent.
- **Feature:** Agent Management
- **File:** src/routes/agents.js
- **Handler:** `runAgent` (from `src/agents`)
- **Auth:** Not specified (assumed none)
- **Request Body:** None (no body expected)
- **Path Parameters:**
  | Param | Type | Required | Description |
  |-------|------|----------|-------------|
  | id | string | Yes | Agent ID |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | id | string | Run ID |
  | agentId | string | Agent ID |
  | schedule | string | Cron schedule of the agent |
  | status | string | Run status (e.g., "running") |
  | fingerprint | string | Unique fingerprint of the run |
  | notifyError | boolean | Whether to notify on error |
  | notified | boolean | Whether notification was sent |
  | createdAt | string | ISO timestamp |
  | updatedAt | string | ISO timestamp |
- **Response 404:** Agent not found
- **Response 500:** Internal server error
- **Calls:** `getAgent()`, `createRun()`, `runAgent()`

## Run Management APIs

### GET /api/runs
- **Description:** List all run records.
- **Feature:** Run Management
- **File:** src/routes/runs.js
- **Handler:** `listRuns` (from `src/runs`)
- **Auth:** Not specified (assumed none)
- **Query Parameters:**
  | Param | Type | Required | Description |
  |-------|------|----------|-------------|
  | limit | number | No | Maximum number of runs to return (default: 100) |
  | agentId | string | No | Filter by agent ID |
  | status | string | No | Filter by status (e.g., "success", "error") |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | runs | array | List of Run objects |
  | total | number | Total number of runs matching filters |
- **Response 500:** Internal server error
- **Calls:** `listRuns()`

## tchat Integration APIs (Mock)

### POST /api/messages
- **Description:** Send a chat message via tchat (mock server for development).
- **Feature:** tchat Integration
- **File:** dev/mocks/tchat-mock.mjs
- **Handler:** `tchatMock` (mock server handler)
- **Auth:** Not specified (assumed none)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | channel | string | Yes | Target channel (e.g., "general") |
  | text | string | Yes | Message content |
  | username | string | No | Sender username (default: "agent-sre") |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | ok | boolean | Success flag |
  | message | string | Confirmation message |
- **Response 400:** Invalid request body
- **Response 500:** Internal server error
- **Calls:** None (mock endpoint, writes to `tchat-sent.jsonl`)

---

# API Examples (JSON)

```json-examples
[
  {
    "method": "POST",
    "endpoint": "/api/agents/agent-001/run",
    "description": "Manually trigger a run for agent-001",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "params": { "id": "agent-001" }
    },
    "response": {
      "status": 200,
      "body": {
        "id": "run-123",
        "agentId": "agent-001",
        "schedule": "0 9 * * *",
        "status": "running",
        "fingerprint": "abc123def456",
        "notifyError": true,
        "notified": false,
        "createdAt": "2026-08-17T10:00:00.000Z",
        "updatedAt": "2026-08-17T10:00:00.000Z"
      }
    }
  },
  {
    "method": "GET",
    "endpoint": "/api/runs",
    "description": "List all runs with optional filters",
    "request": {
      "headers": { "Accept": "application/json" },
      "params": { "limit": 10, "agentId": "agent-001", "status": "success" }
    },
    "response": {
      "status": 200,
      "body": {
        "runs": [
          {
            "id": "run-123",
            "agentId": "agent-001",
            "schedule": "0 9 * * *",
            "status": "success",
            "fingerprint": "abc123def456",
            "notifyError": true,
            "notified": true,
            "createdAt": "2026-08-17T09:00:00.000Z",
            "updatedAt": "2026-08-17T09:05:00.000Z"
          }
        ],
        "total": 1
      }
    }
  },
  {
    "method": "POST",
    "endpoint": "/api/messages",
    "description": "Send a chat message via tchat mock",
    "request": {
      "headers": { "Content-Type": "application/json" },
      "body": {
        "channel": "general",
        "text": "Agent run completed successfully",
        "username": "agent-sre"
      }
    },
    "response": {
      "status": 200,
      "body": {
        "ok": true,
        "message": "Message sent"
      }
    }
  }
]
```