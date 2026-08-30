# Technical Decisions

> 記錄架構和技術決策 (ADR format)。AI 在做決策時會自動追加。

## ADR-001: ADR-003: SRE Watchdog Agent Platform 核心架構
- **日期**: 2026-08-15
- **狀態**: Proposed
- **背景**: 需要 cron 定時讀 Grafana 判斷異常並通知 tchat 值班，且 agent 定義（context/rules/tools/schedule）要可透過 UI+API 管理並持久化。現況：crews 是靜態 JSON 需重啟、TaskStore 是 in-memory 重啟即失、只有人工觸發 agent loop。
- **決定**: 1) Agent Registry 採 file-based agents/*.json（沿用 conversation.mjs 模式），取代 in-memory TaskStore（Task/Agent 概念合一，舊 /api/tasks 過渡期 deprecated）。2) Scheduler 用 node-cron（最小粒度 1 分鐘），進程內嵌、agent 更新動態重排、run timeout 5 分鐘、同 agent 不併發。3) 通知不是 pipeline 而是 agent 的 tool call：agent 在 loop 內自主完成「讀 Grafana alerts → 判斷 → tchat_send_message 通知」，通知目標（notifyTarget: targetType + targetId）存在 agent 定義。4) 異常判斷以 Grafana alerts API 客觀狀態（firing/pending）優先、LLM 負責綜合判斷與措辭，減少幻覺誤報。5) 防洗爆：alert fingerprint + cooldown（預設 30 分鐘，可按 agent 覆寫）。
- **後果**: 優點：通知內容有 LLM 上下文、新增通知管道零架構改動、agent 定義可持久化可排程。風險：LLM 誤判需靠 alert 客觀狀態緩解；in-memory Task 退役需過渡期；scheduler 進程內嵌表示 server 重啟會漏跑（單機規模可接受，未來可抽獨立 worker）。

## ADR-002: ADR-004: tchat transport 抽層（ports & adapters）與契約 v0
- **日期**: 2026-08-15
- **狀態**: Proposed
- **背景**: 公司 tchat 不是 Telegram Bot API 相容，但現有 tools/tchat/handler.mjs 是寫死的 Telegram client（api.telegram.org、data.ok、result.message_id），transport 遲早整段重寫。開發期無測試環境，需 mock-first。
- **決定**: tchat handler 拆成 ports & adapters 兩層：工具層（參數驗證/格式化，LLM 介面 tchat_send_message 永不變）+ client.mjs transport 層（唯一可換檔案）。契約 v0 定義：POST {url}/api/messages，body { targetType: "user"|"channel", targetId: string, text: string }，回應 200 { ok: true, messageId: string } 或 4xx/5xx { ok: false, error: string }。開發期以契約 v0 實作 localhost mock server（grafana mock 照標準 Grafana API、tchat mock 照自家契約）。讀歷史/讀未讀兩工具標 deprecated 待公司 API 確認後再定義。進公司 swap 清單：僅換 client.mjs + config 加公司 url/token + 用公司 API 重測一輪，其餘全部不動。
- **後果**: 優點：開發不被 infra 卡住、mock 同時是 API 契約文件、通知路徑全程經真實 handler 程式碼測試。風險：契約 v0 是未見公司 API 前的抽象，靠極簡（僅 send）降低偏離風險；進公司後需以公司 API 重跑一輪通知驗證。

