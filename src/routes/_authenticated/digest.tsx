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
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getProfile, updateProfile } from "@/lib/profile.functions";
import {
  triggerTestDigest,
  listDigestRuns,
  getDigestRun,
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

  useEffect(() => {
    getProfileFn({})
      .then((p) => {
        if (!p) return;
        setEnabled(p.digestEnabled);
        setEmail(p.digestEmail ?? "");
        setTime(p.digestTime ?? "06:00");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      <div className="flex items-center justify-between rounded-lg border border-border p-3.5">
        <div>
          <p className="text-xs font-medium">Daily digest</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Morning email connecting your meetings to your library
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors cursor-pointer select-none",
            enabled ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-4" : "translate-x-0.5",
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

      <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2.5">
        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
          <strong>Granola integration pending.</strong> The digest will automatically pull themes from yesterday's meetings once Granola is connected. Until then, use the test run below to preview the format.
        </p>
      </div>
    </div>
  );
}

// ─── Test run panel ───────────────────────────────────────────────────────────

function TestRunPanel({ onRanTest }: { onRanTest: () => void }) {
  const triggerFn = useServerFn(triggerTestDigest);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    sectionsCount: number;
    citationCount: number;
    sections: { theme: string; synthesis: string; citations: { title: string; author: string | null; chapterTitle: string | null }[] }[];
  } | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await triggerFn({});
      setResult(res);
      onRanTest();
      toast.success(`Test digest complete — ${res.sectionsCount} sections, ${res.citationCount} citations`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test digest failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">Test run</p>
          <p className="text-[10px] text-muted-foreground">
            Runs the digest pipeline with predefined themes — no Granola needed.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleRun} disabled={running}>
          {running ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
          ) : (
            <><Play className="h-3 w-3" /> Run test</>
          )}
        </Button>
      </div>

      {result && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-3">
          <p className="text-[10px] text-muted-foreground">
            {result.sectionsCount} sections · {result.citationCount} citations
          </p>
          {result.sections.map((s, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {s.theme}
              </p>
              <p className="text-[11px] leading-relaxed">{s.synthesis}</p>
              {s.citations.length > 0 && (
                <div className="space-y-0.5">
                  {s.citations.map((c, j) => (
                    <p key={j} className="text-[10px] text-muted-foreground">
                      📚 {c.title}{c.chapterTitle ? ` — ${c.chapterTitle}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
