/**
 * StatusBadge — Server connection status indicator.
 *
 * Shows a coloured dot + label.
 *   online  → green
 *   offline → red
 *   checking→ amber (pulse animation)
 */
interface StatusBadgeProps {
  status: "online" | "offline" | "checking";
}

const CONFIG: Record<
  StatusBadgeProps["status"],
  { dot: string; text: string; label: string }
> = {
  online: {
    dot: "bg-emerald-500",
    text: "text-emerald-600",
    label: "Online",
  },
  offline: {
    dot: "bg-red-500",
    text: "text-red-500",
    label: "Offline",
  },
  checking: {
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-500",
    label: "Connecting…",
  },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const c = CONFIG[status];
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} aria-hidden="true" />
      <span className={`font-medium ${c.text}`}>{c.label}</span>
    </div>
  );
}
