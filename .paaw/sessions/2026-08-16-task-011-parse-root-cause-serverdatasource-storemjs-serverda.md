# 修復 TASK-011 遺留的測試 parse 失敗並完成結案。

已診斷出 root cause：你新寫的 server/datasource-store.mjs 和 server/datasource-store.test.mjs 的 header block comment 裡含有 `tools/*/config.json` 字樣 — 其中的 `*/` 會提前終止 block comment

**日期**: 2026-08-16
**耗時**: 709s
**結果**: ✅ 成功
**分支**: `main`

## 任務

修復 TASK-011 遺留的測試 parse 失敗並完成結案。

已診斷出 root cause：你新寫的 server/datasource-store.mjs 和 server/datasource-store.test.mjs 的 header block comment 裡含有 `tools/*/config.json` 字樣 — 其中的 `*/` 會提前終止 block comment，讓後續 comment 文字被當成 JS code，導致 vitest parse 失敗（錯誤訊息：datasource-store.mjs:40:3 與 datasource-store.test.mjs:7:8 "Failed to parse source for import analysis"）。

修復步驟：
1. read_file 這兩個檔案，把所有 comment 內的 `tools/*/config.json` 改成 `tools/<name>/config.json`（或其他不含 `*/` 的寫法）。兩個檔案至少各一處：datasource-store.mjs 約第 27 行、datasource-store.test.mjs 約第 4 行。
2. 用 grep 掃 server/datasource-store.mjs、server/datasource-store.test.mjs、server/routes.mjs、server/routes.test.mjs 有沒有其他寫在 block comment 裡的 `*/`（排除合法的 comment 結尾行），一併修掉。
3. 跑 npx vitest run server/datasource-store.test.mjs server/routes.test.mjs 確認 parse 修復且全綠。
4. 跑全套 npm test 確認無 regression。
5. git add 相關檔案並 commit（feat(server): datasource store and CRUD API with token masking）。不 push。
6. 用 action_log_add 記錄結案（上次 dispatch 結果被截斷，action log 沒有 TASK-011 紀錄）。

## AI 操作步驟

3× read_file
3× edit_file
1× grep
23× bash
4× task_update

### 變更檔案
- `.paaw/CHANGELOG.md`
- `server/datasource-store.mjs`
- `server/datasource-store.test.mjs`

## Git 變更分析

### Status
```
M .gitignore
 M .paaw/CHANGELOG.md
MM .paaw/api-samples.json
 M .paaw/auto-dispatch/plans/ns-2026-08-16-agent-sre.json
 M .paaw/coding-memory/actions.jsonl
 M .paaw/coding-memory/conversations/coding.developer/active.json
 M .paaw/coding-memory/conversations/coding.em/active.json
 M .paaw/coding-memory/dispatch-log.jsonl
 M .paaw/tasks/TASKS.json
M  agents/README.md
A  dev/e2e/watchdog-e2e.mjs
M  package.json
 M server/routes.mjs
 M tools/grafana/handler.mjs
?? .paaw/sessions/2026-08-16-task-011datasource-storemjs-apidatasources-crudkey-mask-task.md
?? .paaw/staged-changes.json
?? server/datasource-store.mjs
?? server/datasource-store.test.mjs
```

### Diff Stat
```
.gitignore                                         |   4 +
 .paaw/CHANGELOG.md                                 |   9 +
 .paaw/api-samples.json                             | 152 ++++++-
 .../plans/ns-2026-08-16-agent-sre.json             | 261 +----------
 .paaw/coding-memory/actions.jsonl                  |   1 +
 .../conversations/coding.developer/active.json     | 281 +++++++++++-
 .../conversations/coding.em/active.json            |   9 +-
 .paaw/coding-memory/dispatch-log.jsonl             | 214 +++++++++
 .paaw/tasks/TASKS.json                             | 489 ++++++++++++++++-----
 server/routes.mjs                                  |  84 ++++
 tools/grafana/handler.mjs                          |  14 +-
 11 files changed, 1151 insertions(+), 367 deletions(-)
 .paaw/api-samples.json   |  10 ++-
 agents/README.md         |  13 ++-
 dev/e2e/watchdog-e2e.mjs | 203 +++++++++++++++++++++++++++++++++++++++++++++++
 package.json             |   3 +-
 4 files changed, 223 insertions(+), 6 deletions(-)
```
