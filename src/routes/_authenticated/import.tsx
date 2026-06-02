import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ArrowLeft, BookOpen, Camera, Search, PenLine, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  extractBookFromCover,
  lookupBook,
  suggestChapters,
  addPhysicalBook,
  type BookCandidate,
} from "@/lib/library.functions";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportBook,
});

// ─── Step types ───────────────────────────────────────────────────────────────

type Method = "search" | "scan" | "manual";
type Step = "identify" | "review";

type Draft = {
  title: string;
  author: string;
  isbn: string;
  coverUrl: string;
  description: string;
  shelfLocation: string;
};

const emptyDraft = (): Draft => ({
  title: "", author: "", isbn: "", coverUrl: "", description: "", shelfLocation: "",
});

// ─── Step 1: Identify ────────────────────────────────────────────────────────

function IdentifyStep({
  onContinue,
}: {
  onContinue: (draft: Draft) => void;
}) {
  const [method, setMethod] = useState<Method>("search");
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
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const meta = await extractFn({ data: { imageBase64: base64, mimeType } });
      onContinue({ ...emptyDraft(), title: meta.title, author: meta.author, isbn: meta.isbn ?? "" });
    } catch {
      toast.error("Could not read the cover — try entering details manually");
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const tabs: { id: Method; label: string; icon: React.ElementType }[] = [
    { id: "search", label: "Search", icon: Search },
    { id: "scan",   label: "Cover scan", icon: Camera },
    { id: "manual", label: "Manual entry", icon: PenLine },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setMethod(id); setResults([]); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
              method === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
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
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((c) => (
                <button
                  key={c.googleBooksId}
                  type="button"
                  onClick={() => handleSelectCandidate(c)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left hover:bg-accent/50 transition-colors"
                >
                  {c.coverUrl ? (
                    <img src={c.coverUrl} alt={c.title} className="h-14 w-10 shrink-0 rounded object-cover" />
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
            <div className="text-center py-3">
              <p className="text-[10px] text-muted-foreground">No results — try entering details manually.</p>
            </div>
          )}
        </div>
      )}

      {/* Scan */}
      {method === "scan" && (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFilePick}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-10 text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors disabled:opacity-50"
          >
            {scanning ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">Reading cover…</span>
              </>
            ) : (
              <>
                <Camera className="h-6 w-6" />
                <span className="text-xs">Choose cover photo</span>
                <span className="text-[10px]">JPEG, PNG, or WebP</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Manual */}
      {method === "manual" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-title">Title</Label>
            <Input
              id="m-title"
              value={manual.title}
              onChange={(e) => setManual((d) => ({ ...d, title: e.target.value }))}
              placeholder="High Output Management"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-author">Author</Label>
            <Input
              id="m-author"
              value={manual.author}
              onChange={(e) => setManual((d) => ({ ...d, author: e.target.value }))}
              placeholder="Andy Grove"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-isbn">
              ISBN <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="m-isbn"
              value={manual.isbn}
              onChange={(e) => setManual((d) => ({ ...d, isbn: e.target.value }))}
              placeholder="9780679734895"
            />
          </div>
          <Button
            className="w-full"
            onClick={() => {
              if (!manual.title.trim()) { toast.error("Title is required"); return; }
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

// ─── Step 2: Review + chapters ────────────────────────────────────────────────

function ReviewStep({
  draft,
  onBack,
}: {
  draft: Draft;
  onBack: () => void;
}) {
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
    if (!title.trim()) { toast.error("Enter a title first"); return; }
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

    if (!title.trim()) { toast.error("Title is required"); return; }
    if (chapters.length === 0) { toast.error("Add at least one chapter"); return; }

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
      {adding && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Generating chapter summaries and indexing… this takes ~10 seconds per book.
          </p>
        </div>
      )}

      {/* Book details */}
      <div className="flex gap-3">
        {draft.coverUrl && (
          <img
            src={draft.coverUrl}
            alt={title}
            className="h-20 w-14 shrink-0 rounded object-cover border border-border"
          />
        )}
        <div className="flex-1 space-y-2">
          <div className="space-y-1">
            <Label htmlFor="r-title">Title</Label>
            <Input id="r-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-author">Author</Label>
            <Input id="r-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author name" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="r-isbn">
            ISBN <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="r-isbn" value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="9780…" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="r-shelf">
            Shelf <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="r-shelf"
            value={shelfLocation}
            onChange={(e) => setShelfLocation(e.target.value)}
            placeholder="Shelf B, row 2"
          />
        </div>
      </div>

      {/* Chapters */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="r-chapters">Chapters</Label>
          <button
            type="button"
            onClick={handleSuggest}
            disabled={suggesting || adding}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {suggesting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Suggest
          </button>
        </div>
        <textarea
          id="r-chapters"
          value={chaptersText}
          onChange={(e) => setChaptersText(e.target.value)}
          placeholder={"Introduction\nChapter 1: The Basics of Production\nChapter 2: Managing the Breakfast Factory"}
          rows={6}
          disabled={adding}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 resize-none leading-relaxed placeholder:text-muted-foreground/50"
        />
        <p className="text-[10px] text-muted-foreground">
          One chapter per line. {librisWillGenerate}
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

const librisWillGenerate = "Lumen will generate a semantic summary for each chapter.";

// ─── Root component ───────────────────────────────────────────────────────────

function ImportBook() {
  const [step, setStep] = useState<Step>("identify");
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <Link to="/library" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <h1 className="text-xs font-medium">Add a book</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-sm">
          {step === "identify" ? (
            <IdentifyStep
              onContinue={(d) => { setDraft(d); setStep("review"); }}
            />
          ) : (
            <ReviewStep
              draft={draft}
              onBack={() => setStep("identify")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
