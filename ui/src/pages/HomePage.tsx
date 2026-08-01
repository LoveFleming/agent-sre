/**
 * HomePage — Platform landing page.
 *
 * Aggregates data from three endpoints:
 *   GET /api/health  → server status + uptime + tool count
 *   GET /api/crews   → agent roster
 *   GET /api/tools   → registered tools
 *
 * Layout sections:
 *   1. Hero — welcome + quick actions
 *   2. Stats row — agents / tools / uptime
 *   3. Agent grid — crew cards
 *   4. Tools by provider — grouped tool list
 */
import { useEffect, useState } from "react";
import type {
  Crew,
  HealthInfo,
  ToolEntry,
  ViewId,
} from "../types";
import { getProvider, formatUptime } from "../types";

interface HomePageProps {
  /** Navigate to another view (e.g. clicking "Start Chat" → console) */
  onNavigate: (view: ViewId) => void;
  /** Pre-fill a chat prompt and switch to console */
  onQuickAction?: (prompt: string) => void;
}

// ── Quick actions (mirrors SREConsole for consistency) ──

const QUICK_ACTIONS = [
  { id: "check-latency", label: "查延遲", prompt: "幫我查各服務的 p99 latency，看有沒有異常飆高的", icon: "🔍" },
  { id: "check-errors", label: "查錯誤率", prompt: "幫我查最近 1 小時的 5xx 錯誤率，哪些 service 最高？", icon: "🔴" },
  { id: "check-resources", label: "資源使用", prompt: "幫我查各 service 的 CPU 和 Memory 使用率，有沒有接近極限的？", icon: "💻" },
  { id: "check-alerts", label: "查看 Alerts", prompt: "目前有哪些 firing alerts？依嚴重程度排列", icon: "🚨" },
  { id: "health-check", label: "健康檢查", prompt: "做一次全面健康檢查：latency、error rate、resource usage", icon: "❤️" },
  { id: "security-scan", label: "安全掃描", prompt: "做一次基本安全掃描，檢查有沒有高風險問題", icon: "🔒" },
];

export default function HomePage({ onNavigate, onQuickAction }: HomePageProps) {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [hRes, cRes, tRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/crews"),
          fetch("/api/tools"),
        ]);
        if (!hRes.ok || !cRes.ok || !tRes.ok) {
          throw new Error("Failed to fetch platform data");
        }
        const [h, c, t] = await Promise.all([
          hRes.json() as Promise<HealthInfo>,
          cRes.json() as Promise<{ crews: Crew[] }>,
          tRes.json() as Promise<{ tools: ToolEntry[] }>,
        ]);
        if (cancelled) return;
        setHealth(h);
        setCrews(c.crews || []);
        setTools(t.tools || []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Group tools by provider ──
  const toolsByProvider = tools.reduce<Record<string, ToolEntry[]>>((acc, tool) => {
    const provider = getProvider(tool.source);
    (acc[provider] ||= []).push(tool);
    return acc;
  }, {});
  const providerNames = Object.keys(toolsByProvider).sort();

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-24 bg-stone-100 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-20 bg-stone-100 rounded-xl" />
          <div className="h-20 bg-stone-100 rounded-xl" />
          <div className="h-20 bg-stone-100 rounded-xl" />
        </div>
        <div className="h-48 bg-stone-100 rounded-xl" />
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
        <h2 className="text-lg font-bold text-stone-700">無法載入平台資料</h2>
        <p className="text-sm text-stone-400 mt-1">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      {/* ── 1. Hero ── */}
      <section className="rounded-xl bg-gradient-to-br from-stone-100 to-stone-50 border border-stone-200 p-6">
        <h1 className="text-xl font-bold text-stone-800">
          🛡️ SRE Agent Platform
        </h1>
        <p className="text-sm text-stone-500 mt-1">
          {crews.length} 位 AI Agent · {tools.length} 個工具 · 自動化事件排查
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() =>
                onQuickAction
                  ? onQuickAction(action.prompt)
                  : onNavigate("console")
              }
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
            >
              <span aria-hidden="true">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      </section>

      {/* ── 2. Stats row ── */}
      <section className="grid grid-cols-3 gap-4">
        <StatCard label="AI Agents" value={crews.length} icon="👥" />
        <StatCard label="MCP Tools" value={tools.length} icon="🔧" />
        <StatCard
          label="Uptime"
          value={formatUptime(health?.uptime)}
          icon="⏱️"
        />
      </section>

      {/* ── 3. Agent grid ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-stone-700 uppercase tracking-wide">
            Agent Team
          </h2>
          <button
            type="button"
            onClick={() => onNavigate("agents")}
            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
          >
            View all →
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {crews.map((crew) => (
            <button
              key={crew.id}
              type="button"
              onClick={() => onNavigate("console")}
              className="text-left p-4 rounded-xl bg-white border border-stone-200 hover:border-emerald-400 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl" aria-hidden="true">
                  {crew.emoji || "🤖"}
                </span>
                <span className="text-sm font-semibold text-stone-700 truncate">
                  {crew.title}
                </span>
              </div>
              {crew.codename && (
                <p className="text-xs text-stone-400 mb-1">{crew.codename}</p>
              )}
              <p className="text-xs text-stone-500 line-clamp-2">
                {crew.description || ""}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* ── 4. Tools by provider ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-stone-700 uppercase tracking-wide">
            Tools
          </h2>
          <button
            type="button"
            onClick={() => onNavigate("tools")}
            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
          >
            View all →
          </button>
        </div>
        <div className="space-y-2">
          {providerNames.map((provider) => (
            <div
              key={provider}
              className="p-3 rounded-xl bg-white border border-stone-200"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-stone-600 uppercase tracking-wide">
                  {provider}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-400">
                  {toolsByProvider[provider].length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {toolsByProvider[provider].map((tool) => (
                  <span
                    key={tool.name}
                    title={tool.definition.function.description}
                    className="text-xs px-2 py-1 rounded-md bg-stone-50 text-stone-500 border border-stone-100"
                  >
                    {tool.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── StatCard (internal) ──

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-white border border-stone-200">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base" aria-hidden="true">{icon}</span>
        <span className="text-xs text-stone-400 font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-stone-700">{value}</div>
    </div>
  );
}
