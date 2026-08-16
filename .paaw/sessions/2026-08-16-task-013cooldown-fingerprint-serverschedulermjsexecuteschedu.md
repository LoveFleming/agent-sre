# 實作 TASK-013：Cooldown / fingerprint 防重複通知。

前置已就緒：server/scheduler.mjs（executeScheduledRun、notifyPolicy）與 server/run-store.mjs 已完成，tools/tchat/client.mjs transport 已上線，全套測試 356 綠。

工作內容：
1. 先 read_file

**日期**: 2026-08-16
**耗時**: 964s
**結果**: ✅ 成功
**分支**: `main`

## 任務

實作 TASK-013：Cooldown / fingerprint 防重複通知。

前置已就緒：server/scheduler.mjs（executeScheduledRun、notifyPolicy）與 server/run-store.mjs 已完成，tools/tchat/client.mjs transport 已上線，全套測試 356 綠。

工作內容：
1. 先 read_file 確認現有結構：server/scheduler.mjs、server/scheduler.test.mjs、server/run-store.mjs（了解 run 記錄欄位）、server/agent-store.mjs 的 agent schema（cooldownMinutes 欄位定義）。
2. 在 scheduler 執行路徑（包在 runAgentLoop 外圍，非改 agent-loop 本身）實作：
   - run 結果產生 alert fingerprint：sorting 過的 alert names+state 做雜湊（如 SHA-256 hex）
   - 通知前檢查：同 agent 同 fingerprint 若在 cooldownMinutes 內（agent 可覆寫，預設 30）已通知過 → 跳過 tchat 發送，run 記 notified: false, skippedByCooldown: true
   - fingerprint 狀態存 runs/<agentId>/cooldown-state.json（重啟存活）
   - 不同 fingerprint 不互相干擾
3. 驗收測試（mock）：firing 連跑兩次 → 第二次 jsonl 無新訊息；過 cooldown 再跑 → 重新通知；不同 fingerprint 不互相干擾；記錄 notified:false/skippedByCooldown。測試風格沿用 scheduler.test.mjs 現有 mock timer / transport stub 慣例。
4. 跑全套 npm test 確認綠燈。
5. commit（feat(scheduler): cooldown fingerprint to suppress duplicate notifications）。不 push。
6. action_log_add 記錄結案。

注意：工作樹可能有別的 session 留下的 staged 變更，commit 前先 git status 確認只 add 本次相關檔案（server/scheduler.mjs、server/scheduler.test.mjs，如有動到 run-store 才加）。

## AI 操作步驟

19× read_file
6× grep
22× bash

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
 M tools/grafana/handler.mjs
?? .paaw/sessions/2026-08-16-task-011-codedatasource-store-21-tests-routes-64-tests-356-p.md
?? .paaw/sessions/2026-08-16-task-011-parse-root-cause-serverdatasource-storemjs-serverda.md
?? .paaw/sessions/2026-08-16-task-011datasource-storemjs-apidatasources-crudkey-mask-task.md
?? .paaw/staged-changes.json
```

### Diff Stat
```
.gitignore                                         |   4 +
 .paaw/CHANGELOG.md                                 |  17 +
 .paaw/api-samples.json                             | 152 ++++++-
 .../plans/ns-2026-08-16-agent-sre.json             | 261 +----------
 .paaw/coding-memory/actions.jsonl                  |   2 +
 .../conversations/coding.developer/active.json     | 281 +++++++++++-
 .../conversations/coding.em/active.json            |   9 +-
 .paaw/coding-memory/dispatch-log.jsonl             | 214 +++++++++
 .paaw/tasks/TASKS.json                             | 497 ++++++++++++++++-----
 tools/grafana/handler.mjs                          |  14 +-
 10 files changed, 1080 insertions(+), 371 deletions(-)
 .paaw/api-samples.json   |  10 ++-
 agents/README.md         |  13 ++-
 dev/e2e/watchdog-e2e.mjs | 203 +++++++++++++++++++++++++++++++++++++++++++++++
 package.json             |   3 +-
 4 files changed, 223 insertions(+), 6 deletions(-)
```
