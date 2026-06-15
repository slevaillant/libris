import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { BookOpen, CheckCircle, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { redeemInviteToken, setIndexerPaymentLink } from "@/lib/bounty.functions";

export const Route = createFileRoute("/join/$token")({
  component: JoinPage,
});

type Stage = "loading" | "form" | "email-sent" | "redeeming" | "payment-link" | "done" | "error";

function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const redeemFn = useServerFn(redeemInviteToken);

  const setPaymentLinkFn = useServerFn(setIndexerPaymentLink);

  const [stage, setStage] = useState<Stage>("loading");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setStage("redeeming");
        redeemFn({ data: { token } })
          .then(() => setStage("payment-link"))
          .catch((e) => {
            setErrorMsg(e instanceof Error ? e.message : "Invalid invite link");
            setStage("error");
          });
      } else {
        setStage("form");
      }
    });
  }, [token]);

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      setStage("email-sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send link");
    } finally {
      setBusy(false);
    }
  };

  const savePaymentLink = async (skip = false) => {
    setBusy(true);
    try {
      if (!skip && paymentLink.trim()) {
        await setPaymentLinkFn({ data: { paymentLink: paymentLink.trim() } });
      }
    } catch {
      // non-fatal — they can update it later
    } finally {
      setBusy(false);
      setStage("done");
      setTimeout(() => navigate({ to: "/index-books" }), 1200);
    }
  };

  if (stage === "loading" || stage === "redeeming") {
    return (
      <Shell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        {stage === "redeeming" && <p className="text-sm text-muted-foreground">Joining library…</p>}
      </Shell>
    );
  }

  if (stage === "payment-link") {
    return (
      <Shell>
        <CheckCircle className="h-10 w-10 text-green-500" />
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold">You're in!</p>
          <p className="text-xs text-muted-foreground">
            Add your payment link so the owner can pay you directly. You can skip this for now.
          </p>
        </div>
        <div className="w-full max-w-xs space-y-1.5">
          <Label className="text-xs">Your payment link</Label>
          <Input
            type="url"
            value={paymentLink}
            onChange={(e) => setPaymentLink(e.target.value)}
            placeholder="https://revolut.me/yourname"
            className="text-xs"
            autoFocus
          />
          <p className="text-[9px] text-muted-foreground">Revolut, PayPal.me, Lydia…</p>
        </div>
        <div className="flex gap-2 w-full max-w-xs">
          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => savePaymentLink(true)} disabled={busy}>
            Skip
          </Button>
          <Button size="sm" className="flex-1 text-xs gap-1" onClick={() => savePaymentLink(false)} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save & continue
          </Button>
        </div>
      </Shell>
    );
  }

  if (stage === "done") {
    return (
      <Shell>
        <CheckCircle className="h-10 w-10 text-green-500" />
        <div className="text-center">
          <p className="text-sm font-semibold">You're in!</p>
          <p className="text-xs text-muted-foreground mt-1">Taking you to the indexing page…</p>
        </div>
      </Shell>
    );
  }

  if (stage === "error") {
    return (
      <Shell>
        <BookOpen className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-semibold">Invite error</p>
        <p className="text-xs text-muted-foreground text-center max-w-xs">{errorMsg}</p>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate({ to: "/" })}>
          Go home
        </Button>
      </Shell>
    );
  }

  if (stage === "email-sent") {
    return (
      <Shell>
        <Mail className="h-10 w-10 text-primary" />
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold">Check your email</p>
          <p className="text-xs text-muted-foreground">
            We sent a magic link to <strong>{email}</strong>.
            <br />Click it to join the library — no password needed.
          </p>
        </div>
        <button onClick={() => setStage("form")} className="text-xs text-muted-foreground underline underline-offset-2">
          Use a different email
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <BookOpen className="h-10 w-10 text-muted-foreground" />
      <div className="text-center space-y-1">
        <h1 className="text-sm font-semibold">You've been invited to index a library</h1>
        <p className="text-xs text-muted-foreground">
          Enter your email — we'll send you a one-click link. No password needed.
        </p>
      </div>
      <form onSubmit={sendMagicLink} className="w-full max-w-xs space-y-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          autoFocus
        />
        <Button type="submit" disabled={busy} className="w-full gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {busy ? "Sending…" : "Send magic link"}
        </Button>
      </form>
      <p className="text-[10px] text-muted-foreground">
        Already have an account?{" "}
        <a href="/login" className="underline underline-offset-2">Sign in here</a>.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-5 text-center max-w-sm w-full">
        {children}
      </div>
    </div>
  );
}
