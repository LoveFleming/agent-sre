# Phase 0 設計：SRE 多 Agent 編排核心

> ADR-002 決策文件。目標：讓 Commander 能自主派工給其他 agent，實現多 Agent 編排排查。

## 架構概覽

```
使用者 → POST /api/chat (crewId: sre.commander)
                    │
                    ▼
         ┌─────────────────────┐
         │   Commander Agent   │
         │   (張志遠 Marcus)    │
         │                     │
         │  1. 判斷嚴重程度     │
         │  2. task_decompose   │ ← tool
         │  3. dispatch_agent   │ ← tool (核心)
         │  4. 綜合報告         │
         └──┬──────────────────┘
            │ dispatch_agent("metrics", "查 payment p99")
            ▼
         ┌─────────────────────┐
         │  Nested Agent Loop  │  ← 新增邏輯
         │  crew = sre.metrics │
         │  啟動子 agent-loop   │
         │  Wendy 用 PromQL    │
         │  查資料 → 回傳結果   │
         └─────────────────────┘
            │
            ▼
         Commander 收到結果 → 分析 → 派下一個 → ... → 報告
```

---

## 新增檔案清單

```
tools/orchestrator/           ← 新增 provider 目錄
├── handler.mjs               ← dispatch_agent + task 管理邏輯
├── config.json               ← orchestrator 設定 (maxRounds, timeout)
└── tools/
    ├── dispatch_agent.json   ← tool definition
    ├── task_decompose.json   ← tool definition
    ├── task_list.json        ← tool definition
    └── task_update.json      ← tool definition
```

**現有檔案修改：**

| 檔案 | 修改內容 |
|---|---|
| `crews/sre.commander.json` | `toolGroups` 加入 `"orchestrator"` |
| `server/agent-loop.mjs` | `getCrewTools` 支援 `toolGroups` → tool name 映射 |
| (選改) `server/routes.mjs` | `/api/chat` 回傳 dispatch 過程事件 |

---

## 1. dispatch_agent Tool

### 1.1 Tool Definition (`tools/orchestrator/tools/dispatch_agent.json`)

```json
{
  "name": "dispatch_agent",
  "description": "派工給指定的 SRE agent 執行排查任務。Agent 會用自己的工具查資料並回傳結果。一次派一個 agent，等結果回來再派下一個。",
  "parameters": {
    "type": "object",
    "properties": {
      "agentId": {
        "type": "string",
        "description": "目標 agent ID。可用: metrics, logs, runbook, responder, security",
        "enum": ["metrics", "logs", "runbook", "responder", "security"]
      },
      "task": {
        "type": "string",
        "description": "明確的任務描述。要具體：查什麼 metric、查什麼 log、查什麼 SOP。範例: '查 payment-service 最近 5 分鐘 p99 latency'"
      }
    },
    "required": ["agentId", "task"]
  }
}
```

### 1.2 Handler 邏輯 (`tools/orchestrator/handler.mjs`)

```javascript
// 偽碼 — 實際程式碼交給 Developer

import { getCrew } from "../../server/crew-loader.mjs";
import { runAgentLoop } from "../../server/agent-loop.mjs";
import { toolRegistry } from "../../server/tool-registry.mjs";

// agentId → crewId 映射
const CREW_MAP = {
  metrics:   "sre.metrics",
  logs:      "sre.logs",
  runbook:   "sre.runbook",
  responder: "sre.responder",
  security:  "sre.security",
};

// 子 agent 不挂載 dispatch_agent（防止無限遞迴）
const SUB_AGENT_BLOCKED_TOOLS = ["dispatch_agent", "task_decompose"];

export default async function handler(args, ctx) {
  switch (ctx.toolName) {
    case "dispatch_agent":
      return handleDispatch(args, ctx);

    case "task_decompose":
      return handleTaskDecompose(args, ctx);

    case "task_list":
      return handleTaskList(args, ctx);

    case "task_update":
      return handleTaskUpdate(args, ctx);
  }
}

async function handleDispatch({ agentId, task }, ctx) {
  const crewId = CREW_MAP[agentId];
  if (!crewId) {
    return { text: `❌ 未知 agent: ${agentId}。可用: metrics, logs, runbook, responder, security`, error: true };
  }

  const crew = getCrew(crewId);
  if (!crew) {
    return { text: `❌ Crew 定義不存在: ${crewId}`, error:  true };
  }

  // 啟動 nested agent loop — 子 agent 用自己的 tools
  try {
    const result = await runAgentLoop({
      crew,
      message: task,
      history: [],              // 子 agent 不帶歷史
      maxRounds: 3,             // 限制子 agent 的 tool-call 輪數
      timeoutMs: 30_000,        // 30 秒 timeout
      // 過濾掉 dispatch 相關 tool（防遞迴）
      toolFilter: (name) => !SUB_AGENT_BLOCKED_TOOLS.includes(name),
    });

    return {
      text: `📋 **${crew.title} (${crew.codename})** 回報:\n\n${result.content}`,
      data: {
        agentId,
        agentName: crew.codename,
        toolCallCount: result.toolCallCount,
        content: result.content,
      },
    };
  } catch (err) {
    return { text: `❌ ${crew.codename} 執行失敗: ${err.message}`, error: true };
  }
}
```

