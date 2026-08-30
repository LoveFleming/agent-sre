# ⚠️ 你上一輪找錯工作區了！這份 security scan 是在 **tpaaw-gateway** 專案掃的，不是 agent-sre 也不是 tPAAW。

**修復目標檔案絕對路徑：`/Users/steward/App/tpaaw-gateway/src/server.mjs`**
請先確認你的 cwd 是 tpaaw-gateway（跑 `pwd`）。若不在，先 `cd /Users/

**日期**: 2026-08-25
**耗時**: 119s
**結果**: ✅ 成功
**分支**: `main`

## 任務

⚠️ 你上一輪找錯工作區了！這份 security scan 是在 **tpaaw-gateway** 專案掃的，不是 agent-sre 也不是 tPAAW。

**修復目標檔案絕對路徑：`/Users/steward/App/tpaaw-gateway/src/server.mjs`**
請先確認你的 cwd 是 tpaaw-gateway（跑 `pwd`）。若不在，先 `cd /Users/steward/App/tpaaw-gateway`。檔案絕對存在——我剛剛 read_file 成功讀到了它的 Backup Manager 區塊（L263-335）。

先 read_file 讀 `src/server.mjs` 的 Backup Manager 區塊（L263-335），確認現況再改。

具體修改：

1. **listBackups() (L267)** — `f` 來自 readdirSync 內部來源，被掃描誤報 path traversal。過濾條件已含 `f.startsWith("paaw-backup-") && f.endsWith(".tar.gz")`，把它強化為完整白名單 regex：`/^paaw-backup-\d{8}-\d{4}\.tar\.gz$/`，不符的 skip 掉。

2. **createBackup() (L291, L313-314)**：
   - `const dirs = ["data", ".paaw"].filter(...)` 的 `d` 是 hardcoded，屬誤報，可保留但確保 join 後路徑仍落在 PAAW_ROOT 內。
   - 內部生成 `filename` 後，加白名單 regex 驗證 `/^paaw-backup-\d{8}-\d{4}\.tar\.gz$/`，不符就 throw。

3. **restoreBackup() (L326)** — 🔴 真正的 command injection。目前 `execSync(\`tar xzf "${filepath}"\`)` 用 shell 字串拼 filename（user input），可注入。
   - 開頭對 filename 做白名單驗證：不符合 `/^paaw-backup-\d{8}-\d{4}\.tar\.gz$/` 直接 return { ok:false, error:"Invalid backup filename" }。
   - 改用 `execFileSync("tar", ["xzf", filepath], { cwd: PAAW_ROOT, encoding: "utf-8", timeout: 300000 })` — 用參數傳遞、免 shell。確認 child_process import（看檔案裡已存在的 require 方式，通常 `const { execSync, execFileSync } = require("child_process")` 或已 import）。

改完跑 security scan 或至少確認程式碼層面消除了 shell 字串拼接（不再有 `tar xzf "..."` 這種 execSync shell 寫法）。

改碼前先 read_file。commit 用 Conventional Commits 英文 <72字，例如 fix(server): eliminate command injection in backup restore。commit 後不要 push。

## AI 操作步驟

12× bash
1× read_file
1× edit_file

### 變更檔案
- `/Users/steward/App/tpaaw-gateway/src/server.mjs`

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
?? .paaw/sessions/2026-08-25-srcservermjs-backup-manager-7-security-findings-read-file-sr.md
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
 .paaw/tasks/TASKS.json                             |   175 +-
 27 files changed, 72401 insertions(+), 6389 deletions(-)
```

## AI 回覆

已 commit（a8eb20b），未 push。所有修改驗證完畢。

## 修改摘要

`/Users/steward/App/tpaaw-gateway/src/server.mjs` — Back Manager 安全修補（3 處）：

1. **listBackups()** — 過濾條件強化為完整白名單 regex `/^paaw-backup-\d{8}-\d{4}\.tar\.gz$/`（消除 path traversal 誤報）
2. **createBackup()** — 內部 filename 以相同 regex 驗證，不符 throw；`execSync` shell 拼接改為 `execFileSync("tar", ["czf", filepath, ...dirs])`
3. **restoreBackup()** — 🔴 真正的 command injection 修復：開頭白名單驗證 filename（不符 return `{ok:false}`），並改用 `execFileSync("tar", ["xzf", filepath])` 參數傳遞、免 shell

同時在 import 行加入 `execFileSync`。

📋 **Work Summary**
├─ 改了什麼：`src/server.mjs`（Backup Manager）— path 白名單 regex、tar 由 shell 字串改為 execFileSync 參數傳遞
├─ 為什麼改：修復 security scan 的 7 個 findings 中屬 Backup Manager 的部分，主要消除 `restoreBackup` 的 command injection
├─ 怎麼測試：
│  1. `node --check src/server.mjs` → syntax OK
│  2. `grep "tar xzf"` → 確認已無 shell 字串拼接
│  3. `git diff` 檢視 10 insertions / 5 deletions，僅改 Backup Manager 與 import 行
│  4. 預期：restoreBackup 傳入非白名單檔名 → 直接 return invalid，不會進 shell exec
└─ 風險注意：`tar xzf` 解壓路徑仍會覆寫 PAAW_ROOT 內檔案（原有行為不變）；restore 流程的 stopPaaw/startPaaw 未更動

已 commit（a8eb20b，Conventional Commits 英文 <72字），**未 push**。
