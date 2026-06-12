import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Loader2,
  Mail,
  Clock,
  Play,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  BookOpen,
  Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getProfile, updateProfile } from "@/lib/profile.functions";
import {
  triggerTestDigest,
  runDigest,
  listDigestRuns,
  getDigestRun,
  parseTopicTitlesFromMd,
  type DigestRunSummary,
  type DigestThemeRow,
} from "@/lib/digest.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/digest")({
  component: DigestPage,
});

// ─── Settings section ─────────────────────────────────────────────────────────

function DigestSettings() {
  const getProfileFn = useServerFn(getProfile);
  const updateProfileFn = useServerFn(updateProfile);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [email, setEmail] = useState("");
  const [time, setTime] = useState("06:00");
  const [topicsMd, setTopicsMd] = useState<string | null>(null);
  const [topicsUpdatedAt, setTopicsUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    getProfileFn({})
      .then((p) => {
        if (!p) return;
        setEnabled(p.digestEnabled);
        setEmail(p.digestEmail ?? "");
        setTime(p.digestTime ?? "06:00");
        setTopicsMd(p.topicsMd ?? null);
        setTopicsUpdatedAt(p.topicsUpdatedAt ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const activeTopics = topicsMd ? parseTopicTitlesFromMd(topicsMd) : [];

  const handleSave = async () => {
    setSaving(true);
    try {
      const profile = await getProfileFn({});
      if (!profile) return;
      await updateProfileFn({
        data: {
          displayName: profile.displayName,
          librarianName: profile.librarianName,
          professionalContext: profile.professionalContext,
          timezone: profile.timezone,
          digestEnabled: enabled,
          digestEmail: email || null,
          onboardingCompleted: profile.onboardingCompleted,
        },
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading settings…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className={cn(
        "flex items-center justify-between rounded-lg border p-3.5 transition-colors",
        enabled ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-muted/30",
      )}>
        <div>
          <p className="text-xs font-medium">Daily digest</p>
          <p className="text-[10px] mt-0.5 text-muted-foreground">
            {enabled ? `Sent every morning at ${time}` : "No email will be sent"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={cn(
            "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
            enabled ? "bg-emerald-500" : "bg-muted-foreground/25",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200",
              enabled ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>

      {enabled && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="digest-email" className="flex items-center gap-1.5">
              <Mail className="h-3 w-3" />
              Delivery email
            </Label>
            <Input
              id="digest-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <p className="text-[10px] text-muted-foreground">
              Leave blank to read digests in-app only.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="digest-time" className="flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Delivery time
            </Label>
            <Input
              id="digest-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-28"
            />
            <p className="text-[10px] text-muted-foreground">
              Your local time. Digest runs after your last meeting of the previous day.
            </p>
          </div>
        </>
      )}

      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
      </Button>

      {/* Topics status */}
      <div className="rounded-lg border border-border p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-medium">Topics</p>
          </div>
          {topicsUpdatedAt && (
            <span className="text-[10px] text-muted-foreground">
              Synced {new Date(topicsUpdatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>

        {activeTopics.length === 0 ? (
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Aucun topic actif.{" "}
            <span className="font-mono bg-muted px-1 py-0.5 rounded text-[9px]">
              npx tsx sync/push-topics.ts
            </span>{" "}
            pour synchroniser TOPICS.md.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {activeTopics.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Test run panel ───────────────────────────────────────────────────────────

type TestSection = { theme: string; synthesis: string; citations: { title: string; author: string | null; chapterTitle: string | null; url: string | null }[] };

function TestRunPanel({ onRanTest }: { onRanTest: () => void }) {
  const triggerFn = useServerFn(triggerTestDigest);
  const runFn = useServerFn(runDigest);
  const [running, setRunning] = useState<"sample" | "topics" | "email" | null>(null);
  const [result, setResult] = useState<{ sectionsCount: number; citationCount: number; sections: TestSection[]; source: "sample" | "topics" } | null>(null);

  const handleSample = async () => {
    setRunning("sample");
    setResult(null);
    try {
      const res = await triggerFn({});
      setResult({ ...res, source: "sample" });
      onRanTest();
      toast.success(`Sample digest — ${res.sectionsCount} sections, ${res.citationCount} citations`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test digest failed");
    } finally {
      setRunning(null);
    }
  };

  const handleTopics = async (sendEmail = false) => {
    setRunning(sendEmail ? "email" : "topics");
    setResult(null);
    try {
      const res = await runFn({ data: { sendEmail } });
      setResult({ sectionsCount: res.sectionsCount, citationCount: res.citationCount, sections: res.sections, source: "topics" });
      onRanTest();
      if (sendEmail) {
        toast.success(res.emailSent ? "Email sent to your inbox!" : "Digest ran but email failed — check RESEND_API_KEY");
      } else {
        toast.success(`Digest from your topics — ${res.sectionsCount} sections, ${res.citationCount} citations`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No topics synced yet — run npx tsx sync/push-topics.ts first");
    } finally {
      setRunning(null);
    }
  };

  const busy = running !== null;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs font-medium">Test run</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => handleTopics(false)} disabled={busy} className="flex-1">
            {running === "topics" ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
            ) : (
              <><Play className="h-3 w-3" /> Preview</>
            )}
          </Button>
          <Button size="sm" onClick={() => handleTopics(true)} disabled={busy} className="flex-1">
            {running === "email" ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Sending…</>
            ) : (
              <>Send email now</>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSample} disabled={busy} className="shrink-0 text-muted-foreground">
            {running === "sample" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sample"}
          </Button>
        </div>
        {result && (
          <p className="text-[10px] text-muted-foreground">
            {result.source === "topics" ? "From your TOPICS.md" : "Predefined sample themes"} · {result.sectionsCount} sections · {result.citationCount} citations
          </p>
        )}
      </div>

      {result && (() => {
        const allCitations = result.sections.flatMap((s) => s.citations);
        const seen = new Set<string>();
        const uniqueSources = allCitations.filter((c) => {
          const key = c.url ?? c.title;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return (
          <div className="space-y-6 pt-2">
            {result.sections.map((s, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {s.theme}
                </p>
                <p className="text-sm leading-relaxed">{s.synthesis}</p>
              </div>
            ))}

            {uniqueSources.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  Sources cited
                </p>
                {uniqueSources.map((c, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="shrink-0 mt-px">{c.url ? "🔗" : "📚"}</span>
                    <span>
                      {c.url
                        ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">{c.title}</a>
                        : <span className="font-medium">{c.title}</span>
                      }
                      {c.author ? <span className="text-muted-foreground/70"> — {c.author}</span> : ""}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Digest history ───────────────────────────────────────────────────────────

function DigestHistory({ refreshKey }: { refreshKey: number }) {
  const listFn = useServerFn(listDigestRuns);
  const getRunFn = useServerFn(getDigestRun);

  const [runs, setRuns] = useState<DigestRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [themes, setThemes] = useState<Record<string, DigestThemeRow[]>>({});
  const [loadingThemes, setLoadingThemes] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listFn({})
      .then(setRuns)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const handleExpand = async (runId: string) => {
    if (expandedId === runId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(runId);
    if (!themes[runId]) {
      setLoadingThemes(runId);
      try {
        const t = await getRunFn({ data: { digestRunId: runId } });
        setThemes((prev) => ({ ...prev, [runId]: t }));
      } catch {}
      setLoadingThemes(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading history…</span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
        <BookOpen className="h-6 w-6 text-muted-foreground/30" />
        <p className="text-[11px] text-muted-foreground">No digests yet. Run a test to generate your first one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const runThemes = themes[run.id];

        return (
          <div key={run.id} className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => handleExpand(run.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40 active:bg-accent/60 transition-all cursor-pointer select-none"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">
                  {new Date(run.runDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {run.themesFound} themes · {run.citationsFound} citations
                </p>
              </div>
              <div className="shrink-0">
                {run.emailSent ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border px-3 py-3 space-y-3">
                {loadingThemes === run.id ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Loading…</span>
                  </div>
                ) : runThemes && runThemes.length > 0 ? (
                  runThemes.map((t) => (
                    <div key={t.id} className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t.themeType.replace("_", " ")} · {t.themeText}
                      </p>
                      {t.synthesis && (
                        <p className="text-[11px] leading-relaxed text-foreground/80">{t.synthesis}</p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-muted-foreground">No themes stored for this run.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

function DigestPage() {
  const [historyKey, setHistoryKey] = useState(0);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-5">
        <h1 className="text-xs font-medium">Daily Digest</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5 space-y-8 max-w-xl">

        {/* Settings */}
        <section className="space-y-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Settings
          </h2>
          <DigestSettings />
        </section>

        {/* Test run */}
        <section className="space-y-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Preview
          </h2>
          <TestRunPanel onRanTest={() => setHistoryKey((k) => k + 1)} />
        </section>

        {/* History */}
        <section className="space-y-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            History
          </h2>
          <DigestHistory refreshKey={historyKey} />
        </section>

      </div>
    </div>
  );
}
