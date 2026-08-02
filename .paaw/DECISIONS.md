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

## ADR-003: SRE 定時巡檢架構 — Scheduler + Inspection Engine + 閾值過濾 + tChat 告警
- **日期**: 2026-08-02
- **狀態**: Proposed
- **背景**: 使用者需求是「定時讀 Grafana dashboard 全部圖表給 AI 解讀，有問題丟公司 tChat channel 通知值班」。現有系統已是聊天互動架構，缺「定時觸發」與「大批 panel 巡檢」兩塊。核心成本風險：全量丟 AI 解讀很貴很慢，需過濾層。
- **決定**: 在現有 agent-sre 上新增「定時巡檢」能力：新增 Scheduler（排程器）+ Inspection Engine（巡檢執行器）。巡檢策略採 B（閾值/規則先行過濾，只有異常 panel 才丟 AI 解讀，控制 token 成本）。任務管理先採 config-driven（jobs/*.json），後續再補 UI。通知走 tchat_send 到值班 channel。
- **後果**: 需要新增 scheduler + inspection modules、jobs 設定檔、閾值規則、通知封裝。相較聊天架構是獨立一層，不影響現有 chat。過濾層降低 token 成本但需定義閾值；初期可用簡單規則，後續可讓 AI 學習。

## ADR-004: 不採用 MCP，使用 Direct Tool Implementation
- **日期**: 2026-08-02
- **狀態**: Proposed
- **背景**: 專案需要決定工具架構層是走 MCP（Model Context Protocol）還是 direct tool implementation。目前專案同時存在兩套機制：tool-registry（direct）和 mcp-client/mcp-server（MCP）。評估後認為 SRE Agent 是單一 server 自用場景，工具都是內部整合（Grafana/Prometheus/Loki/K8s），不需要跨 process 通訊或標準化協議。
- **決定**: 移除 MCP server/client 程式碼（TASK-003），保留 tool-registry + tool-loader 的 direct tool implementation。MCP 相關的 mcp-server.mjs、mcp-client.mjs、mcp-servers.example.json 全數刪除。未來若有外接需求（例如要讓 Claude Desktop 或其他應用連入）再重新引入 MCP。
- **後果**: 優點：減少程式碼複雜度、零網路 overhead、好 debug、啟動更快。缺點：未來若要讓外部應用共用工具，需要重新加回 MCP 層。

