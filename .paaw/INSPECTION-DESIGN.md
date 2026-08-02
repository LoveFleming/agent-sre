# SRE 定時巡檢設計文件 (Inspection Design)

> 目標：定時讀取 Grafana dashboard 全部圖表 → AI 解讀 → 有異常丟公司 tChat channel 通知值班。
> 這是加在現有 agent-sre 之上的「巡檢層」，與現有聊天架構平行，不互相干擾。

## 1. 需求拆解

使用者的核心需求（用時間軸看）：

```
⏰ 每 N 分鐘
  → 抓 Grafana dashboard 全部 panel（圖表）
  → 丟給 AI 解讀「有沒有異常？」
  → 有問題 → ❗ 丟到公司 tChat channel 通知值班
  → 沒問題 → ✅ 安靜（寫 status / 記錄）
```

以及：之後會有**更多類似需求**加入（定期巡檢 / 手動 launch 特定 task）。

## 2. 架構總覽

```
┌───────────────────────────────────────────────┐
│            SCHEDULER（排程器）                   │
│   讀 jobs/*.json → 定時觸發 Inspection Run      │
└──────────────────────┬────────────────────────┘
                       ▼
        ┌──────────────────────────┐
        │    INSPECTION ENGINE      │← 巡檢執行器（核心新增）
        │    (一次巡檢 = 一個 run)   │
        └────────────────┬─────────┘
                         │ 對每個 job 的每個 dashboard
        ┌────────────────▼─────────┐
        │   1. 抓 Grafana 資料      │ grafana_get_dashboard
        │      → 列出所有 panel     │ grafana_query_panel
        └────────────────┬─────────┘
                         ▼
        ┌──────────────────────────┐
        │   2. 閾值過濾層 (Filter)   │← 先用規則找「可疑」panel
        │      (省 token 關鍵)      │   只有異常才送給 AI
        └────────────────┬─────────┘
                         ▼
        ┌──────────────────────────┐
        │   3. AI 解讀 (僅異常 panel)│ dispatch → 蘇婉清(metrics)/
        │                          │   張志遠(commander)
        └────────────────┬─────────┘
                         ▼
    ┌─────────────────────────────────────┐
    │   4. 有異常 → tchat_send 通知值班      │
    │      無異常 → status 記錄, 安靜        │
    └─────────────────────────────────────┘
```

## 3. 核心元件

### 3.1 Scheduler（排程器）
- 讀取 `jobs/*.json`（每個檔案 = 一個巡檢任務）
- 每個 job 有 `schedule`（cron 或 interval）與 `dashboards`（要看哪些）
- 到了時間就觸發一個 Inspection Run
- 支援「手動 launch」：人類或 API 呼叫立即觸發

### 3.2 Inspection Engine（巡檢執行器）
- 一次巡檢做一件事：**跑完一個 job 的全部 dashboard**
- 記錄每個 panel 的狀態（ok / warn / crit / error）
- 產出巡檢報告，可寫入 status / log

### 3.3 閾值過濾層（Filter）—— 省成本關鍵
> 「全量丟 AI 解讀」很貴。設計成先過濾，只有異常才見 AI。

- 每個 dashboard 可定義 panel 的規則（例如：`p99 > 1s` 或 `error_rate > 5%`）
- 也可用「與歷史比對」：這輪 vs 上一輪，差異過大才叫異常
- 過濾通過的 panel 才送 AI 解讀成因

### 3.4 AI 解讀
- 把「異常 panel 的資料」交給 metrics agent / commander 解讀
- 輸出：根因判斷、嚴重程度、建議

### 3.5 通知（tChat）
- 有異常 → `tchat_send` 到值班 channel
- 通知內容：哪個 dashboard、哪個 panel、數值、AI 判斷、建議
- 可做「靜默期 / 去重」避免同一問題狂刷

## 4. Job 設定檔格式（config-driven 初版）

```jsonc
// jobs/payment.json
{
  "id": "payment-inspection",
  "name": "Payment Service 巡檢",
  "schedule": {
    "type": "interval",      // interval | cron
    "every": "5m"            // 每 5 分鐘
  },
  "dashboards": [
    {
      "uid": "abc123",       // Grafana dashboard UID
      "rules": [              // 閾值規則（過濾層用）
        { "panel": "p99 latency", "target": "histogram_quantile(...)", "crit": "> 1s" }
      ]
    }
  ],
  "notify": {
    "channel": "sre-oncall",   // tChat channel
    "min_severity": "warn"     // 至少 warn 才通知
  }
}
```

## 5. 資料流向走讀（一次正常巡檢）

1. Scheduler 到點 → Inspection Engine 收到 job
2. Engine 對 dashboard `abc123` 呼叫 `grafana_get_dashboard` → 得到所有 panel 定義
3. 對每個 panel 呼叫 `grafana_query_panel` 撈數值
4. Filter 用 rules 判斷哪幾個 panel 異常
5. 異常 panel 資料 → dispatch 給 AI agent 解讀成因
6. AI 判斷嚴重程度 → 若 ≥ warn → `tchat_send` 給值班
7. 全部寫入巡檢報告（status）

## 6. 新增的 API（供 UI / 手動觸發）

```
GET  /api/inspect/jobs          — 列出所有巡檢任務
POST /api/inspect/run           — 手動立即執行某個 job
GET  /api/inspect/reports        — 巡檢歷史報告
GET  /api/inspect/status         — 目前 status 狀態
```

## 7. 實作路線圖（分階段，先把最小可跑通做起來）

### Phase A — 最小可跑通（先證實價值）
- Scheduler（interval 觸發）
- Inspection Engine（跑一個 job）
- 抓 dashboard + panel（用現有 grafana tools）
- 簡單閾值規則過濾
- 異常 → tchat_send
- jobs/*.json 設定
- **不做**：AI 解讀（先規則直接通知）、UI、cron、去重

### Phase B — 加 AI 解讀
- 異常 panel 才 dispatch AI agent 解讀成因
- 嚴重程度判定
- 去重 / 靜默期
- 巡檢報告寫檔

### Phase C — 完整化
- cron 排程
- UI 管理 jobs / 看報告
- 與歷史比對的動態閾值
- 多種告警管道

## 8. 驗收標準（Phase A）
- [ ] 一個 job 設定後，能按 interval 自動觸發
- [ ] 能抓到 dashboard 全部 panel 資料
- [ ] 異常 panel（超過閾值）會被偵測
- [ ] 異常時 tchat_send 到指定 channel，內容含 dashboard/panel/數值
- [ ] 無異常時不發通知（只寫 status）
- [ ] 手動 `POST /api/inspect/run` 能立即執行一次

## 9. 開放決策（需你確認）
| 決策 | 預設 | 說明 |
|---|---|---|
| 巡檢策略 | B（規則過濾才 AI） | 省 token；若你 dashboard 很少可改全量 |
| 過濾方式 | 閾值規則 | 初期用手寫規則，後續可 AI 學習 |
| 任務管理 | config 檔 (jobs/*.json) | 快、先跑通；之後加 UI |
| 通知 | tchat_send 到指定 channel | 之後可加 email / webhook |
