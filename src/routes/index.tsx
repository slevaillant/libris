import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate({ to: session ? "/library" : "/login" });
  }, [session, loading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  );
}
