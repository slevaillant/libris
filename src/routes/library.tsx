import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/library")({
  component: Library,
});

function Library() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [session, loading, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <span className="text-xs font-semibold">Libris</span>
        <button
          onClick={signOut}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">Your library is empty</p>
          <p className="text-xs text-muted-foreground">
            Phase 0 complete — scaffold is running.
          </p>
        </div>
      </main>
    </div>
  );
}
