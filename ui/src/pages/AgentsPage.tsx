/**
 * AgentsPage — Create, edit, and delete SRE agents.
 *
 * Layout:
 *   ┌──────────────┬────────────────────────────────┐
 *   │  Agent List  │  Agent Editor (form)           │
 *   │  (+ new)     │  name / desc / notify target / │
 *   │              │  schedule / cooldown / enabled │
 *   │              │  tools / rules / context /     │
 *   │              │  prompt / [Save] [Delete]      │
 *   └──────────────┴────────────────────────────────┘
 *
 * Data flows through the REST CRUD API under /api/agents (TASK-002/003;
 * the legacy /api/tasks endpoints are deprecated). Server errors come
 * back as `{ error: string }` with 400/404 and are surfaced in the
 * editor status line — never dropped (regression rule from `edf2daa`).
 *
 * Fields beyond the legacy Task shape (ADR-003):
 *   - schedule: 5-field cron expression, empty = manual-only agent
 *   - notifyTarget: { targetType: "user"|"channel", targetId }
 *   - cooldownMinutes: positive integer (default 30)
 *   - enabled: boolean toggle gating the scheduler
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Agent,
  ToolEntry,
} from "../types";
import {
  emptyAgentDraft,
  getProvider,
  isValidCron,
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

/** Extract a readable error message from an API error body (`{ error }`). */
function apiErrorMessage(status: number, body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return `HTTP ${status}`;
}

