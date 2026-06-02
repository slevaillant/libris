import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { updateProfile } from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

const TIMEZONES = [
  "Europe/Paris", "Europe/London", "America/New_York",
  "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney",
];

function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const saveFn = useServerFn(updateProfile);

  const defaultName = user?.email?.split("@")[0] ?? "";

  const [displayName, setDisplayName]               = useState(defaultName);
  const [librarianName, setLibrarianName]           = useState("Lumen");
  const [professionalContext, setProfessionalContext] = useState("");
  const [timezone, setTimezone]                     = useState("Europe/Paris");
  const [digestEnabled, setDigestEnabled]           = useState(true);
  const [saving, setSaving]                         = useState(false);

  const save = async (e: React.FormEvent) => {
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
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm space-y-8">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-border">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
          <h1 className="text-sm font-semibold">Welcome to Libris</h1>
          <p className="text-xs text-muted-foreground">
            Let's set up your personal knowledge system.
          </p>
        </div>

        <form onSubmit={save} className="space-y-5">

          {/* Name */}
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

          {/* Librarian name */}
          <div className="space-y-1.5">
            <Label htmlFor="lumen">Your librarian's name</Label>
            <Input
              id="lumen"
              value={librarianName}
              onChange={(e) => setLibrarianName(e.target.value)}
              placeholder="Lumen"
            />
            <p className="text-[10px] text-muted-foreground">
              This is the name of your AI librarian. Default is Lumen.
            </p>
          </div>

          {/* Professional context */}
          <div className="space-y-1.5">
            <Label htmlFor="context">What do you work on? <span className="text-muted-foreground/60">(optional)</span></Label>
            <Input
              id="context"
              value={professionalContext}
              onChange={(e) => setProfessionalContext(e.target.value)}
              placeholder="Building AI products, interested in trading…"
            />
            <p className="text-[10px] text-muted-foreground">
              Helps {librarianName || "Lumen"} give you more relevant answers.
            </p>
          </div>

          {/* Timezone */}
          <div className="space-y-1.5">
            <Label htmlFor="tz">Timezone</Label>
            <select
              id="tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              Used to send your morning digest at the right time.
            </p>
          </div>

          {/* Daily digest toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-xs font-medium">Daily digest</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Morning email connecting your meetings to your library.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDigestEnabled(!digestEnabled)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                digestEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                digestEnabled ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={saving}>
            {saving ? "Setting up…" : "Enter your library"}
          </Button>
        </form>
      </div>
    </div>
  );
}
