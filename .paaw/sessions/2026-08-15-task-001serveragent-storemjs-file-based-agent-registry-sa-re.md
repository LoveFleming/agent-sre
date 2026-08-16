# 針對 TASK-001「server/agent-store.mjs — file-based Agent Registry 持久化」做設計討論（SA review），為 Developer 實作前定調。

請先讀取以下 context 再給設計結論：
1. .paaw 的 ADR-003（SRE Watchdog Agent Platform 規劃）— 確認 Agent Registry 在整體

**日期**: 2026-08-15
**耗時**: 340s
**結果**: ✅ 成功
**分支**: `main`

## 任務

針對 TASK-001「server/agent-store.mjs — file-based Agent Registry 持久化」做設計討論（SA review），為 Developer 實作前定調。

請先讀取以下 context 再給設計結論：
1. .paaw 的 ADR-003（SRE Watchdog Agent Platform 規劃）— 確認 Agent Registry 在整體架構的角色
2. server/conversation.mjs — file-based store 的既有模式（讀寫、archive、錯誤處理）
3. server/tool-loader.mjs 的 safeResolve — path traversal 防護模式
4. server/task-store.mjs — 被取代的 TaskStore，確認取代時要注意什麼

TASK-001 要求的 schema：{ id, name, description, context, agentRules, prompt, allowedTools[], schedule (cron 或 null), notifyTarget: { targetType: "user"|"channel", targetId }, cooldownMinutes (預設 30), enabled, createdAt, updatedAt }，存 agents/*.json。

請產出設計結論（會轉交 Developer）：
- schema 欄位驗證規則（哪些必填、型別、預設值）
- saveAgent / deleteAgent 的 id 產生與檔名規則（如何避免 id 含路徑字元）
- safeResolve 的具體做法（比照 tool-loader）
- 與 conversation.mjs 模式的一致性要求（atomic write？錯誤處理？）
- TaskStore 取代的注意事項（要不要保留 task-store.mjs 一段時間？路由要動嗎？）
- 測試該覆蓋哪些案例

不需要寫 code，產出設計決策即可。

## AI 操作步驟

1× task_list
1× project_info
2× glob
7× read_file
3× reference_read
1× grep
1× task_update

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
MD .paaw/staged-changes.json
 M .paaw/standards/coding-style.md
MM .paaw/tasks/TASKS.json
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
 .paaw/coding-memory/actions.jsonl                  |   19 +-
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
 .paaw/staged-changes.json                          |   22 -
 .paaw/standards/coding-style.md                    |  259 +-
 .paaw/tasks/TASKS.json                             | 1217 +++++++--
 61 files changed, 8897 insertions(+), 9647 deletions(-)
 .paaw/CHANGELOG.md                                 |  57 ++++-
 .paaw/SECURITY-FIX-PLAN.md                         |  58 +++++
 .paaw/action-log/2026-08-02.json                   |  32 +++
 .paaw/{night-shift => auto-dispatch}/config.json   |   0
 .../plans/ns-2026-08-02-agent-sre.json             | 178 ++++++++++++++
 .../plans/ns-2026-08-03-agent-sre.json             |  54 +++++
 .paaw/auto-dispatch/report.md                      | 128 ++++++++++
 .paaw/auto-dispatch/reports/2026-08-02.md          | 128 ++++++++++
 .paaw/auto-dispatch/status.json                    |  12 +
 .paaw/code-intelligence/status-cache.json          |  10 +-
 .paaw/coding-memory/actions.jsonl                  |   8 +
 .../conversations/coding.em/active.json            |  26 +-
 .../coding.em/s-2026-08-02T13-11-09.json           |  27 +++
 .../coding.em/s-2026-08-03T09-08-38.json           |  83 +++++++
 .../conversations/coding.tester/active.json        |   2 +-
 .paaw/coding-memory/dispatch-log.jsonl             | 121 ++++++++++
 .paaw/night-shift/status.json                      |  16 --
 .paaw/sessions/2026-08-02-task.md                  | 100 ++++----
 .paaw/staged-changes.json                          |  22 +-
 .paaw/tasks/TASKS.json                             | 267 ++++++++++++++++++++-
 server/conversation.mjs                            |  14 ++
 server/conversation.test.mjs                       |  67 ++++++
 server/routes.mjs                                  |  17 +-
 server/routes.test.mjs                             | 111 +++++++++
 server/tool-loader.mjs                             |   2 +-
 25 files changed, 1443 insertions(+), 97 deletions(-)
```

## AI 回覆

設計結論已完整寫入 TASK-001 notes，Developer 接手時讀 task 即有全部 context。

```
📋 **Work Summary**
├─ 做了什麼：完成 TASK-001（agent-store.mjs）的 SA review 設計定調 — schema 驗證規則表、id/檔名規則（store 產生 UUID + 外部 id 雙層防護）、safeResolve 引用方式（import 不複製）、與 conversation.mjs 的一致性要求 + 兩處刻意的模式偏離（atomic write、讀取容錯不對稱）、TaskStore 過渡策略（保留 + 舊路由不動 + phase-2 才清理）、8 個測試案例；全部寫入 TASK-001 note
├─ 為什麼：TASK-001 是 Watchdog Platform（ADR-003）phase-1 第一塊基石，scheduler/UI/API 都依賴此 store 的契約，實作前需定調避免 Developer 自行發明 schema 語意與防護層次
├─ 建議下一步：
│  1. dispatch 給 Developer (Priya) 實作 server/agent-store.mjs + agent-store.test.mjs（照 TASK-001 note 的設計結論）
│  2. 實作完成後跑 vitest，確認 8 類測試案例覆蓋（特別是 path traversal 與 atomic write）
│  3. 預期結果：agents/*.json 持久化層落地，後續 /api/agents 路由 task 與 scheduler task 可直接疊上
└─ 風險注意：(1) agents/ 進 git 是新決策 — 測試若汙染 agents/ 會出現髒 diff，務必用 tmpdir 隔離；(2) atomic write 與讀取容錯不對稱是對 conversation.mjs 模式的刻意偏離，未來若有人「統一模式」時要知道這是有理由的（已寫進 note）
```
