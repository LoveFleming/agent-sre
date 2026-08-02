# Technical Decisions

> 記錄架構和技術決策 (ADR format)。AI 在做決策時會自動追加。

## ADR-001: Agent SRE Platform 首頁導航架構 — 七層選單設計
- **日期**: 2026-08-01
- **狀態**: Proposed
- **背景**: 目前 SREConsole.tsx 將 Console 和 Dashboard 塞在同一頁的兩個 tab，缺少平台層級的導航。使用者無法一眼看到 agents、tools、tasks 的全貌。使用者想做一個 SRE agent 平台，核心概念是「人開發工具、訂規則，由 AI agent 自動執行」。現有元件已具備：6 個 SRE crew agents、8 個 tool providers、commander 自主派工（task_decompose + dispatch_agent）、SREDashboard 儀表板、Agent Console 對話介面。
- **決定**: 採用左側欄固定導航，7 個一級選單：
1. 🏠 Home — 平台概覽（狀態卡片 + 大總管快捷入口 + Quick Actions + 最近任務）
2. 👥 Agents — Agent 管理（6 個 SRE crew 的卡片 + 詳情頁）
3. 🔧 Tools — Tool 管理（8 個 provider 按組分組 + 測試面板）
4. 📋 Tasks — 自動化任務中心（commander 派發的排查步驟可視化）
5. 📊 Monitor — 系統監控（搬移現有 SREDashboard）
6. 💬 Console — 大總管對話（搬移現有 Agent Console）
7. ⚙️ Config — 設定管理

實作分 7 個 Phase，Phase 1（導航框架 + Home）為基礎，Phase 6（Tasks + Task API）為核心新功能。
- **後果**: 正面：
- 清晰的平台層級導航，使用者 3 秒內了解系統全貌
- Agents/Tools/Tasks 分離，各自獨立管理
- 大部分頁面（Monitor/Console/Tools）是重組現有元件，effort 可控

負面：
- Phase 6 Tasks 需要後端新增 task store + API，是目前最大的工作量
- 需要逐步淘汰舊版 ui/src/App.tsx，過渡期可能有兩套 UI 共存
- 左側欄在小螢幕上需要額外處理響應式（摺疊/抽屜）

## ADR-002: SRE 多 Agent 編排架構 — Nested Agent Loop + dispatch_agent tool
- **日期**: 2026-08-02
- **狀態**: Proposed
- **背景**: 現有系統有 6 個 SRE crew 角色（Commander, Metrics, Logs, Runbook, Responder, Security）和 27 個工具，但 Commander 的 system prompt 中引用了 dispatch_agent / task_decompose 功能，這些 tool 並不存在於 tool registry。導致 Commander 無法真正調度其他 agent，只能自己回答問題。

使用者需求：SRE agent 有多個角色、有指揮官調度、對外 tool 可以抓資料分析、有 status 可以記錄。

評估了三種方案：
1. Nested Agent Loop — dispatch_agent 作為 tool，內部啟動子 agent loop
2. Task Queue + Worker — 需要 Redis/RabbitMQ，過度設計
3. Event-Driven (pub/sub) — 非同步整合成本高
- **決定**: 採用方案 A：Nested Agent Loop。

dispatch_agent 作為一個註冊在 tool registry 的 tool，當 Commander 呼叫時：
1. 取得目標 crew 定義（getCrew）
2. 啟動 nested runAgentLoop（子 agent 用自己的 tools 查資料）
3. 子 agent 回傳結果
4. 結果作為 tool result 回到 Commander 的 context
5. Commander 基於結果決定下一步

同步執行模式（一次派一個 agent，等結果再派下一個）。理由：
- 貼合現有架構，agent-loop.mjs 已有完整的 runAgentLoop
- 只需新增 orchestrator tool provider，不需引入外部依賴
- LLM 的 tool-calling 本來就是同步的，最自然
- 非 sync 的平行 dispatch 可以在 Phase 2+ 考慮

新增 tool provider 結構：tools/orchestrator/
- handler.mjs — dispatch_agent, task_decompose, task_list, task_update
- tools/dispatch_agent.json — tool definition
- tools/task_decompose.json — tool definition
- tools/task_list.json — tool definition
- tools/task_update.json — tool definition
- **後果**: 優點：
- 最小改動實現多 Agent 編排，複用現有 runAgentLoop
- Commander 可以真正自主排查（拆分→逐個派工→綜合報告）
- 不需引入 Redis/MQ 等外部基礎設施
- 每個子 agent 繼承自己的 toolGroups，權限隔離自然

缺點 / 風險：
- 同步執行 → 如果派 5 個 agent 會依序等待，總時間 = Σ各 agent 耗時
- 需要處理 nested agent loop 的遞迴深度（dispatch_agent 內不能再 dispatch）
- LLM token 消耗較大（每個子 agent 都要獨立 LLM call）
- 錯誤處理需要完善（子 agent 超時/失敗不應中斷整個排查）

緩解：
- 設定子 agent 的 maxRounds 較低（3-4 輪）
- 子 agent 不挂載 dispatch_agent（防止遞迴）
- 設定子 agent timeout（30s）
- Phase 2 可加 Promise.all 平行 dispatch

