import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Search,
  PenLine,
  Loader2,
  Sparkles,
  Upload,
  Smartphone,
  CheckCircle2,
  XCircle,
  Circle,
  Globe,
  GitBranch,
  Rss,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  extractBookFromCover,
  lookupBook,
  suggestChapters,
  addPhysicalBook,
  extractKindleLibrary,
  addDigitalBook,
  addKindleBook,
  checkDuplicate,
  type BookCandidate,
} from "@/lib/library.functions";
import {
  previewSubstack,
  ingestSubstack,
  previewGithubRepo,
  ingestGithubRepo,
  previewWebArticle,
  ingestWebArticle,
  previewYouTubeVideo,
  ingestYouTubeVideo,
  type WebSourcePreview,
} from "@/lib/web-sources.functions";
import type { PdfExtractResult } from "@/lib/sources/pdf";
import type { EpubExtractResult } from "@/lib/sources/epub";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

// ─── Top-level mode ────────────────────────────────────────────────────────────

type ImportMode = "physical" | "digital" | "kindle" | "web";

// ─── Shared types ──────────────────────────────────────────────────────────────

type PhysicalMethod = "search" | "scan" | "manual";
type PhysicalStep = "identify" | "review";

type Draft = {
  title: string;
  author: string;
  isbn: string;
  coverUrl: string;
  description: string;
  shelfLocation: string;
};

const emptyDraft = (): Draft => ({
  title: "",
  author: "",
  isbn: "",
  coverUrl: "",
  description: "",
  shelfLocation: "",
});

// ─── Mode selector ─────────────────────────────────────────────────────────────

