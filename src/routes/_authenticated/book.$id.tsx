import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  BookMarked,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { getSource, type ChunkRow } from "@/lib/sources.functions";
import { cn } from "@/lib/utils";

type SourceDetail = {
  id: string;
  sourceType: string;
  title: string;
  author: string | null;
  isbn: string | null;
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

function ChapterItem({ chunk }: { chunk: ChunkRow }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium flex-1 truncate">
          {chunk.chapterTitle ?? `Chapter ${chunk.chunkIndex + 1}`}
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

function BookDetail() {
  const { id } = Route.useParams();
  const fetchSource = useServerFn(getSource);

  const [data, setData] = useState<{ source: SourceDetail; chunks: ChunkRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSource({ data: { sourceId: id } })
      .then((res: { source: SourceDetail; chunks: ChunkRow[] }) =>
        setData({ source: res.source, chunks: res.chunks }),
      )
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

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
                <StatusPill status={data.source.ingestStatus} />
              </div>
            </div>

            {data.source.description && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{data.source.description}</p>
            )}

            {/* Chapters */}
            {data.chunks.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <BookMarked className="h-3.5 w-3.5 text-muted-foreground" />
                  <h2 className="text-xs font-medium">
                    Chapters
                    <span className="text-muted-foreground font-normal ml-1.5">
                      ({data.chunks.length})
                    </span>
                  </h2>
                </div>
                <div className="space-y-1.5">
                  {data.chunks.map((chunk) => (
                    <ChapterItem key={chunk.id} chunk={chunk} />
                  ))}
                </div>
              </section>
            )}

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

