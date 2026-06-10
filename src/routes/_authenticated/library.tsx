import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { BookOpen, Plus, Loader2, AlertCircle, CheckCircle2, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listSources, deleteSource, type SourceRow } from "@/lib/sources.functions";
import { syncSubstackFeeds } from "@/lib/web-sources.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Filter ───────────────────────────────────────────────────────────────────

type LibraryFilter = "all" | "book" | "ebook" | "web" | "substack" | "github";

const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: "All",
  book: "Books",
  ebook: "eBooks",
  web: "Web",
  substack: "Substack",
  github: "GitHub",
};

function matchesFilter(s: SourceRow, f: LibraryFilter) {
  if (f === "all") return true;
  if (f === "book") return s.sourceType === "physical_book" || s.sourceType === "highlight_only";
  if (f === "ebook") return s.sourceType === "ebook" || s.sourceType === "pdf";
  if (f === "web") return s.sourceType === "web_article";
  if (f === "substack") return s.sourceType === "substack";
  if (f === "github") return s.sourceType === "github_repo";
  return true;
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  physical_book: "Book",
  ebook: "eBook",
  pdf: "PDF",
  substack: "Newsletter",
  github_repo: "GitHub",
  web_article: "Article",
  highlight_only: "Highlights",
};

export const Route = createFileRoute("/_authenticated/library")({
  component: Library,
});

function StatusBadge({ status, chunks }: { status: string; chunks: number }) {
  if (status === "processing") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Indexing…
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-destructive">
        <AlertCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        {chunks} {chunks === 1 ? "chapter" : "chapters"}
      </span>
    );
  }
  return null;
}

function BookRow({
  source,
  onDeleted,
}: {
  source: SourceRow;
  onDeleted: (id: string) => void;
}) {
  const deleteFn = useServerFn(deleteSource);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    try {
      await deleteFn({ data: { sourceId: source.id } });
      onDeleted(source.id);
      toast.success(`"${source.title}" removed`);
    } catch {
      toast.error("Failed to delete");
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <Link
      to="/book/$id"
      params={{ id: source.id }}
      className="group flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
    >
      {/* Cover or placeholder */}
      <div className="h-14 w-10 shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center">
        {source.coverUrl ? (
          <img src={source.coverUrl} alt={source.title} className="h-full w-full object-cover" />
        ) : (
          <BookOpen className="h-4 w-4 text-muted-foreground/40" />
        )}
      </div>

      {/* Meta */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{source.title}</p>
        {source.author && (
          <p className="text-[10px] text-muted-foreground truncate">{source.author}</p>
        )}
        <div className="mt-1">
          <StatusBadge status={source.ingestStatus} chunks={source.totalChunks} />
        </div>
      </div>

      {/* Type pill */}
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide bg-muted text-muted-foreground">
        {SOURCE_TYPE_LABEL[source.sourceType] ?? source.sourceType}
      </span>

      {/* Delete */}
      {confirming ? (
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.preventDefault()}>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="cursor-pointer rounded px-2 py-1 text-[10px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
          </button>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(false); }}
            className="cursor-pointer rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={handleDelete}
          className="cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </Link>
  );
}

function Library() {
  const fetchSources = useServerFn(listSources);
  const syncFn = useServerFn(syncSubstackFeeds);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>("all");

  const load = () =>
    fetchSources({})
      .then((result) => setSources(Array.isArray(result) ? result : []))
      .catch(console.error)
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await syncFn({});
      if (r.synced > 0) {
        toast.success(`${r.synced} new article${r.synced !== 1 ? "s" : ""} indexed from ${r.checked} newsletter${r.checked !== 1 ? "s" : ""}`);
        setLoading(true);
        await load();
      } else {
        toast.success(`All ${r.checked} newsletter${r.checked !== 1 ? "s" : ""} up to date`);
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
          <h1 className="text-xs font-medium">Library</h1>
          {sources.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {sources.length} {sources.length === 1 ? "source" : "sources"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleSync} disabled={syncing} title="Sync Substack feeds">
            <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync feeds"}
          </Button>
          <Link to="/import">
            <Button size="sm" variant="outline">
              <Plus className="h-3 w-3" />
              Import
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-card border border-border">
              <BookOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Your library is empty</p>
              <p className="text-xs text-muted-foreground mt-1">
                Import a book, article, Substack, or GitHub repo to start building your knowledge base.
              </p>
            </div>
            <Link to="/import">
              <Button size="sm">
                <Plus className="h-3 w-3" />
                Import
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4 max-w-xl">
            {/* Filter pills — only show tabs that have at least one source */}
            {(() => {
              const tabs: LibraryFilter[] = ["all"];
              if (sources.some((s) => s.sourceType === "physical_book" || s.sourceType === "highlight_only")) tabs.push("book");
              if (sources.some((s) => s.sourceType === "ebook" || s.sourceType === "pdf")) tabs.push("ebook");
              if (sources.some((s) => s.sourceType === "web_article")) tabs.push("web");
              if (sources.some((s) => s.sourceType === "substack")) tabs.push("substack");
              if (sources.some((s) => s.sourceType === "github_repo")) tabs.push("github");
              if (tabs.length === 1) return null;
              return (
                <div className="flex gap-1 flex-wrap">
                  {tabs.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setActiveFilter(f)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors cursor-pointer select-none",
                        activeFilter === f
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {FILTER_LABELS[f]}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Source list */}
            {sources.filter((s) => matchesFilter(s, activeFilter)).length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-8">Nothing here yet.</p>
            ) : (
              <div className="space-y-2">
                {sources
                  .filter((s) => matchesFilter(s, activeFilter))
                  .map((s) => (
                    <BookRow
                      key={s.id}
                      source={s}
                      onDeleted={(id) => setSources((prev) => prev.filter((x) => x.id !== id))}
                    />
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
