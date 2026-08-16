# TChat Transport Contract v0

> Status: **v0（開發期抽象，未見公司 API 前的極簡契約）** · Ref: ADR-004 · Task: TASK-007
> Swap point: `tools/tchat/client.mjs`（唯一可換檔案）

## 1. 契約內容

### Endpoint

```
POST {api_url}/api/messages
```

- `api_url` 來自 `tools/tchat/config.json` 的 `api_url` 欄位（env fallback：`TCHAT_API_URL`）
- 例：`api_url = http://localhost:3002` → `POST http://localhost:3002/api/messages`

### Request

Headers:

| Header | 必填 | 說明 |
|---|---|---|
| `Authorization` | ❌ | `Bearer <token>`，選填（config `token` / env `TCHAT_TOKEN`） |
| `Content-Type` | ✅ | `application/json` |

Body（`application/json`）:

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `targetType` | `"user" \| "channel"` | ✅ | 目標類型 |
| `targetId` | string | ✅ | 使用者 ID 或頻道 ID |
| `text` | string | ✅ | 訊息內容（純文字） |

```json
{ "targetType": "channel", "targetId": "ops", "text": "🚨 CPU 95% on api-3" }
```

### Response

**200 OK** — 成功

```json
{ "ok": true, "messageId": "msg_0123456789" }
```

| 欄位 | 說明 |
|---|---|
| `ok` | 恆為 `true` |
| `messageId` | string，訊息唯一 ID |

**4xx / 5xx** — 失敗

```json
{ "ok": false, "error": "target not found: ops" }
```

| 欄位 | 責任 |
|---|---|
| `ok` | 恆為 `false` |
| `error` | string，人類可讀錯誤（client 會原樣上拋） |

### 逾時

- client 預設 `10s`（`AbortSignal.timeout`），config `timeout_ms` 可覆寫。

### 錯誤分類（client.mjs 回傳，絕不 throw）

| 情境 | 回傳 |
|---|---|
| `api_url` 未設 | `{ ok:false, error:"tchat api_url not configured..." }` |
| 網路層失敗（DNS/ECONNREFUSED/timeout）| `{ ok:false, error:"tchat transport error: <reason>" }` |
| HTTP 4xx/5xx + `{ok:false,error}` body | `{ ok:false, error:<body.error>, status }` |
| HTTP 非 2xx 但 body 無 `error` 欄位 | `{ ok:false, error:"tchat API error: HTTP <status>", status }` |
| HTTP 200 但 body `ok:false` | `{ ok:false, error:<body.error> }` |
| 200 但缺 `messageId` | 視為失敗（同上，fallback 到 HTTP status 訊息） |

## 2. 分層（ports & adapters）

```
LLM / scheduler
      │  tchat_send_message({ targetType, targetId, text })   ← 介面凍結
      ▼
tools/tchat/handler.mjs   工具層：驗證、錯誤格式化（❌/✅）
      │  sendMessage() 同介面直通
      ▼
tools/tchat/client.mjs    transport 層：契約 v0 唯一實作 ← 🔁 SWAP POINT
      ▼
{api_url}/api/messages    mock server（TASK-009）↔ 公司 tchat API
```

- **handler.mjs（工具層）** — 對 LLM 的介面 `tchat_send_message` 從此不變。負責參數驗證（targetType/targetId/text）與 `❌`/`✅` 錯誤格式化。另 export `sendTchatMessage()` 供 scheduler 通知路徑直呼，與 LLM 工具走完全相同程式碼。
- **client.mjs（transport 層）** — 契約 v0 的唯一實作，絕不 throw，所有失敗都收斂成 `{ok:false, error}`。config 載入（config.json → env fallback）也在這層。

## 3. 進公司 Swap 清單（僅此，不動其他）

| # | 動作 | 檔案 |
|---|---|---|
| 1 | 依公司真實 API 重寫 `sendMessage()`（URL/headers/body/response 映射） | `tools/tchat/client.mjs` |
| 2 | config 換成公司 url + token（`api_url` / `token`） | `tools/tchat/config.json` |
| 3 | 用公司 API 重跑通知驗證一輪（含 4xx/5xx/網路斷線） | — |

其餘全部不動：`handler.mjs`、tool schema、scheduler、UI、agent 定義。

## 4. Deprecated 工具（不納入契約 v0）

| 工具 | 狀態 |
|---|---|
| `tchat_read_history` | ⚠️ DEPRECATED — 功能保留（legacy Telegram transport），公司 API 契約未定 |
| `tchat_read_next` | ⚠️ DEPRECATED — 同上 |

讀取類契約待公司 API 確認後另開 ADR 定義。契約 v0 刻意極簡（僅 send），降低未見公司 API 前的偏離風險。

## 5. Config

`tools/tchat/config.json`（範本見 `config.example.json`）：

```json
{
  "api_url": "http://localhost:3002",
  "token": "",
  "timeout_ms": 10000,
  "bot_token": "…",
  "default_chat_id": "",
  "allowed_chat_ids": []
}
```

| 欄位 | 用途 | env fallback |
|---|---|---|
| `api_url` | 契約 v0 base URL | `TCHAT_API_URL` |
| `token` | Bearer token（選填） | `TCHAT_TOKEN` |
| `timeout_ms` | fetch 逾時（預設 10000） | — |
| `bot_token` / `default_chat_id` / `allowed_chat_ids` | **legacy** — 僅 deprecated read 工具使用 | `TG_BOT_TOKEN` / `TG_DEFAULT_CHAT_ID` / `TG_ALLOWED_CHATS` |
