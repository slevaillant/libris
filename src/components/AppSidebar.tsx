import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, MessageCircle, Mail, Users, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/lib/profile.functions";

type Props = { profile: UserProfile | null };

const NAV = [
  { to: "/library", label: "Library", icon: BookOpen, enabled: true },
  { to: "/chat",    label: "Chat",    icon: MessageCircle, enabled: true },
  { to: "/digest",  label: "Digest",  icon: Mail,        enabled: true },
  { to: "/bounty",  label: "Bounty",  icon: Users,       enabled: true },
  { to: "/settings", label: "Settings", icon: Settings, enabled: false },
] as const;

export function AppSidebar({ profile }: Props) {
  const { signOut, user } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="flex h-screen w-48 shrink-0 flex-col border-r border-border bg-card sticky top-0">
      {/* Logo */}
      <div className="flex h-12 items-center px-4 border-b border-border">
        <span className="text-xs font-semibold tracking-wide">Libris</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-2 pt-3">
        {NAV.map(({ to, label, icon: Icon, enabled }) =>
          enabled ? (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-xs transition-colors",
                path.startsWith(to)
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </Link>
          ) : (
            <div
              key={to}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground/40 cursor-not-allowed"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </div>
          ),
        )}
      </nav>

      {/* User */}
      <div className="border-t border-border p-3 space-y-1">
        <p className="text-[10px] text-muted-foreground truncate px-1">
          {profile?.displayName || user?.email}
        </p>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <LogOut className="h-3 w-3" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
