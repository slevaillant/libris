import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getBountyConfig,
  upsertBountyConfig,
  getLeaderboard,
  markSessionPaid,
  createInviteToken,
  type BountyConfig,
  type IndexingSession,
} from "@/lib/bounty.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Award,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Settings,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bounty")({
  component: BountyPage,
});

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF" };
function fmt(amount: number, currency: string) {
  return `${CURRENCY_SYMBOLS[currency] ?? currency}${amount.toFixed(2)}`;
}

function BountyPage() {
  const fetchConfig = useServerFn(getBountyConfig);
  const saveConfig = useServerFn(upsertBountyConfig);
  const fetchLeaderboard = useServerFn(getLeaderboard);
  const paySession = useServerFn(markSessionPaid);
  const genInvite = useServerFn(createInviteToken);

  const [config, setConfig] = useState<BountyConfig | null>(null);
  const [sessions, setSessions] = useState<IndexingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [price, setPrice] = useState("0.50");
  const [currency, setCurrency] = useState("EUR");

  useEffect(() => {
    Promise.all([fetchConfig({}), fetchLeaderboard({})])
      .then(([cfg, lb]) => {
        if (cfg) {
          setConfig(cfg);
          setPrice(cfg.pricePerBook.toFixed(2));
          setCurrency(cfg.currency);
        }
        setSessions(lb);
      })
      .catch((e) => console.error("Bounty load error:", e))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveConfig({
        data: {
          pricePerBook: parseFloat(price) || 0.5,
          currency,
        },
      });
      toast.success("Bounty configuration saved");
      const cfg = await fetchConfig({});
      setConfig(cfg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const generateInvite = async () => {
    try {
      const { tokenId } = await genInvite({});
      setInviteUrl(`${window.location.origin}/join/${tokenId}`);
      toast.success("Invite link generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate invite");
    }
  };

  const copyInvite = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied");
  };

  const pay = async (sessionId: string) => {
    try {
      await paySession({ data: { sessionId } });
      setSessions((prev) =>
        prev.map((s) => s.id === sessionId ? { ...s, paid: true, paidAt: new Date().toISOString() } : s),
      );
      toast.success("Marked as paid");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const openPayment = (session: IndexingSession) => {
    if (!session.indexerPaymentLink) return;
    const note = encodeURIComponent(`Libris indexing — ${session.bookCount} books`);
    const url = session.indexerPaymentLink.includes("?")
      ? `${session.indexerPaymentLink}&amount=${session.totalAmount}&note=${note}`
      : `${session.indexerPaymentLink}/${session.totalAmount}`;
    window.open(url, "_blank");
  };

  const totalOwed = sessions.filter((s) => !s.paid).reduce((acc, s) => acc + s.totalAmount, 0);
  const totalPaid = sessions.filter((s) => s.paid).reduce((acc, s) => acc + s.totalAmount, 0);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
        <h1 className="text-xs font-medium">Indexing Bounty</h1>
        <span className="text-[10px] text-muted-foreground">Reward people for cataloguing your physical library</span>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6">

          {/* Config */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Configuration</h2>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Price per book</Label>
                  <div className="flex gap-1.5 mt-1">
                    <Input
                      type="number"
                      min="0"
                      step="0.10"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="h-7 text-xs w-24 font-mono"
                    />
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {["EUR", "USD", "GBP", "CHF"].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" className="h-7 text-xs gap-1" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Save
                </Button>
              </div>
            </div>
          </section>

          {/* Invite */}
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Invite an indexer</h2>
              <p className="text-xs text-muted-foreground">Share a link — they sign up, get access, and start earning.</p>
            </div>
            <div className="space-y-3 p-4">
              {inviteUrl ? (
                <div className="flex gap-2">
                  <Input value={inviteUrl} readOnly className="h-7 text-xs font-mono flex-1" />
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0" onClick={copyInvite}>
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={generateInvite}>
                  Generate invite link
                </Button>
              )}
              <p className="text-[9px] text-muted-foreground">Single-use · expires in 7 days</p>
            </div>
          </section>

          {/* Stats */}
          {sessions.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Books indexed", value: sessions.reduce((a, s) => a + s.bookCount, 0).toString() },
                { label: "Amount owed", value: fmt(totalOwed, currency) },
                { label: "Amount paid", value: fmt(totalPaid, currency) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
                  <div className="text-lg font-semibold tabular-nums">{value}</div>
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Leaderboard */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Award className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Leaderboard</h2>
              <span className="ml-auto text-[10px] text-muted-foreground">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
            </div>
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BookOpen className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs font-medium">No sessions yet</p>
                <p className="text-[11px] text-muted-foreground">Invite someone to start indexing your shelves.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {sessions.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-sm font-mono text-muted-foreground w-5 text-center">
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{s.indexerName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.bookCount} book{s.bookCount === 1 ? "" : "s"} · {fmt(s.totalAmount, s.currency)}
                        {!s.endedAt && " · in progress"}
                      </div>
                    </div>
                    {s.paid ? (
                      <span className={cn("text-[10px] font-medium text-green-600 shrink-0")}>Paid</span>
                    ) : s.endedAt ? (
                      <div className="flex gap-1.5 shrink-0">
                        {s.indexerPaymentLink && (
                          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => openPayment(s)}>
                            <ExternalLink className="h-2.5 w-2.5" />
                            Pay {fmt(s.totalAmount, s.currency)}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => pay(s.id)}>
                          Mark paid
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[10px] font-medium text-emerald-600 shrink-0">Live</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
