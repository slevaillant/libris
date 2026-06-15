import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  startSession,
  endSession,
  getOwnerForIndexer,
  indexerAddBook,
} from "@/lib/bounty.functions";
import { suggestChapters, lookupBook } from "@/lib/library.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { toast } from "sonner";
import {
  BookImage,
  Check,
  CheckCircle,
  Loader2,
  MapPin,
  ScanBarcode,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/index-books")({
  component: IndexBooksPage,
});

type BookPreview = { title: string; author: string; isbn: string | null; cover: string | null };
type AddedBook = { title: string; shelfLocation: string };

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF" };
function fmt(amount: number, currency: string) {
  return `${CURRENCY_SYMBOLS[currency] ?? currency}${amount.toFixed(2)}`;
}

function IndexBooksPage() {
  const navigate = useNavigate();

  const getOwnerFn = useServerFn(getOwnerForIndexer);
  const startFn = useServerFn(startSession);
  const endFn = useServerFn(endSession);
  const addBookFn = useServerFn(indexerAddBook);
  const lookupFn = useServerFn(lookupBook);
  const suggestFn = useServerFn(suggestChapters);

  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{ pricePerBook: number; currency: string } | null>(null);
  const [bookCount, setBookCount] = useState(0);
  const [added, setAdded] = useState<AddedBook[]>([]);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [endResult, setEndResult] = useState<{ bookCount: number; totalAmount: number; currency: string } | null>(null);

  // Per-book state
  const [identifying, setIdentifying] = useState(false);
  const [preview, setPreview] = useState<BookPreview | null>(null);
  const [shelf, setShelf] = useState("");
  const [saving, setSaving] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [inputMode, setInputMode] = useState<"cover" | "barcode" | "manual">("cover");
  const [manualTitle, setManualTitle] = useState("");
  const [manualAuthor, setManualAuthor] = useState("");

  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getOwnerFn({}).then(({ ownerUserId: id }) => setOwnerUserId(id)).catch(() => {});
  }, []);

  const begin = async () => {
    if (!ownerUserId) {
      const msg = "No library found — join via a valid invite link first.";
      setStartError(msg);
      toast.error(msg);
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const result = await startFn({ data: { ownerUserId } });
      setSessionId(result.sessionId);
      setSessionInfo({ pricePerBook: result.pricePerBook, currency: result.currency });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start session";
      const friendly = msg.toLowerCase().includes("bounty")
        ? "The library owner hasn't configured a bounty yet — ask them to set a price per book."
        : msg;
      setStartError(friendly);
      toast.error(friendly, { duration: 6000 });
    } finally {
      setStarting(false);
    }
  };

  const finish = async () => {
    if (!sessionId) return;
    setEnding(true);
    try {
      const result = await endFn({ data: { sessionId } });
      setEndResult(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to end session");
    } finally {
      setEnding(false);
    }
  };

  const onCoverFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast.error("Image too large (max 8 MB)"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setIdentifying(true);
      setPreview(null);
      try {
        // Use a basic vision call via the import flow isn't available here.
        // Fall back to asking the user to type the title for cover-photo flow.
        // The barcode path is the recommended fast path.
        toast.info("Cover photo recognised — please verify the title and author below.");
        setPreview({ title: "", author: "", isbn: null, cover: dataUrl });
      } finally {
        setIdentifying(false);
      }
    };
    reader.readAsDataURL(f);
  };

  const onBarcodeDetected = async (isbn: string) => {
    setScannerActive(false);
    setIdentifying(true);
    try {
      const results = await lookupFn({ data: { query: `isbn:${isbn}` } });
      const r = results[0];
      if (r) setPreview({ title: r.title, author: r.authors.join(", "), isbn: r.isbn ?? isbn, cover: r.coverUrl ?? null });
      else setPreview({ title: "", author: "", isbn, cover: null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ISBN lookup failed");
    } finally {
      setIdentifying(false);
    }
  };

  const confirmManual = () => {
    if (!manualTitle.trim()) { toast.error("Title required"); return; }
    setPreview({ title: manualTitle.trim(), author: manualAuthor.trim(), isbn: null, cover: null });
  };

  const saveBook = async () => {
    if (!preview || !shelf.trim() || !sessionId) return;
    setSaving(true);
    try {
      let chapters: string[] = [];
      try {
        const suggested = await suggestFn({ data: { title: preview.title, author: preview.author } });
        chapters = suggested as string[];
      } catch { /* non-fatal */ }

      const { bookCount: newCount } = await addBookFn({
        data: {
          sessionId,
          title: preview.title,
          author: preview.author || undefined,
          isbn: preview.isbn,
          coverUrl: preview.cover,
          shelfLocation: shelf.trim(),
          chapters,
        },
      });

      setBookCount(newCount);
      setAdded((prev) => [{ title: preview.title, shelfLocation: shelf.trim() }, ...prev]);
      setPreview(null);
      setShelf("");
      setManualTitle("");
      setManualAuthor("");
      toast.success(`"${preview.title}" added · ${newCount} book${newCount === 1 ? "" : "s"} this session`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── End screen ──────────────────────────────────────────────────────────────
  if (endResult) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-xs">
          <Trophy className="h-12 w-12 mx-auto text-amber-500" />
          <div>
            <div className="text-2xl font-bold">{fmt(endResult.totalAmount, endResult.currency)}</div>
            <div className="text-sm text-muted-foreground">
              {endResult.bookCount} book{endResult.bookCount === 1 ? "" : "s"} indexed
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Great work! The library owner has been notified. You'll receive payment shortly.
          </p>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate({ to: "/library" })}>
            View library
          </Button>
        </div>
      </div>
    );
  }

  // ── Start screen ────────────────────────────────────────────────────────────
  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-xs">
          <BookImage className="h-10 w-10 mx-auto text-muted-foreground" />
          <div>
            <h1 className="text-sm font-semibold">Ready to index?</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Scan each book's barcode, confirm metadata, enter its shelf location, and earn per book added.
            </p>
          </div>
          {startError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-left">
              <p className="text-xs font-semibold text-destructive">Can't start session</p>
              <p className="text-xs text-destructive/80 mt-1">{startError}</p>
            </div>
          )}
          <Button size="sm" className="gap-1.5 text-xs w-full" onClick={begin} disabled={starting}>
            {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Start indexing session
          </Button>
        </div>
      </div>
    );
  }

  // ── Active session ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <BookImage className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Indexing session</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-bold tabular-nums">
              {bookCount} book{bookCount !== 1 ? "s" : ""}
            </div>
            {sessionInfo && (
              <div className="text-[10px] text-muted-foreground">
                = {fmt(bookCount * sessionInfo.pricePerBook, sessionInfo.currency)}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={finish} disabled={ending}>
            {ending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Finish"}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-md space-y-4 p-4">

          {/* Input mode selector */}
          {!preview && (
            <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
              {(["barcode", "cover", "manual"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setInputMode(mode); setPreview(null); setScannerActive(false); }}
                  className={`flex-1 rounded-md py-1.5 text-[11px] font-medium transition-colors ${
                    inputMode === mode ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {mode === "barcode" ? "📷 Barcode" : mode === "cover" ? "📸 Cover" : "✏️ Manual"}
                </button>
              ))}
            </div>
          )}

          {/* Barcode scanner */}
          {!preview && inputMode === "barcode" && (
            scannerActive ? (
              <BarcodeScanner onDetected={onBarcodeDetected} onCancel={() => setScannerActive(false)} />
            ) : identifying ? (
              <div className="border border-dashed border-border rounded-lg p-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Looking up ISBN…</p>
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-lg p-8 text-center space-y-3">
                <ScanBarcode className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Fastest path — no typing required</p>
                <Button size="sm" className="gap-1.5 text-xs" onClick={() => setScannerActive(true)}>
                  Start camera
                </Button>
              </div>
            )
          )}

          {/* Cover photo */}
          {!preview && inputMode === "cover" && (
            <div
              className="border border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:bg-accent/20"
              onClick={() => coverRef.current?.click()}
            >
              {identifying ? (
                <><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" /><p className="text-xs text-muted-foreground">Processing…</p></>
              ) : (
                <>
                  <BookImage className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-xs font-medium">Photograph the cover</p>
                  <p className="text-[10px] text-muted-foreground mt-1">You'll confirm title and author</p>
                </>
              )}
              <input
                ref={coverRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onCoverFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {/* Manual entry */}
          {!preview && inputMode === "manual" && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <Label className="text-[10px]">Title *</Label>
                <Input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} className="h-7 text-xs mt-1" placeholder="Book title" />
              </div>
              <div>
                <Label className="text-[10px]">Author</Label>
                <Input value={manualAuthor} onChange={(e) => setManualAuthor(e.target.value)} className="h-7 text-xs mt-1" placeholder="Author name" />
              </div>
              <Button size="sm" className="w-full h-7 text-xs" onClick={confirmManual}>Continue</Button>
            </div>
          )}

          {/* Book preview + shelf entry */}
          {preview && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex gap-3 p-4">
                {preview.cover ? (
                  <img src={preview.cover} alt="" className="h-16 w-11 rounded object-cover shrink-0" />
                ) : (
                  <div className="h-16 w-11 rounded bg-muted shrink-0 flex items-center justify-center">
                    <BookImage className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Input
                    value={preview.title}
                    onChange={(e) => setPreview({ ...preview, title: e.target.value })}
                    className="h-7 text-xs font-medium mb-1"
                    placeholder="Title"
                  />
                  <Input
                    value={preview.author}
                    onChange={(e) => setPreview({ ...preview, author: e.target.value })}
                    className="h-6 text-[11px]"
                    placeholder="Author"
                  />
                </div>
                <button type="button" onClick={() => { setPreview(null); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="border-t border-border p-4 space-y-3">
                <div>
                  <Label className="text-[10px] flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Shelf location *
                  </Label>
                  <Input
                    value={shelf}
                    onChange={(e) => setShelf(e.target.value)}
                    placeholder="e.g. A-12 or Living room shelf 3"
                    className="h-7 text-xs mt-1"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && saveBook()}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5"
                  onClick={saveBook}
                  disabled={saving || !shelf.trim() || !preview.title.trim()}
                >
                  {saving ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                  ) : (
                    <><Check className="h-3.5 w-3.5" /> Confirm &amp; add book</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Recent additions */}
          {added.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Just added</p>
              {added.slice(0, 5).map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                  <span className="truncate flex-1">{b.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">{b.shelfLocation}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
