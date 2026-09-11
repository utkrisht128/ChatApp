import { useEffect, useState, type ComponentType } from "react";
import { MailWarning, MessageCircle, Settings, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useMatch } from "react-router";
import { toast } from "sonner";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { LogoMark } from "@/components/Logo";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Tip } from "@/components/ui/Tooltip";
import { useCurrentUser, useResendVerification } from "@/features/auth/api";
import { useTotalUnread } from "@/features/chats/api";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useThemeStore } from "@/stores/theme";

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; active: (path: string) => boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Chats", icon: MessageCircle, active: (p) => p === "/" || p.startsWith("/c/") },
  { to: "/settings", label: "Settings", icon: Settings, active: (p) => p.startsWith("/settings") },
];

const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

/** Desktop/tablet: vertical rail. */
function NavRail({ unread }: { unread: number }) {
  const me = useCurrentUser();
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className="hidden w-[72px] shrink-0 flex-col items-center gap-2 border-r border-border bg-surface py-3 md:flex">
      <LogoMark className="mb-3 size-9" />
      {NAV.map((item) => {
        const active = item.active(pathname);
        const count = item.to === "/" ? unread : 0;
        return (
          <Tip key={item.to} label={item.label}>
            <NavLink
              to={item.to}
              aria-label={count ? `${item.label}, ${count} unread` : item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative grid size-11 place-items-center rounded-2xl transition-colors",
                active ? "bg-primary-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <item.icon className="size-[22px]" />
              {count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-fg ring-2 ring-surface">
                  {badgeText(count)}
                </span>
              )}
            </NavLink>
          </Tip>
        );
      })}
      <div className="flex-1" />
      <Tip label="Your profile">
        <Link to="/settings/profile" aria-label="Your profile" className="rounded-full">
          <Avatar name={me.displayName} src={me.avatarUrl} seed={me.id} size="md" />
        </Link>
      </Tip>
    </nav>
  );
}

/** Phones: bottom tabs, hidden inside a conversation or settings section. */
function BottomTabs({ unread }: { unread: number }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className="flex shrink-0 border-t border-border bg-surface pb-safe md:hidden">
      {NAV.map((item) => {
        const active = item.active(pathname);
        const count = item.to === "/" ? unread : 0;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn("relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-accent" : "text-muted")}
          >
            <span className="relative">
              <item.icon className="size-6" />
              {count > 0 && (
                <span className="absolute -top-1 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-fg">
                  {badgeText(count)}
                </span>
              )}
            </span>
            {item.label}
            {count > 0 && <span className="sr-only">, {count} unread</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

const DISMISS_KEY = "chatapp-verify-dismissed";

function VerifyEmailBanner() {
  const me = useCurrentUser();
  const resend = useResendVerification();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (me.emailVerified || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage unavailable — dismissal lasts for this render tree only */
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-1.5 text-sm">
      <MailWarning className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 truncate">Verify your email to secure your account.</p>
      <Button
        size="sm"
        variant="ghost"
        className="text-accent"
        loading={resend.isPending}
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: () => toast.success("Verification email sent", { description: me.email }),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      >
        Resend email
      </Button>
      <IconButton label="Dismiss" size="sm" onClick={dismiss}>
        <X />
      </IconButton>
    </div>
  );
}

export function AppShell() {
  const me = useCurrentUser();
  const inChat = useMatch("/c/:chatId");
  const inSettingsSection = useMatch("/settings/:section");
  const unread = useTotalUnread();

  // The server copy of the theme wins when it changes (e.g. set on another device).
  const setPreference = useThemeStore((s) => s.setPreference);
  useEffect(() => setPreference(me.settings.theme), [me.settings.theme, setPreference]);

  useEffect(() => {
    document.title = unread ? `(${badgeText(unread)}) ChatApp` : "ChatApp";
  }, [unread]);

  return (
    <div className="h-app flex overflow-hidden bg-bg">
      <NavRail unread={unread} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <VerifyEmailBanner />
        <div className="flex min-h-0 flex-1">
          <Outlet />
        </div>
        {!inChat && !inSettingsSection && <BottomTabs unread={unread} />}
      </div>
    </div>
  );
}
