# 修復 src/server.mjs Backup Manager 的 7 個 security findings。先 read_file 讀 src/server.mjs 的 Backup Manager 區塊（L263-335 附近）確認現況再改。

具體修改（都在 src/server.mjs）：

1. **listBackups() (L267)** — `f` 來自 readdirSyn

**日期**: 2026-08-25
**耗時**: 286s
**結果**: ✅ 成功
**分支**: `main`

## 任務

修復 src/server.mjs Backup Manager 的 7 個 security findings。先 read_file 讀 src/server.mjs 的 Backup Manager 區塊（L263-335 附近）確認現況再改。

具體修改（都在 src/server.mjs）：

1. **listBackups() (L267)** — `f` 來自 readdirSync（內部可信），但被掃描報 path traversal。加檔名白名單驗證：過濾時已用 `f.startsWith("paaw-backup-") && f.endsWith(".tar.gz")`，再加一個完整 regex `paaw-backup-\d{8}-\d{4}\.tar\.gz` 白名單確認，防止任何非預期檔名。

2. **createBackup() (L291, L313-314)**：
   - `const dirs = ["data", ".paaw"].filter(...)` 的 `d` 是 hardcoded，誤報。可保留，但確保 join 後路徑仍落在 PAAW_ROOT 內（用 path.resolve + 確認 prefix 或直接 hardcode 安全即可）。
   - 內部生成 `filename` 後，加白名單 regex 驗證：`/^paaw-backup-\d{8}-\d{4}\.tar\.gz$/`，不符就 throw/log，確保 filepath 一定安全。

3. **restoreBackup() (L326)** — 🔴 真正的 command injection。目前 `execSync(\`tar xzf "${filepath}"\`)` 用 shell 拼字串，filename 是 user input，可注入。
   - 改成白名單驗證 filename：「不符合 `/^paaw-backup-\d{8}-\d{4}\.tar\.gz$/` 直接 return { ok:false, error }」
   - 改用 `execFileSync("tar", ["xzf", filepath], { cwd: PAAW_ROOT, encoding: "utf-8", timeout: 300000 })`，用參數傳遞，不用 shell 字串。
   - 確認 execFileSync 已 import（或從 Node 內建 `child_process` require，參考檔案已有的 import/require 方式）。

改完後：跑 `node script/semgrep 或重跑 security scan 確認 findings 降到 7 以下（command injection 那條至少要消失）`。如果掃描工具不方便跑，至少要確認程式碼層面已消除 shell 拼接。

注意改碼前一定先 read_file 讀檔，不要憑記憶改。commit 用 Conventional Commits（英文，<72字），例如 fix(server): eliminate command injection in backup restore。commit 後不要 push。

## AI 操作步驟

2× read_file
1× glob
1× grep
6× bash
1× reference_read
1× ask_user
1× action_log_add
1× task_list

## Git 變更分析

### Status
```
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
?? .paaw/handover-state.json
?? .paaw/logs/semgrep-2026-08-19T13-40-05-stdout.json
?? .paaw/logs/semgrep-2026-08-19T13-40-05.sh
?? .paaw/logs/semgrep-2026-08-19T14-01-02-stdout.json
?? .paaw/logs/semgrep-2026-08-19T14-01-02.sh
?? .paaw/logs/semgrep-2026-08-19T14-19-30-stdout.json
?? .paaw/logs/semgrep-2026-08-19T14-19-30.sh
?? .paaw/release-unit-model.json
```

### Diff Stat
```
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
 .paaw/coding-memory/actions.jsonl                  |     1 +
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
 .paaw/tasks/TASKS.json                             |   173 +-
 27 files changed, 72400 insertions(+), 6388 deletions(-)
```

## AI 回覆

我已徹底查證。**這個修復任務無法在目前的工作目錄執行，因為檔案路徑對不上**。我必須誠實報告，不能憑猜測亂改或假裝完成。

## 查證結果

我做了完整搜尋與確認：

| 檢查項目 | 結果 |
|---|---|
| agent-sre 是否有 `src/` 目錄 | ❌ 無，採用 `server/` 架構 |
| agent-sre 是否有任何 `server.mjs` | ❌ 全搜尋 0 命中 |
| agent-sre 是否有 Backup 相關程式碼（`backup`/`paaw-backup`/`tar xzf`/`listBackups`/`createBackup`/`restoreBackup`） | ❌ 全部 0 命中 |
| Backup Manager 實際位置 | **`/Users/steward/App/tPAAW/packages/server/src/routes/backup.mjs`**（另一個 workspace，含 `listBackups`/`createBackup`/`restoreBackup`/`paaw-backup`） |

您指定的 `src/server.mjs`（L263-335）**在 agent-sre 專案不存在**，Backup Manager 實際位在 *另一個* workspace **tPAAW** 的 `packages/server/src/routes/backup.mjs`。運行時的安全性掃描可能是在掃 tPAAW 或其他位置的程式碼，但 agent-sre 根本不是檔案所在處。

## 我遇到的能力限制

目前 cwd 固定在 `/Users/steward/App/agent-sre`，`read_file`/`write_file`/`bash` 都被 path 白名單限定在此目錄，無法跨到妹妹 workspace `tPAAW` 讀寫。我試過 `ask_user` 但使用者在 loop 中無法回覆，只好做最佳判斷後暫停。

## 我能做的（已經做了）

- 已把查證結果寫入 action log，讓能控制正確 workspace 的人接手。
- 我**沒有**在 agent-sre 內憑猜測建立或修改任何檔案 — 那會產生錯誤的程式碼。

## 需要您確認

這個修復需要**切換到 tPAAW workspace**（或由該專案的 developer agent 處理）。一旦我能存取 `packages/server/src/routes/backup.mjs`，我就可以按照您的三個具體步驟執行：

1. **`listBackups()`** — 加完整檔名 regex `paaw-backup-\d{8}-\d{4}\.tar\.gz` 白名單
2. **`createBackup()`** — 對內部生成的 `filename` 加 regex 驗證
3. **`restoreBackup()`** — 🔴 改用 `execFileSync("tar", ["xzf", filepath], { cwd, timeout })` 消除 command injection（而不是 `execSync` 的 shell 字串拼接）

並確認 `execFileSync` 的 import 方式後再執行。

**請告訴我正確的 workspace/路徑**，或確認我是否該改用 tPAAW。在得到確認前，我不會動手亂改，避免造成錯誤或覆蓋到對的檔案（我會改到錯的地方）。
