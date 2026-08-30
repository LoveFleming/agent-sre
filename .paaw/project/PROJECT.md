# agent-sre

> An SRE agent management web application that schedules, executes, records, and monitors recurring agent runs, with a React UI and integrations for tchat and Grafana.

## Quick Links

- [Architecture Map](ARCHITECTURE.md)
- [Feature Map](features/FEATURES.json)
- [API Contract](specs/api-contract.md)
- [Error Codes](specs/error-codes.md)
- [Coding Standards](standards/coding-style.md)
- [Code Intelligence](code-intelligence/summary.json)
- [Security Scan](security/scan-results.json)

## Tech Stack

- **Project Type:** Web application
- **Backend Language:** JavaScript (Node.js)
- **Frontend Language:** TypeScript / JSX (`src/main.tsx`)
- **Backend Framework:** Express
- **Frontend Build Tool:** Vite (pinned to 5.4.21)
- **Scheduler:** node-cron
- **Storage:** File-based JSON models (`Run`, `Agent`, `Task`)
- **External Integrations:** tchat (contract v0), Grafana
- **Development Mocks:** tchat mock server, Grafana mock server
- **Testing:** Unit/e2e tests under `test/`
- **Security:** `npm audit` currently reports 0 vulnerabilities

## Architecture Overview

agent-sre is a modular monolith. The Express server exposes an HTTP API for agent and run management, while domain modules — `routes`, `agents`, `runs`, `scheduler`, `tchat`, `grafana`, and `watchdog` — maintain clear boundaries and avoid circular dependencies. Data models are persisted as file-backed JSON records.

The frontend is a Vite/React application that communicates with the Express API and provides an agent management/oversight UI. The scheduler uses `node-cron` to run agents according to configured schedules, while the watchdog module monitors system health, synchronizes task state, and coordinates tchat/Grafana notifications. Local mock servers for tchat and Grafana allow development and e2e tests without external service dependencies.

## Features

- **Agent Management** — Define agents with `id`, `name`, `expertise`, and `schedule`.
- **Manual Run Triggering** — Manually start an agent run via `POST /api/agents/:id/run`.
- **Scheduled Execution** — Schedule recurring agent runs using `node-cron`.
- **Run Tracking** — Record, list, filter, and retain run records with status, fingerprint, and notification state.
- **Retention Controls** — Apply limits and retention behavior to the run store.
- **tchat Integration** — Contract v0 transport layer for sending chat messages.
- **Grafana Integration** — Send metrics and fetch alerts from Grafana.
- **Watchdog** — Health monitoring, task-state synchronization, and Grafana-coupled alerting.
- **Development Mocks** — Standalone mock servers for tchat (`:3002`) and Grafana.
- **Admin UI** — React-based `AgentsPage` for agent/task oversight and manual triggers.

## Getting Started

### Prerequisites

- Node.js 18+ (or the version required by the Vite/Express setup)
- npm

### Installation

```bash
npm install
```

### Running

The mock tchat server can be started with:

```bash
npm run mock:tchat
```

The mock tchat server listens on port `3002` and logs sent messages to `dev/mocks/tchat-sent.jsonl` by default. The path can be configured via the `TCHAT_SENT_LOG` environment variable.

Additional dev/start scripts are defined in `package.json`. The Express API entry point is `src/server.js`; the Vite frontend entry point is `src/main.tsx`.

### Testing

```bash
npm test
```

E2E and watchdog-related tests are also included and can be run from the test scripts defined in `package.json`.

## Project Structure

| Path | Purpose |
|------|---------|
| `src/server.js` | Express server entry point and global error middleware |
| `src/main.tsx` | Vite/React frontend entry point |
| `src/routes/` | HTTP API route definitions (`agents`, `runs`) |
| `src/agents/` | Agent definitions, validation, and execution logic |
| `src/scheduler/` | `node-cron` scheduling engine and run recording |
| `src/runs/` | Run record store, filtering, fingerprinting, retention |
| `src/tchat/` | tchat transport layer (contract v0) |
| `src/grafana/` | Grafana metrics/alert handler |
| `src/watchdog/` | Health monitoring, task-state sync, external integration loop |
| `src/models/` | File-persisted data models: `Run`, `Agent`, `Task` |
| `src/ui/` | React UI components, including `AgentsPage` |
| `dev/mocks/` | Mock servers for tchat and Grafana |
| `test/` | Unit and e2e tests |
| `.paaw/` | Project documentation, task tracking, ADRs, runbooks |