### 1.3 關鍵設計約束

| 約束 | 值 | 理由 |
|---|---|---|
| 子 agent maxRounds | 3 | 避免子 agent 自己無限循環 |
| 子 agent timeout | 30s | 避免單個 agent 卡住整個排查 |
| 子 agent 不挂載 dispatch | — | 防止無限遞迴 |
| 子 agent 不帶 history | [] | 每次派工都是獨立任務 |
| dispatch 是同步的 | true | LLM tool-call 本來就是同步 |
| Commander maxRounds | 10 | 給足夠空間做多步驟排查 |

---

## 2. Task Management Tools

### 2.1 task_decompose

Commander 用來拆分大問題為具體的排查步驟。

```json
{
  "name": "task_decompose",
  "description": "將一個複雜的 SRE 問題拆解為具體的排查步驟。每個步驟需指派 agent 和明確任務。",
  "parameters": {
    "type": "object",
    "properties": {
      "problem": { "type": "string", "description": "問題描述" },
      "severity": { "type": "string", "enum": ["P0", "P1", "P2", "P3"] },
      "steps": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "stepId":   { "type": "string", "description": "步驟編號, 如 'step-1'" },
            "agent":    { "type": "string", "enum": ["metrics", "logs", "runbook", "responder", "security"] },
            "task":     { "type": "string", "description": "具體任務描述" },
            "reason":   { "type": "string", "description": "為什麼要查這個" }
          },
          "required": ["stepId", "agent", "task"]
        }
      }
    },
    "required": ["problem", "steps"]
  }
}
```

### 2.2 task_list / task_update

追蹤排查進度，結果存到 in-memory store。

```json
{
  "name": "task_list",
  "description": "列出目前排查計畫的所有步驟及其狀態。",
  "parameters": { "type": "object", "properties": {} }
}
```

```json
{
  "name": "task_update",
  "description": "更新排查步驟的狀態。",
  "version": 1,
  "parameters": {
    "type": "_agent_loop.mjs getCrewTools_ 支援 toolGroups → tool name 映射",
    "properties": {
      "stepId":   { "type": "string" },
      "status":   { "type": "string", "enum": ["pending", "in-progress", "done", "failed", "skipped"] },
      "result":   { "type": "string", "description": "該步驟的發現或結果摘要" }
    },
    "required": ["stepId", "status"]
  }
}
```

---

## 3. agent-loop.mjs 修改

### 問題

目前 `getCrewTools(crew, allTools)` 只支援 `crew.allowedTools`（工具白名單），但 crew JSON 裡用的是 `toolGroups`（工具組），兩者沒有對應。

```javascript
// 現有 (有 bug)
function getCrewTools(crew, allTools) {
  if (!crew?.allowedTools?.length) return allTools; // 沒有限制就回傳全部
  return allTools.filter(...);
}
```

### 修改方案

新增 `toolGroups` → tool name 映射表：

```javascript
// 新增：toolGroup → tool name 映射
const TOOL_GROUP_MAP = {
  "core-read":      [],  // 不掛 tool, 或基礎查詢
  "memory":         [],  // Phase 3
  "decisions":      [],  // Phase 3
  "tasks":          [],  // Phase 3
  "dispatch":       [],  // legacy, 由 orchestrator 替代
  "orchestrator":   ["dispatch_agent", "task_decompose", "task_list", "task_update"],
  "sre-prometheus": ["query_promql", "prom_query_range", "list_alerts"],
  "sre-grafana":    ["grafana_list_dashboards", "grafana_get_dashboard", "grafana_query_panel", ...],
  "sre-loki":       ["query_logs", "log_stats"],
  "sre-k8s":        ["kubectl_get", "kubectl_describe", "kubectl_logs", "kubectl_top", "kubectl_apply"],
  "sre-shell":      ["exec_command", "health_check"],
  "sre-security":   ["scan_rbac", "check_ssl", "scan_deps"],
  "sre-docs":       ["read_runbook", "list_runbooks"],
};

function getCrewTools(crew, allTools) {
  // 新邏8: 支援 toolGroups
  if (crew?.toolGroups?.length) {
    const allowedNames = new Set();
    for (const group of crew.toolGroups) {
      const names = TOOL_GROUP_MAP[group] || [];
      names.forEach(n => allowedNames.add(n));
    }
    return allTools.filter(t => {
      const name = t.function?.name || t.name;
      return allowedNames.has(name);
    });
  }

  // 舊邏輯保留
  if (crew?.allowedTools?.length) {
    return allTools.filter(t => {
      const name = t.function?.name || t.name;
      return crew.allowedTools.includes(name);
    });
  }

  return allTools; // 沒限制 = 全部
}
```

**同時需要修改 `runAgentLoop`：**

新增 `maxRounds` 和 `toolFilter` 參數，用於子 agent 的資源限制。

