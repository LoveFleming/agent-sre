/**
 * MonitorWorkspace — SRE Agentic Monitoring workspace (MVP)
 *
 * Ported from the MVP HTML prototype + spec:
 *  - Left menu: monitor list (name / health dot / source · schedule / tags)
 *  - Outer tab sheet: one tab per opened monitor (close ≠ stop — the
 *    persistent AgentInstance keeps running in the backend)
 *  - Main: agent chat scoped to the instance + status bar
 *    (Run Now / Model Settings / last run / next run chips)
 *  - Create Monitor modal (name → source → resource → schedule → flow → output)
 *  - Model Settings modal: 10 sections (Overview…Output MCP)
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "./MonitorWorkspace.css";

// ── Types (mirror the server API shapes) ──

interface SourceMCP { id: string; type: string; resource: string; tools: string[] }
interface OutputMCP { id: string; type: string; target: string; approvalRequired?: boolean }
interface SchedulerCfg { triggerType: string; cron: string; timezone: string; timeoutMinutes: number; overlapPolicy: string; retry: number }
interface AgentCfg { agentName: string; role: string; mission: string; rules: string[]; prompt: string; skills: string[] }
interface MemoryPolicy { persistKnowledge: boolean; persistIncidents: boolean; workingMemoryTtlRuns: number }
interface MonitorDef {
  id: string; name: string; description: string; enabled: boolean;
  scheduler: SchedulerCfg; sourceMCPs: SourceMCP[]; processFlow: { templateId: string };
  agentConfig: AgentCfg; memoryPolicy: MemoryPolicy; outputMCPs: OutputMCP[];
  createdAt?: string; updatedAt?: string;
}
interface MonitorSummary {
  id: string; name: string; enabled: boolean; status: string; situation: string;
  sourceType: string; schedule: string; flowName: string;
  lastRunAt: string | null; nextRunAt: string | null; runCount: number;
}
interface InstanceState {
  instanceId: string; monitorId: string; monitorName: string;
  status: string; currentSituation: string; lastRunAt: string | null;
  lastRunResult: string | null; nextRunAt: string | null; runCount: number;
  workingMemory: { hypothesis: string; evidence: string[]; confidence: number | null; updatedAt: string | null };
  knowledgeMemory: string[]; incidentMemory: IncidentEntry[];
}
interface IncidentEntry { id: string; situation: string; severity: string; summary: string; confidence: number | null; recommendation: string; approvalRequired: boolean; open: boolean; createdAt: string }
interface ChatMsg { role: "user" | "assistant" | "tool"; content: string; ts?: string }
interface FlowNode { id: string; name: string; type: string; description: string }
interface FlowTemplate { id: string; name: string; description: string; nodes?: FlowNode[] }
interface MonitorMeta { flowTemplates: FlowTemplate[]; schedulePresets: Record<string, string>; sourceTypes: string[]; outputTypes: string[] }

const REFRESH_MS = 10_000;

const STATUS_LABEL: Record<string, string> = {
  idle: "Persistent Agent Running", watch: "Watch — active situation",
  running: "Agent Loop running…", error: "Last run failed", disabled: "Monitor disabled",
  unknown: "Unknown",
};

function dotClass(status: string) {
  if (status === "watch") return "mw-dot warn";
  if (status === "error") return "mw-dot err";
  if (status === "disabled" || status === "unknown") return "mw-dot off";
  return "mw-dot";
}
function pillClass(status: string) {
  if (status === "watch") return "mw-status-pill warn";
  if (status === "error") return "mw-status-pill err";
  if (status === "disabled" || status === "unknown") return "mw-status-pill off";
  return "mw-status-pill";
}
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

// IME composition guard (three-layer, per coding standards)
function useComposing() {
  const ref = useRef(false);
  return {
    handlers: {
      onCompositionStart: () => { ref.current = true; },
      onCompositionEnd: () => { ref.current = false; },
    },
    isComposing: () => ref.current,
  };
}

export default function MonitorWorkspace() {
  const [monitors, setMonitors] = useState<MonitorSummary[]>([]);
  const [meta, setMeta] = useState<MonitorMeta | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [detail, setDetail] = useState<{ monitor: MonitorDef; instance: InstanceState } | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const composing = useComposing();
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  }, []);

  const loadMonitors = useCallback(async () => {
    try {
      const r = await fetch("/api/monitors");
      if (!r.ok) return;
      const data = await r.json();
      const list: MonitorSummary[] = data.monitors || [];
      setMonitors(list);
      // Keep only still-existing tabs; default-select the first monitor.
      setOpenTabs(prev => {
        const ids = new Set(list.map(m => m.id));
        const kept = prev.filter(id => ids.has(id));
        return kept.length ? kept : (list.length ? [list[0].id] : []);
      });
      setActiveId(prev => {
        if (prev && list.some(m => m.id === prev)) return prev;
        return list.length ? list[0].id : "";
      });
    } catch { /* server offline — sidebar badge handles it */ }
  }, []);

  useEffect(() => {
    fetch("/api/monitor-meta").then(r => r.json()).then(setMeta).catch(() => {});
    loadMonitors();
    const timer = setInterval(loadMonitors, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadMonitors]);

  const openMonitor = useCallback((id: string) => {
    setOpenTabs(prev => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }, []);

  const closeTab = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const next = prev.filter(x => x !== id);
      if (activeId === id) setActiveId(next[next.length - 1] || "");
      return next;
    });
    showToast("Workspace tab closed. The Agent Instance is still running in the backend.");
  }, [activeId, showToast]);

  // Load detail + chat for the active monitor
  useEffect(() => {
    if (!activeId) { setDetail(null); setChat([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const [d, c] = await Promise.all([
          fetch(`/api/monitors/${activeId}`).then(r => r.json()),
          fetch(`/api/monitors/${activeId}/chat`).then(r => r.json()),
        ]);
        if (cancelled) return;
        setDetail(d.monitor ? d : null);
        setChat(Array.isArray(c.messages) ? c.messages : []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [chat, activeId]);

  const sendChat = useCallback(async (text?: string) => {
    const q = (text ?? chatInput).trim();
    if (!q || chatBusy || !activeId) return;
    setChatInput("");
    setChat(prev => [...prev, { role: "user", content: q, ts: new Date().toISOString() }]);
    setChatBusy(true);
    try {
      const r = await fetch(`/api/monitors/${activeId}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const data = await r.json();
      setChat(prev => [...prev, { role: "assistant", content: data.content || data.error || "(no reply)", ts: new Date().toISOString() }]);
    } catch (err) {
      setChat(prev => [...prev, { role: "assistant", content: `Request failed: ${(err as Error).message}`, ts: new Date().toISOString() }]);
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, chatBusy, activeId]);

  const runNow = useCallback(async () => {
    if (!activeId || runBusy) return;
    setRunBusy(true);
    setChat(prev => [...prev, { role: "tool", content: "Scheduler → manual run started (Agent Loop executing Process Flow…)" }]);
    try {
      const r = await fetch(`/api/monitors/${activeId}/run`, { method: "POST" });
      const data = await r.json();
      const res = data.result || {};
      setChat(prev => [...prev, { role: "tool", content: `Agent Loop → sources read → rules gate → ${res.quiet ? "healthy (quiet)" : "situation detected"}` }, { role: "assistant", content: res.summary || "(no summary)", ts: new Date().toISOString() }]);
      showToast(res.quiet ? "Manual run completed — healthy, stayed quiet" : "Manual run completed — situation recorded");
      loadMonitors();
      if (activeId) {
        const d = await fetch(`/api/monitors/${activeId}`).then(r2 => r2.json());
        if (d.monitor) setDetail(d);
      }
    } catch (err) {
      showToast(`Run failed: ${(err as Error).message}`);
    } finally {
      setRunBusy(false);
    }
  }, [activeId, runBusy, showToast, loadMonitors]);

  const activeSummary = useMemo(() => monitors.find(m => m.id === activeId) || null, [monitors, activeId]);
  const flowNodes = useMemo(() => meta?.flowTemplates?.find(f => f.id === detail?.monitor.processFlow.templateId) ?? meta?.flowTemplates?.[0] ?? [], [meta, detail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? monitors.filter(m => m.name.toLowerCase().includes(q) || m.sourceType.includes(q)) : monitors;
  }, [monitors, search]);

  return (
    <div className="monitor-workspace">
      {/* ── LEFT MENU ── */}
      <aside className="mw-sidebar">
        <div className="mw-brand">
          <div className="mw-logo">SRE</div>
          <div><b>Agentic Monitor</b><span>Persistent monitoring agents</span></div>
        </div>
        <input className="mw-search" placeholder="Search monitor..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="mw-group-title">Monitoring Agents</div>
        {filtered.map(m => (
          <div key={m.id} className={`mw-menu-item${m.id === activeId ? " active" : ""}`} onClick={() => openMonitor(m.id)}>
            <div className="mw-item-top"><b>{m.name}</b><span className={dotClass(m.status)} /></div>
            <p>{m.sourceType} MCP · {m.schedule}</p>
            <div className="mw-tags">
              <span className="mw-tag">Persistent Agent</span>
              <span className="mw-tag">{m.status === "watch" ? "Watch" : m.status === "error" ? "Error" : m.status === "disabled" ? "Disabled" : "Healthy"}</span>
            </div>
          </div>
        ))}
        <button className="mw-add" onClick={() => setShowCreate(true)}>＋ New Monitor</button>
      </aside>

      {/* ── MAIN ── */}
      <main className="mw-main">
        <div className="mw-topbar">
          <div className="left">
            <b>AI SRE Workspace</b>
            <span>Each tab attaches to one persistent Agent Instance</span>
          </div>
          <div className="mw-top-actions">
            <button className="mw-btn primary" onClick={() => setSettingsFor(activeId || null)} disabled={!activeId}>⚙ Model Settings</button>
          </div>
        </div>

        <div className="mw-tabsheet">
          {openTabs.map(id => {
            const m = monitors.find(x => x.id === id);
            return (
              <div key={id} className={`mw-app-tab${id === activeId ? " active" : ""}`} onClick={() => setActiveId(id)}>
                <span className="name">{m?.name || id.slice(0, 8)}</span>
                <button className="close" onClick={e => closeTab(e, id)}>×</button>
              </div>
            );
          })}
        </div>

        <div className="mw-workspace">
          {!activeId || !detail ? (
            <div className="mw-empty">
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📡</div>
                No monitor yet — click <b>＋ New Monitor</b> to create a persistent SRE agent.
              </div>
            </div>
          ) : (
            <section className="mw-chat-page">
              <div className="mw-model-bar">
                <div className="mw-model-info">
                  <div className="mw-avatar">AI</div>
                  <div>
                    <b>{detail.monitor.agentConfig.agentName}</b>
                    <p>{detail.monitor.sourceMCPs[0]?.type} MCP · {detail.monitor.sourceMCPs[0]?.resource}</p>
                  </div>
                </div>
                <div className="mw-model-actions">
                  <span className={pillClass(detail.instance.status)}>● {STATUS_LABEL[detail.instance.status] || detail.instance.status}</span>
                  <button className="mw-btn" onClick={runNow} disabled={runBusy}>{runBusy ? "Running…" : "Run Now"}</button>
                  <button className="mw-btn primary" onClick={() => setSettingsFor(activeId)}>⚙ Model Settings</button>
                </div>
              </div>

              <div className="mw-context-row">
                <span className="mw-chip">Last run · {fmtTime(activeSummary?.lastRunAt ?? detail.instance.lastRunAt)}</span>
                <span className="mw-chip">Next run · {fmtTime(activeSummary?.nextRunAt ?? detail.instance.nextRunAt)}</span>
                <span className="mw-chip">Scheduler · {detail.monitor.scheduler.cron}</span>
                <span className="mw-chip">Process Flow · {flowNodes?.name || detail.monitor.processFlow.templateId}</span>
                <span className="mw-chip">Memory · persistent</span>
                <span className="mw-chip">Output MCP · {detail.monitor.outputMCPs.length ? detail.monitor.outputMCPs.map(o => o.type).join(" + ") : "chat only"}</span>
                {detail.instance.currentSituation && <span className="mw-chip" style={{ color: "#ffe1a1" }}>Situation · {detail.instance.currentSituation}</span>}
              </div>

              <div className="mw-chat-scroll" ref={chatScrollRef}>
                <div className="mw-welcome">
                  <h2>{detail.monitor.name}</h2>
                  <p>
                    Persistent Agent Instance: {detail.instance.instanceId}. This tab is only a workspace attachment —
                    the scheduler and agent loop keep running when the tab is closed.
                  </p>
                  <div className="mw-suggestions">
                    {["Is this monitor healthy right now?", "What changed in the last hour?", "What are you investigating now?", "What do you remember about similar incidents?"].map(q => (
                      <button key={q} className="mw-suggest" onClick={() => sendChat(q)} disabled={chatBusy}>{q}</button>
                    ))}
                  </div>
                </div>
                {chat.map((msg, i) => {
                  if (msg.role === "tool") return <div key={i} className="mw-tool-call">{msg.content}</div>;
                  if (msg.role === "user") return <div key={i} className="mw-message-row user"><div className="mw-message user">{msg.content}</div></div>;
                  return <div key={i} className="mw-message-row"><div className="mw-mini-avatar">AI</div><div className="mw-message ai">{msg.content}</div></div>;
                })}
                {chatBusy && <div className="mw-message-row"><div className="mw-mini-avatar">AI</div><div className="mw-message ai">thinking…</div></div>}
              </div>

              <div className="mw-composer-wrap">
                <div className="mw-composer">
                  <textarea
                    placeholder="Ask this Monitoring Agent anything..."
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (composing.isComposing() || e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
                    }}
                    {...composing.handlers}
                  />
                  <div className="mw-composer-foot">
                    <div className="mw-composer-hints">
                      <span className="mw-chip">Agent scoped</span>
                      <span className="mw-chip">Evidence first</span>
                      <span className="mw-chip">Memory enabled</span>
                    </div>
                    <button className="mw-send" onClick={() => sendChat()} disabled={chatBusy || !chatInput.trim()}>Send</button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* ── MODALS ── */}
      {showCreate && meta && (
        <CreateMonitorModal
          meta={meta}
          onClose={() => setShowCreate(false)}
          onCreated={async (id) => {
            setShowCreate(false);
            await loadMonitors();
            openMonitor(id);
            showToast("Persistent Monitoring Agent created");
          }}
        />
      )}
      {settingsFor && meta && detail && (
        <ModelSettingsModal
          meta={meta}
          monitor={detail.monitor}
          instance={detail.instance}
          onClose={() => setSettingsFor(null)}
          onSaved={async () => {
            setSettingsFor(null);
            await loadMonitors();
            if (activeId) {
              const d = await fetch(`/api/monitors/${activeId}`).then(r => r.json());
              if (d.monitor) setDetail(d);
            }
            showToast("Monitoring Model saved");
          }}
          showToast={showToast}
        />
      )}

      <div className={`mw-toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  );
}

// ═══════════════ Create Monitor modal (spec §3) ═══════════════

function CreateMonitorModal({ meta, onClose, onCreated }: {
  meta: MonitorMeta; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("New API Monitor");
  const [agentName, setAgentName] = useState("");
  const [sourceType, setSourceType] = useState(meta.sourceTypes[0] || "grafana");
  const [resource, setResource] = useState("https://grafana.company/d/new-api");
  const [preset, setPreset] = useState("every-5m");
  const [flowId, setFlowId] = useState(meta.flowTemplates[0]?.id || "standard-sre");
  const [output, setOutput] = useState("ops");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/monitors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sourceMCPs: [{ type: sourceType, resource }],
          scheduler: { cron: preset },
          processFlow: { templateId: flowId },
          outputMCPs: output.trim() ? [{ type: "chat", target: output.trim() }] : [],
          ...(agentName.trim() ? { agentConfig: { agentName: agentName.trim() } } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onCreated(data.monitor.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mw-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mw-modal small">
        <div className="mw-modal-head">
          <div><b>Create Monitor Agent</b><span>Connect an MCP. Create an Agent. Start monitoring.</span></div>
          <button className="mw-x" onClick={onClose}>×</button>
        </div>
        <div className="mw-modal-body single">
          <div className="mw-create-content">
            <div className="mw-grid2">
              <div className="mw-field"><label>Monitor Name</label><input value={name} onChange={e => setName(e.target.value)} /></div>
              <div className="mw-field"><label>Agent Name (optional)</label><input placeholder={name ? `${name} Agent` : "New API SRE Agent"} value={agentName} onChange={e => setAgentName(e.target.value)} /></div>
            </div>
            <div className="mw-grid2">
              <div className="mw-field">
                <label>Source MCP</label>
                <select value={sourceType} onChange={e => setSourceType(e.target.value)}>
                  {meta.sourceTypes.map(t => <option key={t} value={t}>{t} MCP</option>)}
                </select>
              </div>
              <div className="mw-field">
                <label>Schedule</label>
                <select value={preset} onChange={e => setPreset(e.target.value)}>
                  {Object.entries(meta.schedulePresets).map(([id, cron]) => (
                    <option key={id} value={id}>{cron === "* * * * *" ? "Every minute" : cron === "0 * * * *" ? "Every hour" : `Every ${cron.replace("*/", "")} minutes`}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mw-field"><label>Resource / URL / target</label><input value={resource} onChange={e => setResource(e.target.value)} /></div>
            <div className="mw-grid2">
              <div className="mw-field">
                <label>Process Flow</label>
                <select value={flowId} onChange={e => setFlowId(e.target.value)}>
                  {meta.flowTemplates.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="mw-field"><label>Output MCP (chat channel, blank = none)</label><input value={output} onChange={e => setOutput(e.target.value)} /></div>
            </div>
            <div className="mw-block">
              <div className="mw-block-head"><b>Auto-generated defaults</b><span className="mw-pill">MVP</span></div>
              <p>Default prompt · Default rules · Standard skills · Empty persistent memory · Approval gate for production-changing actions.</p>
            </div>
            {error && <div className="mw-block" style={{ borderColor: "#652839" }}><p style={{ color: "#ffb3c0" }}>{error}</p></div>}
          </div>
        </div>
        <div className="mw-modal-foot">
          <button className="mw-btn" onClick={onClose}>Cancel</button>
          <button className="mw-btn good" onClick={create} disabled={busy || !name.trim() || !resource.trim()}>{busy ? "Creating…" : "Create Agent"}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════ Model Settings modal (spec §5 — 10 sections) ═══════════════

const SETTINGS_SECTIONS = [
  "overview", "scheduler", "source", "flow", "agent", "rules", "prompt", "skills", "memory", "output",
] as const;
type SectionId = typeof SETTINGS_SECTIONS[number];
const SECTION_LABEL: Record<SectionId, string> = {
  overview: "Overview", scheduler: "Scheduler", source: "Source MCP", flow: "Process Flow",
  agent: "Agent", rules: "Rules", prompt: "Prompt", skills: "Skills", memory: "Memory", output: "Output MCP",
};

function ModelSettingsModal({ meta, monitor, instance, onClose, onSaved, showToast }: {
  meta: MonitorMeta; monitor: MonitorDef; instance: InstanceState;
  onClose: () => void; onSaved: () => void; showToast: (m: string) => void;
}) {
  const [section, setSection] = useState<SectionId>("overview");
  const [draft, setDraft] = useState<MonitorDef>(JSON.parse(JSON.stringify(monitor)));
  const [knowledge, setKnowledge] = useState<string[]>(instance.knowledgeMemory || []);
  const [incidents, setIncidents] = useState<IncidentEntry[]>(instance.incidentMemory || []);
  const [busy, setBusy] = useState(false);

  // memory section loads fresh data
  useEffect(() => {
    if (section !== "memory") return;
    fetch(`/api/monitors/${monitor.id}/memory`).then(r => r.json()).then(d => {
      if (Array.isArray(d.knowledge)) setKnowledge(d.knowledge);
      if (Array.isArray(d.incidents)) setIncidents(d.incidents);
    }).catch(() => {});
  }, [section, monitor.id]);

  const flow = meta?.flowTemplates?.find(f => f.id === draft.processFlow.templateId) ?? null;
  const patch = (fn: (d: MonitorDef) => void) => setDraft(prev => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next; });

  const save = async () => {
    setBusy(true);
    try {
      const [mPut, kPut] = await Promise.all([
        fetch(`/api/monitors/${monitor.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        }),
        fetch(`/api/monitors/${monitor.id}/memory`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ knowledge }),
        }),
      ]);
      if (!mPut.ok) throw new Error((await mPut.json()).error || `HTTP ${mPut.status}`);
      if (!kPut.ok) throw new Error((await kPut.json()).error || `HTTP ${kPut.status}`);
      onSaved();
    } catch (err) {
      showToast(`Save failed: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="mw-overlay">
      <div className="mw-modal">
        <div className="mw-modal-head">
          <div><b>{draft.name} · Monitoring Model Settings</b><span>Configuration behind this persistent agent instance</span></div>
          <button className="mw-x" onClick={onClose}>×</button>
        </div>
        <div className="mw-modal-body">
          <nav className="mw-settings-nav">
            {SETTINGS_SECTIONS.map(id => (
              <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{SECTION_LABEL[id]}</button>
            ))}
          </nav>
          <div className="mw-settings-content">
            {section === "overview" && (
              <>
                <h3>Overview</h3>
                <div className="mw-grid2">
                  <div className="mw-field"><label>Monitor Name</label><input value={draft.name} onChange={e => patch(d => { d.name = e.target.value; })} /></div>
                  <div className="mw-field"><label>Agent Instance</label><input value={instance.instanceId} disabled /></div>
                </div>
                <div className="mw-field"><label>Description / Monitoring Objective</label><textarea value={draft.description} onChange={e => patch(d => { d.description = e.target.value; })} /></div>
                <div className="mw-field"><label>Enabled</label>
                  <select value={draft.enabled ? "yes" : "no"} onChange={e => patch(d => { d.enabled = e.target.value === "yes"; })}>
                    <option value="yes">Enabled — scheduler active</option>
                    <option value="no">Disabled — manual only</option>
                  </select>
                </div>
                <div className="mw-block"><div className="mw-block-head"><b>Lifecycle</b><span className="mw-pill">persistent</span></div>
                  <p>Closing the UI tab only detaches the workspace. Scheduler and Agent Loop continue in the backend.</p></div>
              </>
            )}

            {section === "scheduler" && (
              <>
                <h3>Scheduler</h3>
                <div className="mw-grid2">
                  <div className="mw-field">
                    <label>Trigger Type</label>
                    <select value={draft.scheduler.triggerType} onChange={e => patch(d => { d.scheduler.triggerType = e.target.value; })}>
                      <option value="interval">Interval</option><option value="cron">Cron</option><option value="event-fallback">Event + fallback</option>
                    </select>
                  </div>
                  <div className="mw-field">
                    <label>Timezone</label>
                    <select value={draft.scheduler.timezone} onChange={e => patch(d => { d.scheduler.timezone = e.target.value; })}>
                      <option>Asia/Taipei</option><option>UTC</option>
                    </select>
                  </div>
                </div>
                <div className="mw-grid2">
                  <div className="mw-field">
                    <label>Run Every (preset)</label>
                    <select value="" onChange={e => { if (e.target.value) patch(d => { d.scheduler.cron = e.target.value; }); }}>
                      <option value="">— pick a preset —</option>
                      {Object.entries(meta.schedulePresets).map(([id, cron]) => <option key={id} value={cron}>{id} ({cron})</option>)}
                    </select>
                  </div>
                  <div className="mw-field">
                    <label>Overlap Policy</label>
                    <select value={draft.scheduler.overlapPolicy} onChange={e => patch(d => { d.scheduler.overlapPolicy = e.target.value; })}>
                      <option value="skip">Skip if previous run active</option><option value="queue">Queue next</option>
                    </select>
                  </div>
                </div>
                <div className="mw-grid2">
                  <div className="mw-field"><label>Cron (5-field)</label><input value={draft.scheduler.cron} onChange={e => patch(d => { d.scheduler.cron = e.target.value; })} /></div>
                  <div className="mw-field"><label>Timeout (minutes)</label><input type="number" min={1} max={60} value={draft.scheduler.timeoutMinutes} onChange={e => patch(d => { d.scheduler.timeoutMinutes = parseInt(e.target.value) || 3; })} /></div>
                </div>
                <div className="mw-block"><div className="mw-block-head"><b>Next run</b><span className="mw-pill">preview</span></div><p>{fmtTime(instance.nextRunAt)} (from last tick)</p></div>
              </>
            )}

            {section === "source" && (
              <>
                <h3>Source MCP</h3>
                {draft.sourceMCPs.map((s, i) => (
                  <div className="mw-block" key={s.id || i}>
                    <div className="mw-block-head">
                      <b>{s.type} MCP</b>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span className="mw-pill green">bound</span>
                        {draft.sourceMCPs.length > 1 && (
                          <button className="mw-btn ghost" style={{ padding: "2px 8px" }} onClick={() => patch(d => { d.sourceMCPs.splice(i, 1); })}>remove</button>
                        )}
                      </div>
                    </div>
                    <div className="mw-grid2" style={{ marginTop: 8 }}>
                      <div className="mw-field">
                        <label>Type</label>
                        <select value={s.type} onChange={e => patch(d => { d.sourceMCPs[i].type = e.target.value; })}>
                          {meta.sourceTypes.map(t => <option key={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="mw-field"><label>Resource / URL</label><input value={s.resource} onChange={e => patch(d => { d.sourceMCPs[i].resource = e.target.value; })} /></div>
                    </div>
                  </div>
                ))}
                {draft.sourceMCPs.length < 5 && (
                  <button className="mw-btn" onClick={() => patch(d => { d.sourceMCPs.push({ id: "", type: meta.sourceTypes[0], resource: "", tools: [] }); })}>＋ Add Source MCP</button>
                )}
              </>
            )}

            {section === "flow" && (
              <>
                <h3>Process Flow</h3>
                <div className="mw-field">
                  <label>Template</label>
                  <select value={draft.processFlow.templateId} onChange={e => patch(d => { d.processFlow.templateId = e.target.value; })}>
                    {meta.flowTemplates.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                {flow && (
                  <>
                    <div className="mw-flow">
                      {flow.nodes?.map((n, i) => (
                        <React.Fragment key={n.id}>
                          {i > 0 && <span className="mw-flow-arrow">→</span>}
                          <div className={`mw-flow-node${n.type === "agentic" ? " agentic" : n.type === "gate" ? " gate" : ""}`}>{n.name}</div>
                        </React.Fragment>
                      ))}
                    </div>
                    {flow.nodes?.map((n, i) => (
                      <div className="mw-block" key={n.id}>
                        <div className="mw-block-head"><b>{i + 1} · {n.name}</b>
                          <span className={`mw-pill${n.type === "agentic" ? " yellow" : n.type === "gate" ? " green" : ""}`}>{n.type}</span>
                        </div>
                        <p>{n.description}</p>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}

            {section === "agent" && (
              <>
                <h3>Agent</h3>
                <div className="mw-grid2">
                  <div className="mw-field"><label>Agent Name</label><input value={draft.agentConfig.agentName} onChange={e => patch(d => { d.agentConfig.agentName = e.target.value; })} /></div>
                  <div className="mw-field"><label>Role</label><input value={draft.agentConfig.role} onChange={e => patch(d => { d.agentConfig.role = e.target.value; })} /></div>
                </div>
                <div className="mw-field"><label>Mission</label><textarea value={draft.agentConfig.mission} onChange={e => patch(d => { d.agentConfig.mission = e.target.value; })} /></div>
              </>
            )}

            {section === "rules" && (
              <>
                <h3>Rules</h3>
                {draft.agentConfig.rules.map((r, i) => (
                  <div className="mw-block" key={i}>
                    <div className="mw-block-head"><b>Rule {i + 1}</b>
                      <button className="mw-btn ghost" style={{ padding: "2px 8px" }} onClick={() => patch(d => { d.agentConfig.rules.splice(i, 1); })}>remove</button>
                    </div>
                    <textarea className="mw-field" style={{ marginTop: 8, minHeight: 50 }} value={r} onChange={e => patch(d => { d.agentConfig.rules[i] = e.target.value; })} />
                  </div>
                ))}
                <button className="mw-btn" onClick={() => patch(d => { d.agentConfig.rules.push("New rule…"); })}>＋ Add Rule</button>
              </>
            )}

            {section === "prompt" && (
              <>
                <h3>Prompt</h3>
                <div className="mw-field">
                  <label>System Prompt (role & behavior only — workflow lives in Process Flow / Rules)</label>
                  <textarea style={{ minHeight: 330 }} value={draft.agentConfig.prompt} onChange={e => patch(d => { d.agentConfig.prompt = e.target.value; })} />
                </div>
              </>
            )}

            {section === "skills" && (
              <>
                <h3>Skills</h3>
                <div className="mw-skill-grid">
                  {draft.agentConfig.skills.map((s, i) => (
                    <div className="mw-block" key={i}>
                      <div className="mw-block-head"><b>{s}</b>
                        <button className="mw-btn ghost" style={{ padding: "2px 8px" }} onClick={() => patch(d => { d.agentConfig.skills.splice(i, 1); })}>×</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input className="mw-field" style={{ marginBottom: 0 }} placeholder="Add skill…" onKeyDown={e => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v) { patch(d => { d.agentConfig.skills.push(v); }); (e.target as HTMLInputElement).value = ""; }
                    }
                  }} />
                </div>
              </>
            )}

            {section === "memory" && (
              <>
                <h3>Memory</h3>
                <div className="mw-block">
                  <div className="mw-block-head"><b>Knowledge Memory</b><span className="mw-pill">persistent · editable</span></div>
                  <textarea style={{ marginTop: 8, minHeight: 90, width: "100%", background: "#081522", color: "#eef6ff", border: "1px solid #29425e", borderRadius: 9, padding: 9 }}
                    placeholder="One entry per line — healthy baselines, known patterns, panel relationships…"
                    value={knowledge.join("\n")}
                    onChange={e => setKnowledge(e.target.value.split("\n").map(x => x.trim()).filter(Boolean))} />
                </div>
                <div className="mw-block">
                  <div className="mw-block-head"><b>Incident Memory</b><span className="mw-pill">persistent · auto</span></div>
                  {incidents.length === 0 ? <p>No incidents recorded yet.</p> : incidents.slice(-8).reverse().map(inc => (
                    <p key={inc.id}>🚨 {inc.situation} · {inc.severity} · conf {inc.confidence ?? "—"} · {inc.open ? "OPEN" : "closed"} · {fmtTime(inc.createdAt)}{inc.recommendation ? ` · 建議: ${inc.recommendation}` : ""}</p>
                  ))}
                </div>
                <div className="mw-block">
                  <div className="mw-block-head"><b>Working Memory</b><span className="mw-pill">live</span></div>
                  <p>Hypothesis: {instance.workingMemory.hypothesis || "—"}</p>
                  <p>Confidence: {instance.workingMemory.confidence ?? "—"} · Updated: {fmtTime(instance.workingMemory.updatedAt)}</p>
                </div>
              </>
            )}

            {section === "output" && (
              <>
                <h3>Output MCP</h3>
                {draft.outputMCPs.map((o, i) => (
                  <div className="mw-block" key={o.id || i}>
                    <div className="mw-block-head">
                      <b>{o.type} MCP</b>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span className={`mw-pill${o.approvalRequired ? " yellow" : " green"}`}>{o.approvalRequired ? "approval required" : "automatic"}</span>
                        <button className="mw-btn ghost" style={{ padding: "2px 8px" }} onClick={() => patch(d => { d.outputMCPs.splice(i, 1); })}>remove</button>
                      </div>
                    </div>
                    <div className="mw-grid2" style={{ marginTop: 8 }}>
                      <div className="mw-field">
                        <label>Type</label>
                        <select value={o.type} onChange={e => patch(d => { d.outputMCPs[i].type = e.target.value; d.outputMCPs[i].approvalRequired = e.target.value === "action"; })}>
                          {meta.outputTypes.map(t => <option key={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="mw-field"><label>Target (channel id)</label><input value={o.target} onChange={e => patch(d => { d.outputMCPs[i].target = e.target.value; })} /></div>
                    </div>
                  </div>
                ))}
                {draft.outputMCPs.length < 5 && (
                  <button className="mw-btn" onClick={() => patch(d => { d.outputMCPs.push({ id: "", type: "chat", target: "", approvalRequired: false }); })}>＋ Add Output MCP</button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="mw-modal-foot">
          <button className="mw-btn" onClick={onClose}>Cancel</button>
          <button className="mw-btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Model"}</button>
        </div>
      </div>
    </div>
  );
}
