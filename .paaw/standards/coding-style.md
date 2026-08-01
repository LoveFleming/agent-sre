# Coding Standards — agent-sre

## 1. Coding Rules

### Naming Conventions
- **Files & Directories:** Use `kebab-case` for all filenames and directories (e.g., `mcp-server.ts`, `grafana-provider.ts`). Exception: React component files may use `PascalCase.tsx` (e.g., `ChatTab.tsx`).
- **Classes & Interfaces:** Use `PascalCase` (e.g., `class McpServer`, `interface ChatMessage`). Append `Interface` or prefix with `I` only if strictly necessary, prefer clean `PascalCase`.
- **Functions & Variables:** Use `camelCase` (e.g., `startServer`, `const grafanaTools`).
- **React Components:** Use `PascalCase` for component declarations and JSX tags.
- **Constants:** Use `UPPER_SNAKE_CASE` for global or environment-level constants (e.g., `const MAX_RETRIES = 3`).
- **TypeScript Types:** Use `PascalCase` (e.g., `type McpTool = { ... }`).

### File Organization Patterns
- Group files by domain/feature rather than file type (e.g., keep provider logic, types, and utilities within `src/tools/grafana/`).
- React components belong in `src/web/` and must avoid containing backend or MCP protocol logic.
- Shared types should be centralized at the module root (e.g., `src/mcp/types.ts`, `src/web/types.ts`).

### Import Ordering Rules
Organize imports in the following order, separated by blank lines:
1. Node.js built-in modules (`node:http`, `node:path`).
2. External dependencies (`react`, `vite`, `express`/`http` frameworks).
3. Internal absolute paths (`@/mcp/client`, `@/tools/grafana` — assuming path aliases are configured).
4. Relative paths (`./types`, `../utils`).
5. Type-only imports (use `import type { ... }`).

### Export Patterns
- **Tool Providers & Utilities:** Always use **Named Exports** (e.g., `export const grafanaTools`, `export class McpServer`).
- **React Components:** Use **Named Exports** to maintain consistency across the UI layer. Avoid default exports to prevent inconsistent naming during refactoring.

---

## 2. Architecture Rules

### Layer Dependencies
The architecture follows a unidirectional top-down dependency flow:
1. **Presentation Layer (`src/web`)**: Depends *only* on the HTTP API Layer (`src/server` via fetch) and its own UI state/types. It must never import server-side or MCP internal code directly.
2. **API Layer (`src/server.ts`)**: Depends on the MCP Client (`src/mcp/client`) and the SRE Crew (`src/crew`).
3. **Orchestration Layer (`src/crew`)**: Depends on the MCP Client and Tool definitions.
4. **Protocol Layer (`src/mcp`)**: The Client depends on the Server interface; the Server depends on the Tool Providers.
5. **Tool Provider Layer (`src/tools/*`)**: Depends strictly on the MCP protocol interfaces (`src/mcp/types.ts`) and external APIs (Grafana, Telegram). 

*Rule: Lower layers must never import from higher layers (e.g., `src/tools` cannot import from `src/web`).*

### Module Boundaries
- Tool providers (e.g., `tool-grafana` and `tool-tchat`) are strictly isolated. **No cross-tool imports** are allowed. They should only communicate via the MCP Server.
- The Web UI must not tightly couple to specific tool names; it should dynamically render tools discovered via `GET /api/tools`.

### Separation of Concerns
- **Routes vs. Logic vs. Data:** HTTP route handlers in `server.ts` must only handle HTTP request/response parsing and validation. Core execution must be delegated to the MCP Client or Crew orchestrator.
- Tool Providers must separate API data-fetching logic from MCP input/output schema mapping.

---

## 3. Pattern Guidelines

### Error Handling Pattern
*(Addresses Tech Debt: No error code taxonomy)*
- Establish a centralized error taxonomy in `src/errors.ts`.
- **External Calls:** All external API calls (Grafana, Telegram, LLMs) must be wrapped in `try/catch` blocks.
- **Error Mapping:** Normalize external API errors into a standard `AppError` class containing:
  - `code` (e.g., `GRAFANA_API_ERROR`, `LLM_TIMEOUT`)
  - `message` (safe for client display)
  - `details` (context-specific debugging info)
- **API Responses:** HTTP handlers must catch `AppError` instances and return the mapped HTTP status code (4xx for client/bad inputs, 5xx for upstream failures).

### Async Patterns
- Enforce `async/await` over Promise chaining (`.then()`).
- Never swallow errors in async functions without logging or rethrowing a normalized `AppError`.
- Always validate external responses before processing data.

### State Management Patterns
- **Backend:** Currently in-memory only. State must be encapsulated within class instances (e.g., `McpServer`, `SreCrew`) or exported singletons. Avoid global mutable variables.
- **Frontend:** Use React Context or lightweight state managers (e.g., Zustand) for cross-component state (like `ChatTab` arrays or active model selections). Use custom hooks (`useChat`, `useTools`) to isolate data-fetching logic from UI components.

### API Response Format Conventions
*(Addresses Tech Debt: No API request/response schemas)*
- All API endpoints must define Request and Response schemas using **Zod**.
- Standardize API JSON responses to an envelope format:
  ```json
  {
    "success": true,
    "data": { ... }
  }
  ```
  On error:
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Input validation failed for field 'tabId'"
    }
  }
  ```

### Testing Patterns
*(Addresses Tech Debt: No test suite)*
- **Framework:** Use `Vitest` (aligns with the Vite ecosystem).
- **Unit Tests:** Write tests adjacent to the source file (e.g., `grafana-provider.test.ts`) for tool logic and schema validation. Mock external HTTP calls using tools like `msw` (Mock Service Worker).
- **Integration Tests:** Test the MCP round-trip (`client` -> `server` -> `provider`).
- **Coverage Requirement:** Ensure tests cover all critical paths: MCP tool registration, tool execution, and the core React component rendering lifecycle.

---

## 4. Quality Checklist

Before submitting any Pull Request, verify the following:

- [ ] No hardcoded secrets, API keys, or tokens (use environment variables).
- [ ] Error handling implemented for all external calls (Grafana, Telegram, LLMs).
- [ ] Input validation (via Zod or similar) applied to all incoming API payloads (`POST /api/chat`, `/api/tools/test`).
- [ ] Consistent naming conventions applied (files: `kebab-case`, classes: `PascalCase`).
- [ ] No circular dependencies introduced between MCP server, client, and tools.
- [ ] Tests added/updated to cover critical paths and new tool providers.
- [ ] API responses correctly utilize the standard JSON envelope format.
- [ ] React components do not contain backend/MCP protocol logic.