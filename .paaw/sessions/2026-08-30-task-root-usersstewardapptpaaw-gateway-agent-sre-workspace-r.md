# 【⚠️ 工作目錄】本 task 的專案 root 是 /Users/steward/App/tpaaw-gateway（不是 agent-sre！）。你上一輪跑錯 workspace 了，本輪所有檔案操作一律用這個絕對路徑開頭，例如 read /Users/steward/App/tpaaw-gateway/src/server.mjs。如果你的工具拒絕存取該路徑，立即回報「無法存取 tpaaw-

**日期**: 2026-08-30
**耗時**: 501s
**結果**: ✅ 成功
**分支**: `main`

## 任務

【⚠️ 工作目錄】本 task 的專案 root 是 /Users/steward/App/tpaaw-gateway（不是 agent-sre！）。你上一輪跑錯 workspace 了，本輪所有檔案操作一律用這個絕對路徑開頭，例如 read /Users/steward/App/tpaaw-gateway/src/server.mjs。如果你的工具拒絕存取該路徑，立即回報「無法存取 tpaaw-gateway」並停止，不要又跑去 agent-sre。

實作 TASK-002：為 Backup Manager 補 unit tests（node:test 框架，ADR-001 選型）。

【第一步：讀檔案】
1. read_file /Users/steward/App/tpaaw-gateway/src/server.mjs 的 backup 區域（約 L240-360），找 BACKUP_REGEX / BACKUP_DATE_REGEX / listBackups / createBackup / restoreBackup（這些 symbol 一定存在，TASK-001 剛修過，commit a8eb20b）
2. read_file /Users/steward/App/tpaaw-gateway/package.json 確認 scripts 和 module type

【第二步：最小 refactor（只加 export，不搬檔案）】
- listBackups / createBackup / restoreBackup 加 export keyword；BACKUP_REGEX / BACKUP_DATE_REGEX 若未 export 也加上
- 若 BACKUP_DIR 之類的路徑常數寫死，採最小改動讓測試可覆寫（例如可由 process.env 覆寫），不要大改結構
- package.json 加 "test": "node --test tests/"

【第三步：寫測試 /Users/steward/App/tpaaw-gateway/tests/unit/backup.test.mjs】
必測案例：
1. BACKUP_REGEX 白名單：合法 paaw-backup-2026-08-25-14.tar.gz 通過；拒絕 ../etc/passwd、..\\..\\x、paaw-backup-20260825-14.tar.gz（QA 抓到的錯誤格式）、paaw-backup-.tar.gz、含 ; 或 rm -rf 的注入名
2. ★Regression invariant（最重要）：createBackup 產生的真實檔名必須能通過 BACKUP_REGEX —— TASK-001 critical bug 的根因
3. listBackups：目錄含 .DS_Store、非法名稱時只回合法備份、依日期排序
4. createBackup：真實產生 tar.gz；失敗情境錯誤處理
5. restoreBackup：非法 filename 拒絕、不存在檔案錯誤處理、還原前自動產生 safety backup

【隔離】所有測試在 fs.mkdtempSync 的 temp dir 操作，afterEach 清理。

【驗收】在 /Users/steward/App/tpaaw-gateway 下 npm test 一鍵通過。完成後 git add（不 commit）。回報：改了哪些檔案、測試案例數、npm test 結果。

## AI 操作步驟

2× read_file
33× bash
1× staged_summary
1× action_log_add

## Git 變更分析

