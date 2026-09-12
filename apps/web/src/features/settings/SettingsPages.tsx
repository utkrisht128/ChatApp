import { useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, AtSign, Ban, Bell, ChevronRight, KeyRound, Lock, LogOut, MessageSquareText, Monitor, Moon, Palette, Sun, UserRound } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { Navigate, NavLink, Outlet, useMatch, useNavigate } from "react-router";
import { toast } from "sonner";
import { passwordSchema, updateProfileSchema, type Visibility } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { RadioRows, SettingsGroup, SwitchRow } from "@/components/ui/Switch";
import { PasswordField, TextAreaField, TextField } from "@/components/ui/TextField";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useChangePassword, useCurrentUser, useLogout, useLogoutEverywhere, useResendVerification } from "@/features/auth/api";
import { useBlocked, useSetBlocked } from "@/features/moderation/api";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fromServer, validate, type FieldErrors } from "@/lib/forms";
import { SplitView } from "@/layouts/SplitView";
import { useThemeStore, type ThemePreference } from "@/stores/theme";
import { AvatarPicker } from "@/components/AvatarPicker";
import { useSetAvatar, useUpdateProfile, useUpdateSettings } from "./api";

type Section = { to: string; label: string; description: string; icon: ComponentType<{ className?: string }> };

const SECTIONS: Section[] = [
  { to: "profile", label: "Profile", description: "Name, username and bio", icon: UserRound },
  { to: "account", label: "Account", description: "Email, password and sessions", icon: KeyRound },
  { to: "privacy", label: "Privacy", description: "Last seen, online status, read receipts", icon: Lock },
  { to: "blocked", label: "Blocked", description: "People you've blocked", icon: Ban },
  { to: "notifications", label: "Notifications", description: "Messages, groups and sounds", icon: Bell },
  { to: "appearance", label: "Appearance", description: "Light, dark or system theme", icon: Palette },
  { to: "chats", label: "Chats", description: "Keyboard and sending", icon: MessageSquareText },
];

/* ── Layout ─────────────────────────────────────────────────────────────── */

export function SettingsSection() {
  const inSection = useMatch("/settings/:section");
  return (
    <SplitView list={<SettingsNav />} showDetail={Boolean(inSection)}>
      <Outlet />
    </SplitView>
  );
}

/** Desktop opens the first section; phones show the section list. */
export function SettingsIndex() {
  return useIsDesktop() ? <Navigate to="profile" replace /> : null;
}

function SettingsNav() {
  const me = useCurrentUser();
  const logout = useLogout();
  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col overflow-y-auto pt-safe">
      <h1 className="flex h-14 shrink-0 items-center px-4 text-2xl font-bold tracking-tight">Settings</h1>
      <NavLink to="profile" className="mx-2 mb-3 flex items-center gap-3 rounded-2xl p-3 hover:bg-surface-2">
        <Avatar name={me.displayName} src={me.avatarUrl} seed={me.id} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{me.displayName}</span>
          <span className="block truncate text-sm text-muted">@{me.username}</span>
        </span>
      </NavLink>
      <nav aria-label="Settings sections" className="flex flex-col px-2">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={({ isActive }) => cn("flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors", isActive ? "bg-surface-3" : "hover:bg-surface-2")}
          >
            <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-accent">
              <s.icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{s.label}</span>
              <span className="block truncate text-xs text-muted">{s.description}</span>
            </span>
            <ChevronRight className="size-4 text-subtle md:hidden" />
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-4">
        <Button variant="danger-ghost" className="w-full justify-start" loading={logout.isPending} onClick={() => logout.mutate()}>
          <LogOut className="size-4" /> Log out
        </Button>
      </div>
    </div>
  );
}

function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg max-md:animate-slide-in-right">
      <header className="shrink-0 border-b border-border bg-surface pt-safe">
        <div className="flex h-14 items-center gap-1 px-2 md:px-6">
          <IconButton label="Back to settings" className="md:hidden" onClick={() => navigate("/settings")}>
            <ArrowLeft />
          </IconButton>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-7 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6">{children}</div>
      </div>
    </div>
  );
}

