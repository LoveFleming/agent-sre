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

const API = "";

export default function App() {
  const [tab, setTab] = useState<"chat" | "tools">("chat");
  const [crews, setCrews] = useState<Crew[]>([]);
  const [activeCrew, setActiveCrew] = useState<Crew | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const composingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Init ──
  useEffect(() => {
    fetch(`${API}/api/crews`).then(r => r.json()).then(d => setCrews(d.crews || []));
    fetch(`${API}/api/tools`).then(r => r.json()).then(d => setTools(d.tools || []));
  }, []);

  // ── Select crew ──
  const selectCrew = useCallback(async (crew: Crew) => {
    setActiveCrew(crew);
    try {
      const res = await fetch(`${API}/api/conversations/${encodeURIComponent(crew.id)}`);
      const data = await res.json();
      const msgs = data.messages || [];
      if (msgs.length === 0 && crew.greeting) {
        setMessages([{ role: "assistant", content: crew.greeting }]);
      } else {
        setMessages(msgs);
      }
    } catch { setMessages([]); }
  }, []);

  // ── Send ──
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeCrew || loading) return;
    setInput("");
    const userMsg: ChatMsg = { role: "user", content: text, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewId: activeCrew.id, message: text }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.content || data.error || "Error", ts: new Date().toISOString() }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}`, ts: new Date().toISOString() }]);
    }
    setLoading(false);
  }, [input, activeCrew, loading]);

  // ── Auto scroll ──
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  return (
    <div className="flex h-screen bg-stone-100 text-stone-800">
      {/* ── Sidebar ── */}
      <div className="w-64 bg-white border-r border-stone-200 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-stone-200">
          <h1 className="text-base font-bold text-stone-800">🤖 Agent SRE</h1>
          <p className="text-xs text-stone-400">{crews.length} crew · {tools.length} tools</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {crews.map(c => (
            <button
              key={c.id}
              onClick={() => selectCrew(c)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                activeCrew?.id === c.id ? "bg-emerald-100 text-emerald-700 font-semibold" : "hover:bg-stone-100 text-stone-600"
              }`}
            >
              <span className="text-xl">{c.emoji || "👤"}</span>
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
        {/* Tabs */}
        <div className="flex border-b border-stone-200 bg-white">
          <TabBtn active={tab === "chat"} onClick={() => setTab("chat")}>💬 Chat</TabBtn>
          <TabBtn active={tab === "tools"} onClick={() => setTab("tools")}>
            🔧 Tools <span className="ml-1 text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">{tools.length}</span>
          </TabBtn>
        </div>

        {/* Chat Panel */}
        {tab === "chat" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-stone-400">
                  <span className="text-5xl mb-3">{activeCrew?.emoji || "💬"}</span>
                  <p className="text-sm">{activeCrew ? "開始對話吧" : "選擇一位 SRE Crew 開始"}</p>
                </div>
              )}
              {messages.filter(m => m.role !== "tool").map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] px-4 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "bg-emerald-500 text-white"
                      : "bg-white border border-stone-200 text-stone-700"
                  }`}>
                    {m.content}
                  </div>
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
                disabled={!activeCrew}
                placeholder={activeCrew ? "輸入訊息... (Enter 送出)" : "先選擇一位 Crew"}
                rows={1}
                className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-emerald-400 disabled:bg-stone-50 disabled:text-stone-400"
                style={{ minHeight: "40px", maxHeight: "120px" }}
              />
              <button
                onClick={send}
                disabled={!activeCrew || loading || !input.trim()}
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-stone-300 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                送出
              </button>
            </div>
          </div>
        )}

        {/* Tools Panel */}
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-sm transition-colors border-b-2 ${
        active ? "text-emerald-600 border-emerald-500 font-semibold" : "text-stone-400 border-transparent hover:text-stone-600"
      }`}
    >
      {children}
    </button>
  );
}

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
