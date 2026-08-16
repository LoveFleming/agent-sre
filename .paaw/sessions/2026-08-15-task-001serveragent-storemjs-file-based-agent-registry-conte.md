# 實作 TASK-001：server/agent-store.mjs — file-based Agent Registry 持久化。

【必讀 context — 先讀 TASK-001 notes 裡 architect 的設計結論】
TASK-001 的 notes 已有完整 SA review 設計定調（schema 驗證規則、id/檔名規則、safeResolve 用法、atomic w

**日期**: 2026-08-15
**耗時**: 556s
**結果**: ✅ 成功
**分支**: `main`

## 任務

實作 TASK-001：server/agent-store.mjs — file-based Agent Registry 持久化。

【必讀 context — 先讀 TASK-001 notes 裡 architect 的設計結論】
TASK-001 的 notes 已有完整 SA review 設計定調（schema 驗證規則、id/檔名規則、safeResolve 用法、atomic write、測試案例），嚴格照做。以下是重點摘要：

【檔案】
1. 新增 server/agent-store.mjs
2. 新增 server/agent-store.test.mjs
3. 建 agents/ 目錄（repo root，與 tools/ 同層）— 因為是空目錄不進 git，放一個 agents/README.md 說明用途即可

【實作要求】
- 只 export 4 個函式：listAgents, getAgent, saveAgent, deleteAgent
- Schema（驗證錯誤一律 throw new Error，不含 HTTP 概念）：
  - name: 必填非空（trim ≥1，上限 100）
  - description/context/prompt: 選填預設 ""
  - agentRules: {guardrails[], redirectRules[], refuseTopics[]} 三陣列，沿用 task-store typedef，未知鍵忽略
  - allowedTools: string[] 預設 []，存檔時對 toolRegistry 驗證存在，不存在 warn 不擋
  - schedule: string|null 預設 null，非 null 必須合法 cron，無效 throw
  - notifyTarget: 必填 {targetType: "user"|"channel", targetId: 非空 string}，enum 外 throw
  - cooldownMinutes: number 預設 30，必須正整數，0/負/小數 throw
  - enabled: boolean 預設 true
  - createdAt/updatedAt: store 產生 ISO，呼叫端不可覆寫
- id 由 store 產生（randomUUID），呼叫端不可指定
- getAgent/deleteAgent 外部 id → safeResolve + 檔名白名單 regex ^[a-zA-Z0-9_-]+$ 雙層防護
- safeResolve: import from "./tool-loader.mjs"，不要複製
- AGENTS_DIR = safeResolve(ROOT, "agents")，所有路徑組裝必走 safeResolve
- atomic write：writeFileSync(tmp) → renameSync，理由寫進 JSDoc
- 讀取容錯不對稱：listAgents 檔不存在回 []、壞 JSON warn+skip；getAgent 不存在回 null、壞 JSON throw
- saveAgent 區分 create（無 id）/update（有 id），update 不存在 throw 404 語意

【參考檔案 — 動手前必讀】
- server/conversation.mjs — file-based store 模式
- server/tool-loader.mjs — safeResolve
- server/task-store.mjs — agentRules typedef 要沿用的對象
- server/tool-registry.mjs — allowedTools 驗證要對照

【測試（8 案例，architect 已定）】
1. CRUD 往返 + list createdAt asc + update 只變 updatedAt
2. defaults 填充
3. 驗證 throw 案例（name 空、targetType enum 外、cooldown 0/負/小數、無效 cron）
4. path traversal（../、絕對路徑、%2e%2e、空字串）對 getAgent/deleteAgent throw
5. atomic write 間接驗證 + tmp 檔不被 listAgents 讀到
6. 髒資料：壞 JSON → listAgents skip、getAgent throw
7. delete 不存在回 null/false 不 throw
8. update 不產生新檔/孤兒檔
測試隔離：用 tmpdir 或注入 base dir，不要汙染版本控制的 agents/

【紅線】
- 不碰 routes.mjs、不碰 TaskManagementPage、不刪 task-store.mjs
- cron 驗證如果不想拉依賴，可以手寫簡單 validator（5 欄位解析）或用 package.json 已有的 dep，先查 package.json 有沒有 cron lib

完成後：跑測試（vitest）確保綠，git add 但不要 push。回報時告訴我測試怎麼跑、結果如何。

## AI 操作步驟

1× task_list
9× read_file
6× bash
3× write_file
4× edit_file
1× git
1× staged_summary
1× task_update
1× action_log_add

### 變更檔案
- `agents/README.md`
- `server/agent-store.mjs`
- `server/agent-store.test.mjs`

