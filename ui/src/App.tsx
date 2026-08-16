/**
 * App — Navigation shell for the Agent SRE Platform.
 *
 * Phase 1: Sidebar navigation + Home page + placeholder pages.
 * Console and Tools pages are functional (extracted from the
 * original single-tab App).
 *
 * State is simple view switching (no react-router). The shell also
 * tracks server health status for the Sidebar badge.
 */
import { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import HomePage from "./pages/HomePage";
import ConsolePage from "./pages/ConsolePage";
import ToolsPage from "./pages/ToolsPage";
import AgentsPage from "./pages/AgentsPage";
import Placeholder from "./pages/Placeholder";
import type { NavItem, ViewId } from "./types";

// ── Navigation items (single source of truth) ──

const NAV_ITEMS: NavItem[] = [
  { id: "home",    label: "Home",    icon: "🏠" },
  { id: "agents",  label: "Agents",  icon: "👥" },
  { id: "tools",   label: "Tools",   icon: "🔧" },
  { id: "monitor", label: "Monitor", icon: "📊" },
  { id: "console", label: "Console", icon: "💬" },
  { id: "config",  label: "Config",  icon: "⚙️" },
];

// ── Health check config ──

const HEALTH_INTERVAL_MS = 30_000;

export default function App() {
  const [view, setView] = useState<ViewId>("home");
  const [healthStatus, setHealthStatus] = useState<
    "online" | "offline" | "checking"
  >("checking");
  const [quickPrompt, setQuickPrompt] = useState<string | null>(null);

  // ── Periodic health check ──
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const r = await fetch("/api/health");
        if (cancelled) return;
        setHealthStatus(r.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setHealthStatus("offline");
      }
    };

    check();
    const timer = setInterval(check, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // ── Navigate to console with a pre-filled prompt ──
  const handleQuickAction = useCallback((prompt: string) => {
    setQuickPrompt(prompt);
    setView("console");
  }, []);

  const handlePromptConsumed = useCallback(() => {
    setQuickPrompt(null);
  }, []);

  return (
    <div className="flex h-screen bg-stone-100 text-stone-800">
      <Sidebar
        items={NAV_ITEMS}
        activeId={view}
        onSelect={setView}
        healthStatus={healthStatus}
      />

      {/* ── Content Area ── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {view === "home" && (
          <HomePage
            onNavigate={setView}
            onQuickAction={handleQuickAction}
          />
        )}

        {view === "console" && (
          <ConsolePage
            initialPrompt={quickPrompt}
            onPromptConsumed={handlePromptConsumed}
          />
        )}

        {view === "tools" && <ToolsPage />}

        {view === "agents" && <AgentsPage />}
        {view === "monitor" && (
          <Placeholder title="Monitor" phase="Phase 4 · SRE Dashboard integration" icon="📊" />
        )}
        {view === "config" && (
          <Placeholder title="Config" phase="Phase 7 · Provider & Crew settings" icon="⚙️" />
        )}
      </main>
    </div>
  );
}
