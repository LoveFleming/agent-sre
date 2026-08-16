# 實作 TASK-011：datasource-store.mjs + /api/datasources CRUD（key mask）。

前置已就緒：TASK-015 API auth（X-API-Token）已完成並 commit，server/routes.mjs 已有 checkApiToken() gate。

工作內容：
1. 先 read_file 確認現有結構：server/rout

**日期**: 2026-08-16
**耗時**: 2761s
**結果**: ✅ 成功
**分支**: `main`

## 任務

實作 TASK-011：datasource-store.mjs + /api/datasources CRUD（key mask）。

前置已就緒：TASK-015 API auth（X-API-Token）已完成並 commit，server/routes.mjs 已有 checkApiToken() gate。

工作內容：
1. 先 read_file 確認現有結構：server/routes.mjs、server/agent-store.mjs（沿用其 file-based store 模式：atomic write tmp→rename、schema 驗證）、server/task-store.mjs、server/agent-store.test.mjs（測試風格參考）。
2. 新增 server/datasource-store.mjs：管理 datasource 設定（如 grafana: { url, token }），存 datasources/*.json。export listDatasources/getDatasource/saveDatasource/deleteDatasource。
3. 在 server/routes.mjs 加 /api/datasources CRUD：
   - GET /api/datasources：token 一律 mask 成 "***"（永不回明文）
   - POST /api/datasources：寫入明文 token
   - PUT /api/datasources/:id：若 token 欄為 "***" 或缺空則保留原值不覆蓋
   - DELETE /api/datasources/:id
   - 錯誤處理沿用 routes.mjs 慣例：400/404/500，body { "error": ... }
4. 串接：datasource 變更時同步更新對應 tools/<name>/config.json（grafana handler 讀的是該檔）。先用 read_file 確認 tools/grafana/handler.mjs 實際讀的 config 路徑與格式再寫同步邏輯。
5. 安全要求：secret 不寫進 run log、不進 agent prompt。
6. 新增 server/datasource-store.test.mjs + 在 server/routes.test.mjs 補 API 測試（記得帶 X-API-Token header）。驗收標準：API key 任何回應路徑不出現明文、未改 key 的更新不覆蓋原值、CRUD 全綠含 mask 驗證、tool config 變更後 handler 讀到新值。
7. 跑全套 npm test 確認綠燈，commit（feat(server): datasource store and CRUD API with token masking）。不 push。

## AI 操作步驟

8× read_file
24× bash
1× task_list
3× write_file
6× edit_file

### 變更檔案
- `server/datasource-store.mjs`
- `server/datasource-store.test.mjs`
- `server/routes.mjs`
- `tools/grafana/handler.mjs`

## Git 變更分析

### Status
```
M .gitignore
M  .paaw/api-samples.json
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
?? .paaw/staged-changes.json
?? server/datasource-store.mjs
?? server/datasource-store.test.mjs
```

### Diff Stat
```
.gitignore                                         |   4 +
 .../plans/ns-2026-08-16-agent-sre.json             | 261 +-----------
 .paaw/coding-memory/actions.jsonl                  |   1 +
 .../conversations/coding.developer/active.json     | 281 ++++++++++++-
 .../conversations/coding.em/active.json            |   9 +-
 .paaw/coding-memory/dispatch-log.jsonl             | 214 ++++++++++
 .paaw/tasks/TASKS.json                             | 456 +++++++++++++++------
 server/routes.mjs                                  |  84 ++++
 tools/grafana/handler.mjs                          |  14 +-
 9 files changed, 964 insertions(+), 360 deletions(-)
 .paaw/api-samples.json   |  10 ++-
 agents/README.md         |  13 ++-
 dev/e2e/watchdog-e2e.mjs | 203 +++++++++++++++++++++++++++++++++++++++++++++++
 package.json             |   3 +-
 4 files changed, 223 insertions(+), 6 deletions(-)
```
