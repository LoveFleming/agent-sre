/**
 * ToolsPage — Tool management interface.
 *
 * Lists all registered MCP tools grouped by provider.
 * Phase 3 will add a full test panel; for now this is a read-only
 * view extracted from the original App.tsx.
 */
import { useState, useEffect } from "react";
import type { ToolEntry } from "../types";
import { getProvider } from "../types";

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/tools");
        if (!r.ok) throw new Error("Failed to fetch tools");
        const d = await r.json();
        if (cancelled) return;
        setTools(d.tools || []);
        // Auto-expand first provider
        if (d.tools?.length > 0) {
          setExpandedProvider(getProvider(d.tools[0].source));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Group by provider ──
  const providers = tools.reduce<Record<string, ToolEntry[]>>((acc, tool) => {
    const p = getProvider(tool.source);
    (acc[p] ||= []).push(tool);
    return acc;
  }, {});
  const providerNames = Object.keys(providers).sort();

  if (loading) {
    return (
      <div className="p-6 space-y-3 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-stone-100 rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-stone-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-bold text-stone-700">MCP Tools</h1>
        <span className="text-xs text-stone-400">
          {tools.length} tools · {providerNames.length} providers
        </span>
      </div>

      {providerNames.map((provider) => {
        const isExpanded = expandedProvider === provider;
        const providerTools = providers[provider];
        return (
          <div
            key={provider}
            className="rounded-xl bg-white border border-stone-200 overflow-hidden"
          >
            <button
              type="button"
              onClick={() =>
                setExpandedProvider(isExpanded ? null : provider)
              }
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-stone-50 transition-colors"
            >
              <span
                className="text-stone-400 transition-transform"
                style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
                aria-hidden="true"
              >
                ▶
              </span>
              <span className="text-sm font-bold text-stone-700 uppercase tracking-wide">
                {provider}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-400">
                {providerTools.length}
              </span>
            </button>

            {isExpanded && (
              <div className="border-t border-stone-100 divide-y divide-stone-50">
                {providerTools.map((tool) => (
                  <div key={tool.name} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono font-semibold text-emerald-600">
                        {tool.name}
                      </code>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">
                      {tool.definition.function.description}
                    </p>
                    {tool.definition.function.parameters?.properties &&
                      Object.keys(tool.definition.function.parameters.properties).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {Object.entries(
                            tool.definition.function.parameters.properties,
                          ).map(([param, schema]) => {
                            const paramType = schema?.type;
                            return (
                              <span
                                key={param}
                                className="text-xs px-1.5 py-0.5 rounded bg-stone-50 text-stone-400 font-mono"
                              >
                                {param}
                                {paramType && (
                                  <span className="text-stone-300 ml-1">
                                    : {paramType}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
