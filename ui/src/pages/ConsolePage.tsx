/**
 * ConsolePage — Chat interface (extracted from original App.tsx).
 *
 * Multi-tab conversations with crew selection, model selector,
 * and SSE streaming responses.
 *
 * Phase 5 will enhance this with the full SREConsole feature set.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Crew, ChatMsg, ToolEntry, ChatTab } from "../types";

const API = "";

const MODELS = [
  { id: "", label: "Default" },
  { id: "glm-5.1", label: "GLM 5.1" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
];

interface ConsolePageProps {
  /** Pre-filled prompt (from Home quick actions) */
  initialPrompt?: string | null;
  /** Reset the initial prompt after consuming */
  onPromptConsumed?: () => void;
}

export default function ConsolePage({
  initialPrompt,
  onPromptConsumed,
}: ConsolePageProps) {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [chatTabs, setChatTabs] = useState<ChatTab[]>([]);
  const [activeTabIdx, setActiveTabIdx] = useState(-1);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("");
  const composingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Init ──
  useEffect(() => {
    fetch(`${API}/api/crews`).then(r => r.json()).then(d => setCrews(d.crews || []));
    fetch(`${API}/api/tools`).then(r => r.json()).then(d => {
      const _tools = (d.tools || []) as ToolEntry[];
      void _tools;
    });
  }, []);

  const activeTab = activeTabIdx >= 0 ? chatTabs[activeTabIdx] : null;

  // ── Open crew as tab ──
  const openCrew = useCallback(async (crew: Crew) => {
    const existing = chatTabs.findIndex(t => t.crewId === crew.id);
    if (existing >= 0) {
      setActiveTabIdx(existing);
      return;
    }
    const newTab: ChatTab = {
      crewId: crew.id,
      title: crew.title,
      emoji: crew.emoji || "🤖",
      messages: [],
    };
    // Try loading saved conversation
    try {
      const r = await fetch(`${API}/api/conversations/${crew.id}`);
      if (r.ok) {
        const d = await r.json();
        if (d.messages?.length) {
          newTab.messages = d.messages;
        }
      }
    } catch { /* ignore */ }

    // Add greeting if empty
    if (newTab.messages.length === 0 && crew.greeting) {
      newTab.messages.push({
        role: "assistant",
        content: crew.greeting,
        ts: new Date().toISOString(),
      });
    }

    setChatTabs(prev => [...prev, newTab]);
    setActiveTabIdx(chatTabs.length); // will be the new index
  }, [chatTabs]);

  const closeTab = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setChatTabs(prev => {
      const next = prev.filter((_, i) => i !== idx);
      setActiveTabIdx(cur => {
        if (cur === idx) return next.length ? Math.max(0, cur - 1) : -1;
        if (cur > idx) return cur - 1;
        return cur;
      });
      return next;
    });
  }, []);

  // ── Auto-scroll ──
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTab?.messages]);

  // ── Auto-open first crew ──
  useEffect(() => {
    if (crews.length > 0 && chatTabs.length === 0) {
      const commander = crews.find(c => c.id === "sre.commander") || crews[0];
      openCrew(commander);
    }
  }, [crews, chatTabs.length, openCrew]);

  // ── Handle initial prompt from quick actions ──
  useEffect(() => {
    if (initialPrompt && activeTab) {
      setInput(initialPrompt);
      onPromptConsumed?.();
      // Auto-send after a brief delay
      setTimeout(() => {
        send(initialPrompt);
      }, 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, activeTab]);

  // ── Send message ──
  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading || !activeTab) return;

    const userMsg: ChatMsg = { role: "user", content: text, ts: new Date().toISOString() };
    const assistantMsg: ChatMsg = { role: "assistant", content: "", ts: new Date().toISOString() };

    const tabIdx = activeTabIdx;
    setChatTabs(prev => prev.map((t, i) =>
      i === tabIdx ? { ...t, messages: [...t.messages, userMsg, assistantMsg] } : t
    ));
    setInput("");
    setLoading(true);

    try {
      const resp = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crewId: activeTab.crewId,
          message: text,
          model: model || undefined,
          stream: true,
        }),
      });

      // Show HTTP-level errors (e.g. provider not configured → 500)
      if (!resp.ok) {
        let errText = `HTTP ${resp.status}`;
        try { const d = await resp.json(); errText = d.error || errText; } catch { /* not JSON */ }
        setChatTabs(prev => prev.map((t, i) =>
          i === tabIdx
            ? { ...t, messages: [...t.messages.slice(0, -1), { role: "assistant", content: `⚠️ ${errText}` }] }
            : t
        ));
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const chunk of events) {
          const chunkLines = chunk.split("\n");
          let eventType = "";
          let payload = "";
          for (const line of chunkLines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) payload = line.slice(6).trim();
            else if (line.startsWith("data:")) payload = line.slice(5).trim();
          }
          if (!payload) continue;
          try {
            const obj = JSON.parse(payload);
            if (eventType === "delta" && obj.content) {
              acc += obj.content;
              setChatTabs(prev => prev.map((t, i) =>
                i === tabIdx
                  ? { ...t, messages: [...t.messages.slice(0, -1), { role: "assistant", content: acc, ts: new Date().toISOString() }] }
                  : t
              ));
            } else if (eventType === "error") {
              setChatTabs(prev => prev.map((t, i) =>
                i === tabIdx
                  ? { ...t, messages: [...t.messages.slice(0, -1), { role: "assistant", content: `⚠️ ${obj.message || "發生錯誤"}` }] }
                  : t
              ));
            }
          } catch { /* skip non-JSON */ }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Request failed";
      setChatTabs(prev => prev.map((t, i) =>
        i === tabIdx
          ? { ...t, messages: [...t.messages.slice(0, -1), { role: "assistant", content: `⚠️ ${errMsg}` }] }
          : t
      ));
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeTab, activeTabIdx, model]);

  // ── Keyboard: Enter to send, IME aware ──
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !composingRef.current) {
      e.preventDefault();
      send();
    }
  }, [send]);

  return (
    <div className="flex h-full">
      {/* ── Crew list ── */}
      <div className="w-52 border-r border-stone-200 bg-stone-50 overflow-y-auto shrink-0">
        <div className="px-3 py-2 text-xs font-bold text-stone-400 uppercase tracking-wide border-b border-stone-200">
          Agents
        </div>
        <ul className="py-1">
          {crews.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openCrew(c)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 transition-colors text-left"
              >
                <span aria-hidden="true">{c.emoji || "🤖"}</span>
                <span className="truncate">{c.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar + model selector */}
        <div className="flex items-center h-10 border-b border-stone-200 bg-white shrink-0">
          <div className="flex-1 flex items-center overflow-x-auto">
            {chatTabs.map((t, i) => (
              <button
                key={`${t.crewId}-${i}`}
                type="button"
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

        {/* Messages */}
        {activeTab ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {activeTab.messages.filter(m => m.role !== "tool").map((m, i) => (
              <div key={i} className="flex justify-end">
                <div className={`max-w-[80%] px-4 py-2 rounded-xl text-sm break-words ${
                  m.role === "user"
                    ? "bg-emerald-500 text-white rounded-br-sm"
                    : "bg-white border border-stone-200 text-stone-700 rounded-bl-sm"
                }`}>
                  {m.role === "user" ? (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  ) : (
                    <div className="markdown-body [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_pre]:my-2 [&_pre]:bg-stone-100 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_code]:text-emerald-600 [&_code]:font-mono [&_code]:text-xs [&_a]:text-emerald-600 [&_a]:underline [&_h1]:text-base [&_h1]:font-bold [&_h1]:my-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:my-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-2 [&_blockquote]:text-stone-500 [&_table]:my-2 [&_th]:border [&_th]:border-stone-300 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-stone-300 [&_td]:px-2 [&_td]:py-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-2 rounded-xl bg-white border border-stone-200 text-stone-400 text-sm animate-pulse">
                  …
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-stone-300 text-sm">
            ← 選擇一個 Agent 開始對話
          </div>
        )}

        {/* Input bar */}
        {activeTab && (
          <div className="border-t border-stone-200 p-3 bg-white shrink-0">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              rows={1}
              placeholder={`對 ${activeTab.title} 說…`}
              className="w-full resize-none border border-stone-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-400 max-h-32"
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-stone-300">Enter 發送 · Shift+Enter 換行</span>
              <button
                type="button"
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="px-4 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "送出中…" : "送出"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
