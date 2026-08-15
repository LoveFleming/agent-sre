# agents/

Agent Registry 資料目錄（`server/agent-store.mjs` 的唯一真相來源）。

- 每個 agent 一個 `<uuid>.json` 檔，由 store 以 atomic write（tmp → rename）寫入
- 檔名即 id：`^[a-zA-Z0-9_-]+$` 白名單 + safeResolve 雙層防 path traversal
- 本目錄隨 repo 版本控制，視為 **config-as-code**：agents 定義可以直接 commit 進來，作為環境的初始 agent 集合
- 測試不會碰這裡 — 測試用 `SRE_AGENTS_DIR` 環境變數指向 temp dir
- 運行期修改也寫到這裡；如需重置，刪掉 JSON 檔再重啟即可
- 不要手放 `*.tmp` 檔；`*.json.tmp` 是 atomic write 的暫存檔，會被 `listAgents` 忽略

Schema 定義見 `server/agent-store.mjs` 頂部 JSDoc（`@typedef Agent`）。
