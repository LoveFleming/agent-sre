# Phase 1 設計：導航框架 + Home 頁

> **目標**：把現在的單頁 App 升級為有側欄導航的平台框架，首頁展示系統全貌。
> **涉及檔案**：4 新增 + 1 改寫
> **預估 effort**：Medium（~半天）

---

## 1. 現況分析

### 目前的 UI 結構
```
ui/index.html → ui/src/main.tsx → ui/src/App.tsx
                                    ├── "chat" tab (crew 列表 + 多對話)
                                    └── "tools" tab (tool 列表)
```

- `ui/src/App.tsx` — 簡單的兩個 tab（chat / tools），**沒有導航框架**
- `ui/SREConsole.tsx` — 功能豐富的 SRE Console（Dashboard + Agent Console），但 **import 路徑斷裂**（`../api`, `../utils`, `../i18n`, `../theme`, `../components/` 在 standalone 專案中不存在）
- `ui/SREDashboard.tsx` — 儀表板元件，同樣 import 斷裂
- 結論：**Phase 1 從 `ui/src/` 乾淨重建導航框架，不碰 SREConsole/SREDashboard**（它們在 Phase 4/5 時再適配）

### 後端已有 API
| Endpoint | 用途 | Home 頁需要？ |
|----------|------|:---:|
| `GET /api/health` | 健康檢查 | ✅ |
| `GET /api/crews` | 列出 6 個 agent | ✅ |
| `GET /api/tools` | 列出已註冊工具 | ✅ |

Phase 1 **不需要新增後端 API**，Home 頁用現有三個 endpoint 聚合即可。

---

## 2. 目標 UI 結構

```
┌──────────────────────────────────────────────────┐
│  ┌────────┬───────────────────────────────────┐  │
│  │        │                                   │  │
│  │ 🏠 Home│     [Page Content Area]           │  │
│  │ 👥 Agent│                                   │  │
│  │ 🔧 Tools│     ← 各 page 元件渲染處          │  │
│  │ 📋 Tasks│                                   │  │
│  │ 📊 Mon. │                                   │  │
│  │ 💬 Cons.│                                   │  │
│  │ ⚙ Config│                                   │  │
│  │        │                                   │  │
│  │ ────── │                                   │  │
│  │  Status│                                   │  │
│  └────────┴───────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 新增檔案清單

```
ui/src/
  App.tsx              ← 改寫：導航 shell
  types.ts             ← 新增：shared types
  components/
    Sidebar.tsx        ← 新增：左側導航欄
    StatusBadge.tsx    ← 新增：伺服器連線狀態
  pages/
    HomePage.tsx       ← 新增：平台首頁
    Placeholder.tsx    ← 新增：未開發頁面的佔位元件
```

---

## 3. Component 設計

### 3.1 App.tsx — 導航 Shell

**職責**：管理當前活躍頁面，渲染 Sidebar + Content Area。

```tsx
// 狀態：簡單的 view 切換，不用 react-router
type ViewId = "home" | "agents" | "tools" | "tasks" | "monitor" | "console" | "config";

// Nav 定義（單一真相來源，Sidebar 和 App 共用）
const NAV_ITEMS: NavItem[] = [
  { id: "home",    label: "Home",    icon: "🏠" },
  { id: "agents",  label: "Agents",  icon: "👥" },
  { id: "tools",   label: "Tools",   icon: "🔧" },
  { id: "tasks",   label: "Tasks",   icon: "📋", badge: "soon" },
  { id: "monitor", label: "Monitor", icon: "📊" },
  { id: "console", label: "Console", icon: "💬" },
  { id: "config",  label: "Config",  icon: "⚙️" },
];
```

**Data flow**：
```
App (useState<ViewId>)
 ├── Sidebar (props: items, activeId, onSelect)
 └── Content Area
      └── switch(view) → <HomePage/> | <Placeholder/>
```

### 3.2 Sidebar.tsx — 左側導航

**Props**：
```ts
interface SidebarProps {
  items: NavItem[];
  activeId: ViewId;
  onSelect: (id: ViewId) => void;
  healthStatus?: "online" | "offline" | "checking";
}
```

**UI 結構**：
- 頂部：Logo / 標題「🤖 Agent SRE」
- 中間：Nav items（active item 高亮）
- 底部：伺服器連線狀態 badge

**樣式（Tailwind）**：
- 固定寬度 `w-56`（224px）
- `bg-stone-50` 淺色背景 / `dark:bg-stone-900`
- Active item: `bg-stone-200` + 左側 `border-l-4` accent
- Hover: `bg-stone-100`

### 3.3 HomePage.tsx — 平台首頁

**資料需求**：
```ts
// 三個 fetch 平行呼叫
const [crews, setCrews] = useState<Crew[]>([]);
const [tools, setTools] = useState<ToolEntry[]>([]);
const [health, setHealth] = useState<HealthInfo | null>(null);

