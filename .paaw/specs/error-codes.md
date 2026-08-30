The source scan in your context did not include numeric line numbers, so the Line column below is expressed as the originating route/handler. Verify and re-scan before treating the row as committed SRE documentation.

## 1. Error Code Registry

**File: `.paaw/specs/error-codes.md`**

```markdown
# agent-sre Error Code Registry

> Generated from project scan + git history.
> Line/Handler identifies the code location that raises the error.

| Error Code | Message | HTTP Status | Feature | File | Line/Handler | Runbook |
|-----------|---------|-------------|---------|------|------------------------------|---------|
| API-001 | Invalid query parameter | 400 | API | src/routes/runs.js | GET /api/runs handler | .paaw/operations/runbooks/api-001.md |
| API-002 | Invalid request body | 400 | API | src/routes/agents.js | POST /api/agents/:id/run handler | .paaw/operations/runbooks/api-002.md |
| AGT-001 | Agent not found | 404 | Agent Management | src/agents/index.js | getAgent() | .paaw/operations/runbooks/agt-001.md |
| AGT-002 | Agent definition invalid | 500 | Agent Management | src/agents/index.js | validateAgent() | .paaw/operations/runbooks/agt-002.md |
| AGT-003 | Agent execution failed | 500 | Agent Management | src/agents/index.js | runAgent() | .paaw/operations/runbooks/agt-003.md |
| RUN-001 | Run record not found | 404 | Runs | src/runs/store.js | findRun() | .paaw/operations/runbooks/run-001.md |
| RUN-002 | Run store read/write failed | 500 | Runs | src/runs/store.js | readRuns()/writeRuns() | .paaw/operations/runbooks/run-002.md |
| SCH-001 | Invalid cron expression | 400 | Scheduler | src/scheduler/index.js | scheduleTask() | .paaw/operations/runbooks/sch-001.md |
| SCH-002 | Scheduled run execution failed | 500 | Scheduler | src/scheduler/index.js | runScheduledTask() | .paaw/operations/runbooks/sch-002.md |
| TCH-001 | tchat send failed | 502 | tchat Integration | src/tchat/transport.js | sendChat() | .paaw/operations/runbooks/tch-001.md |
| TCH-002 | tchat payload rejected | 400 | tchat Integration | src/tchat/transport.js | validateMessage() | .paaw/operations/runbooks/tch-002.md |
| MOCK-001 | Malformed tchat mock request | 400 | Mock Server | dev/mocks/tchat-mock.mjs | POST /api/messages | .paaw/operations/runbooks/mock-001.md |
| MOCK-002 | Mock sent-log write failed | 500 | Mock Server | dev/mocks/tchat-mock.mjs | appendSentLog() | .paaw/operations/runbooks/mock-002.md |
| GRA-001 | Grafana send failed | 502 | Grafana | src/grafana/index.js | sendMetric() | .paaw/operations/runbooks/gra-001.md |
| GRA-002 | Grafana fetch failed | 502 | Grafana | src/grafana/index.js | fetchAlerts() | .paaw/operations/runbooks/gra-002.md |
| WDG-001 | Watchdog loop failed | 500 | Watchdog | src/watchdog/index.js | watchdogLoop() | .paaw/operations/runbooks/wdg-001.md |
| WDG-002 | Task state sync failed | 500 | Watchdog | src/watchdog/state-sync.js | syncTaskState() | .paaw/operations/runbooks/wdg-002.md |
| SYS-500 | Unexpected internal error | 500 | System | src/server.js | globalErrorMiddleware() | .paaw/operations/runbooks/sys-500.md |
```

---

## 2. API → Exception → Error Code → Runbook Chain

```text
POST /api/agents/:id/run
  ├─ API-002: Invalid request body (400) → .paaw/operations/runbooks/api-002.md
  ├─ AGT-001: Agent not found (404) → .paaw/operations/runbooks/agt-001.md
  ├─ AGT-002: Agent definition invalid (500) → .paaw/operations/runbooks/agt-002.md
  ├─ AGT-003: Agent execution failed (500) → .paaw/operations/runbooks/agt-003.md
  ├─ RUN-002: Run store write failed (500) → .paaw/operations/runbooks/run-002.md
  └─ SYS-500: Unexpected internal error (500) → .paaw/operations/runbooks/sys-500.md


GET /api/runs
  ├─ API-001: Invalid query parameter (400) → .paaw/operations/runbooks/api-001.md
  ├─ RUN-002: Run store read failed (500) → .paaw/operations/runbooks/run-002.md
  └─ SYS-500: Unexpected internal error (500) → .paaw/operations/runbooks/sys-500.md


POST /api/messages  (tchat mock server)
  ├─ MOCK-001: Malformed tchat mock request (400) → .paaw/operations/runbooks/mock-001.md
  ├─ MOCK-002: Mock sent-log write failed (500) → .paaw/operations/runbooks/mock-002.md
  └─ SYS-500: Unexpected internal error (500) → .paaw/operations/runbooks/sys-500.md


Scheduler — scheduleTask()
  ├─ SCH-001: Invalid cron expression (400) → .paaw/operations/runbooks/sch-001.md
  ├─ SCH-002: Scheduled run execution failed (500) → .paaw/operations/runbooks/sch-002.md
  └─ RUN-002: Run store write failed (500) → .paaw/operations/runbooks/run-002.md


tchat transport — sendChat()
  ├─ TCH-002: tchat payload rejected (400) → .paaw/operations/runbooks/tch-002.md
  └─ TCH-001: tchat send failed (502) → .paaw/operations/runbooks/tch-001.md


watchdog — watchdogLoop()
  ├─ GRA-001: Grafana send failed (502) → .paaw/operations/runbooks/gra-001.md
  ├─ GRA-002: Grafana fetch failed (502) → .paaw/operations/runbooks/gra-002.md
  ├─ TCH-001: tchat send failed (502) → .paaw/operations/runbooks/tch-001.md
  ├─ WDG-002: Task state sync failed (500) → .paaw/operations/runbooks/wdg-002.md
  └─ WDG-001: Watchdog loop failed (500) → .paaw/operations/runbooks/wdg-001.md
```

