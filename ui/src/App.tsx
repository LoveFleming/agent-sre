import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──
interface Crew {
  id: string;
  emoji?: string;
  codename?: string;
  title: string;
  description?: string;
  greeting?: string;
}
interface ChatMsg {
  role: "user" | "assistant" | "tool";
  content: string;
  ts?: string;
}
interface ToolEntry {
  name: string;
  definition: { function: { name: string; description: string; parameters: any } };
  source?: string;
}
interface ChatTab {
  crewId: string;
  title: string;
  emoji: string;
  messages: ChatMsg[];
}

const API = "";

const MODELS = [
  { id: "", label: "Default" },
  { id: "glm-5.1", label: "GLM 5.1" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
];

export default function App() {
  const [tab, setTab] = useState<"chat" | "tools">("chat");
  const [crews, setCrews] = useState<Crew[]>([]);
  const [chatTabs, setChatTabs] = useState<ChatTab[]>([]);
  const [activeTabIdx, setActiveTabIdx] = useState(-1);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("");
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const composingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Init ──
  useEffect(() => {
    fetch(`${API}/api/crews`).then(r => r.json()).then(d => setCrews(d.crews || []));
    fetch(`${API}/api/tools`).then(r => r.json()).then(d => setTools(d.tools || []));
  }, []);

  const activeTab = activeTabIdx >= 0 ? chatTabs[activeTabIdx] : null;

  // ── Open crew as tab ──
  const openCrew = useCallback(async (crew: Crew) => {
    // Check if tab already open
    const existing = chatTabs.findIndex(t => t.crewId === crew.id);
    if (existing >= 0) {
      setActiveTabIdx(existing);
      return;
    }

    // Load conversation
    let msgs: ChatMsg[] = [];
    try {
      const res = await fetch(`${API}/api/conversations/${encodeURIComponent(crew.id)}`);
      const data = await res.json();
      msgs = data.messages || [];
    } catch {}

    if (msgs.length === 0 && crew.greeting) {
      msgs = [{ role: "assistant", content: crew.greeting }];
    }

    const newTab: ChatTab = {
      crewId: crew.id,
      title: crew.codename || crew.title,
      emoji: crew.emoji || "👤",
      messages: msgs,
    };
    setChatTabs(prev => [...prev, newTab]);
    setActiveTabIdx(chatTabs.length); // will be the new last index
  }, [chatTabs]);

  // ── Close tab ──
  const closeTab = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = chatTabs.filter((_, i) => i !== idx);
    setChatTabs(newTabs);
    if (activeTabIdx === idx) {
      setActiveTabIdx(Math.max(0, idx - 1));
    } else if (activeTabIdx > idx) {
      setActiveTabIdx(activeTabIdx - 1);
    }
    if (newTabs.length === 0) setActiveTabIdx(-1);
  };

  // ── Send ──
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeTab || loading) return;
    setInput("");
    const userMsg: ChatMsg = { role: "user", content: text, ts: new Date().toISOString() };

    // Update tab messages
    setChatTabs(prev => prev.map((t, i) =>
      i === activeTabIdx ? { ...t, messages: [...t.messages, userMsg] } : t
    ));
    setLoading(true);
    try {
      const body: any = { crewId: activeTab.crewId, message: text };
      if (model) body.model = model;
      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const reply: ChatMsg = { role: "assistant", content: data.content || data.error || "Error", ts: new Date().toISOString() };
      setChatTabs(prev => prev.map((t, i) =>
        i === activeTabIdx ? { ...t, messages: [...t.messages, reply] } : t
      ));
    } catch (err: any) {
      const reply: ChatMsg = { role: "assistant", content: `❌ ${err.message}`, ts: new Date().toISOString() };
      setChatTabs(prev => prev.map((t, i) =>
        i === activeTabIdx ? { ...t, messages: [...t.messages, reply] } : t
      ));
    }
    setLoading(false);
  }, [input, activeTab, activeTabIdx, loading, model]);

  // ── Auto scroll ──
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeTab?.messages, loading]);

  return (
    <div className="flex h-screen bg-stone-100 text-stone-800">
      {/* ── Sidebar ── */}
      <div className="w-56 bg-white border-r border-stone-200 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-stone-200">
          <h1 className="text-base font-bold text-stone-800">🤖 Agent SRE</h1>
          <p className="text-xs text-stone-400">{crews.length} crew · {tools.length} tools</p>
        </div>
        <div className="px-3 py-2">
          <div className="text-xs font-semibold text-stone-400 mb-1">Crew</div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {crews.map(c => (
            <button
              key={c.id}
              onClick={() => openCrew(c)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                activeTab?.crewId === c.id
                  ? "bg-emerald-100 text-emerald-700 font-semibold"
                  : "hover:bg-stone-100 text-stone-600"
              }`}
            >
              <span className="text-lg">{c.emoji || "👤"}</span>
              <div className="min-w-0">
                <div className="text-sm truncate">{c.codename || c.title}</div>
                <div className="text-xs text-stone-400 truncate">{c.title}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top tabs */}
        <div className="flex items-center border-b border-stone-200 bg-white">
          <div className="flex items-center border-r border-stone-200 px-3 h-full">
            <button
              onClick={() => setTab("chat")}
              className={`px-3 py-2.5 text-sm transition-colors ${tab === "chat" ? "text-emerald-600 font-semibold" : "text-stone-400 hover:text-stone-600"}`}
            >💬</button>
            <button
              onClick={() => setTab("tools")}
              className={`px-3 py-2.5 text-sm transition-colors ${tab === "tools" ? "text-emerald-600 font-semibold" : "text-stone-400 hover:text-stone-600"}`}
            >
              🔧 <span className="ml-0.5 text-xs bg-emerald-500 text-white px-1 rounded-full">{tools.length}</span>
            </button>
          </div>

          {/* Chat tabs */}
          {tab === "chat" && (
            <div className="flex items-center overflow-x-auto flex-1 h-10">
              {chatTabs.map((t, i) => (
                <button
                  key={`${t.crewId}-${i}`}
                  onClick={() => setActiveTabIdx(i)}
                  className={`group flex items-center gap-1.5 px-3 py-2 text-xs border-r border-stone-200 transition-colors whitespace-nowrap ${
                    i === activeTabIdx ? "bg-stone-50 text-stone-800 font-semibold border-b-2 border-b-emerald-500" : "bg-white text-stone-500 hover:bg-stone-50"
                  }`}
                >
                  <span>{t.emoji}</span>
                  <span>{t.title}</span>
                  <span
                    onClick={(e) => closeTab(i, e)}
                    className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  >✕</span>
                </button>
              ))}
            </div>
          )}

          {/* Model selector */}
          <div className="flex items-center px-3 border-l border-stone-200 h-10">
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="text-xs border border-stone-300 rounded-lg px-2 py-1 bg-white text-stone-600 outline-none focus:border-emerald-400 cursor-pointer"
            >
              {MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Content area */}
        {tab === "chat" && (
          activeTab ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeTab.messages.filter(m => m.role !== "tool").map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] px-4 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      m.role === "user"
                        ? "bg-emerald-500 text-white"
                        : "bg-white border border-stone-200 text-stone-700"
                    }`}>{m.content}</div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex gap-1">
                      <Dot /> <Dot delay=".2s" /> <Dot delay=".4s" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="p-3 border-t border-stone-200 bg-white flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  onKeyDown={e => {
                    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                  placeholder="輸入訊息... (Enter 送出, Shift+Enter 換行)"
                  rows={1}
                  className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-emerald-400"
                  style={{ minHeight: "40px", maxHeight: "120px" }}
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-stone-300 text-white text-sm font-semibold rounded-lg transition-colors"
                >送出</button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-stone-400">
              <span className="text-5xl mb-3">🎖️</span>
              <p className="text-sm">從左側選擇一位 SRE Crew 開始對話</p>
            </div>
          )
        )}

        {tab === "tools" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {tools.map(t => <ToolCard key={t.name} tool={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Components ──

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="w-2 h-2 bg-stone-400 rounded-full animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}

function ToolCard({ tool }: { tool: ToolEntry }) {
  const fn = tool.definition.function;
  const params = fn.parameters?.properties || {};
  const [result, setResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const paramHint = Object.entries(params).map(([k, v]: [string, any]) =>
    `"${k}": "${v.description?.slice(0, 40) || v.type || ""}"`
  ).join(",\n  ");

  const test = async () => {
    setTesting(true);
    setResult("Loading...");
    try {
      const args = JSON.parse(textareaRef.current?.value || "{}");
      const res = await fetch(`${API}/api/tools/${encodeURIComponent(fn.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arguments: args }),
      });
      const data = await res.json();
      setResult(data.text || JSON.stringify(data, null, 2));
    } catch (err: any) {
      setResult(`❌ ${err.message}`);
    }
    setTesting(false);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-stone-800">🔧 {fn.name}</span>
        <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded">{tool.source || "built-in"}</span>
      </div>
      <p className="text-xs text-stone-500 mb-3 whitespace-pre-wrap">{fn.description}</p>
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          defaultValue={paramHint ? `{\n  ${paramHint}\n}` : "{}"}
          rows={Math.min(4, Object.keys(params).length || 1)}
          className="flex-1 font-mono text-xs border border-stone-300 rounded-lg p-2 resize-none outline-none focus:border-emerald-400 bg-stone-50"
        />
        <button
          onClick={test}
          disabled={testing}
          className="px-3 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-colors"
        >
          {testing ? "執行中..." : "測試"}
        </button>
      </div>
      {result !== null && (
        <pre className="mt-3 p-2 bg-stone-900 text-stone-100 rounded-lg text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">{result}</pre>
      )}
    </div>
  );
}
