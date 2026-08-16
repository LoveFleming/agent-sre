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

### changed
- code changes (1 new file) (4 modified)

### changed
- +81 −80 lines across 5 files

### added
- TASK-004 run-store 補齊：fingerprint/notifyError 欄位、notified 三態（null=未觸發通知場景）、GET /api/runs ?limit= 參數（無效 → 400）、每 agent 保留 200 筆 retention（SRE_RUNS_RETENTION 可覆寫）。測試全套 283/283 綠。

### changed
- code changes (4 modified)

### changed
- +36 −46 lines across 3 files

### changed
- code changes (1 modified)

### changed
- +115 −76 lines across 10 files

### changed
- code changes (1 new file) (2 modified)

### changed
- +109 −86 lines across 7 files

### changed
- code changes (1 new file) (2 modified)

### changed
- +133 −80 lines across 7 files

### changed
- code changes (1 new file) (2 modified)

### changed
- +137 −80 lines across 7 files

### added
- feat(api): POST /api/agents/:id/run 手動觸發 agent 立即執行（TASK-006）— 202 + runId 非同步執行、404 agent 不存在、409 已有 run 進行中、400 無效 id；不受 enabled/schedule 限制，與 cron tick 共用 executeScheduledRun 執行路徑與 in-flight 鎖。scheduler 新增 beginRun() 同步入口供 route 在回應前鎖定。

### changed
- code changes (3 modified)

### changed
- +216 −815 lines across 10 files

### changed
- code changes (1 modified)

### changed
- +234 −820 lines across 11 files

### changed
- code changes (1 new file) (3 modified)

### changed
- +222 −837 lines across 11 files

### changed
- code changes (1 new file) (1 modified)

### changed
- +224 −840 lines across 11 files

### changed
- code changes (1 new file) (4 modified)

### changed
- +250 −862 lines across 12 files

### changed
- code changes (1 new file) (2 modified)

### changed
- +283 −877 lines across 13 files

### changed
- +283 −877 lines across 13 files

### changed
- 實作 TASK-011：datasource-store.mjs + /api/datasources CRUD（token 於回應一律 mask 成 "***"；PUT 傳 "***"/空/缺省 = 保留原值）。存檔時 hot-sync 到 tools/<id>/config.json，provider 免重啟。前置已就緒：TASK-001 agent-store 模式沿用、TASK-015 X-API-Token auth 保護。修復 comment 內 `tools/*/config.json` 導致的 vitest parse 失敗（`*/` 提前終止 block comment），並補齊 6 個 /api/datasources API samples。(2 new files) (4 modified)

### changed
- +964 −360 lines across 9 files

### fixed
- 修復 TASK-011 遺留的測試 parse 失敗並完成結案。

已診斷出 root cause：你新寫的 server/datasource-store.m (3 modified)

### changed
- +1151 −367 lines across 11 files

## 2026-08-15
### changed
- 實作 TASK-001：server/agent-store.mjs — file-based Agent Registry 持久化。

【必讀 context (1 new file) (2 modified)



> 由 PAAW AI-Native IDE 自動維護。每次 AI 完成任務後自動追加變更記錄。


### changed
- +8919 −9636 lines across 61 files