## Git 變更分析

### Status
```
MD .paaw/CHANGELOG.md
 M .paaw/DECISIONS.md
 D .paaw/INSPECTION-DESIGN.md
 D .paaw/PHASE-0-DESIGN.md
 D .paaw/PHASE-1-DESIGN.md
 D .paaw/PLATFORM-ROADMAP.md
AD .paaw/SECURITY-FIX-PLAN.md
MD .paaw/action-log/2026-08-02.json
 M .paaw/agents/_config.json
 M .paaw/agents/coding.architect.json
 M .paaw/agents/coding.developer.json
 M .paaw/agents/coding.doc-writer.json
 M .paaw/agents/coding.em.json
 M .paaw/agents/coding.helpdesk.json
 M .paaw/agents/coding.qa.json
 M .paaw/agents/coding.tester.json
RD .paaw/night-shift/config.json -> .paaw/auto-dispatch/config.json
AD .paaw/auto-dispatch/plans/ns-2026-08-02-agent-sre.json
AD .paaw/auto-dispatch/plans/ns-2026-08-03-agent-sre.json
AD .paaw/auto-dispatch/report.md
AD .paaw/auto-dispatch/reports/2026-08-02.md
AD .paaw/auto-dispatch/status.json
 M .paaw/changes/change-intelligence.json
 M .paaw/code-intelligence/call-graph.json
 M .paaw/code-intelligence/dependency-graph.json
 M .paaw/code-intelligence/file-map.json
MM .paaw/code-intelligence/status-cache.json
 M .paaw/code-intelligence/summary.json
 M .paaw/code-intelligence/symbol-index.json
 M .paaw/code-intelligence/test-code-map.json
 M .paaw/code-intelligence/test-intelligence.json
MM .paaw/coding-memory/actions.jsonl
 M .paaw/coding-memory/conversations/coding.architect/active.json
 D .paaw/coding-memory/conversations/coding.architect/s-2026-08-02T05-44-24.json
 D .paaw/coding-memory/conversations/coding.developer/active.json
 D .paaw/coding-memory/conversations/coding.developer/s-2026-08-01T14-06-39.json
 D .paaw/coding-memory/conversations/coding.developer/s-2026-08-02T03-10-51.json
 D .paaw/coding-memory/conversations/coding.developer/s-2026-08-02T05-50-14.json
MM .paaw/coding-memory/conversations/coding.em/active.json
 D .paaw/coding-memory/conversations/coding.em/s-2026-08-02T10-02-07.json
AD .paaw/coding-memory/conversations/coding.em/s-2026-08-02T13-11-09.json
AD .paaw/coding-memory/conversations/coding.em/s-2026-08-03T09-08-38.json
MD .paaw/coding-memory/conversations/coding.tester/active.json
MM .paaw/coding-memory/dispatch-log.jsonl
 M .paaw/cu-status.json
 M .paaw/em/config.json
 M .paaw/features/FEATURES.json
 M .paaw/features/FILE-FEATURES.json
 M .paaw/features/tree-sitter-analysis.txt
 D .paaw/logs/semgrep-2026-08-01T03-06-42-stdout.json
 D .paaw/logs/semgrep-2026-08-01T03-06-42.sh
D  .paaw/night-shift/status.json
 M .paaw/project/ARCHITECTURE.md
 M .paaw/project/PROJECT.md
 M .paaw/scan.json
 M .paaw/security/scan-results.json
MD .paaw/sessions/2026-08-02-task.md
 M .paaw/specs/api-contract.md
 M .paaw/specs/error-codes.md
MM .paaw/staged-changes.json
 M .paaw/standards/coding-style.md
MM .paaw/tasks/TASKS.json
A  agents/README.md
A  server/agent-store.mjs
A  server/agent-store.test.mjs
M  server/conversation.mjs
A  server/conversation.test.mjs
M  server/routes.mjs
A  server/routes.test.mjs
M  server/tool-loader.mjs
?? .paaw/agents/coding.handover.json
?? .paaw/agents/coding.ops.json
?? .paaw/agents/coding.rm.json
?? .paaw/auto-dispatch/plans/ns-2026-08-15-agent-sre.json
?? .paaw/deps-cache.json
?? .paaw/gates.json
?? .paaw/logs/semgrep-2026-08-15T11-20-42-stdout.json
?? .paaw/logs/semgrep-2026-08-15T11-20-42.sh
?? .paaw/metrics-cache.json
?? .paaw/sessions/2026-08-15-task-001serveragent-storemjs-file-based-agent-registry-sa-re.md
?? server/config.test.mjs
?? server/llm.test.mjs
?? server/task-store.test.mjs
?? server/tool-registry.test.mjs
```

