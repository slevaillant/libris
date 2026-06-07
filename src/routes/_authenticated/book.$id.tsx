import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  BookMarked,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Highlighter,
  Plus,
  Trash2,
  X,
  RefreshCw,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { getSource, reembedSource, type ChunkRow } from "@/lib/sources.functions";
import {
  createHighlight,
  listHighlights,
  deleteHighlight,
  type HighlightRow,
} from "@/lib/highlights.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SourceDetail = {
  id: string;
  sourceType: string;
  title: string;
  author: string | null;
  isbn: string | null;
  url: string | null;
  coverUrl: string | null;
  description: string | null;
  shelfLocation: string | null;
  totalChunks: number;
  ingestStatus: string;
  ingestError: string | null;
  isRead: boolean;
  tags: string[];
  createdAt: string;
};

export const Route = createFileRoute("/_authenticated/book/$id")({
  component: BookDetail,
});

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete:   "bg-green-500/10 text-green-600",
    processing: "bg-amber-500/10 text-amber-600",
    failed:     "bg-destructive/10 text-destructive",
    pending:    "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", map[status] ?? map.pending)}>
      {status}
    </span>
  );
}

// ─── Chapter item (collapsible) ───────────────────────────────────────────────

function ChapterItem({ chunk, isArticle = false }: { chunk: ChunkRow; isArticle?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50 active:bg-accent/70 active:scale-[0.99] transition-all cursor-pointer select-none"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium flex-1 truncate">
          {chunk.chapterTitle ?? `${isArticle ? "Section" : "Chapter"} ${chunk.chunkIndex + 1}`}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-border">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{chunk.content}</p>
        </div>
      )}
    </div>
  );
}

// ─── Highlight card ───────────────────────────────────────────────────────────