export default function AgentsPage() {
  // ── Server state ──
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Editor state ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Agent>(emptyAgentDraft());
  const [creating, setCreating] = useState(false); // true while editing a NEW (unsaved) agent
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── IME composition guard (Enter-to-save must not fire mid-composition) ──
  const composingRef = useRef(false);

  // ── Load agents + tools ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, toolsRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/tools"),
      ]);
      if (!aRes.ok) throw new Error(`Agents load failed: ${aRes.status}`);
      if (!toolsRes.ok) throw new Error(`Tools load failed: ${toolsRes.status}`);
      const [aJson, toolsJson] = await Promise.all([aRes.json(), toolsRes.json()]);
      setAgents(aJson.agents || []);
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

  // ── Select an agent to edit ──
  const selectAgent = useCallback(
    (agent: Agent) => {
      setSelectedId(agent.id);
      setDraft({
        ...agent,
        // Defensive copies so editing never mutates the list entry
        allowedTools: [...agent.allowedTools],
        agentRules: {
          guardrails: [...agent.agentRules.guardrails],
          redirectRules: [...agent.agentRules.redirectRules],
          refuseTopics: [...agent.agentRules.refuseTopics],
        },
        notifyTarget: { ...agent.notifyTarget },
      });
      setCreating(false);
      setSaveMsg(null);
    },
    [],
  );

  // ── Start a new agent ──
  const startNewAgent = useCallback(() => {
    setSelectedId(null);
    setDraft(emptyAgentDraft());
    setCreating(true);
    setSaveMsg(null);
  }, []);

  // ── Save (create or update) ──
  const handleSave = useCallback(async () => {
    // Client-side validation first — catches obvious mistakes without a
    // round-trip; the server re-validates authoritatively (agent-store).
    // Order: name → schedule → notify target → cooldown.
    const schedule = draft.schedule?.trim() || null;
    const targetId = draft.notifyTarget.targetId.trim();
    if (!draft.name.trim()) {
      setSaveMsg({ kind: "err", text: "Agent name is required." });
      return;
    }
    if (schedule !== null && !isValidCron(schedule)) {
      setSaveMsg({
        kind: "err",
        text: `Schedule must have 5 fields (min hour day month weekday), e.g. */5 * * * * — got "${schedule}".`,
      });
      return;
    }
    if (!targetId) {
      setSaveMsg({ kind: "err", text: "Notify target id is required." });
      return;
    }
    if (
      !Number.isInteger(draft.cooldownMinutes) ||
      draft.cooldownMinutes < 1
    ) {
      setSaveMsg({
        kind: "err",
        text: "Cooldown must be a whole number of minutes (≥ 1).",
      });
      return;
    }

    setSaving(true);
    setSaveMsg(null);
    const payload = {
      name: draft.name.trim(),
      description: draft.description,
      context: draft.context,
      prompt: draft.prompt,
      agentRules: draft.agentRules,
      allowedTools: draft.allowedTools,
      schedule,
      notifyTarget: {
        targetType: draft.notifyTarget.targetType,
        targetId,
      },
      cooldownMinutes: draft.cooldownMinutes,
      enabled: draft.enabled,
    };

    try {
      if (creating) {
        const r = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(apiErrorMessage(r.status, d));
        }
        const { agent } = await r.json();
        await loadAll();
        selectAgent(agent);
        setSaveMsg({ kind: "ok", text: "Agent created." });
      } else if (selectedId) {
        const r = await fetch(`/api/agents/${encodeURIComponent(selectedId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(apiErrorMessage(r.status, d));
        }
        const { agent } = await r.json();
        await loadAll();
        selectAgent(agent);
        setSaveMsg({ kind: "ok", text: "Agent saved." });
      }
    } catch (err) {
      setSaveMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }, [creating, selectedId, draft, loadAll, selectAgent]);

  // ── Delete the selected agent (confirm first) ──
  const handleDelete = useCallback(async () => {
    if (!selectedId || creating) return;
    if (!window.confirm(`Delete agent "${draft.name}"? This cannot be undone.`)) {
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(apiErrorMessage(r.status, d));
      }
      await loadAll();
      setDraft(emptyAgentDraft());
      setSelectedId(null);
      setCreating(false);
    } catch (err) {
      setSaveMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Delete failed",
      });
    } finally {
      setSaving(false);
    }
  }, [selectedId, creating, draft.name, loadAll]);

  // ── Enter-to-save on single-line inputs (IME-safe via composingRef) ──
  const handleEnterSave = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !composingRef.current) {
        e.preventDefault();
        void handleSave();
      }
    },
    [handleSave],
  );

  // ── Toggle a tool on/off ──
  const toggleTool = useCallback(
    (toolName: string) => {
      setDraft((d) => {
        const has = d.allowedTools.includes(toolName);
        return {
          ...d,
          allowedTools: has
            ? d.allowedTools.filter((t) => t !== toolName)
            : [...d.allowedTools, toolName],
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
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Agent list ── */}
      <aside
        className="w-72 border-r border-stone-200 bg-stone-50 flex flex-col shrink-0"
        aria-label="Agent list"
      >
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-xs font-bold text-stone-400 uppercase tracking-wide">
            Agents
          </h2>
          <button
            type="button"
            onClick={startNewAgent}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: ACCENT }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = ACCENT_HOVER;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = ACCENT;
            }}
          >
            + New Agent
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {agents.length === 0 ? (
            <p className="px-4 py-6 text-xs text-stone-400 text-center">
              No agents yet. Click <span className="font-semibold">+ New Agent</span> to create one.
            </p>
          ) : (
            <ul role="list" className="py-1">
              {agents.map((a) => {
                const isActive = a.id === selectedId;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => selectAgent(a)}
                      aria-current={isActive ? "true" : undefined}
                      className="w-full text-left px-4 py-2.5 border-l-[3px] transition-colors"
                      style={{
                        borderLeftColor: isActive ? ACCENT : "transparent",
                        backgroundColor: isActive ? ACCENT_BG : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = ACCENT_BG;
                          e.currentTarget.style.borderLeftColor = ACCENT_BG;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = "transparent";
                          e.currentTarget.style.borderLeftColor = "transparent";
                        }
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: a.enabled ? ACCENT : "#d6d3d1" }}
                        />
                        <span className="text-sm font-semibold text-stone-700 truncate">
                          {a.name}
                        </span>
                        <span
                          className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                          style={{
                            backgroundColor: a.enabled ? ACCENT_BG : "#f5f5f4",
                            color: a.enabled ? ACCENT_TEXT : "#a8a29e",
                          }}
                        >
                          {a.enabled ? "ON" : "OFF"}
                        </span>
                      </span>
                      <span className="block text-[11px] text-stone-400 font-mono truncate mt-0.5">
                        {a.schedule ? `⏰ ${a.schedule}` : "manual only"}
                      </span>
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
        aria-label="Agent editor"
      >
        {nothingSelected ? (
          <EmptyState onNewAgent={startNewAgent} />
        ) : (
          <div className="p-6 max-w-3xl space-y-6">
            {/* ── Header ── */}
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-stone-700">
                {creating ? "New Agent" : "Edit Agent"}
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
            <Field label="Name" required htmlFor="agent-name">
              <input
                id="agent-name"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onKeyDown={handleEnterSave}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder="e.g. CPU Watchdog"
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
                placeholder="What this agent watches / does"
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 resize-y"
              />
            </Field>

            {/* ── Notify target (required by the agent schema) ── */}
            <Field
              label="Notify Target"
              required
              hint="where scheduled run reports are delivered"
              htmlFor="agent-target-id"
            >
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="agent-target-type">Notify target type</label>
                <select
                  id="agent-target-type"
                  aria-label="Notify target type"
                  value={draft.notifyTarget.targetType}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      notifyTarget: {
                        ...draft.notifyTarget,
                        targetType: e.target.value as "user" | "channel",
                      },
                    })
                  }
                  className="px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 shrink-0"
                >
                  <option value="user">user</option>
                  <option value="channel">channel</option>
                </select>
                <label className="sr-only" htmlFor="agent-target-id">Target id</label>
                <input
                  id="agent-target-id"
                  type="text"
                  value={draft.notifyTarget.targetId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      notifyTarget: {
                        ...draft.notifyTarget,
                        targetId: e.target.value,
                      },
                    })
                  }
                  onKeyDown={handleEnterSave}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  placeholder="e.g. u-ops"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400"
                />
              </div>
            </Field>

            {/* ── Schedule (cron) ── */}
            <Field
              label="Schedule (cron)"
              hint="empty = manual only"
              htmlFor="agent-schedule"
            >
              <input
                id="agent-schedule"
                type="text"
                value={draft.schedule ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, schedule: e.target.value })
                }
                onKeyDown={handleEnterSave}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder="*/5 * * * * (every 5 minutes)"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400"
              />
              <p className="text-xs text-stone-400 mt-1">
                5 fields — <span className="font-mono">minute hour day-of-month month day-of-week</span>.
                Examples: <span className="font-mono">*/5 * * * *</span> every 5 min ·
                <span className="font-mono"> 0 9 * * 1-5</span> weekdays 09:00 ·
                leave empty for a manual-only agent.
              </p>
            </Field>

            {/* ── Cooldown + Enabled (side by side) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Cooldown (minutes)" hint="min gap between runs" htmlFor="agent-cooldown">
                <input
                  id="agent-cooldown"
                  type="number"
                  min={1}
                  step={1}
                  value={draft.cooldownMinutes === 0 ? "" : draft.cooldownMinutes}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cooldownMinutes: e.target.value === ""
                        ? 0
                        : parseInt(e.target.value, 10),
                    })
                  }
                  placeholder="30"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400"
                />
              </Field>

              <Field label="Enabled" hint="scheduler on/off">
                <div className="flex items-center h-[38px]">
                  <EnabledSwitch
                    checked={draft.enabled}
                    onChange={(enabled) => setDraft({ ...draft, enabled })}
                  />
                  <span className="ml-2 text-sm text-stone-500">
                    {draft.enabled ? "Active" : "Paused"}
                  </span>
                </div>
              </Field>
            </div>

            {/* ── Allowed tools ── */}
            <Field
              label="Allowed Tools"
              hint={`${draft.allowedTools.length} selected · ${tools.length} available`}
            >
              <ToolPicker
                tools={tools}
                selected={draft.allowedTools}
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
                  description="Topics this agent must decline to act on (one per line)."
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
                  placeholder={"人事異動\n薪資相關"}
                />
              </div>
            </fieldset>

            {/* ── Context ── */}
            <Field label="Context">
              <textarea
                value={draft.context}
                onChange={(e) => setDraft({ ...draft, context: e.target.value })}
                placeholder="Background knowledge injected into every run"
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 resize-y"
              />
            </Field>

            {/* ── Prompt ── */}
            <Field label="Prompt" required hint="system/role prompt" htmlFor="agent-prompt">
              <textarea
                id="agent-prompt"
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                placeholder="What the agent should do on each run"
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white text-stone-700 outline-none focus:border-emerald-400 resize-y"
              />
            </Field>

            {/* ── Actions ── */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = ACCENT_HOVER;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = ACCENT;
                }}
              >
                {saving ? "Saving…" : creating ? "Create Agent" : "Save"}
              </button>
              {!creating && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDelete()}
                  className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  style={{ color: DANGER, backgroundColor: DANGER_BG }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = DANGER_HOVER;
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = DANGER_BG;
                    e.currentTarget.style.color = DANGER;
                  }}
                >
                  Delete
                </button>
              )}
            </div>

            {/* ── Timestamps (existing agents only) ── */}
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

/** Empty state shown when no agent is selected. */
function EmptyState({ onNewAgent }: { onNewAgent: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="text-5xl mb-3 select-none" aria-hidden="true">👥</div>
      <h2 className="text-lg font-bold text-stone-700">Select an Agent</h2>
      <p className="text-sm text-stone-400 mt-1 max-w-sm">
        Pick an agent from the list to edit it, or create a new one.
      </p>
      <button
        type="button"
        onClick={onNewAgent}
        className="mt-4 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
        style={{ backgroundColor: ACCENT }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = ACCENT_HOVER;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = ACCENT;
        }}
      >
        + New Agent
      </button>
    </div>
  );
}

/** Labeled form field wrapper (with optional required marker + hint). */
function Field({
  label,
  required,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-stone-600">
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

/**
 * Accessible toggle switch (role="switch") for the agent enabled flag.
 * Visual: sliding knob on a pill track; accent when on, stone when off.
 */
function EnabledSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Toggle agent enabled"
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ backgroundColor: checked ? ACCENT : "#d6d3d1" }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(24px)" : "translateX(4px)" }}
      />
    </button>
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
      <p className="text-xs text-stone-400 px-3 py-2 border border-dashed border-stone-300 rounded-lg">
        No tools registered on the server.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {providerNames.map((provider) => {
        const providerTools = [...providers[provider]].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        return (
          <div key={provider}>
            <p className="text-[11px] font-bold text-stone-400 uppercase tracking-wide mb-1">
              {provider} ({providerTools.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {providerTools.map((tool) => {
                const checked = selected.includes(tool.name);
                return (
                  <label
                    key={tool.name}
                    className="flex items-start gap-2 px-2.5 py-2 rounded-lg border transition-colors cursor-pointer"
                    style={{
                      borderColor: checked ? ACCENT : "#e7e5e4",
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