/* ── Profile ────────────────────────────────────────────────────────────── */

export function ProfileSettings() {
  const me = useCurrentUser();
  const update = useUpdateProfile();
  const setAvatar = useSetAvatar();
  const initial = { displayName: me.displayName, username: me.username, bio: me.bio };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => values[k] !== initial[k]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k as keyof typeof initial]));
    const { data, errors } = validate(updateProfileSchema, changed);
    setErrors(errors);
    if (!data) return;
    update.mutate(data, {
      onSuccess: (user) => {
        setValues({ displayName: user.displayName, username: user.username, bio: user.bio });
        toast.success("Profile updated");
      },
      onError: (err) => {
        const { fields, message } = fromServer(err);
        setErrors(fields);
        if (message) toast.error(message);
      },
    });
  };

  return (
    <SettingsPage title="Profile">
      <div className="flex flex-col items-center gap-3 text-center">
        <AvatarPicker name={values.displayName || me.displayName} src={me.avatarUrl} seed={me.id} apply={(fileId) => setAvatar.mutateAsync(fileId)} />
        <div>
          <p className="text-lg font-semibold">{me.displayName}</p>
          <p className="text-sm text-muted">@{me.username}</p>
        </div>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 md:p-5">
        <TextField label="Name" value={values.displayName} maxLength={48} onChange={(e) => setValues((v) => ({ ...v, displayName: e.target.value }))} error={errors.displayName} />
        <TextField
          label="Username"
          leading={<AtSign />}
          autoCapitalize="none"
          spellCheck={false}
          value={values.username}
          onChange={(e) => setValues((v) => ({ ...v, username: e.target.value }))}
          error={errors.username}
          hint="People can find you by this name."
        />
        <TextAreaField
          label="Bio"
          value={values.bio}
          maxLength={160}
          onChange={(e) => setValues((v) => ({ ...v, bio: e.target.value }))}
          error={errors.bio}
          hint={`${values.bio.length}/160`}
        />
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => (setValues(initial), setErrors({}))}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!dirty} loading={update.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </SettingsPage>
  );
}

/* ── Account ────────────────────────────────────────────────────────────── */