### Diff Stat
```
.paaw/CHANGELOG.md                                 |   64 -
 .paaw/DECISIONS.md                                 |   94 +-
 .paaw/INSPECTION-DESIGN.md                         |  165 --
 .paaw/PHASE-0-DESIGN.md                            |  424 ----
 .paaw/PHASE-1-DESIGN.md                            |  291 ---
 .paaw/PLATFORM-ROADMAP.md                          |   82 -
 .paaw/SECURITY-FIX-PLAN.md                         |   58 -
 .paaw/action-log/2026-08-02.json                   |   47 -
 .paaw/agents/_config.json                          |    5 +-
 .paaw/agents/coding.architect.json                 |   19 +-
 .paaw/agents/coding.developer.json                 |    8 +-
 .paaw/agents/coding.doc-writer.json                |    7 +-
 .paaw/agents/coding.em.json                        |   11 +-
 .paaw/agents/coding.helpdesk.json                  |    7 +-
 .paaw/agents/coding.qa.json                        |   11 +-
 .paaw/agents/coding.tester.json                    |    8 +-
 .paaw/auto-dispatch/config.json                    |   22 -
 .../plans/ns-2026-08-02-agent-sre.json             |  178 --
 .../plans/ns-2026-08-03-agent-sre.json             |   54 -
 .paaw/auto-dispatch/report.md                      |  128 -
 .paaw/auto-dispatch/reports/2026-08-02.md          |  128 -
 .paaw/auto-dispatch/status.json                    |   12 -
 .paaw/changes/change-intelligence.json             | 1336 ++++++++--
 .paaw/code-intelligence/call-graph.json            |  481 ++--
 .paaw/code-intelligence/dependency-graph.json      |  938 ++++++-
 .paaw/code-intelligence/file-map.json              | 1214 +++++++--
 .paaw/code-intelligence/status-cache.json          |   23 +-
 .paaw/code-intelligence/summary.json               |   40 +-
 .paaw/code-intelligence/symbol-index.json          | 1542 ++++++++----
 .paaw/code-intelligence/test-code-map.json         |  129 +-
 .paaw/code-intelligence/test-intelligence.json     |  553 ++++-
 .paaw/coding-memory/actions.jsonl                  |   20 +-
 .../conversations/coding.architect/active.json     |  406 +--
 .../coding.architect/s-2026-08-02T05-44-24.json    |  250 --
 .../conversations/coding.developer/active.json     |  322 ---
 .../coding.developer/s-2026-08-01T14-06-39.json    |   54 -
 .../coding.developer/s-2026-08-02T03-10-51.json    |  377 ---
 .../coding.developer/s-2026-08-02T05-50-14.json    |  105 -
 .../conversations/coding.em/active.json            |   27 +-
 .../coding.em/s-2026-08-02T10-02-07.json           |  101 -
 .../coding.em/s-2026-08-02T13-11-09.json           |   27 -
 .../coding.em/s-2026-08-03T09-08-38.json           |   83 -
 .../conversations/coding.tester/active.json        |  214 --
 .paaw/coding-memory/dispatch-log.jsonl             | 2586 ++------------------
 .paaw/cu-status.json                               |   44 +-
 .paaw/em/config.json                               |    2 +-
 .paaw/features/FEATURES.json                       |  602 +++--
 .paaw/features/FILE-FEATURES.json                  |  436 +++-
 .paaw/features/tree-sitter-analysis.txt            |  310 ++-
 .paaw/logs/semgrep-2026-08-01T03-06-42-stdout.json |    1 -
 .paaw/logs/semgrep-2026-08-01T03-06-42.sh          |    4 -
 .paaw/project/ARCHITECTURE.md                      |  201 +-
 .paaw/project/PROJECT.md                           |  254 +-
 .paaw/scan.json                                    |  455 +++-
 .paaw/security/scan-results.json                   |  757 +++++-
 .paaw/sessions/2026-08-02-task.md                  |   93 -
 .paaw/specs/api-contract.md                        |  570 +++--
 .paaw/specs/error-codes.md                         |  667 +----
 .paaw/staged-changes.json                          |   23 +-
 .paaw/standards/coding-style.md                    |  259 +-
 .paaw/tasks/TASKS.json                             | 1226 ++++++++--
 61 files changed, 8919 insertions(+), 9636 deletions(-)
 .paaw/CHANGELOG.md                                 |  57 +++-
 .paaw/SECURITY-FIX-PLAN.md                         |  58 ++++
 .paaw/action-log/2026-08-02.json                   |  32 ++
 .paaw/{night-shift => auto-dispatch}/config.json   |   0
 .../plans/ns-2026-08-02-agent-sre.json             | 178 +++++++++++
 .../plans/ns-2026-08-03-agent-sre.json             |  54 ++++
 .paaw/auto-dispatch/report.md                      | 128 ++++++++
 .paaw/auto-dispatch/reports/2026-08-02.md          | 128 ++++++++
 .paaw/auto-dispatch/status.json                    |  12 +
 .paaw/code-intelligence/status-cache.json          |  10 +-
 .paaw/coding-memory/actions.jsonl                  |   8 +
 .../conversations/coding.em/active.json            |  26 +-
 .../coding.em/s-2026-08-02T13-11-09.json           |  27 ++
 .../coding.em/s-2026-08-03T09-08-38.json           |  83 +++++
 .../conversations/coding.tester/active.json        |   2 +-
 .paaw/coding-memory/dispatch-log.jsonl             | 121 +++++++
 .paaw/night-shift/status.json                      |  16 -
 .paaw/sessions/2026-08-02-task.md                  | 100 +++---
 .paaw/staged-changes.json                          |  22 +-
 .paaw/tasks/TASKS.json                             | 267 +++++++++++++++-
 agents/README.md                                   |  12 +
 server/agent-store.mjs                             | 354 +++++++++++++++++++++
 server/agent-store.test.mjs                        | 270 ++++++++++++++++
 server/conversation.mjs                            |  14 +
 server/conversation.test.mjs                       |  67 ++++
 server/routes.mjs                                  |  17 +-
 server/routes.test.mjs                             | 111 +++++++
 server/tool-loader.mjs                             |   2 +-
 28 files changed, 2079 insertions(+), 97 deletions(-)
```

