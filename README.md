# SRE Agentic Monitoring

> **Connect an MCP → Create a Monitor → Persistent Agent Instance → Start monitoring.**
> Zero PAAW dependency. Runs on Node.js 20+.

The monitor workspace IS the app: left monitor menu, outer tab sheet, agent chat.
Closing a tab never stops the backend agent — the scheduler and agent loop keep running.

## Quick Start

```bash
# 1. Configure LLM provider
cp config/providers.example.json config/providers.json
# Edit providers.json — add your API keys

# 2. Start server
npm start

# 3. Open the workspace
#    http://localhost:4200/ — Create your first monitor from the UI
```

Optional: fake Grafana source for local testing — `npm run mock:grafana`.

## Domain model (spec)

- **MonitorDefinition** — scheduler / SourceMCP[] / ProcessFlow / AgentConfiguration (rules+prompt+skills) / MemoryPolicy / OutputMCP[]
- **AgentInstance** — persistent runtime state + 4 memory types (knowledge / incident / conversation / working)
- **Process Flow** — first-class object, deterministic vs agentic nodes; 3 templates (Standard SRE / Alert Triage / Release Watch)
- **Scheduler** — cron per enabled monitor, healthy = quiet (zero LLM calls), Run Now shares the same path

## API (behind `X-API-Token` when `AGENT_SRE_API_TOKEN` is set)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health + loaded tools |
| GET/POST | `/api/monitors` | List / create monitors (MonitorDefinition) |
| GET/PUT/DELETE | `/api/monitors/:id` | Monitor detail / update / delete |
| POST | `/api/monitors/:id/run` | Run Now (manual agent loop) |
| GET/POST | `/api/monitors/:id/chat` | Agent-scoped chat history / send |
| GET/PUT | `/api/monitors/:id/memory` | Memory viewer/editor (knowledge/incident) |
| GET | `/api/monitors/:id/runs` | Execution history |
| GET | `/api/monitor-meta` | Pickers (sources / flows / outputs) |
