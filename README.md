# Agent SRE — AI Site Reliability Engineering Crew

> AI-powered SRE agent crew with tool providers for Kubernetes, Prometheus, Loki, and more.

Extracted from [PAAW](https://github.com/LoveFleming/tPAAW) as an independent, reusable SRE agent module.

## 👥 Crew Members

| Emoji | Codename | Role | Expertise |
|-------|----------|------|-----------|
| 🎖️ | 張志遠 Marcus | SRE 大總管 | 事件協調、On-Call 排班、風險評估 |
| 📊 | 蘇婉清 Wendy | Metrics 分析師 | PromQL、Grafana、SLO/SLI 監控 |
| 📋 | 趙明軒 Ming | Log 分析師 | Loki LogQL、Error cluster、Stack trace |
| 🔧 | 黃志強 Victor | 事件處置員 | K8s 操作、擴容縮容、降級策略 |
| 📖 | 林雅婷 Abby | Runbook 專員 | SOP、故障樹、事後檢討文件 |
| 🔒 | 陳如芸 Ruby | 安全檢查員 | 漏洞掃描、RBAC、SSL/TLS 審計 |

## 🔧 Tool Providers

| Provider | Tools | Description |
|----------|-------|-------------|
| **Prometheus** | query_promql, prom_query_range, list_alerts | Metrics querying & alerting |
| **Loki** | query_logs, log_stats | Log aggregation & search |
| **Kubernetes** | kubectl_get/describe/logs/apply/top | Cluster operations |
| **Security** | check_ssl, scan_deps, scan_rbac | Security audits |
| **Shell** | exec_command, health_check | Remote shell execution |
| **Docs** | list_runbooks, read_runbook | Runbook knowledge base |

## 📁 Structure

```
agent-sre/
├── crews/           # 6 SRE crew member definitions (JSON)
├── tools/           # 6 tool providers with handlers & tool defs
├── ui/              # React components (SREConsole + SREDashboard)
├── server/          # API routes + tool registry
│   ├── sre.mjs             # SRE REST API
│   ├── tool-registry.mjs   # Tool registration system
│   ├── tool-registry-init.mjs
│   └── tool-engine/
│       └── provider.mjs    # Tool provider framework
└── README.md
```

## 🔗 Integration with PAAW

This module is designed to plug into PAAW's architecture:
- Crew definitions load via PAAW's crew system
- Tool providers register via the shared tool registry
- UI components mount as PAAW pages
- Server routes mount as PAAW API routes

## 📜 License

Private — LoveFleming
