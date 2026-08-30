# Architecture Map: agent-sre

## 1. System Overview

**agent-sre** is an SRE (Site Reliability Engineering) agent management web application. It allows users to define agents with specific expertise and schedules, automatically executes them via a cron-based scheduler, records run results, and integrates with external services like tchat (chat messaging) and Grafana (monitoring/alerting). The system provides a UI for agent oversight and manual triggering of runs.

**Tech Stack:**
- **Backend:** Node.js, Express (HTTP API), node-cron (scheduling)
- **Frontend:** React (via Vite), likely with TypeScript (based on `src/main.tsx`)
- **Data Persistence:** File-based (JSON files) for models (Run, Agent, Task)
- **External Integrations:** tchat (mock server for development), Grafana (mock server for development)
- **Testing:** Unit tests (test directory), e2e tests (watchdog e2e test mentioned in git log)

**Architecture Style:** Monolith with modular separation. The backend is a single Express server with clear module boundaries (routes, services, models). The frontend is a separate Vite app that communicates via HTTP API. Development mocks are included for external services.

## 2. Layer Structure

```
Presentation Layer
  - UI Components (src/ui/)
    - AgentsPage (formerly TaskManagementPage)
    - Other React components (implied)

API Layer
  - Routes (src/routes/)
    - agents.js (POST /api/agents/:id/run)
    - runs.js (GET /api/runs)
    - (implied other routes)
  - Middleware (Express middleware, not explicitly listed)

Business Logic Layer
  - Services (src/scheduler/, src/runs/, src/agents/, src/watchdog/, src/tchat/, src/grafana/)
    - scheduler: scheduleTask, runScheduler
    - runs: createRun, listRuns, updateRun
    - agents: getAgent, runAgent
    - watchdog: watchdogLoop
    - tchat: sendChat
    - grafana: sendMetric, fetchAlerts
  - Domain Models (src/models/)
    - Run (id, agentId, schedule, status, fingerprint, notifyError, notified, createdAt, updatedAt)
    - Agent (id, name, expertise, schedule)
    - Task (id, title, status)

Data Layer
  - File Storage (JSON files, persistence via file system)
  - External APIs (tchat, Grafana – via mocks in dev, real in production)

Development Support
  - Mock Servers (dev/mocks/)
    - tchat-mock.mjs (POST /api/messages)
    - grafana-mock (implied)
```

## 3. Module Dependencies

**Internal Dependencies (from scan):**
- `routes` depends on `runs`, `scheduler`, `agents`
- `scheduler` depends on `runs`
- `agents` depends on `runs`
- `watchdog` depends on `tchat`, `grafana`
- `ui` depends on `api` (HTTP API)

**Circular Dependencies:** None detected.

**External Dependencies:**
- `node-cron` (scheduling)
- Express (HTTP framework)
- Vite (frontend build tool)
- React (UI library)
- (Other npm packages inferred from package.json, but only node-cron explicitly listed)

**External Services:**
- tchat (chat messaging service)
- Grafana (monitoring/alerting)

## 4. Key Patterns

- **Modular Monolith:** Clear separation of concerns via modules (routes, services, models).
- **Repository Pattern:** Data models (Run, Agent, Task) are persisted to file storage, abstracted via service functions (e.g., `createRun`, `listRuns`).
- **Service Layer:** Business logic encapsulated in service modules (scheduler, runs, agents, watchdog).
- **REST API:** HTTP endpoints for agents and runs, with manual trigger support.
- **Scheduling Pattern:** Uses `node-cron` to schedule agent runs, with run recording.
- **State Management (Frontend):** Not explicitly detailed, but likely React state/context or hooks.
- **Error Handling:** Not explicitly defined; error codes are missing (health gap). Likely uses Express error middleware.
- **Configuration:** Environment variables (e.g., `TCHAT_SENT_LOG` for mock log path).

## 5. Entry Points

- **Server Entry Point:** `src/server.js` – starts the Express server, mounts routes, initializes scheduler.
- **UI Entry Point:** `src/main.tsx` – React application bootstrap.
- **CLI/Dev Entry Points:**
  - `dev/mocks/tchat-mock.mjs` – mock tchat server (port 3002) for development.
  - (Implied) `dev/mocks/grafana-mock` – mock Grafana server.
  - npm scripts (e.g., `mock:tchat` in package.json) to run mocks.

---

*Note: The architecture map is based on the provided scan results and git history. Some details (e.g., exact file structure, middleware) are inferred and may require further verification.*