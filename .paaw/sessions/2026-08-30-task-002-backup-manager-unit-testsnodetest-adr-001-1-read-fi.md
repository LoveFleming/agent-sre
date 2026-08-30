# 實作 TASK-002：為 Backup Manager 補 unit tests（node:test 框架，ADR-001 選型）。

【第一步：讀檔案】
1. read_file src/server.mjs 的 backup 區域（約 L240-360），找到 BACKUP_REGEX / BACKUP_DATE_REGEX / listBackups / createBackup / re

**日期**: 2026-08-30
**耗時**: 102s
**結果**: ✅ 成功
**分支**: `main`

## 任務

實作 TASK-002：為 Backup Manager 補 unit tests（node:test 框架，ADR-001 選型）。

【第一步：讀檔案】
1. read_file src/server.mjs 的 backup 區域（約 L240-360），找到 BACKUP_REGEX / BACKUP_DATE_REGEX / listBackups / createBackup / restoreBackup
2. read_file package.json 確認現有 scripts 和 module type

【第二步：最小 refactor（只加 export，不搬檔案）】
- listBackups / createBackup / restoreBackup 加 export keyword（如 BACKUP_REGEX 已 export 則跳過）
- 若函式內有寫死路徑（如 BACKUP_DIR 常數），保持不動 —— 測試用 monkey-patch 或以可覆寫的方式處理；若無法乾淨覆寫，優先選擇把 BACKUP_DIR 改為 export const 且測試可透過 process.env 覆寫的**最小改動**，切勿大改結構
- package.json 加 "test": "node --test tests/"

【第三步：寫測試 tests/unit/backup.test.mjs】
必測案例（詳見 task spec）：
1. BACKUP_REGEX 白名單：合法 paaw-backup-2026-08-25-14.tar.gz 通過；拒絕 ../etc/passwd、..\\..\\x、paaw-backup-20260825-14.tar.gz（QA 抓到的錯誤格式）、paaw-backup-.tar.gz、含 ; 或 rm -rf 的注入名
2. ★Regression invariant（最重要）：createBackup 產生的真實檔名必須能通過 BACKUP_REGEX —— 這是 TASK-001 critical bug 的根因，一定要有
3. listBackups：目錄含 .DS_Store、非法名稱時只回合法備份、依日期排序
4. createBackup：真實產生 tar.gz；失敗情境（如目錄不存在）錯誤處理
5. restoreBackup：非法 filename 拒絕、不存在檔案錯誤處理、還原前自動產生 safety backup

【隔離】所有測試在 fs.mkdtempSync 的 temp dir 操作，afterEach 清理，不留殘留。

【驗收】npm test 一鍵通過。完成後 git add（不 commit）。回報：改了哪些檔案、測試案例數、npm test 結果。

## AI 操作步驟

2× task_list
2× read_file
2× grep
1× glob
1× ask_user
2× reference_read
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
 .paaw/coding-memory/actions.jsonl                  |     2 +
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
 .paaw/standards/coding-style.md                    |   261 +-
 .paaw/tasks/TASKS.json                             |   179 +-
 28 files changed, 72413 insertions(+), 6391 deletions(-)
```

## AI 回覆

## 回報：TASK-002 無法在當前 Release Unit 執行 — 已停止，未改任何檔案

### 調查證據

| 檢查項 | 結果 |
|---|---|
| `src/server.mjs` | ❌ 不存在（agent-sre 入口是 `server/index.mjs`） |
| grep `BACKUP_REGEX / listBackups / createBackup / restoreBackup` 全專案 | ❌ 0 筆 |
| agent-sre task 系統的 TASK-002 | 實為「/api/agents CRUD endpoints」且已 done — **與 backup tests 完全無關** |
| auto-dispatch plan `ns-2026-08-30` 的上下文 | 明確指向 `/Users/steward/App/tpaaw-gateway/src/server.mjs`（歷史 TASK-001 修補 commit `a8eb20b` 也在該檔） |
| 我的檔案存取邊界 | 被限制在 agent-sre 目錄內（連唯讀 reference 工具的 root 也只掛載 agent-sre），**讀不到也寫不了 tpaaw-gateway** |

### 為什麼不硬做

1. **寫了就是造假測試** — 在 agent-sre 建 `tests/unit/backup.test.mjs` 會 import 一個不存在的模組，`npm test` 必紅。對不存在的程式碼寫測試，比沒有測試更糟。
2. **會破壞現有測試** — 把 `package.json` 的 `test` 換成 `node --test tests/` 會直接弄壞 agent-sre 現行的 `vitest run` 套件（覆蓋 routes、agents、runs、UI 等大量測試）。vitest 是這個專案的既定框架，「ADR-001 選 node:test」顯然是 tpaaw-gateway 那邊的決策。

### 建議行動

**請切換 Release Unit 到 tpaaw-gateway，再重派這個任務**，我拿到邊界後可以立刻照 spec 完整執行（讀碼 → 最小 export refactor → 5 大類測試案例 → temp dir 隔離 → `git add` 不 commit）。

### 附加發現：一個關鍵矛盾（切過去後請優先驗證）

歷史紀錄顯示 tpaaw-gateway 的 regex 是 `/^paaw-backup-\d{8}-\d{4}\.tar\.gz$/`（**無連字號**日期 `20260825`），但你給的合法範例是 `paaw-backup-2026-08-25-14.tar.gz`（**含連字號**）。兩者互斥 —— 這極可能就是 TASK-001 critical bug 的真正根因：**createBackup 產出含連字號的檔名，BACKUP_REGEX 卻只認 `\d{8}`，導致剛建好的備份被 listBackups 過濾掉**。屆時回歸測試 #2（★createBackup 產出檔名必須通過 BACKUP_REGEX）就是釘死這個 invariant 的那一顆，我會放在最前面。

已將以上結論記入 action log，供後續接手的人直接使用。