---

## 3. Runbooks

### `.paaw/operations/runbooks/api-001.md`

```markdown
# API-001: Invalid Query Parameter

| Field | Value |
|---|---|
| Error Code | API-001 |
| HTTP Status | 400 |
| Location | src/routes/runs.js |

## Symptom
- `GET /api/runs?limit=abc` returns `400 Bad Request`
- API response contains a message such as `Invalid query parameter`

## Root Cause
- Route code expects a positive integer for `limit`
- Query parameter is not a number, is negative, or exceeds the allowed maximum
- Unsupported filter parameter used

## Debugging Steps
1. Reproduce the request exactly and capture the URL/query string.
2. Inspect `src/routes/runs.js` validation block.
3. Validate parameter with:
   - `Number.parseInt(req.query.limit, 10)`
   - Ensure the result is finite and ≥ 0.
4. Check frontend calls in `src/api/` for accidental `undefined` values.

## Fix
- Reject non-integer `limit` values with `400`.
- Apply sane bounds: for example `1 <= limit <= 1000`.
- Provide a clear error message: `Invalid limit; expected an integer between 1 and 1000`.

## Related Code
- Handler: `src/routes/runs.js`
- Run store: `src/runs/store.js`
- Test: `test/runs.test.js`
```

### `.paaw/operations/runbooks/api-002.md`

```markdown
# API-002: Invalid Request Body

| Field | Value |
|---|---|
| Error Code | API-002 |
| HTTP Status | 400 |
| Location | src/routes/agents.js |

## Symptom
`POST /api/agents/:id/run` returns `400` while body is invalid.

## Root Cause
- Missing JSON body
- Invalid JSON syntax
- Required fields absent
- Wrong `Content-Type: application/json` header

## Debugging Steps
1. Replay request with `curl --json '...'`.
2. Check route middleware:
   - Express `express.json()` present
   - `Content-Type` header correct
3. Inspect validation code in `src/routes/agents.js`.

## Fix
- Add schema validation before invoking `runAgent()`.
- Return a list of missing/invalid fields in the error message.
- Add tests for missing and malformed JSON.

## Related Code
- Handler: `src/routes/agents.js`
- Model: `src/models/agent.js`
- Test: `test/agents.test.js`
```

### `.paaas/operations/runbooks/agt-001.md`

```markdown
# AGT-001: Agent Not Found

| Field | Value |
|---|---|
| Error Code | AGT-001 |
| HTTP Status | 404 |
| Location | src/agents/index.js |

## Symptom
`POST /api/agents/:id/run` returns `404` with message `Agent not found`.

## Root Cause
- Agent ID is misspelled in request URL
- Agent definition file does not contain an agent with that ID
- Agent was removed but a run/scheduler reference still exists

## Debugging Steps
1. Confirm the requested agent ID:
   - URL: `/api/agents/agent-001/run`
2. Search the agent store for the exact ID.
3. Inspect scheduler records for orphaned agent references.
4. Verify file permissions prevent reading the agent file.

## Fix
- If the ID is misspelled, correct the request.
- If the agent is deleted, restore from git history or re-add the agent definition.
- If the error occurs during scheduled runs, correct or remove the stale scheduler entry.

## Related Code
- Agent module: `src/agents/index.js`
- Route: `src/routes/agents.js`
- Agent model: `src/models/agent.js`
```

### `.paas/operations/runbooks/agt-002.md`

```markdown
# AGT-002: Agent Definition Invalid

| Field | Value |
|---|---|
| Error Code | AGT-002 |
| HTTP Status | 500 |
| Location | src/agents/index.js |

## Symptom
- API returns `500` even before running the agent.
- Logs show an agent validation failure.

## Root Cause
- Agent definition is missing required fields, e.g. `id`, `name`, `expertise`, or `schedule`
- Agent executor/command path is invalid
- Agent manifest JSON is corrupted

## Debugging Steps
1. Read the full error log.
2. Open the agent definition store source.
3. Validate each agent against the expected schema.
4. Check for trailing commas or other corrupted JSON.

## Fix
- Fix the agent definition file.
- Add a schema validator and fail fast at startup.
- Log the offending agent ID and the validation error, not only a generic message.

## Related Code
- Agent loader: `src/agents/index.js`
- Model: `src/models/agent.js`
- Test: `test/agent.test.js`
```

### `.paow/operations/runbooks/agt-003.md`

```markdown
# AGT-003: Agent Execution Failed

| Field | Value |
|---|---|