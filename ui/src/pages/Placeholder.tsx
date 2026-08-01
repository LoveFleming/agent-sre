/**
 * Placeholder — Shown for pages not yet implemented.
 *
 * Props:
 *   title  — page display name
 *   phase  — which roadmap phase will deliver this page
 *   icon   — emoji to show (optional)
 */
interface PlaceholderProps {
  title: string;
  phase: string;
  icon?: string;
}

export default function Placeholder({ title, phase, icon = "🚧" }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="text-6xl mb-4 select-none" aria-hidden="true">
        {icon}
      </div>
      <h2 className="text-xl font-bold text-stone-700">{title}</h2>
      <p className="text-sm text-stone-400 mt-2">{phase}</p>
    </div>
  );
}
