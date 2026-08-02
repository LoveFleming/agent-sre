/**
 * Sidebar — Left-side navigation rail (tPAAW style).
 *
 * Visual language matches tPAAW:
 *   - Active: 3px left border accent + accent-bg background + accent text
 *   - Hover:  same accent-bg/text transition (non-active only)
 *   - Font weight: normal by default, semibold when active
 *
 * Props:
 *   items        — navigation items to render
 *   activeId     — currently active view
 *   onSelect     — callback when a nav item is clicked
 *   healthStatus — server connection status (shown at bottom)
 */
import type { NavItem, ViewId } from "../types";
import StatusBadge from "./StatusBadge";

// ── Accent palette (matches tPAAW NavItem defaults) ──
const ACCENT = "#f97316"; // orange-500
const ACCENT_BG = "#fff7ed"; // orange-50
const INACTIVE_TEXT = "#78716c"; // stone-500

interface SidebarProps {
  items: NavItem[];
  activeId: ViewId;
  onSelect: (id: ViewId) => void;
  healthStatus: "online" | "offline" | "checking";
}

export default function Sidebar({
  items,
  activeId,
  onSelect,
  healthStatus,
}: SidebarProps) {
  return (
    <nav
      className="flex flex-col w-56 bg-stone-50 border-r border-stone-200 shrink-0"
      aria-label="Main navigation"
    >
      {/* ── Logo / Title ── */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-stone-200">
        <span className="text-xl" aria-hidden="true">🤖</span>
        <span className="text-sm font-bold text-stone-700 tracking-wide">
          Agent SRE
        </span>
      </div>

      {/* ── Nav items ── */}
      <ul className="flex-1 py-2" role="list">
        {items.map((item) => {
          const isActive = item.id === activeId;
          const isDisabled = item.badge === "soon";
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => !isDisabled && onSelect(item.id)}
                disabled={isDisabled}
                aria-current={isActive ? "page" : undefined}
                className="flex w-full items-center justify-between pr-4 py-2 text-left text-[15px] transition-colors"
                style={{
                  paddingLeft: isActive ? "26px" : "28px",
                  borderLeft: isActive
                    ? `3px solid ${ACCENT}`
                    : "3px solid transparent",
                  backgroundColor: isActive ? ACCENT_BG : undefined,
                  color: isActive ? ACCENT : INACTIVE_TEXT,
                  fontWeight: isActive ? 600 : 400,
                  cursor: isDisabled ? "not-allowed" : undefined,
                  opacity: isDisabled ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isActive && !isDisabled) {
                    e.currentTarget.style.backgroundColor = ACCENT_BG;
                    e.currentTarget.style.color = ACCENT;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive && !isDisabled) {
                    e.currentTarget.style.backgroundColor = "";
                    e.currentTarget.style.color = INACTIVE_TEXT;
                  }
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="text-[15px] shrink-0"
                    style={{ width: 16, textAlign: "center" }}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-stone-200 text-stone-500">
                    {item.badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* ── Server status ── */}
      <div className="border-t border-stone-200">
        <StatusBadge status={healthStatus} />
      </div>
    </nav>
  );
}
