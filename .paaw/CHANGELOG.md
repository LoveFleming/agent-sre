# Changelog

## 2026-08-16
### added
- 新增 /api/agents CRUD endpoints（TASK-002）：GET/POST /api/agents、GET/PUT/DELETE /api/agents/:id，資料層 agent-store.mjs；/api/tasks 過渡期保留並標記 deprecated:true；埋 scheduler notifier hook 供 ADR-003 scheduler 接線



### changed
- code changes (1 new file) (2 modified)

### added
- TASK-015：所有 /api/* 動態 endpoint 加入 X-API-Token auth（值從 AGENT_SRE_API_TOKEN env，timingSafeEqual 常數時間比對），失敗回 401 { error: unauthorized }；/api/health 與靜態檔案豁免；env 未設時 dev-mode 放行並於啟動 log 警告。CORS allow-list 加入 X-API-Token。

### added
- 所有 /api/* endpoints（/api/health 與靜態檔案除外）要求 X-API-Token header，值從 env AGENT_SRE_API_TOKEN 讀取，crypto.timingSafeEqual 常數時間比對（長度先比對）。失敗回 401 { error: "unauthorized" }。env 未設時放行（dev mode）並於啟動時 log 警告。routes.test.mjs 新增 401/dev-mode/exempt 案例（41→50），全套 250/250 綠。

### changed
- code changes (3 modified)

### changed
- +44 −29 lines across 2 files

## 2026-08-15
### changed
- 實作 TASK-001：server/agent-store.mjs — file-based Agent Registry 持久化。

【必讀 context (1 new file) (2 modified)



> 由 PAAW AI-Native IDE 自動維護。每次 AI 完成任務後自動追加變更記錄。


### changed
- +8919 −9636 lines across 61 files