## AI 回覆

TASK-001 實作完成 ✅

## 測試怎麼跑、結果

```bash
npx vitest run server/agent-store.test.mjs   # 單檔：63 passed
npx vitest run                               # 全套：8 files, 214 passed
```

**結果：** 新測試 63/63 綠；全套 214/214 綠，原有測試（routes、conversation、tool-loader、task-store、llm 等）無 regression。stderr 出現兩行 `[agent-store]` warn 是預期行為（unregistered tool 提醒、skip 壞 JSON），非錯誤。

## 實作重點

- **4 個 export**：`listAgents`（createdAt asc、壞檔 warn+skip）、`getAgent`（不存在 null、壞 JSON throw）、`saveAgent`（create/update、update 不存在 throw "not found"）、`deleteAgent`（不存在回 false 不 throw）
- **Schema 驗證**：照 notes 逐條 — name 必填 trim≥1 上限 100、agentRules 沿用 task-store typedef、allowedTools 對 toolRegistry warn 不擋、cooldownMinutes 正整數、notifyTarget enum、enabled 預設 true；id/createdAt/updatedAt store 擁有，caller 傳入剝除
- **安全**：`^[a-zA-Z0-9_-]+$` 白名單 + `safeResolve`（import 自 tool-loader，未複製）雙層防 traversal
- **Atomic write**：`writeFileSync(tmp)` → `renameSync`，理由寫在 JSDoc
- **cron validator**：查過 package.json 無 cron lib → 手寫 5 欄位數字版（支援 `*`、range、step、list），不支援命名值/Quartz
- **測試隔離**：`SRE_AGENTS_DIR` env + `mkdtempSync` tmpdir，不汙染 `agents/`
- **紅線遵守**：routes.mjs、TaskManagementPage、task-store.mjs 皆未碰

📋 **Work Summary**
├─ 改了什麼：`server/agent-store.mjs`（新，Agent Registry store）、`server/agent-store.test.mjs`（新，8 大類 63 測試）、`agents/README.md`（新，目錄說明）
├─ 為什麼改：TASK-001 — Agent Registry 持久化，取代 in-memory TaskStore 的資料層
├─ 怎麼測試：
│  1. `npx vitest run server/agent-store.test.mjs` → 預期 63 passed
│  2. `npx vitest run` → 預期 214 passed、8 個檔案
│  3. 預期結果：全綠，無 regression；stderr 兩行 `[agent-store]` warn 為預期
└─ 風險注意：saveAgent update 為 partial patch merge 語意（caller 傳什麼覆寫什麼），接 routes 時注意；cron 只認數字格式；`SRE_AGENTS_DIR` 為新環境變數（optional）
