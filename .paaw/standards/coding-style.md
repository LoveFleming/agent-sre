# Coding Standards — agent-sre

## 1. Coding Rules

### Naming Conventions

| Artifact | Convention | Example |
|---|---|---|
| Files & directories | `kebab-case` | `src/routes/agents.js`, `dev/mocks/tchat-mock.mjs` |
| React components | `PascalCase` file name, named export | `src/ui/AgentsPage.jsx` |
| Functions | `camelCase` | `createRun`, `sendChat`, `watchdogLoop` |
| Classes | `PascalCase` | `class RunRepository` |
| Variables | `camelCase` | `agentId`, `notifyError` |
| Constants | `UPPER_SNAKE_CASE` | `DEFAULT_RETENTION_DAYS` |
| Private functions | `_camelCase` prefix | `_normalizeSchedule` |
| Test files | `*.test.js` / `*.spec.js` | `src/runs/run.test.js` |
| Mock files | `*-mock.mjs` | `tchat-mock.mjs`, `grafana-mock.mjs` |

### File Organization

```
src/
  server.js              # entry point, Express bootstrap
  routes/                # HTTP route definitions only
  scheduler/             # scheduling logic
  runs/                  # run domain logic
  agents/                # agent domain logic
  tchat/                 # tchat transport adapter
  grafana/               # grafana adapter
  watchdog/              # health monitoring loop
  models/                # data models / persistence
  ui/                    # React components
test/                    # unit/integration tests
dev/mocks/               # development mock servers
config/                  # environment config
```

- Each domain module owns its logic and exports a small public API.
- Route files contain no business logic; they delegate to domain modules.
- Models are plain data definitions with file persistence.
- Mock servers live under `dev/mocks/`, never in `src/`.

### Import Ordering

1. Node.js built-ins (`node:path`, `node:fs`)
2. External dependencies (`express`, `node-cron`)
3. Internal project modules (`../runs`, `../../models/run`)
4. Relative imports within the same module (`./run`)

Separate groups with a blank line. No unused imports.

### Export Patterns

- **Named exports** for utilities, services, and domain functions: `export function createRun()`, `export const router`.
- **Default exports** only for React page/component entry points: `export default function AgentsPage()`.
- Avoid mixing default and named exports in the same file unless the default is the primary component and named exports are subcomponents/hooks.
- Index files (`index.js`) re-export the module’s public API.

## 2. Architecture Rules

### Layer Dependencies

```
routes → services/domain modules → models
routes → scheduler, runs, agents
scheduler → runs
agents → runs
watchdog → tchat, grafana
ui → api (HTTP only)
```

- **Allowed:** A module may depend on modules listed in its `dependsOn` map.
- **Forbidden:** A domain module must not depend on `routes`.
- **Forbidden:** A model must not depend on services or routes.
- **Forbidden:** UI code must not import server-side modules directly; it communicates via HTTP API.

### Module Boundaries

- No cross-package imports without a documented reason.
- If module A needs functionality from module B, add B to A’s `dependsOn` and export the needed function.
- Do not reach into another module’s internal files; use its public exports.
- Keep the dependency graph acyclic. New dependencies must not create cycles.

### Separation of Concerns

- **Routes:** Parse request, validate input, call one service function, format response.
- **Services/Domain:** Business logic, scheduling, run lifecycle, external integrations.
- **Models/Data:** Persistence, schema, field definitions.
- **Adapters (tchat, grafana):** Isolate external protocol details; expose simple async functions.
- **Watchdog:** Orchestration only; no HTTP route logic.

## 3. Pattern Guidelines

### Error Handling

- Use `try/catch` around all external calls (tchat, grafana, file I/O).
- Propagate errors to the route layer; do not swallow exceptions in services.
- Route handlers catch errors and return a consistent JSON error response:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Human-readable message"
  }
}
```

- Use HTTP status codes: `400` for validation, `404` for missing resources, `500` for unexpected failures.
- Log errors with context (`agentId`, `runId`, `operation`) before returning.
- Do not leak stack traces or internal paths to API clients.

### Async Patterns

- Use `async/await` for all asynchronous operations.
- Never use `.then()` chains for new code.
- External calls must be awaited inside `try/catch`.
- Use `Promise.all` for independent concurrent calls; avoid sequential awaits when calls do not depend on each other.
- Scheduler/watchdog loops should handle rejections explicitly to prevent unhandled promise rejections.

### State Management

- File-based persistence for models (Run, Agent, Task).
- Keep state transitions explicit: `pending → running → succeeded | failed`.
- Run records include `fingerprint`, `notifyError`, and `notified` tri-state fields.
- Do not store derived state; compute it from source fields.
- UI state is local to React components; shared state should be lifted to a common parent or a lightweight store only when necessary.

### API Response Format

- Success responses are plain JSON objects or arrays:

```json
{
  "data": { ... }
}
```

- List endpoints support `limit` and deterministic sort tie-breakers (e.g., `id`).
- Create/update endpoints return the full updated resource.
- Error responses follow the format in Error Handling above.
- All endpoints must validate input before processing.

### Testing Patterns

- Unit tests live next to source files as `*.test.js` or in `test/`.
- Critical paths must be tested: scheduler, run creation/update, agent manual run, watchdog e2e.
- Use deterministic fixtures; no reliance on real external services.
- Mock external services via `dev/mocks/` or test doubles.
- Test names describe behavior: `should create a run with fingerprint`, `should reject invalid schedule`.
- Run `npm test` before committing.

## 4. Quality Checklist

- [ ] No hardcoded secrets or credentials in source code
- [ ] Error handling for all external calls (tchat, grafana, file I/O)
- [ ] Input validation on all API endpoints
- [ ] Consistent naming conventions followed
- [ ] No circular dependencies
- [ ] Tests cover critical paths (scheduler, runs, agents, watchdog)
- [ ] No unused imports or dead code
- [ ] API responses follow the standard success/error format
- [ ] New modules export a minimal public API
- [ ] Dependencies are declared in `package.json` and justified
- [ ] `npm audit` reports no known vulnerabilities
- [ ] Mock servers are confined to `dev/mocks/` and excluded from production builds