function ModeSelector({ onSelect }: { onSelect: (m: ImportMode) => void }) {
  const modes: {
    id: ImportMode;
    icon: React.ElementType;
    label: string;
    description: string;
  }[] = [
    {
      id: "physical",
      icon: BookOpen,
      label: "Physical book",
      description: "Search by title, scan cover, or enter manually",
    },
    {
      id: "digital",
      icon: Upload,
      label: "PDF or ePub",
      description: "Upload an ebook file to index its full content",
    },
    {
      id: "kindle",
      icon: Smartphone,
      label: "Kindle library",
      description: "Screenshot your Kindle library to bulk-add books",
    },
    {
      id: "web",
      icon: Globe,
      label: "Web sources",
      description: "Import a URL, subscribe to a Substack, or add a GitHub repo",
    },
  ];

  return (
    <div className="space-y-2">
      {modes.map(({ id, icon: Icon, label, description }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="flex w-full items-center gap-3 rounded-lg border border-border p-3.5 text-left hover:bg-accent/50 active:scale-[0.98] active:bg-accent/70 transition-all cursor-pointer select-none"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-medium">{label}</p>
            <p className="text-[10px] text-muted-foreground">{description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Physical book flow (unchanged from Phase 3) ──────────────────────────────

function PhysicalFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<PhysicalStep>("identify");
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  return (
    <>
      {step === "identify" ? (
        <PhysicalIdentifyStep
          onContinue={(d) => {
            setDraft(d);
            setStep("review");
          }}
          onBack={onBack}
        />
      ) : (
        <PhysicalReviewStep draft={draft} onBack={() => setStep("identify")} />
      )}
    </>
  );
}

function PhysicalIdentifyStep({
  onContinue,
  onBack,
}: {
  onContinue: (draft: Draft) => void;
  onBack: () => void;
}) {
  const [method, setMethod] = useState<PhysicalMethod>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState<Draft>(emptyDraft());
  const fileRef = useRef<HTMLInputElement>(null);

  const searchFn = useServerFn(lookupBook);
  const extractFn = useServerFn(extractBookFromCover);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const candidates = await searchFn({ data: { query } });
      setResults(candidates);
    } catch {
      toast.error("Search failed — try a different query");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectCandidate = (c: BookCandidate) => {
    onContinue({
      title: c.title,
      author: c.authors.join(", "),
      isbn: c.isbn ?? "",
      coverUrl: c.coverUrl ?? "",
      description: c.description ?? "",
      shelfLocation: "",
    });
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      toast.error("Use a JPEG, PNG, or WebP photo");
      return;
    }
    setScanning(true);
    try {
      const base64 = await toBase64(file);
      const meta = await extractFn({ data: { imageBase64: base64, mimeType } });
      onContinue({ ...emptyDraft(), title: meta.title, author: meta.author, isbn: meta.isbn ?? "" });
    } catch {
      toast.error("Could not read the cover — try entering details manually");
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const tabs: { id: PhysicalMethod; label: string; icon: React.ElementType }[] = [
    { id: "search", label: "Search", icon: Search },
    { id: "scan", label: "Cover scan", icon: Camera },
    { id: "manual", label: "Manual", icon: PenLine },
  ];

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} />

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setMethod(id);
              setResults([]);
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all active:scale-[0.96] cursor-pointer select-none ${
              method === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {method === "search" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Title, author, or ISBN…"
              autoFocus
            />
            <Button variant="outline" onClick={handleSearch} disabled={searching}>
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((c) => (
                <button
                  key={c.googleBooksId}
                  type="button"
                  onClick={() => handleSelectCandidate(c)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left hover:bg-accent/50 active:scale-[0.98] active:bg-accent/70 transition-all cursor-pointer select-none"
                >
                  {c.coverUrl ? (
                    <img
                      src={c.coverUrl}
                      alt={c.title}
                      className="h-14 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted">
                      <BookOpen className="h-4 w-4 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{c.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.authors.join(", ")}
                      {c.publishedDate ? ` · ${c.publishedDate.slice(0, 4)}` : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {results.length === 0 && query && !searching && (
            <p className="text-center text-[10px] text-muted-foreground py-3">
              No results — try entering details manually.
            </p>
          )}
        </div>
      )}

      {method === "scan" && (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={handleFilePick}
          />
          <DropZone
            label="Choose cover photo"
            hint="JPEG, PNG, or WebP"
            loading={scanning}
            loadingLabel="Reading cover…"
            onClick={() => fileRef.current?.click()}
          />
        </div>
      )}

      {method === "manual" && (
        <div className="space-y-3">
          <Field
            id="m-title"
            label="Title"
            value={manual.title}
            onChange={(v) => setManual((d) => ({ ...d, title: v }))}
            placeholder="High Output Management"
            autoFocus
          />
          <Field
            id="m-author"
            label="Author"
            value={manual.author}
            onChange={(v) => setManual((d) => ({ ...d, author: v }))}
            placeholder="Andy Grove"
          />
          <Field
            id="m-isbn"
            label="ISBN"
            optional
            value={manual.isbn}
            onChange={(v) => setManual((d) => ({ ...d, isbn: v }))}
            placeholder="9780679734895"
          />
          <Button
            className="w-full"
            onClick={() => {
              if (!manual.title.trim()) {
                toast.error("Title is required");
                return;
              }
              onContinue(manual);
            }}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

function PhysicalReviewStep({ draft, onBack }: { draft: Draft; onBack: () => void }) {
  const navigate = useNavigate();
  const suggestFn = useServerFn(suggestChapters);
  const addFn = useServerFn(addPhysicalBook);

  const [title, setTitle] = useState(draft.title);
  const [author, setAuthor] = useState(draft.author);
  const [isbn, setIsbn] = useState(draft.isbn);
  const [shelfLocation, setShelfLocation] = useState(draft.shelfLocation);
  const [chaptersText, setChaptersText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [adding, setAdding] = useState(false);

  const handleSuggest = async () => {
    if (!title.trim()) {
      toast.error("Enter a title first");
      return;
    }
    setSuggesting(true);
    try {
      const chapters = await suggestFn({ data: { title, author } });
      if (chapters.length === 0) {
        toast.info("No chapter data found — enter them manually");
      } else {
        setChaptersText(chapters.join("\n"));
      }
    } catch {
      toast.error("Could not suggest chapters");
    } finally {
      setSuggesting(false);
    }
  };

  const handleAdd = async () => {
    const chapters = chaptersText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (chapters.length === 0) {
      toast.error("Add at least one chapter");
      return;
    }
    setAdding(true);
    try {
      await addFn({
        data: {
          title,
          author: author || undefined,
          isbn: isbn || undefined,
          coverUrl: draft.coverUrl || undefined,
          description: draft.description || undefined,
          shelfLocation: shelfLocation || undefined,
          chapters,
        },
      });
      toast.success(`"${title}" added to your library`);
      navigate({ to: "/library" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add book");
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      {adding && <IngestingBanner label="Generating chapter summaries and indexing… ~10 s per book." />}

      <div className="flex gap-3">
        {draft.coverUrl && (
          <img
            src={draft.coverUrl}
            alt={title}
            className="h-20 w-14 shrink-0 rounded object-cover border border-border"
          />
        )}
        <div className="flex-1 space-y-2">
          <Field id="r-title" label="Title" value={title} onChange={setTitle} />
          <Field
            id="r-author"
            label="Author"
            value={author}
            onChange={setAuthor}
            placeholder="Author name"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field id="r-isbn" label="ISBN" optional value={isbn} onChange={setIsbn} placeholder="9780…" />
        <Field
          id="r-shelf"
          label="Shelf"
          optional
          value={shelfLocation}
          onChange={setShelfLocation}
          placeholder="Shelf B, row 2"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="r-chapters">Chapters</Label>
          <button
            type="button"
            onClick={handleSuggest}
            disabled={suggesting || adding}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground active:opacity-60 transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Suggest
          </button>
        </div>
        <textarea
          id="r-chapters"
          value={chaptersText}
          onChange={(e) => setChaptersText(e.target.value)}
          placeholder={"Introduction\nChapter 1: The Basics\nChapter 2: …"}
          rows={6}
          disabled={adding}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 resize-none leading-relaxed placeholder:text-muted-foreground/50"
        />
        <p className="text-[10px] text-muted-foreground">
          One chapter per line. Lumen will generate a semantic summary for each.
        </p>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onBack} disabled={adding} className="w-20">
          Back
        </Button>
        <Button onClick={handleAdd} disabled={adding} className="flex-1">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add to library"}
        </Button>
      </div>
    </div>
  );
}

// ─── Digital book flow (PDF / ePub — bulk) ───────────────────────────────────

type FileItemStatus = "queued" | "parsing" | "duplicate" | "scanned" | "indexing" | "done" | "failed";

type FileItem = {
  id: string;
  file: File;
  name: string;
  status: FileItemStatus;
  chunks?: number;
  error?: string;
};

type DigitalStep = "select" | "processing" | "done";

function DigitalFlow({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const addDigitalFn = useServerFn(addDigitalBook);
  const checkDupFn = useServerFn(checkDuplicate);

  const [step, setStep] = useState<DigitalStep>("select");
  const [files, setFiles] = useState<FileItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase();
      return ext === "pdf" || ext === "epub";
    });
    if (valid.length === 0) {
      toast.error("Only PDF and ePub files are supported");
      return;
    }
    setFiles((prev) => [
      ...prev,
      ...valid.map((f) => ({ id: crypto.randomUUID(), file: f, name: f.name, status: "queued" as FileItemStatus })),
    ]);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const updateFile = (id: string, patch: Partial<FileItem>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const handleProcess = async () => {
    if (files.length === 0) return;
    setStep("processing");

    for (const item of files) {
      const ext = item.file.name.split(".").pop()?.toLowerCase();

      // 1. Parse
      updateFile(item.id, { status: "parsing" });
      let chunks: { content: string; chapterTitle?: string | null; pageNumber?: number | null }[] = [];
      let title = item.file.name.replace(/\.(pdf|epub)$/i, "");
      let author = "";
      let isbn = "";

      try {
        if (ext === "pdf") {
          const { extractPdf } = await import("@/lib/sources/pdf");
          const result: PdfExtractResult = await extractPdf(item.file);
          if (result.isScanned) {
            updateFile(item.id, { status: "scanned", error: "Scanned PDF — add via Physical book instead" });
            continue;
          }
          if (result.chunks.length === 0) {
            updateFile(item.id, { status: "failed", error: "No extractable text" });
            continue;
          }
          chunks = result.chunks;
          title = result.title ?? title;
          author = result.author ?? "";
        } else {
          const { extractEpub } = await import("@/lib/sources/epub");
          const result: EpubExtractResult = await extractEpub(item.file);
          if (result.chunks.length === 0) {
            updateFile(item.id, { status: "failed", error: "No extractable text" });
            continue;
          }
          chunks = result.chunks;
          title = result.title ?? title;
          author = result.author ?? "";
          isbn = result.isbn ?? "";
        }
      } catch (e) {
        updateFile(item.id, { status: "failed", error: e instanceof Error ? e.message : "Parse error" });
        continue;
      }

      // 2. Duplicate check
      try {
        const dup = await checkDupFn({ data: { title, author: author || undefined, isbn: isbn || undefined } });
        if (dup.exists) {
          updateFile(item.id, { status: "duplicate", error: "Already in library" });
          continue;
        }
      } catch { /* skip dup check on error */ }

      // 3. Index
      updateFile(item.id, { status: "indexing" });
      try {
        await addDigitalFn({
          data: {
            title,
            author: author || undefined,
            isbn: isbn || undefined,
            chunks,
          },
        });
        updateFile(item.id, { status: "done", chunks: chunks.length });
      } catch (e) {
        updateFile(item.id, { status: "failed", error: e instanceof Error ? e.message : "Indexing failed" });
      }
    }

    setStep("done");
  };

  const doneCount = files.filter((f) => f.status === "done").length;
  const isProcessing = step === "processing";

  if (step === "select") {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} />

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.epub"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <DropZone
            label="Drop PDF or ePub files here"
            hint="Multiple files supported · click to browse"
            loading={false}
            loadingLabel=""
            onClick={() => fileRef.current?.click()}
            icon={Upload}
          />
        </div>

        {files.length > 0 && (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-2.5 rounded-md bg-muted px-3 py-2">
                <Upload className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="text-[11px] truncate flex-1">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="text-[10px] text-muted-foreground hover:text-destructive active:opacity-60 transition-all cursor-pointer select-none shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <Button className="w-full" onClick={handleProcess}>
            Index {files.length} file{files.length !== 1 ? "s" : ""}
          </Button>
        )}
      </div>
    );
  }

  // processing or done
  return (
    <div className="space-y-4">
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-2.5 rounded-md bg-muted px-3 py-2">
            <DigitalStatusIcon status={f.status} />
            <span className="text-[11px] truncate flex-1">{f.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {f.status === "done" && `${f.chunks} chunks`}
              {f.status === "duplicate" && "duplicate"}
              {f.status === "scanned" && "scanned PDF"}
              {f.status === "failed" && (f.error ?? "failed")}
              {f.status === "parsing" && "parsing…"}
              {f.status === "indexing" && "indexing…"}
              {f.status === "queued" && "queued"}
            </span>
          </div>
        ))}
      </div>

      {step === "done" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground text-center">
            {doneCount} of {files.length} indexed successfully
          </p>
          <Button className="w-full" onClick={() => navigate({ to: "/library" })}>
            Go to library
          </Button>
        </div>
      )}

      {isProcessing && (
        <IngestingBanner label="Parsing and indexing files… do not close this tab." />
      )}
    </div>
  );
}

function DigitalStatusIcon({ status }: { status: FileItemStatus }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (status === "duplicate") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
  if (status === "scanned") return <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  if (status === "parsing" || status === "indexing") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />;
}

// ─── Kindle library flow ──────────────────────────────────────────────────────

type KindleBook = {
  title: string;
  author: string;
  isbn: string;
  coverUrl: string;
  selected: boolean;
  isDuplicate: boolean;
  status: "pending" | "processing" | "done" | "failed";
};

type KindleStep = "screenshots" | "review" | "ingesting";

function KindleFlow({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const extractFn = useServerFn(extractKindleLibrary);
  const lookupFn = useServerFn(lookupBook);
  const checkDupFn = useServerFn(checkDuplicate);
  const addKindleFn = useServerFn(addKindleBook);

  const [step, setStep] = useState<KindleStep>("screenshots");
  const [screenshots, setScreenshots] = useState<{ id: string; name: string; base64: string; mimeType: "image/jpeg" | "image/png" | "image/webp" }[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [books, setBooks] = useState<KindleBook[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleScreenshots = async (files: FileList) => {
    const valid = Array.from(files).filter((f) =>
      ["image/jpeg", "image/png", "image/webp"].includes(f.type),
    );
    if (valid.length === 0) {
      toast.error("Use JPEG, PNG, or WebP screenshots");
      return;
    }
    const newScreenshots = await Promise.all(
      valid.map(async (f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        base64: await toBase64(f),
        mimeType: f.type as "image/jpeg" | "image/png" | "image/webp",
      })),
    );
    setScreenshots((prev) => [...prev, ...newScreenshots]);
  };

  const handleExtract = async () => {
    if (screenshots.length === 0) {
      toast.error("Add at least one screenshot first");
      return;
    }
    setExtracting(true);
    try {
      const allBooks: { title: string; author: string }[] = [];

      for (const ss of screenshots) {
        const result = await extractFn({ data: { imageBase64: ss.base64, mimeType: ss.mimeType } });
        allBooks.push(...result.books);
      }

      if (allBooks.length === 0) {
        toast.error("No books detected — try a clearer screenshot");
        return;
      }

      // Deduplicate by title (case-insensitive)
      const seen = new Set<string>();
      const unique = allBooks.filter(({ title }) => {
        const key = title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Enrich with Google Books metadata + check duplicates in parallel
      const enriched = await Promise.all(
        unique.map(async ({ title, author }): Promise<KindleBook> => {
          const [candidates, dup] = await Promise.all([
            lookupFn({ data: { query: `${title} ${author}` } }).catch(() => []),
            checkDupFn({ data: { title, author } }).catch(() => ({ exists: false })),
          ]);
          const best = candidates[0];
          return {
            title: best?.title ?? title,
            author: best?.authors.join(", ") ?? author,
            isbn: best?.isbn ?? "",
            coverUrl: best?.coverUrl ?? "",
            selected: !dup.exists,
            isDuplicate: dup.exists,
            status: "pending",
          };
        }),
      );

      setBooks(enriched);
      setStep("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const handleIngest = async () => {
    const toAdd = books.filter((b) => b.selected && !b.isDuplicate);
    if (toAdd.length === 0) {
      toast.error("No books selected");
      return;
    }
    setStep("ingesting");

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      if (!book.selected || book.isDuplicate) continue;

      setBooks((prev) => prev.map((b, j) => (j === i ? { ...b, status: "processing" } : b)));
      try {
        await addKindleFn({
          data: {
            title: book.title,
            author: book.author || undefined,
            isbn: book.isbn || undefined,
            coverUrl: book.coverUrl || undefined,
          },
        });
        setBooks((prev) => prev.map((b, j) => (j === i ? { ...b, status: "done" } : b)));
      } catch {
        setBooks((prev) => prev.map((b, j) => (j === i ? { ...b, status: "failed" } : b)));
      }
    }

    const doneCount = toAdd.length;
    toast.success(`${doneCount} book${doneCount === 1 ? "" : "s"} added to your library`);
    navigate({ to: "/library" });
  };

  if (step === "screenshots") {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Go to{" "}
          <span className="font-medium text-foreground">read.amazon.com/kindle-library</span>, take
          screenshots of your library (multiple if needed), then upload them here.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleScreenshots(e.target.files)}
        />

        <DropZone
          label="Add screenshots"
          hint="JPEG, PNG, or WebP · select multiple"
          loading={false}
          loadingLabel=""
          onClick={() => fileRef.current?.click()}
          icon={Smartphone}
        />

        {screenshots.length > 0 && (
          <div className="space-y-1.5">
            {screenshots.map((ss) => (
              <div
                key={ss.id}
                className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
              >
                <span className="text-[10px] truncate">{ss.name}</span>
                <button
                  type="button"
                  onClick={() => setScreenshots((prev) => prev.filter((s) => s.id !== ss.id))}
                  className="ml-2 text-[10px] text-muted-foreground hover:text-destructive active:opacity-60 transition-all cursor-pointer select-none"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <Button
          className="w-full"
          onClick={handleExtract}
          disabled={extracting || screenshots.length === 0}
        >
          {extracting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Extracting books…
            </>
          ) : (
            `Extract books from ${screenshots.length || ""} screenshot${screenshots.length !== 1 ? "s" : ""}`
          )}
        </Button>
      </div>
    );
  }

  if (step === "review") {
    const selectedCount = books.filter((b) => b.selected && !b.isDuplicate).length;

    return (
      <div className="space-y-4">
        <BackButton onClick={() => setStep("screenshots")} />
        <p className="text-[10px] text-muted-foreground">
          {books.length} books detected. {books.filter((b) => b.isDuplicate).length} already in your
          library.
        </p>

        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {books.map((book, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                book.isDuplicate
                  ? "border-border opacity-40"
                  : book.selected
                    ? "border-border"
                    : "border-border opacity-60"
              }`}
            >
              {book.coverUrl ? (
                <img
                  src={book.coverUrl}
                  alt={book.title}
                  className="h-12 w-8 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground/40" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium truncate">{book.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{book.author}</p>
                {book.isDuplicate && (
                  <p className="text-[10px] text-muted-foreground">Already in library</p>
                )}
              </div>
              {!book.isDuplicate && (
                <button
                  type="button"
                  onClick={() =>
                    setBooks((prev) =>
                      prev.map((b, j) => (j === i ? { ...b, selected: !b.selected } : b)),
                    )
                  }
                  className="shrink-0"
                >
                  <div
                    className={`h-4 w-4 rounded border ${
                      book.selected
                        ? "bg-foreground border-foreground"
                        : "border-muted-foreground/40"
                    }`}
                  />
                </button>
              )}
            </div>
          ))}
        </div>

        <Button
          className="w-full"
          onClick={handleIngest}
          disabled={selectedCount === 0}
        >
          Add {selectedCount} book{selectedCount !== 1 ? "s" : ""} to library
        </Button>
      </div>
    );
  }

  // Ingesting
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">Adding to library…</p>
      <div className="space-y-1.5">
        {books
          .filter((b) => b.selected && !b.isDuplicate)
          .map((book, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-md bg-muted px-3 py-2">
              <StatusIcon status={book.status} />
              <span className="text-[11px] truncate">{book.title}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── Web sources flow (URL / Substack / GitHub) ───────────────────────────────

type WebTab = "url" | "substack" | "github";

function WebFlow({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<WebTab>("url");
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<WebSourcePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const previewUrlFn = useServerFn(previewWebArticle);
  const ingestUrlFn = useServerFn(ingestWebArticle);
  const previewYouTubeFn = useServerFn(previewYouTubeVideo);
  const ingestYouTubeFn = useServerFn(ingestYouTubeVideo);
  const previewSubstackFn = useServerFn(previewSubstack);
  const ingestSubstackFn = useServerFn(ingestSubstack);
  const previewGithubFn = useServerFn(previewGithubRepo);
  const ingestGithubFn = useServerFn(ingestGithubRepo);

  const tabs: { id: WebTab; label: string; icon: React.ElementType; placeholder: string }[] = [
    { id: "url",      label: "URL",      icon: Link2,      placeholder: "https://…" },
    { id: "substack", label: "Substack", icon: Rss,        placeholder: "lenny  (handle only)" },
    { id: "github",   label: "GitHub",   icon: GitBranch,  placeholder: "https://github.com/owner/repo" },
  ];

  const handleTabChange = (t: WebTab) => {
    setTab(t);
    setInput("");
    setPreview(null);
  };

  // Extract substack handle from full URL or bare handle.
  // Returns null for specific article URLs (/p/ path) — those go to ingestWebArticle.
  const extractSubstackHandle = (val: string): string | null => {
    // substack.com/@username (new Substack profile/reader format)
    const atMatch = val.match(/substack\.com\/@([a-z0-9_-]+)/i);
    if (atMatch) return atMatch[1];

    // Don't match specific article URLs (/p/ path)
    try {
      const u = new URL(val.startsWith("http") ? val : `https://${val}`);
      if (u.pathname.startsWith("/p/")) return null;
    } catch {}

    // username.substack.com subdomain format
    const m = val.match(/([a-z0-9-]+)\.substack\.com/i);
    return m ? m[1] : null;
  };

  const isYouTubeChannel = (val: string) =>
    /youtube\.com\/@|youtube\.com\/c\/|youtube\.com\/channel\//i.test(val) &&
    !val.includes("watch?v=") &&
    !val.includes("youtu.be/");

  const isYouTubeVideo = (val: string) =>
    /youtube\.com\/watch\?.*v=|youtu\.be\/[a-zA-Z0-9_-]{11}/i.test(val);

  const isHomepageUrl = (val: string) => {
    try {
      const { pathname } = new URL(val);
      return pathname === "/" || pathname === "";
    } catch {
      return false;
    }
  };

  const handlePreview = async () => {
    let val = input.trim();
    if (!val) return;

    // Block YouTube channel pages — we can only index specific videos
    if (isYouTubeChannel(val)) {
      toast.error("Paste a specific video URL (e.g. youtube.com/watch?v=…), not a channel page. The Chrome extension (coming soon) will handle channels.");
      return;
    }

    // Auto-detect Substack URLs (.substack.com domain)
    const substackHandle = extractSubstackHandle(val);
    if (substackHandle && tab !== "substack") {
      setTab("substack");
      setInput(substackHandle);
      val = substackHandle;
    }

    // Auto-detect GitHub URLs in URL tab
    if (tab === "url" && val.includes("github.com/")) {
      setTab("github");
      setInput(val);
    }

    // Auto-detect newsletter homepage URLs (custom domains like news.aakashg.com)
    // A homepage URL with no article path is almost certainly a newsletter — try RSS
    if (tab === "url" && !substackHandle && val.startsWith("http") && isHomepageUrl(val)) {
      setPreviewing(true);
      setPreview(null);
      try {
        const feedPreview = await previewSubstackFn({ data: { handle: val } });
        setTab("substack");
        setInput(val);
        setPreview(feedPreview);
        return;
      } catch {
        // Not a newsletter feed — fall through to normal URL fetch
      } finally {
        setPreviewing(false);
      }
    }

    setPreviewing(true);
    setPreview(null);
    try {
      const activeTab = substackHandle ? "substack" : val.includes("github.com/") ? "github" : tab;
      const activeVal = substackHandle ?? val;
      if (activeTab === "url" && isYouTubeVideo(activeVal)) {
        setPreview(await previewYouTubeFn({ data: { url: activeVal } }));
      } else if (activeTab === "url") {
        setPreview(await previewUrlFn({ data: { url: activeVal } }));
      } else if (activeTab === "substack") {
        setPreview(await previewSubstackFn({ data: { handle: activeVal } }));
      } else {
        setPreview(await previewGithubFn({ data: { url: activeVal } }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not fetch preview");
    } finally {
      setPreviewing(false);
    }
  };

  const handleIngest = async () => {
    if (!preview) return;
    setIngesting(true);
    try {
      if (tab === "url" && isYouTubeVideo(input.trim())) {
        const r = await ingestYouTubeFn({ data: { url: input.trim() } });
        toast.success(`Video indexed — ${r.chunks} chunks`);
      } else if (tab === "url") {
        const r = await ingestUrlFn({ data: { url: input.trim() } });
        toast.success(`Article indexed — ${r.chunks} chunks`);
      } else if (tab === "substack") {
        // Extract handle when possible; fall back to full URL for custom domains
        const val = input.trim();
        const handle = extractSubstackHandle(val) ?? (val.startsWith("http") ? val : val);
        const r = await ingestSubstackFn({ data: { handle } });
        toast.success(`${r.ingested.length} article${r.ingested.length !== 1 ? "s" : ""} indexed`);
      } else {
        const r = await ingestGithubFn({ data: { url: input.trim() } });
        toast.success(`Repo indexed — ${r.chunks} chunks`);
      }
      navigate({ to: "/library" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ingestion failed");
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} />

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleTabChange(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all active:scale-[0.96] cursor-pointer select-none ${
              tab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => { setInput(e.target.value); setPreview(null); }}
          onKeyDown={(e) => e.key === "Enter" && handlePreview()}
          placeholder={tabs.find((t) => t.id === tab)?.placeholder}
          autoFocus
          disabled={ingesting}
        />
        <Button variant="outline" onClick={handlePreview} disabled={previewing || !input.trim() || ingesting}>
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Preview */}
      {preview && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            {tab === "url" && <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {tab === "substack" && <Rss className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {tab === "github" && <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <p className="text-xs font-medium truncate">{preview.title}</p>
          </div>
          {preview.description && (
            <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
              {preview.description}
            </p>
          )}
          {preview.itemCount !== undefined && (
            <p className="text-[10px] text-muted-foreground">
              {tab === "substack"
                ? `${preview.itemCount} articles in feed · importing last 5`
                : `${preview.itemCount} chunks to index`}
            </p>
          )}
          {preview.items && preview.items.length > 0 && (
            <div className="space-y-1 pt-0.5">
              {preview.items.map((item, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <span className="text-[10px] truncate text-muted-foreground">{item.title}</span>
                  {item.date && (
                    <span className="text-[9px] text-muted-foreground/50 shrink-0">{item.date}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {preview && (
        <Button className="w-full" onClick={handleIngest} disabled={ingesting}>
          {ingesting ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Indexing…</>
          ) : (
            "Add to library"
          )}
        </Button>
      )}
    </div>
  );
}

// ─── Shared small components ──────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground active:opacity-70 transition-all cursor-pointer select-none"
    >
      <ArrowLeft className="h-3 w-3" />
      Back
    </button>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  optional,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  optional?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {label}
        {optional && (
          <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
        )}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function DropZone({
  label,
  hint,
  loading,
  loadingLabel,
  onClick,
  icon: Icon = Upload,
}: {
  label: string;
  hint: string;
  loading: boolean;
  loadingLabel: string;
  onClick: () => void;
  icon?: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-10 text-muted-foreground hover:border-foreground/40 hover:text-foreground hover:bg-accent/20 active:scale-[0.99] active:bg-accent/40 transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <>
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-xs">{loadingLabel}</span>
        </>
      ) : (
        <>
          <Icon className="h-6 w-6" />
          <span className="text-xs">{label}</span>
          <span className="text-[10px]">{hint}</span>
        </>
      )}
    </button>
  );
}

function IngestingBanner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusIcon({ status }: { status: KindleBook["status"] }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (status === "processing") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Root component ────────────────────────────────────────────────────────────

function ImportPage() {
  const [mode, setMode] = useState<ImportMode | null>(null);

  const title =
    mode === "physical"
      ? "Physical book"
      : mode === "digital"
        ? "PDF or ePub"
        : mode === "kindle"
          ? "Kindle library"
          : mode === "web"
            ? "Web sources"
            : "Import sources";

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        {mode ? (
          <button
            type="button"
            onClick={() => setMode(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Link to="/library" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        )}
        <h1 className="text-xs font-medium">{title}</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-sm">
          {mode === null && <ModeSelector onSelect={setMode} />}
          {mode === "physical" && <PhysicalFlow onBack={() => setMode(null)} />}
          {mode === "digital" && <DigitalFlow onBack={() => setMode(null)} />}
          {mode === "kindle" && <KindleFlow onBack={() => setMode(null)} />}
          {mode === "web" && <WebFlow onBack={() => setMode(null)} />}
        </div>
      </div>
    </div>
  );
}