## Development

### Coding Standards

- Follow the existing JavaScript/React style used in the repository.
- Keep modules small and focused; expose explicit functions via `index.js` files.
- Use conventional commit messages with task references (e.g., `[TASK-009: ...]`).
- Avoid committing runtime artifacts such as `dev/mocks/tchat-sent.jsonl`.
- Run `npm audit` before release; keep dependency CVEs patched.

### How to Add a New Feature

1. Create or extend the relevant domain model in `src/models/`.
2. Add the business logic as a module under `src/` (e.g., `src/agents/`, `src/runs/`).
3. Expose the module via a public `index.js` API.
4. Add an HTTP route in `src/routes/` if needed.
5. Add a UI page/component in `src/ui/`.
6. Add tests under `test/`.
7. Update the API contract and feature documentation.

### How to Add a New API Endpoint

1. Define the route in the appropriate `src/routes/` file.
2. Implement or reuse a service function in the relevant module.
3. Return standardized responses and map errors to error codes when possible.
4. Add request/response examples to `specs/api-contract.md`.
5. Add tests for success and error paths.

### How to Run Tests

Run the full test suite:

```bash
npm test
```

Run specific tests by target file, e.g.:

```bash
npx jest test/runs.test.js
```

## Operations

### Error Codes

Error codes are documented in `specs/error-codes.md` with runbooks:

- `API-001` / `API-002` — Invalid request/query parameters
- `AGT-001/002/003` — Agent not found, invalid definition, execution failure
- `RUN-001/002` — Run not found, run store failure
- `SCH-001/002` — Invalid cron expression, scheduled run failure
- `TCH-001/002` — Failed tchat send, rejected tchat payload
- `GRA-001/002` — Grafana send/fetch failure
- `WDG-001/002` — Watchdog loop failure, task-state sync failure
- `MOCK-001/002` — Mock server/client validation or persistence failure
- `SYS-500` — Unexpected internal error

### Runbooks

Detailed runbooks are maintained under `ops/runbooks/`. They describe symptoms, debugging steps, fixes, and related code/tests for each error code.

### Monitoring

- The **watchdog** module performs continuous health checks and state synchronization.
- External monitoring data can be sent to Grafana through the Grafana handler.
- Mock tchat messages are appended to `dev/mocks/tchat-sent.jsonl` for e2e verification.
- Keep `npm audit` clean to avoid known dependency vulnerabilities.
- Vite is currently pinned to `5.4.21`; before upgrading to Vite 6, resolve the “missing field module type” pre-transform error.

## Recent Changes

- **Fix Vite downgrade** — Pin Vite to `5.4.21` to fix the “missing field module type” error in Vite 6.
- **Dependency security patches** — Patch CVEs in `vite`, `esbuild`, `nanoid`; `npm audit` now reports 0 vulnerabilities.
- **Watchdog e2e coverage** — Add e2e test for watchdog, Grafana handler update, coding sessions/task state sync.
- **Datasource parse fix** — Repair block-comment parse errors in datasource files.
- **tchat mock server** — Add contract-v0 mock server on port `3002` (`POST /api/messages`), with JSONL sent-log output.
- **tchat transport layer** — Extract tchat transport into a dedicated module with contract v0 (ADR-004).
- **Grafana mock** — Add Grafana mock server dev fixture.
- **Manual agent run API** — Add `POST /api/agents/:id/run`.
- **Scheduling engine** — Add `node-cron` scheduling with run recording and invalid-cron tests.
- **Run store enhancements** — Add fingerprinting, `notifyError`, `notified` tri-state, `limit`, deterministic sorting, and retention.