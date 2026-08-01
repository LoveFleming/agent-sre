# Agent SRE Platform — 實作路線圖

> **ADR-001** 的執行計畫。7 個 Phase，按優先序排列。
> **核心概念**：人開發工具、訂規則，由 AI agent 自動執行。

---

## Phase 總覽

| Phase | 名稱 | 目標 | Effort | 涉及後端？ |
|-------|------|------|--------|:---------:|
| 1 | 導航框架 + Home | 側欄導航 + 平台首頁 | M | ❌ |
| 2 | Agents 頁 | Agent 管理介面（列表 + 詳情） | S | ❌ |
| 3 | Tools 頁 | Tool 管理介面（分組 + 測試面板） | M | ❌ |
| 4 | Monitor 頁 | 搬移 SREDashboard + 適配 imports | M | ❌ |
| 5 | Console 頁 | 搬移 SREConsole 的聊天功能 | M | ❌ |
| 6 | **Tasks 頁** | **自主任務中心（核心新功能）** | **L** | ✅ |
| 7 | Config 頁 | Provider / Crew 設定管理 | S | ❌ |

---

## Phase 1：導航框架 + Home 頁
- **狀態**：✅ 設計完成 → [詳細設計](PHASE-1-DESIGN.md)
- **新增**：`Sidebar.tsx`, `HomePage.tsx`, `Placeholder.tsx`, `types.ts`
- **改寫**：`App.tsx`（從 chat/tools 兩 tab → 7-view 導航框架）

## Phase 2：Agents 頁
- Agent 列表（6 個 crew 的卡片網格）
- 點擊查看詳情（expertise、toolGroups、greeting）
- 「開始對話」按鈕 → 跳轉 Console 並預設選中該 agent
- 資料來源：`GET /api/crews` + `GET /api/crews/:id`

## Phase 3：Tools 頁
- 按 provider 分組展示（grafana / prometheus / k8s / loki / security / shell / tchat / docs）
- 每個 tool 顯示 name + description + parameter schema
- Tool 測試面板：選 tool → 填 args → 執行 → 看結果
- 資料來源：`GET /api/tools`
- 測試 API：`POST /api/chat`（帶 tool call）或新增 `POST /api/tools/test`

## Phase 4：Monitor 頁
- 搬移 `ui/SREDashboard.tsx` 到新框架
- 修復 import 路徑（`../api` 等 standalone 不存在的路徑）
- Provider 狀態卡片 + Alert 摘要 + Quick PromQL

## Phase 5：Console 頁
- 搬移 `ui/SREConsole.tsx` 的聊天功能到新框架
- 修復 import 路徑
- 多對話 tab + Model selector + Quick Actions
- 保留現有 App.tsx 的 chat 邏輯為基礎

## Phase 6：Tasks 頁（核心新功能）
- **後端新增**：
  - `GET /api/tasks` — 列出任務
  - `GET /api/tasks/:id` — 任務詳情（含 sub-tasks）
  - `POST /api/tasks` — 建立任務（觸發 commander 自主執行）
  - Task persistence（SQLite 或 file-based）
- **前端**：
  - 任務列表（status: pending / running / done / failed）
  - 任務詳情：排查步驟時間線（每個 dispatch_agent 的結果）
  - 即時更新（SSE 或 polling）

## Phase 7：Config 頁
- LLM Provider 設定（讀寫 `config/providers.json`）
- Crew 設定（查看 / 編輯 crew JSON）
- Tool Provider 設定（查看 / 編輯 config.json）

---

## 依賴順序

```
Phase 1 (導航框架)
  ├── Phase 2 (Agents)     ─┐
  ├── Phase 3 (Tools)      ─┤ 可以平行開發
  ├── Phase 4 (Monitor)    ─┤
  ├── Phase 5 (Console)    ─┘
  │
  ├── Phase 6 (Tasks)      ← 需要 Phase 5 的 console 功能
  └── Phase 7 (Config)     ← 獨立，最後做
```

Phase 1 完成後，Phase 2-5 可以平行開發（互不依賴）。Phase 6 是最大的工作量。
