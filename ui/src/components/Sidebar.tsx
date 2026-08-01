/**
 * Sidebar — Left-side navigation rail.
 *
 * Props:
 *   items       — navigation items to render
 *   activeId    — currently active view
 *   onSelect    — callback when a nav item is clicked
 *   healthStatus — server connection status (shown at bottom)
 */
import type { NavItem, ViewId } from "../types";
import StatusBadge from "./StatusBadge";

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
      <ul className="flex-1 py-2 space-y-0.5" role="list">
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
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left ${
                  isActive
                    ? "bg-stone-200 text-stone-800 font-semibold border-l-4 border-emerald-500"
                    : isDisabled
                      ? "text-stone-400 cursor-not-allowed"
                      : "text-stone-600 hover:bg-stone-100 border-l-4 border-transparent"
                }`}
              >
                <span className="text-base shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
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
