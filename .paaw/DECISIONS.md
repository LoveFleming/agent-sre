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

