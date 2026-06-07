import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { sendNudge, summarizeConversation, type Citation, type ConversationTurn } from "@/lib/chat.functions";
import { getProfile } from "@/lib/profile.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  coverageQuality?: "strong" | "partial" | "thin";
};

// ─── Citation panel ───────────────────────────────────────────────────────────

function CitationsPanel({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[10px] text-muted-foreground hover:bg-accent/40 active:bg-accent/60 transition-all cursor-pointer select-none"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <BookOpen className="h-3 w-3 shrink-0" />
        {citations.length} source{citations.length !== 1 ? "s" : ""}
      </button>

      {open && (
        <div className="border-t border-border/60 divide-y divide-border/40">
          {citations.map((c) => (
            <div key={c.chunkId} className="px-3 py-2 space-y-0.5">
              <p className="text-[11px] font-medium leading-snug">{c.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {[c.author, c.chapterTitle].filter(Boolean).join(" · ")}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <div
                  className="h-1 rounded-full bg-foreground/20"
                  style={{ width: `${Math.round(c.relevance * 60 + 16)}px` }}
                />
                <span className="text-[9px] text-muted-foreground/60">
                  {Math.round(c.relevance * 100)}% match
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single message bubble ────────────────────────────────────────────────────

function ChatMessage({ message, librarianName }: { message: Message; librarianName: string }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5">
          <p className="text-xs text-primary-foreground leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 max-w-[85%]">
      <p className="text-[10px] text-muted-foreground px-1">{librarianName}</p>
      <div
        className={cn(
          "rounded-2xl rounded-tl-sm border px-3.5 py-2.5",
          message.coverageQuality === "thin"
            ? "border-amber-400/30 bg-amber-500/5"
            : "border-border bg-card",
        )}
      >
        <p className="text-xs leading-relaxed whitespace-pre-wrap">{message.content}</p>
      </div>
      {message.citations && <CitationsPanel citations={message.citations} />}
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

const THINKING_STEPS = [
  "Embedding your question…",
  "Searching your library…",
  "Selecting relevant passages…",
  "Composing response…",
];

function TypingIndicator({ librarianName }: { librarianName: string }) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const timings = [800, 2200, 4000]; // ms at which each step advances
    const timers = timings.map((delay, i) =>
      setTimeout(() => setStepIndex(i + 1), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-col gap-1 max-w-[85%]">
      <p className="text-[10px] text-muted-foreground px-1">{librarianName}</p>
      <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-3 space-y-2">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground animate-pulse">
          {THINKING_STEPS[Math.min(stepIndex, THINKING_STEPS.length - 1)]}
        </p>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ librarianName, onPrompt }: { librarianName: string; onPrompt: (q: string) => void }) {
  const starters = [
    "What's the strongest idea in my library right now?",
    "What have I indexed about leadership?",
    "What do my sources say about decision-making?",
    "Where is my library coverage thin?",
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{librarianName}</p>
        <p className="text-[11px] text-muted-foreground max-w-xs">
          Ask me anything about your library. I'll find the most relevant passages and connect them for you.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
        {starters.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPrompt(q)}
            className="rounded-lg border border-border px-3 py-2.5 text-[11px] text-left text-muted-foreground hover:bg-accent/50 hover:text-foreground active:scale-[0.98] active:bg-accent/70 transition-all cursor-pointer select-none"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

const SUMMARISE_AFTER = 10;

function ChatPage() {
  const sendFn = useServerFn(sendNudge);
  const summariseFn = useServerFn(summarizeConversation);
  const getProfileFn = useServerFn(getProfile);

  const [librarianName, setLibrarianName] = useState("Lumen");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // hasSummary = true means sessionHistory[0].content is a summary string, not a raw turn
  const [sessionHistory, setSessionHistory] = useState<ConversationTurn[]>([]);
  const [hasSummary, setHasSummary] = useState(false);
  const [turnNumber, setTurnNumber] = useState(1);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getProfileFn({})
      .then((p) => { if (p?.librarianName) setLibrarianName(p.librarianName); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (query: string) => {
    const text = query.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const result = await sendFn({
        data: { query: text, sessionHistory, hasSummary, turnNumber },
      });

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.response,
        citations: result.citations,
        coverageQuality: result.coverageQuality,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Update session history (raw turns)
      const updatedHistory: ConversationTurn[] = hasSummary
        ? [
            ...sessionHistory,
            { role: "user", content: text },
            { role: "assistant", content: result.response },
          ]
        : [
            ...sessionHistory,
            { role: "user", content: text },
            { role: "assistant", content: result.response },
          ];

      const nextTurn = turnNumber + 1;
      setTurnNumber(nextTurn);

      // Summarise after SUMMARISE_AFTER turns
      if (!hasSummary && updatedHistory.length >= SUMMARISE_AFTER * 2) {
        try {
          const { summary } = await summariseFn({ data: { turns: updatedHistory } });
          setSessionHistory([{ role: "user", content: summary }]);
          setHasSummary(true);
        } catch {
          // Summarisation failed — keep raw history, no toast needed
          setSessionHistory(updatedHistory.slice(-10));
        }
      } else {
        setSessionHistory(updatedHistory);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-5">
        <h1 className="text-xs font-medium">{librarianName}</h1>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !loading ? (
          <EmptyState librarianName={librarianName} onPrompt={(q) => { setInput(q); handleSend(q); }} />
        ) : (
          <div className="flex flex-col gap-4 px-5 py-5">
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} librarianName={librarianName} />
            ))}
            {loading && <TypingIndicator librarianName={librarianName} />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-4">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring transition-shadow">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask ${librarianName} anything about your library…`}
            rows={1}
            disabled={loading}
            className="flex-1 resize-none bg-transparent text-xs outline-none leading-relaxed placeholder:text-muted-foreground/50 disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <Button
            size="icon"
            onClick={() => handleSend(input)}
            disabled={loading || !input.trim()}
            className="h-7 w-7 shrink-0 rounded-lg"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </Button>
        </div>
        <p className="text-[9px] text-muted-foreground/40 text-center mt-1.5">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