```javascript
export async function runAgentLoop({
  crew, message, history = [], model,
  onToolCall,
  maxRounds = 10,         // ← 新增 (預設 10)
  timeoutMs,             // ← 新增 (可選 timeout)
  toolFilter = null,      // ← 新增 (可過濾 tool)
}) {
  // ... 在 tool-call loop 中:
  //   if (round >= maxRounds) break;
  //   tools = toolFilter ? tools.filter(t => toolFilter(t.function?.name || t.name)) : tools;
}
```

---

## 4. crew JSON 修改

### `crews/sre.commander.json`

```diff
  "toolGroups": [
-   "core-read",
-   "memory",
-   "decisions",
-   "tasks",
-   "dispatch"
+   "core-read",
+   "orchestrator"        ← 加 orchestrator 組，移除無對應 tool 的 dispatch
  ],
```

其他 crew 不需修改——它們的 toolGroups 不包含 orchestrator，自然就不會拿到 dispatch_agent。

---

## 5. 資料流完整走讀

### 場景：使用者問「payment-service latency 突然飆高，查一下」

```
1. POST /api/chat { crewId: "sre.commander", message: "payment-service latency 突然飆高" }

2. agent-loop 啟動 Commander:
   - system prompt = Commander rolePrompt
   - tools = orchestrator 組 → [dispatch_agent, task_decompose, task_list, task_update]

3. LLM 思考 → tool_call: task_decompose({
     problem: "payment-service latency 飆高",
     severity: "P1",
     steps: [
       { stepId: "step-1", agent: "metrics", task: "查 payment p99 latency 最近 5 分鐘" },
       { stepId: "step-2", agent: "logs",    task: "查 payment error log 最近 5 分鐘" },
       { stepId: "step-3", agent: "runbook", task: "查 latency 飆高的 SOP" }
     ]
   })
   → handler 存到 task store, 回傳確認

4. LLM 思考 → tool_call: dispatch_agent({ agentId: "metrics", task: "查 payment p99 latency..." })

5. dispatch_agent handler:
   - getCrew("sre.metrics") → Wendy
   - runAgentLoop({ crew: Wendy, message: task, maxRounds: 3 })
   - Wendy 用 query_promql tool 查資料
   - Wendy 回報: "payment p99 從 200ms → 3.2s, 開始時間 14:32"

6. tool result 回到 Commander context

7. LLM 思考 → tool_call: task_update({ stepId: "step-1", status: "done", result: "p99 200ms→3.2s @14:32" })

8. LLM 思考 → tool_call: dispatch_agent({ agentId: "logs", task: "查 payment error log..." })
   → 趙明軒查 Loki → "大量 ConnectionPoolExhausted @14:33"

9. LLM 思考 → tool_call: dispatch_agent({ agentId: "runbook", task: "查 latency SOP" })
   → 林雅婷查 docs → "SOP-042: Connection Pool 耗盡處置"

10. LLM 收齊結果 → 生成最終報告:

    ## 🔍 排查報告
    問題: payment-service latency 飆高
    嚴重程度: P1
    根因: Connection pool 耗盡 → 請求堆積 → latency 暴增
    建議: 依 SOP-042 重啟 connection pool
```

---

## 6. 錯誤處理策略

| 情況 | 處理 |
|---|---|
| 子 agent timeout | dispatch_agent 回傳 error，Commander 可決定重試或換方向 |
| 子 agent LLM 失敗 | dispatch_agent 回傳 error message |
| dispatch_agent 無對應 agentId | 回傳可用 agent 列表提示 |
| 子 agent 查不到資料 | 正常回傳（「查無相關 metrics」），Commander 判斷 |
| 遞迴呼叫（子 agent 試圖 dispatch） | 被工具過濾擋住，子 agent 看不到 dispatch_agent |

---

## 7. 驗收標準

1. ✅ `GET /api/tools` 能看到 `dispatch_agent`, `task_decompose`, `task_list`, `task_update`
2. ✅ Commander 的 tool 列表只包含 orchestrator tools（不包含 prometheus/loki 等）
3. ✅ 在 Console 對 Commander 說「查一下系統狀態」，Commander 能 dispatch 給 metrics agent
4. Console 停止 — 需要確認 streaming 時 dispatch 過程是否可見
5. ✅ 其他 crew (Metrics 等) 看不到 dispatch_agent tool
6. ✅ dispatch 失敗（錯誤 agentId）有清楚的錯設計原則
7. ✅ 子 agent 不會無限遞迴

---

## 8. 實作順序（給 Developer）

1. 新增 `tools/orchestrator/tools/*.json`（4 個 tool definition）
2. 新增 `tools/orchestrator/handler.mjs`
3. 修改 `server/agent-loop.mjs` — getCrewTools 支援 toolGroups + maxRounds/toolFilter 參數
4. 修改 `crews/sre.commander.json` — toolGroups 加 orchestrator
5. 重啟 server → `GET /api/tools` 驗證
6. 在 Console 測試 dispatch
```
```