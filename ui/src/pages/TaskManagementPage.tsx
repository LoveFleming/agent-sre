/**
 * TaskManagementPage — Create, edit, and delete SRE tasks.
 *
 * Layout:
 *   ┌─────────────┬───────────────────────────┐
 *   │  Task List  │  Task Editor (form)       │
 *   │  (+ new)    │  name / desc / tools /    │
 *   │             │  rules / context / prompt │
 *   │             │  [Save] [Delete]          │
 *   └─────────────┴───────────────────────────┘
 *
 * Data flows through the REST CRUD API under /api/tasks.
 * Tools are fetched from /api/tools (grouped by provider).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Task,
  ToolEntry,
} from "../types";
import {
  emptyTaskDraft,
  getProvider,
  linesToText,
  textToLines,
} from "../types";

// ── Accent palette (matches HomePage / Sidebar "sunny" theme) ──
const ACCENT = "#10b981"; // emerald-500 — matches ConsolePage
const ACCENT_BG = "#ecfdf5"; // emerald-50
const ACCENT_TEXT = "#047857"; // emerald-700
const ACCENT_HOVER = "#059669"; // emerald-600
const DANGER = "#ef4444"; // red-500
const DANGER_HOVER = "#dc2626"; // red-600
const DANGER_BG = "#fef2f2"; // red-50

// ── Helpers ──

export default function TaskManagementPage() {
  // ── Server state ──
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Editor state ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Task>(emptyTaskDraft());
  const [creating, setCreating] = useState(false); // true while editing a NEW (unsaved) task
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── Load tasks + tools ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, toolsRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/tools"),
      ]);
      if (!tRes.ok) throw new Error(`Tasks load failed: ${tRes.status}`);
      if (!toolsRes.ok) throw new Error(`Tools load failed: ${toolsRes.status}`);
      const [tJson, toolsJson] = await Promise.all([tRes.json(), toolsRes.json()]);
      setTasks(tJson.tasks || []);
      setTools(toolsJson.tools || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Select a task to edit ──
  const selectTask = useCallback(
    (task: Task) => {
      setSelectedId(task.id);
      setDraft({ ...task, tools: [...task.tools] });
      setCreating(false);
      setSaveMsg(null);
    },
    [],
  );

  // ── Start a new task ──
  const startNewTask = useCallback(() => {
    setSelectedId(null);
    setDraft(emptyTaskDraft());
    setCreating(true);
    setSaveMsg(null);
  }, []);

  // ── Save (create or update) ──
  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) {
      setSaveMsg({ kind: "err", text: "Task name is required." });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description,
        tools: draft.tools,
        agentRules: draft.agentRules,
        context: draft.context,
        prompt: draft.prompt,
      };

      if (creating) {
        const r = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        const { task } = await r.json();
        await loadAll();
        selectTask(task);
        setSaveMsg({ kind: "ok", text: "Task created." });
      } else if (selectedId) {
        const r = await fetch(`/api/tasks/${encodeURIComponent(selectedId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        const { task } = await r.json();
        await loadAll();
        selectTask(task);
        setSaveMsg({ kind: "ok", text: "Saved." });
      }
    } catch (err) {
      setSaveMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }, [draft, creating, selectedId, loadAll, selectTask]);

  // ── Delete ──
  const handleDelete = useCallback(async () => {
    if (creating) {
      // Just discard the new-task draft
      startNewTask();
      setSaveMsg(null);
      return;
    }
    if (!selectedId) return;
    if (!window.confirm(`Delete task "${draft.name}"? This cannot be undone.`)) {
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/tasks/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      await loadAll();
      setSelectedId(null);
      setDraft(emptyTaskDraft());
      setCreating(false);
      setSaveMsg({ kind: "ok", text: "Task deleted." });
    } catch (err) {
      setSaveMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Delete failed",
      });
    } finally {
      setSaving(false);
    }
  }, [creating, selectedId, draft.name, loadAll, startNewTask]);

  // ── Toggle a tool on/off ──
  const toggleTool = useCallback(
    (toolName: string) => {
      setDraft((d) => {
        const has = d.tools.includes(toolName);
        return {
          ...d,
          tools: has
            ? d.tools.filter((t) => t !== toolName)
            : [...d.tools, toolName],
        };
      });
    },
    [],
  );

  // ── Show nothing selected? ──
  const nothingSelected = !selectedId && !creating;

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="flex h-full">
        <div className="w-72 border-r border-stone-200 bg-stone-50 p-4 space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-stone-100 rounded-xl" />
          ))}
        </div>
        <div className="flex-1 p-6 space-y-4 animate-pulse">
          <div className="h-8 bg-stone-100 rounded-lg w-1/3" />
          <div className="h-24 bg-stone-100 rounded-xl" />
          <div className="h-40 bg-stone-100 rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
        <h2 className="text-lg font-bold text-stone-700">無法載入資料</h2>
        <p className="text-sm text-stone-400 mt-1">{error}</p>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="mt-4 px-4 py-2 text-sm rounded-lg text-white transition-colors"
          style={{ backgroundColor: ACCENT }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = ACCENT_HOVER;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = ACCENT;
          }}
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Task list ── */}
      <aside
        className="w-72 border-r border-stone-200 bg-stone-50 flex flex-col shrink-0"
        aria-label="Task list"
      >
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-xs font-bold text-stone-400 uppercase tracking-wide">
            Tasks
          </h2>
          <button
            type="button"
            onClick={startNewTask}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: ACCENT }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = ACCENT_HOVER;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = ACCENT;
            }}
          >
            <span aria-hidden="true">+</span> New Task
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tasks.length === 0 ? (
            <p className="px-4 py-6 text-xs text-stone-400 text-center">
              No tasks yet. Click <span className="font-semibold">+ New Task</span> to create one.
            </p>
          ) : (
            <ul role="list" className="py-1">
              {tasks.map((t) => {
                const isActive = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectTask(t)}
                      aria-current={isActive ? "true" : undefined}
                      className="w-full text-left px-4 py-2.5 border-l-[3px] transition-colors"
                      style={{
                        borderLeftColor: isActive ? ACCENT : "transparent",
                        backgroundColor: isActive ? ACCENT_BG : undefined,
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = ACCENT_BG;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = "";
                        }
                      }}
                    >
                      <div
                        className="text-sm font-medium truncate"
                        style={{
                          color: isActive ? ACCENT_TEXT : "#44403c",
                        }}
                      >
                        {t.name || "(untitled)"}
                      </div>
                      {t.description && (
                        <p className="text-xs text-stone-400 line-clamp-1 mt-0.5">
                          {t.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {t.tools.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-500">
                            {t.tools.length} tools
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Right: Editor ── */}
      <section
        className="flex-1 overflow-y-auto"
        aria-label="Task editor"
      >
        {nothingSelected ? (
          <EmptyState onNewTask={startNewTask} />
        ) : (
          <div className="p-6 max-w-3xl space-y-6">
            {/* ── Header ── */}
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-stone-700">
                {creating ? "New Task" : "Edit Task"}
              </h1>
              {saveMsg && (
                <span
                  role="status"
                  aria-live="polite"
                  className="text-xs px-2 py-1 rounded-md"
                  style={{
                    backgroundColor:
                      saveMsg.kind === "ok" ? ACCENT_BG : DANGER_BG,
                    color: saveMsg.kind === "ok" ? ACCENT_TEXT : DANGER,
                  }}
                >
                  {saveMsg.text}
                </span>
              )}
            </div>

            {/* ── Name ── */}
            <Field label="Name" required>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Payment Service 健康巡檢"
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400"
              />
            </Field>

            {/* ── Description ── */}
            <Field label="Description">
              <textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                placeholder="What does this task do?"
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 resize-y"
              />
            </Field>

            {/* ── Tools selection ── */}
            <Field
              label="Tools"
              hint={`${draft.tools.length} selected · ${tools.length} available`}
            >
              <ToolPicker
                tools={tools}
                selected={draft.tools}
                onToggle={toggleTool}
              />
            </Field>

            {/* ── Agent rules ── */}
            <fieldset className="rounded-xl bg-white border border-stone-200 p-4">
              <legend className="px-2 text-sm font-semibold text-stone-600">
                Agent Rules
              </legend>
              <div className="space-y-4">
                <LinesField
                  label="Guardrails"
                  description="Hard constraints the agent must respect (one per line)."
                  value={linesToText(draft.agentRules.guardrails)}
                  onChange={(text) =>
                    setDraft({
                      ...draft,
                      agentRules: {
                        ...draft.agentRules,
                        guardrails: textToLines(text),
                      },
                    })
                  }
                  placeholder={"Don't delete production resources\nDon't restart pods without confirmation"}
                />
                <LinesField
                  label="Redirect Rules"
                  description="Requests to send to another person or channel (one per line)."
                  value={linesToText(draft.agentRules.redirectRules)}
                  onChange={(text) =>
                    setDraft({
                      ...draft,
                      agentRules: {
                        ...draft.agentRules,
                        redirectRules: textToLines(text),
                      },
                    })
                  }
                  placeholder={"查 log → 趙明軒\n執行處置 → 黃志強"}
                />
                <LinesField
                  label="Refuse Topics"
                  description="Topics the agent must refuse to handle (one per line)."
                  value={linesToText(draft.agentRules.refuseTopics)}
                  onChange={(text) =>
                    setDraft({
                      ...draft,
                      agentRules: {
                        ...draft.agentRules,
                        refuseTopics: textToLines(text),
                      },
                    })
                  }
                  placeholder={"寫程式碼\n架構設計"}
                />
              </div>
            </fieldset>

            {/* ── Context ── */}
            <Field label="Context">
              <textarea
                value={draft.context}
                onChange={(e) =>
                  setDraft({ ...draft, context: e.target.value })
                }
                placeholder="Additional project / domain knowledge injected into the agent."
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 resize-y"
              />
            </Field>

            {/* ── Prompt ── */}
            <Field label="Prompt">
              <textarea
                value={draft.prompt}
                onChange={(e) =>
                  setDraft({ ...draft, prompt: e.target.value })
                }
                placeholder="System / role prompt for the agent."
                rows={4}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 resize-y font-mono"
              />
            </Field>

            {/* ── Action bar ── */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !draft.name.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: ACCENT }}
                onMouseEnter={(e) => {
                  if (!saving && draft.name.trim()) {
                    e.currentTarget.style.backgroundColor = ACCENT_HOVER;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = ACCENT;
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving || (creating && nothingSelected)}
                className="px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  borderColor: DANGER,
                  color: DANGER,
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!saving) {
                    e.currentTarget.style.backgroundColor = DANGER_BG;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {creating ? "Cancel" : "Delete"}
              </button>
            </div>

            {/* ── Timestamps (existing tasks only) ── */}
            {!creating && draft.createdAt && (
              <p className="text-xs text-stone-400 pt-2 border-t border-stone-100">
                Created {new Date(draft.createdAt).toLocaleString()}
                {draft.updatedAt !== draft.createdAt && (
                  <> · Updated {new Date(draft.updatedAt).toLocaleString()}</>
                )}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

/** Empty state shown when no task is selected. */
function EmptyState({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="text-5xl mb-3 select-none" aria-hidden="true">📋</div>
      <h2 className="text-lg font-bold text-stone-700">Select a Task</h2>
      <p className="text-sm text-stone-400 mt-1 max-w-sm">
        Pick a task from the list to edit it, or create a new one.
      </p>
      <button
        type="button"
        onClick={onNewTask}
        className="mt-4 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
        style={{ backgroundColor: ACCENT }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = ACCENT_HOVER;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = ACCENT;
        }}
      >
        + New Task
      </button>
    </div>
  );
}

/** Labeled form field wrapper. */
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-semibold text-stone-600">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-xs text-stone-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Multi-line text field that edits a string[] (one item per line). */
function LinesField({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-stone-500">{label}</label>
      {description && (
        <p className="text-xs text-stone-400 mt-0.5 mb-1">{description}</p>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 resize-y"
      />
    </div>
  );
}

/** Tool selection panel — tools grouped by provider with checkboxes. */
function ToolPicker({
  tools,
  selected,
  onToggle,
}: {
  tools: ToolEntry[];
  selected: string[];
  onToggle: (toolName: string) => void;
}) {
  // Group by provider
  const providers = useMemo(() => {
    const acc: Record<string, ToolEntry[]> = {};
    for (const tool of tools) {
      const p = getProvider(tool.source);
      (acc[p] ||= []).push(tool);
    }
    return acc;
  }, [tools]);
  const providerNames = Object.keys(providers).sort();

  if (tools.length === 0) {
    return (
      <p className="text-xs text-stone-400 italic">
        No tools registered. Start the server to load tools.
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-white border border-stone-200 divide-y divide-stone-100">
      {providerNames.map((provider) => {
        const providerTools = providers[provider];
        const selectedCount = providerTools.filter((t) =>
          selected.includes(t.name),
        ).length;
        return (
          <div key={provider} className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-stone-600 uppercase tracking-wide">
                {provider}
              </span>
              {selectedCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                  {selectedCount}/{providerTools.length}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {providerTools.map((tool) => {
                const checked = selected.includes(tool.name);
                return (
                  <label
                    key={tool.name}
                    className="flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors"
                    style={{
                      backgroundColor: checked ? ACCENT_BG : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!checked) {
                        e.currentTarget.style.backgroundColor = "#fafaf9";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(tool.name)}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <span className="min-w-0">
                      <span
                        className="block text-xs font-mono font-semibold truncate"
                        style={{
                          color: checked ? ACCENT_TEXT : "#44403c",
                        }}
                      >
                        {tool.name}
                      </span>
                      <span className="block text-[11px] text-stone-400 line-clamp-1">
                        {tool.definition.function.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
