import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { getProfile, type UserProfile } from "@/lib/profile.functions";
import { AppSidebar } from "@/components/AppSidebar";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const NO_SIDEBAR_ROUTES = ["/onboarding"];

function AuthenticatedLayout() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const fetchProfile = useServerFn(getProfile);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!session) { navigate({ to: "/login" }); return; }

    fetchProfile({})
      .then((p) => {
        setProfile(p);
        if (p && !p.onboardingCompleted && !path.startsWith("/onboarding")) {
          navigate({ to: "/onboarding" });
        }
      })
      .catch(console.error)
      .finally(() => setProfileLoading(false));
  }, [session, authLoading]);

  if (authLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  if (!session) return null;

  if (NO_SIDEBAR_ROUTES.some((r) => path.startsWith(r))) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-background">
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar profile={profile} />
      <main className="flex flex-1 min-w-0 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
