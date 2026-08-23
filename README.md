# Agent SRE

> Standalone AI SRE Agent Crew — Kubernetes, Prometheus, Loki operations.
> **SRE Agentic Monitoring Workspace** — Connect an MCP → Create a Monitor → Persistent Agent Instance → Start monitoring.
> Zero PAAW dependency. Runs on Node.js 20+.

## Quick Start

```bash
# 1. Configure LLM provider
cp config/providers.example.json config/providers.json
# Edit providers.json — add your API keys

# 2. Start server
npm start

# 3. Chat with SRE commander
curl -X POST http://localhost:4200/api/chat \
  -H "Content-Type: application/json" \
  -d '{"crewId":"sre.commander","message":"檢查目前叢集狀態"}'
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health + loaded tools |
| GET | `/api/crews` | List all SRE crew members |
| GET | `/api/crews/:id` | Get crew detail |
| GET | `/api/tools` | List registered tools |
| POST | `/api/chat` | Chat with a crew member |
| GET/POST | `/api/monitors` | List / create monitors (MonitorDefinition) |
| GET/PUT/DELETE | `/api/monitors/:id` | Monitor detail / update / delete |
| POST | `/api/monitors/:id/run` | Run Now (manual agent loop) |
| GET/POST | `/api/monitors/:id/chat` | Agent-scoped chat history / send |
| GET/PUT | `/api/monitors/:id/memory` | Memory viewer/editor (knowledge/incident) |
| GET | `/api/monitors/:id/runs` | Execution history |
| GET | `/api/monitor-meta` | Pickers (sources / flows / outputs) |
| GET | `/api/conversations/:crewId` | Load conversation history |
| POST | `/api/conversations/:crewId` | Save conversation |
| DELETE | `/api/conversations/:crewId` | Clear conversation |
| POST | `/api/conversations/:crewId/archive` | Archive + start fresh |

### Chat API

```json
// POST /api/chat
{
  "crewId": "sre.commander",
  "message": "檢查所有 pod 的狀態",
  "stream": false,
  "model": "glm-5.1"
}
```

Streaming (SSE):

```json
{
  "crewId": "sre.metrics",
  "message": "查詢過去 1 小時的 CPU 使用率",
  "stream": true
}
```

## 👥 Crew Members

| Emoji | ID | Codename | Role |
|-------|----|----------|------|
| 🎖️ | sre.commander | 張志遠 Marcus | SRE 大總管 |
| 📊 | sre.metrics | 蘇婉清 Wendy | Metrics 分析師 |
| 📋 | sre.logs | 趙明軒 Ming | Log 分析師 |
| 🔧 | sre.responder | 黃志強 Victor | 事件處置員 |
| 📖 | sre.runbook | 林雅婷 Abby | Runbook 專員 |
| 🔒 | sre.security | 陳如芸 Ruby | 安全檢查員 |

## 🔧 Tool Providers

| Provider | Config | Tools |
|----------|--------|-------|
| Kubernetes | `tools/k8s/config.json` | kubectl_get/describe/logs/top/apply |
| Prometheus | `tools/prometheus/config.json` | query_promql, prom_query_range, list_alerts |
| Loki | `tools/loki/config.json` | query_logs, log_stats |
| Security | `tools/security/config.json` | check_ssl, scan_deps, scan_rbac |
| Shell | `tools/shell/config.json` | exec_command, health_check |
| Docs | `tools/docs/config.json` | list_runbooks, read_runbook |

## 📁 Structure

```
agent-sre/
├── config/
│   ├── providers.json          # LLM provider config
│   └── providers.example.json
├── crews/                      # 6 SRE crew definitions
├── tools/                      # 6 tool providers
├── server/
│   ├── index.mjs               # Entry point
│   ├── config.mjs              # Config + LLM resolver
│   ├── llm.mjs                 # LLM API caller (retry + streaming)
│   ├── agent-loop.mjs          # Core agent loop (tool-use + multi-round)
│   ├── tool-registry.mjs       # Tool registration system
│   ├── tool-loader.mjs         # Auto-discover tool providers
│   ├── crew-loader.mjs         # Load crew definitions
│   ├── conversation.mjs        # File-based conversation storage
│   └── routes.mjs              # HTTP API routes
├── data/                       # Runtime data (conversations, configs)
└── package.json
```

## License

Private — LoveFleming
