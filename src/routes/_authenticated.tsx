import { createFileRoute, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { getProfile, type UserProfile } from "@/lib/profile.functions";
import { AppSidebar } from "@/components/AppSidebar";
import { rememberAfterLogin, takeAfterLogin } from "@/lib/after-login";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const NO_SIDEBAR_ROUTES = ["/onboarding"];

function AuthenticatedLayout() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const href = useRouterState({ select: (s) => s.location.href });
  const fetchProfile = useServerFn(getProfile);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      rememberAfterLogin(href);
      navigate({ to: "/login" });
      return;
    }

    fetchProfile({})
      .then((p) => {
        setProfile(p);
        if (p && !p.onboardingCompleted && !path.startsWith("/onboarding")) {
          navigate({ to: "/onboarding" });
          return;
        }
        // Back to the page asked for before signing in (e.g. the quiz link in the digest)
        const next = takeAfterLogin(window.location.search);
        if (next && next !== href) router.history.push(next);
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