### Status
```
M .paaw/CHANGELOG.md
 M .paaw/changes/change-intelligence.json
 M .paaw/code-intelligence/api-function-map.json
 M .paaw/code-intelligence/call-graph.json
 M .paaw/code-intelligence/dependency-graph.json
 M .paaw/code-intelligence/file-map.json
 M .paaw/code-intelligence/status-cache.json
 M .paaw/code-intelligence/summary.json
 M .paaw/code-intelligence/symbol-index.json
 M .paaw/code-intelligence/test-code-map.json
 M .paaw/code-intelligence/test-intelligence.json
 M .paaw/coding-memory/actions.jsonl
 M .paaw/coding-memory/conversations/coding.developer/active.json
 M .paaw/coding-memory/conversations/coding.em/active.json
 M .paaw/cu-status.json
 M .paaw/deps-cache.json
 M .paaw/features/FEATURES.json
 M .paaw/features/FILE-FEATURES.json
 M .paaw/features/tree-sitter-analysis.txt
 M .paaw/metrics-cache.json
 M .paaw/project/ARCHITECTURE.md
 M .paaw/project/PROJECT.md
 M .paaw/scan.json
 M .paaw/security/scan-results.json
 M .paaw/specs/api-contract.md
 M .paaw/specs/error-codes.md
 M .paaw/staged-changes.json
 M .paaw/standards/coding-style.md
 M .paaw/tasks/TASKS.json
?? .paaw/HANDOVER.md
?? .paaw/auto-dispatch/plans/ns-2026-08-25-agent-sre.json
?? .paaw/auto-dispatch/plans/ns-2026-08-30-agent-sre.json
?? .paaw/handover-state.json
?? .paaw/logs/semgrep-2026-08-19T13-40-05-stdout.json
?? .paaw/logs/semgrep-2026-08-19T13-40-05.sh
?? .paaw/logs/semgrep-2026-08-19T14-01-02-stdout.json
?? .paaw/logs/semgrep-2026-08-19T14-01-02.sh
?? .paaw/logs/semgrep-2026-08-19T14-19-30-stdout.json
?? .paaw/logs/semgrep-2026-08-19T14-19-30.sh
?? .paaw/release-unit-model.json
?? .paaw/sessions/2026-08-25-security-scan-tpaaw-gateway-agent-sre-tpaaw-usersstewardappt.md
?? .paaw/sessions/2026-08-25-srcservermjs-backup-manager-7-security-findings-read-file-sr.md
?? .paaw/sessions/2026-08-25-usersstewardapptpaaw-gatewaysrcservermjs-backup-manager-4-no.md
?? .paaw/sessions/2026-08-25-usersstewardapptpaaw-gatewaysrcservermjs-backup-manager-rege.md
?? .paaw/sessions/2026-08-30-task-002-backup-manager-unit-testsnodetest-adr-001-1-read-fi.md
```

### Diff Stat
```
.paaw/CHANGELOG.md                                 |     9 +
 .paaw/changes/change-intelligence.json             |  3220 +-
 .paaw/code-intelligence/api-function-map.json      |   203 +-
 .paaw/code-intelligence/call-graph.json            | 10946 +++++-
 .paaw/code-intelligence/dependency-graph.json      |  1643 +-
 .paaw/code-intelligence/file-map.json              | 17263 ++++++++-
 .paaw/code-intelligence/status-cache.json          |    16 +-
 .paaw/code-intelligence/summary.json               |    46 +-
 .paaw/code-intelligence/symbol-index.json          | 37900 ++++++++++++++++++-
 .paaw/code-intelligence/test-code-map.json         |   155 +-
 .paaw/code-intelligence/test-intelligence.json     |   600 +-
 .paaw/coding-memory/actions.jsonl                  |     3 +
 .../conversations/coding.developer/active.json     |   804 +-
 .../conversations/coding.em/active.json            |   187 +-
 .paaw/cu-status.json                               |    44 +-
 .paaw/deps-cache.json                              |     2 +-
 .paaw/features/FEATURES.json                       |   910 +-
 .paaw/features/FILE-FEATURES.json                  |   687 +-
 .paaw/features/tree-sitter-analysis.txt            |   639 +-
 .paaw/metrics-cache.json                           |     2 +-
 .paaw/project/ARCHITECTURE.md                      |   148 +-
 .paaw/project/PROJECT.md                           |   244 +-
 .paaw/scan.json                                    |   453 +-
 .paaw/security/scan-results.json                   |  1506 +-
 .paaw/specs/api-contract.md                        |   493 +-
 .paaw/specs/error-codes.md                         |   242 +-
 .paaw/staged-changes.json                          |    28 +-
 .paaw/standards/coding-style.md                    |   261 +-
 .paaw/tasks/TASKS.json                             |   185 +-
 29 files changed, 72431 insertions(+), 6408 deletions(-)
```