function ChangePasswordForm() {
  const change = useChangePassword();
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors>({});

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!values.currentPassword) next.currentPassword = "Enter your current password";
    const parsed = passwordSchema.safeParse(values.newPassword);
    if (!parsed.success) next.newPassword = parsed.error.issues[0]?.message ?? "Invalid password";
    if (values.newPassword !== values.confirm) next.confirm = "Passwords don't match";
    setErrors(next);
    if (Object.keys(next).length) return;
    change.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          setValues({ currentPassword: "", newPassword: "", confirm: "" });
          toast.success("Password changed", { description: "Your other devices have been signed out." });
        },
        onError: (err) => {
          const { fields, message } = fromServer(err);
          setErrors(fields);
          if (message) toast.error(message);
        },
      },
    );
  };

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 p-4 md:p-5">
      <PasswordField label="Current password" autoComplete="current-password" value={values.currentPassword} onChange={set("currentPassword")} error={errors.currentPassword} />
      <PasswordField label="New password" autoComplete="new-password" value={values.newPassword} onChange={set("newPassword")} error={errors.newPassword} hint="At least 8 characters." />
      <PasswordField label="Confirm new password" autoComplete="new-password" value={values.confirm} onChange={set("confirm")} error={errors.confirm} />
      <div className="flex justify-end">
        <Button type="submit" loading={change.isPending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function AccountSettings() {
  const me = useCurrentUser();
  const resend = useResendVerification();
  const logout = useLogout();
  const logoutAll = useLogoutEverywhere();
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <SettingsPage title="Account">
      <SettingsGroup title="Email">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium">{me.email}</p>
            <p className={cn("text-sm", me.emailVerified ? "text-success" : "text-warning")}>{me.emailVerified ? "Verified" : "Not verified"}</p>
          </div>
          {!me.emailVerified && (
            <Button
              variant="secondary"
              size="sm"
              loading={resend.isPending}
              onClick={() =>
                resend.mutate(undefined, {
                  onSuccess: () => toast.success("Verification email sent"),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Resend verification
            </Button>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Password">
        <ChangePasswordForm />
      </SettingsGroup>

      <SettingsGroup title="Sessions" footer="Signing out everywhere ends every session, including this one.">
        <button onClick={() => logout.mutate()} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-medium hover:bg-surface-2">
          <LogOut className="size-4 text-muted" /> Log out of this device
        </button>
        <button onClick={() => setConfirmAll(true)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-medium text-danger hover:bg-danger-soft">
          <LogOut className="size-4" /> Log out everywhere
        </button>
      </SettingsGroup>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Log out everywhere?"
        description="You'll be signed out on every device, including this one."
        confirmLabel="Log out everywhere"
        loading={logoutAll.isPending}
        onConfirm={() => logoutAll.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}
      />
    </SettingsPage>
  );
}

/* ── Privacy ────────────────────────────────────────────────────────────── */

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "contacts", label: "People I've chatted with" },
  { value: "nobody", label: "Nobody" },
];

export function PrivacySettings() {
  const { settings } = useCurrentUser();
  const update = useUpdateSettings();
  return (
    <SettingsPage title="Privacy">
      <SettingsGroup title="Last seen" footer="Who can see when you were last active.">
        <RadioRows label="Last seen" value={settings.lastSeenVisibility} onValueChange={(v) => update.mutate({ lastSeenVisibility: v })} options={VISIBILITY_OPTIONS} />
      </SettingsGroup>
      <SettingsGroup title="Online status" footer="Who can see when you're online right now.">
        <RadioRows label="Online status" value={settings.onlineVisibility} onValueChange={(v) => update.mutate({ onlineVisibility: v })} options={VISIBILITY_OPTIONS} />
      </SettingsGroup>
      <SettingsGroup footer="If you turn off read receipts, you won't see other people's either.">
        <SwitchRow label="Read receipts" description="Let people know when you've read their messages." checked={settings.readReceipts} onCheckedChange={(v) => update.mutate({ readReceipts: v })} />
      </SettingsGroup>
    </SettingsPage>
  );
}

/* ── Blocked ────────────────────────────────────────────────────────────── */

export function BlockedSettings() {
  const blocked = useBlocked();
  const setBlocked = useSetBlocked();
  const users = blocked.data ?? [];

  return (
    <SettingsPage title="Blocked">
      {blocked.isPending ? (
        <div role="status" aria-label="Loading blocked people" className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-3.5 w-32" />
            </div>
          ))}
        </div>
      ) : blocked.isError ? (
        <ErrorState title="Couldn't load your blocked list" error={blocked.error} onRetry={() => blocked.refetch()} />
      ) : users.length === 0 ? (
        <EmptyState
          icon={Ban}
          title="You haven't blocked anyone"
          description="Blocking someone stops them messaging you or seeing when you're online. You can block someone from their chat."
        />
      ) : (
        <SettingsGroup title={`${users.length} blocked`} footer="Blocked people can't message you, start a chat with you, or see when you're online.">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={u.displayName} src={u.avatarUrl} seed={u.id} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{u.displayName}</p>
                <p className="truncate text-sm text-muted">@{u.username}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={setBlocked.isPending}
                onClick={() => setBlocked.mutate({ userId: u.id, blocked: false, name: u.displayName })}
              >
                Unblock
              </Button>
            </div>
          ))}
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}

/* ── Notifications ──────────────────────────────────────────────────────── */

export function NotificationSettings() {
  const { settings } = useCurrentUser();
  const n = settings.notifications;
  const update = useUpdateSettings();
  return (
    <SettingsPage title="Notifications">
      <SettingsGroup title="Notify me about">
        <SwitchRow label="Direct messages" checked={n.messages} onCheckedChange={(v) => update.mutate({ notifications: { messages: v } })} />
        <SwitchRow label="Group messages" checked={n.groups} onCheckedChange={(v) => update.mutate({ notifications: { groups: v } })} />
        <SwitchRow label="Mentions" description="Even in muted groups." checked={n.mentions} onCheckedChange={(v) => update.mutate({ notifications: { mentions: v } })} />
      </SettingsGroup>
      <SettingsGroup>
        <SwitchRow label="Show message preview" description="Include message text in notifications." checked={n.showPreview} onCheckedChange={(v) => update.mutate({ notifications: { showPreview: v } })} />
        <SwitchRow label="Sounds" description="Play a sound for new messages while the app is open." checked={settings.sounds} onCheckedChange={(v) => update.mutate({ sounds: v })} />
      </SettingsGroup>
    </SettingsPage>
  );
}

/* ── Appearance ─────────────────────────────────────────────────────────── */

const THEMES: { value: ThemePreference; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function ThemePreview({ mode }: { mode: "light" | "dark" }) {
  const c = mode === "light" ? { bg: "#eceff4", in: "#ffffff", out: "#4f5bd5", bar: "#ffffff" } : { bg: "#0d1016", in: "#1b202a", out: "#3d48c0", bar: "#11141b" };
  return (
    <div className="flex h-full flex-col" style={{ background: c.bg }}>
      <div className="h-3 shrink-0" style={{ background: c.bar }} />
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-2.5">
        <span className="h-2.5 w-3/5 rounded-full" style={{ background: c.in }} />
        <span className="h-2.5 w-2/5 self-end rounded-full" style={{ background: c.out }} />
        <span className="h-2.5 w-1/2 rounded-full" style={{ background: c.in }} />
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const update = useUpdateSettings();
  return (
    <SettingsPage title="Appearance">
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">Theme</h2>
        <RadioGroup.Root
          aria-label="Theme"
          value={preference}
          onValueChange={(v) => {
            setPreference(v as ThemePreference);
            update.mutate({ theme: v as ThemePreference });
          }}
          className="grid grid-cols-3 gap-3"
        >
          {THEMES.map((t) => (
            <RadioGroup.Item
              key={t.value}
              value={t.value}
              className="group flex flex-col gap-2 rounded-2xl border-2 border-border bg-surface p-2 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-3 focus-visible:ring-primary/30 data-[state=checked]:border-primary"
            >
              <div className="aspect-[4/3] overflow-hidden rounded-xl border border-border">
                {t.value === "system" ? (
                  <div className="grid h-full grid-cols-2">
                    <ThemePreview mode="light" />
                    <ThemePreview mode="dark" />
                  </div>
                ) : (
                  <ThemePreview mode={t.value} />
                )}
              </div>
              <span className="flex items-center gap-1.5 px-1 pb-0.5 text-sm font-medium">
                <t.icon className="size-4 text-muted group-data-[state=checked]:text-accent" /> {t.label}
              </span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <p className="px-1 text-xs text-muted">System follows your device's light/dark setting. Your choice syncs across devices.</p>
      </section>
    </SettingsPage>
  );
}

/* ── Chats ──────────────────────────────────────────────────────────────── */

export function ChatSettings() {
  const { settings } = useCurrentUser();
  const update = useUpdateSettings();
  return (
    <SettingsPage title="Chats">
      <SettingsGroup footer="On touch devices, Enter always starts a new line — use the send button.">
        <SwitchRow
          label="Enter to send"
          description="Press Enter to send and Shift+Enter for a new line."
          checked={settings.enterToSend}
          onCheckedChange={(v) => update.mutate({ enterToSend: v })}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