useEffect(() => {
  Promise.all([
    fetch("/api/health").then(r => r.json()),
    fetch("/api/crews").then(r => r.json()),
    fetch("/api/tools").then(r => r.json()),
  ]).then(([h, c, t]) => {
    setHealth(h);
    setCrews(c.crews || []);
    setTools(t.tools || []);
  });
}, []);
```

**頁面佈局（由上到下）**：

```
┌─────────────────────────────────────────────┐
│  Hero Section                                │
│  「Agent SRE Platform」                      │
│  副標題 + Commander 快捷入口按鈕              │
├─────────────────────────────────────────────┤
│  Stat Cards Row (4 cards)                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │Agents│ │Tools │ │Tasks │ │Health│        │
│  │  6   │ │  27  │ │ Soon │ │  ✓   │        │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
├─────────────────────────────────────────────┤
│  Quick Actions (grid 2x3)                    │
│  [查延遲] [查錯誤率] [查資源]                  │
│  [查Alerts] [健康檢查] [安全掃描]              │
├─────────────────────────────────────────────┤
│  Agent Roster (6 agent cards in 2 rows)      │
│  ┌────┐ ┌────┐ ┌────┐                        │
│  │🛡️ │ │📊 │ │📋 │                         │
│  └────┘ └────┘ └────┘                        │
│  ┌────┐ ┌────┐ ┌────┐                        │
│  │📖 │ │🔧 │ │🔒 │                         │
│  └────┘ └────┘ └────┘                        │
├─────────────────────────────────────────────┤
│  Tool Providers Overview                     │
│  grafana (6) | prometheus (3) | k8s (5) ...  │
└─────────────────────────────────────────────┘
```

**Stat Cards 細節**：
| Card | 數據來源 | Display |
|------|---------|---------|
| Agents | `crews.length` | 數字 + emoji |
| Tools | `tools.length` | 數字 + 依 provider 分組 |
| Tasks | — | 「Coming Soon」badge |
| Health | `/api/health` | ✓ Online / ✗ Offline |

**Quick Actions**：
複用 SREConsole 的 `QUICK_ACTIONS` 定義，點擊後跳轉到 Console 頁（Phase 5）。Phase 1 先做按鈕 UI + `onNavigate("console")` callback。

**Agent Roster**：
每個 agent 一張小卡片，顯示 emoji + title + codename + description（截斷）。點擊後跳轉到 Agents 詳情（Phase 2）。Phase 1 先做靜態展示。

### 3.4 types.ts — 共用型別

```ts
export type ViewId = "home" | "agents" | "tools" | "tasks" | "monitor" | "console" | "config";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  badge?: string;       // "soon" | "new" | 數字
}

export interface Crew {
  id: string;
  title: string;
  codename?: string;
  emoji?: string;
  description?: string;
  expertise?: string;
  imageUrl?: string;
  greeting?: string;
}

export interface ToolEntry {
  name: string;
  definition: { function: { name: string; description: string; parameters: any } };
  source?: string;  // "provider:grafana" 等
}

export interface HealthInfo {
  status: string;
  // 其他欄位依後端實際回傳
}
```

### 3.5 Placeholder.tsx — 佔位頁

```tsx
// 簡單的佔位元件，顯示頁面名稱 + "Phase N 即將推出"
function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="text-6xl mb-4">🚧</div>
      <h2 className="text-xl font-bold text-stone-700">{title}</h2>
      <p className="text-sm text-stone-400 mt-2">{phase}</p>
    </div>
  );
}
```

---

## 4. 實作步驟（Developer 按此順序）

### Step 1：建立 types.ts
- 新增 `ui/src/types.ts`，放入上述型別定義
- 從舊 `App.tsx` 提取 `Crew`, `ChatMsg`, `ToolEntry` 到這裡

### Step 2：建立 Sidebar 元件
- 新增 `ui/src/components/Sidebar.tsx`
- Props-driven，純展示元件

### Step 3：建立 HomePage
- 新增 `ui/src/pages/HomePage.tsx`
- 三個 fetch 平行載入資料
- Stat cards + Quick actions + Agent roster + Tool overview

### Step 4：建立 Placeholder
- 新增 `ui/src/pages/Placeholder.tsx`

### Step 5：改寫 App.tsx
- 把現在的 chat/tools tab 邏輯**保留為 Console 頁的內容**（Phase 5 會用到）
- 新 App.tsx 只負責導航框架
- Home 為預設頁面
- 其他 6 個頁面暫時用 Placeholder

### Step 6：驗證
- `npm run dev` 啟動
- 左側欄 7 個選單都能切換
- Home 頁顯示正確的 agents/tools/health 資料
- Quick action 按鈕和 agent 卡片有 hover 效果

---

## 5. 風格規範

沿用現有 App.tsx 的 Tailwind 風格：
- 主色調：`stone` 系列（warm gray）
- 圓角：`rounded-xl` 卡片
- 間距：`gap-4`, `p-4`
- 字體大小：標題 `text-xl`, 內文 `text-sm`, 數字 `text-3xl font-bold`
- 不引入新的 CSS framework 或 icon library

---

## 6. 不做的事（Phase 1 範圍外）

- ❌ 不碰 `ui/SREConsole.tsx` / `ui/SREDashboard.tsx`（Phase 4/5 適配）
- ❌ 不新增後端 API
- ❌ 不加 react-router（用 `useState` 切換 view 即可）
- ❌ 不做 responsive/手機版（Phase 後期再處理）
- ❌ 不做 auth/login
