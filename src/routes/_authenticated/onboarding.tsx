import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { updateProfile } from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BookOpen, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

const TIMEZONES = [
  "Europe/Paris", "Europe/London", "America/New_York",
  "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney",
];

function detectedTimezone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return TIMEZONES.includes(tz) ? tz : "Europe/Paris";
}

function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const saveFn = useServerFn(updateProfile);

  const defaultName = user?.email?.split("@")[0] ?? "";

  const [displayName, setDisplayName]               = useState(defaultName);
  const [librarianName, setLibrarianName]           = useState("Lumen");
  const [professionalContext, setProfessionalContext] = useState("");
  const [timezone, setTimezone]                     = useState(detectedTimezone);
  const [digestEnabled, setDigestEnabled]           = useState(true);
  const [saving, setSaving]                         = useState(false);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!displayName.trim()) { toast.error("Your name is required"); return; }
    setSaving(true);
    try {
      await saveFn({
        data: {
          displayName: displayName.trim(),
          librarianName: librarianName.trim() || "Lumen",
          professionalContext: professionalContext.trim() || null,
          timezone,
          digestEnabled,
          digestEmail: user?.email ?? null,
          onboardingCompleted: true,
        },
      });
      navigate({ to: "/library" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center p-6 pt-16 bg-background">
      <div className="w-full max-w-sm space-y-8">

        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-border">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h1 className="text-sm font-semibold">Set up your library</h1>
            <p className="text-xs text-muted-foreground">
              Quick setup — you can change everything later.
            </p>
          </div>
        </div>

        <form onSubmit={save} className="space-y-4">

          <div className="space-y-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Seb"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-muted-foreground" />
              <Label htmlFor="lumen">Your librarian's name</Label>
            </div>
            <Input
              id="lumen"
              value={librarianName}
              onChange={(e) => setLibrarianName(e.target.value)}
              placeholder="Lumen"
            />
            <p className="text-[10px] text-muted-foreground">
              Your AI agent — answers questions using only what's in your library.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="context">
              Interests{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="context"
              value={professionalContext}
              onChange={(e) => setProfessionalContext(e.target.value)}
              placeholder="AI, product management, trading…"
            />
          </div>

          {/* Morning digest */}
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-xs font-medium">Morning digest</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Daily 6am email linking yesterday's meetings to your library.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={digestEnabled}
                onClick={() => setDigestEnabled(!digestEnabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  digestEnabled ? "bg-green-500" : "bg-zinc-600"
                }`}
              >
                <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out ${
                  digestEnabled ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
            </div>

            {digestEnabled && (
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            )}
          </div>

          <Button type="submit" size="lg" className="w-full mt-2" disabled={saving}>
            {saving ? "Setting up…" : "Enter your library"}
          </Button>
        </form>
      </div>
    </div>
  );
}