function HighlightCard({
  highlight,
  onDelete,
}: {
  highlight: HighlightRow;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const deleteFn = useServerFn(deleteHighlight);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteFn({ data: { highlightId: highlight.id } });
      onDelete(highlight.id);
      toast.success("Highlight deleted");
    } catch {
      toast.error("Could not delete highlight");
      setDeleting(false);
    }
  };

  return (
    <div className="group relative rounded-lg border border-border bg-amber-500/5 px-3.5 py-3 space-y-1.5">
      <blockquote className="text-[11px] leading-relaxed text-foreground/90 italic border-l-2 border-amber-400/60 pl-2.5">
        {highlight.content}
      </blockquote>

      {highlight.note && (
        <p className="text-[10px] text-muted-foreground leading-relaxed pl-2.5">
          {highlight.note}
        </p>
      )}

      {(highlight.chapter || highlight.page) && (
        <p className="text-[10px] text-muted-foreground/60 pl-2.5">
          {[highlight.chapter, highlight.page ? `p. ${highlight.page}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive active:opacity-60 transition-all cursor-pointer disabled:opacity-30"
        aria-label="Delete highlight"
      >
        {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      </button>
    </div>
  );
}

// ─── Add highlight form ───────────────────────────────────────────────────────

function AddHighlightForm({
  sourceId,
  chapterOptions,
  onSaved,
  onCancel,
}: {
  sourceId: string;
  chapterOptions: string[];
  onSaved: (h: HighlightRow) => void;
  onCancel: () => void;
}) {
  const createFn = useServerFn(createHighlight);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [chapter, setChapter] = useState("");
  const [page, setPage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error("Paste a quote first");
      return;
    }
    setSaving(true);
    try {
      const result = await createFn({
        data: {
          sourceId,
          content: content.trim(),
          note: note.trim() || undefined,
          chapter: chapter.trim() || undefined,
          page: page ? parseInt(page, 10) : undefined,
        },
      });
      onSaved(result);
      toast.success("Highlight saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save highlight");
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-500/5 p-3.5 space-y-3">
      <div className="space-y-1">
        <Label htmlFor="hl-content" className="text-[10px]">Quote</Label>
        <textarea
          ref={textareaRef}
          id="hl-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste or type the passage you want to save…"
          rows={4}
          disabled={saving}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 resize-none leading-relaxed placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="hl-note" className="text-[10px]">
          Your note <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <textarea
          id="hl-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why does this matter to you?"
          rows={2}
          disabled={saving}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 resize-none leading-relaxed placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="hl-chapter" className="text-[10px]">
            Chapter <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          {chapterOptions.length > 0 ? (
            <select
              id="hl-chapter"
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              disabled={saving}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              <option value="">—</option>
              {chapterOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            <input
              id="hl-chapter"
              type="text"
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              placeholder="Chapter name"
              disabled={saving}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="hl-page" className="text-[10px]">
            Page <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <input
            id="hl-page"
            type="number"
            min={1}
            value={page}
            onChange={(e) => setPage(e.target.value)}
            placeholder="42"
            disabled={saving}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-3 w-3" />
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Highlighter className="h-3 w-3" />}
          Save highlight
        </Button>
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

function BookDetail() {
  const { id } = Route.useParams();
  const fetchSource = useServerFn(getSource);
  const fetchHighlights = useServerFn(listHighlights);

  const reembedFn = useServerFn(reembedSource);

  const [data, setData] = useState<{ source: SourceDetail; chunks: ChunkRow[] } | null>(null);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingHighlight, setAddingHighlight] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const handleReindex = async () => {
    if (!data) return;
    setReindexing(true);
    try {
      const { embedded } = await reembedFn({ data: { sourceId: data.source.id } });
      if (embedded === 0) {
        toast.info("All chunks already have embeddings");
      } else {
        toast.success(`Re-indexed ${embedded} chunk${embedded !== 1 ? "s" : ""}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-indexing failed");
    } finally {
      setReindexing(false);
    }
  };

  useEffect(() => {
    Promise.all([
      fetchSource({ data: { sourceId: id } }),
      fetchHighlights({ data: { sourceId: id } }),
    ])
      .then(([src, hl]) => {
        setData({ source: src.source as SourceDetail, chunks: src.chunks });
        setHighlights(hl);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  const chapterOptions = (data?.chunks ?? [])
    .map((c) => c.chapterTitle)
    .filter((t): t is string => !!t);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <Link to="/library" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <h1 className="text-xs font-medium truncate">{data?.source.title ?? "Book"}</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {data && (
          <div className="max-w-xl space-y-6">
            {/* Book header */}
            <div className="flex gap-4">
              <div className="h-28 w-20 shrink-0 rounded overflow-hidden border border-border bg-muted flex items-center justify-center">
                {data.source.coverUrl ? (
                  <img
                    src={data.source.coverUrl}
                    alt={data.source.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <BookOpen className="h-6 w-6 text-muted-foreground/40" />
                )}
              </div>
              <div className="space-y-1 flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{data.source.title}</p>
                {data.source.author && (
                  <p className="text-xs text-muted-foreground">{data.source.author}</p>
                )}
                {data.source.isbn && (
                  <p className="text-[10px] text-muted-foreground/60">ISBN {data.source.isbn}</p>
                )}
                {data.source.shelfLocation && (
                  <p className="text-[10px] text-muted-foreground/60">{data.source.shelfLocation}</p>
                )}
                {data.source.url && (
                  <a
                    href={data.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate max-w-[180px]">
                      {new URL(data.source.url).hostname.replace(/^www\./, "")}
                    </span>
                  </a>
                )}
                <div className="flex items-center gap-2">
                  <StatusPill status={data.source.ingestStatus} />
                  <button
                    type="button"
                    onClick={handleReindex}
                    disabled={reindexing}
                    title="Re-index missing embeddings"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground active:opacity-60 transition-all cursor-pointer select-none disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3 w-3 ${reindexing ? "animate-spin" : ""}`} />
                    {reindexing ? "Re-indexing…" : "Re-index"}
                  </button>
                </div>
              </div>
            </div>

            {data.source.description && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {data.source.description}
              </p>
            )}

            {/* Highlights */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Highlighter className="h-3.5 w-3.5 text-amber-500" />
                  <h2 className="text-xs font-medium">
                    Highlights
                    {highlights.length > 0 && (
                      <span className="text-muted-foreground font-normal ml-1.5">
                        ({highlights.length})
                      </span>
                    )}
                  </h2>
                </div>
                {!addingHighlight && (
                  <button
                    type="button"
                    onClick={() => setAddingHighlight(true)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground active:opacity-60 transition-all cursor-pointer select-none"
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </button>
                )}
              </div>

              {addingHighlight && (
                <AddHighlightForm
                  sourceId={id}
                  chapterOptions={chapterOptions}
                  onSaved={(h) => {
                    setHighlights((prev) => [...prev, h]);
                    setAddingHighlight(false);
                  }}
                  onCancel={() => setAddingHighlight(false)}
                />
              )}

              {highlights.length === 0 && !addingHighlight && (
                <p className="text-[10px] text-muted-foreground py-1">
                  No highlights yet. Add one to give Lumen direct access to the passages that matter most to you.
                </p>
              )}

              {highlights.map((h) => (
                <HighlightCard
                  key={h.id}
                  highlight={h}
                  onDelete={(deletedId) =>
                    setHighlights((prev) => prev.filter((x) => x.id !== deletedId))
                  }
                />
              ))}
            </section>

            {/* Chunks — grouped by type */}
            {data.chunks.length > 0 && (() => {
              const keyIdeas = data.chunks.filter((c) => c.chunkType === "key_idea");
              const others = data.chunks.filter((c) => c.chunkType !== "key_idea");
              const isArticle = ["substack", "web_article"].includes(data.source.sourceType);
              return (
                <>
                  {keyIdeas.length > 0 && (
                    <section className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        <h2 className="text-xs font-medium">
                          Key ideas
                          <span className="text-muted-foreground font-normal ml-1.5">
                            ({keyIdeas.length})
                          </span>
                        </h2>
                      </div>
                      <div className="space-y-1.5">
                        {keyIdeas.map((chunk) => (
                          <div
                            key={chunk.id}
                            className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-3.5 py-2.5"
                          >
                            <p className="text-[11px] leading-relaxed">{chunk.content}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {others.length > 0 && (
                    <section className="space-y-2">
                      <div className="flex items-center gap-2">
                        <BookMarked className="h-3.5 w-3.5 text-muted-foreground" />
                        <h2 className="text-xs font-medium">
                          {isArticle ? "Content" : "Chapters"}
                          <span className="text-muted-foreground font-normal ml-1.5">
                            ({others.length})
                          </span>
                        </h2>
                      </div>
                      <div className="space-y-1.5">
                        {others.map((chunk) => (
                          <ChapterItem key={chunk.id} chunk={chunk} isArticle={isArticle} />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              );
            })()}

            {data.source.ingestStatus === "failed" && data.source.ingestError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-[10px] text-destructive font-medium mb-0.5">Indexing failed</p>
                <p className="text-[10px] text-muted-foreground">{data.source.ingestError}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
