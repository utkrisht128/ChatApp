import { useMemo, useState } from "react";
import { Ban, CheckCheck, Flag, MoreVertical, Search, ShieldCheck, ShieldOff, Trash2, UserRound } from "lucide-react";
import { Navigate } from "react-router";
import {
  ADMIN_USER_FILTERS,
  formatBytes,
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  type AdminReport,
  type AdminUser,
  type AdminUserFilter,
  type ReportStatus,
} from "@chat/shared";
import { ActionDropdown, type Action } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { TextField } from "@/components/ui/TextField";
import { useCurrentUser } from "@/features/auth/api";
import { useDebounced } from "@/features/search/api";
import { cn } from "@/lib/cn";
import { formatChatTime } from "@/lib/format";
import { useAdminReports, useAdminStats, useAdminUsers, useResolveReport, useSetBan, useSetUserRole } from "./api";

type Tab = "overview" | "users" | "reports";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "reports", label: "Reports" },
];

const FILTER_LABELS: Record<AdminUserFilter, string> = {
  all: "All",
  banned: "Banned",
  admins: "Admins",
  unverified: "Unverified",
};

function Pills<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string; }) {
  return (
    <div role="group" aria-label={label} className="flex gap-2 overflow-x-auto">
      {options.map((o) => (
        <button
          key={o}
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "h-8 shrink-0 rounded-full px-3.5 text-sm font-medium capitalize transition-colors",
            value === o ? "bg-primary-soft text-accent" : "bg-surface-2 text-muted hover:text-fg",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Overview ───────────────────────────────────────────────────────────── */

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Overview() {
  const stats = useAdminStats();
  if (stats.isPending) return <Rows count={4} />;
  if (stats.isError) return <ErrorState title="Couldn't load stats" error={stats.error} onRetry={() => stats.refetch()} />;
  const s = stats.data;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Stat label="Users" value={s.users.total} hint={`${s.users.newThisWeek} new this week`} />
      <Stat label="Admins" value={s.users.admins} />
      <Stat label="Banned" value={s.users.banned} />
      <Stat label="Messages" value={s.messages.total} hint={`${s.messages.today} today`} />
      <Stat label="Chats" value={s.chats.direct + s.chats.groups} hint={`${s.chats.groups} groups`} />
      <Stat label="Open reports" value={s.reports.open} hint={`${s.reports.total} all time`} />
      <Stat label="Storage used" value={formatBytes(s.storageBytes)} hint="Across all uploads" />
    </div>
  );
}

/* ── Users ──────────────────────────────────────────────────────────────── */

function UserRow({ user, meId }: { user: AdminUser; meId: string }) {
  const setBan = useSetBan();
  const setRole = useSetUserRole();
  const [confirmBan, setConfirmBan] = useState(false);
  const isMe = user.id === meId;
  const banned = Boolean(user.bannedAt);

  const actions: Action[] = [
    {
      id: "role",
      label: user.role === "admin" ? "Remove admin" : "Make admin",
      icon: user.role === "admin" ? ShieldOff : ShieldCheck,
      hidden: isMe,
      onSelect: () => setRole.mutate({ userId: user.id, role: user.role === "admin" ? "user" : "admin", name: user.displayName }),
    },
    {
      id: "ban",
      label: banned ? "Unban" : "Ban",
      icon: Ban,
      danger: !banned,
      hidden: isMe,
      onSelect: () => (banned ? setBan.mutate({ userId: user.id, banned: false, name: user.displayName }) : setConfirmBan(true)),
    },
  ];

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      <Avatar name={user.displayName} src={user.avatarUrl} seed={user.id} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[15px] font-medium">
          {user.displayName}
          {isMe && <span className="text-xs text-muted">(you)</span>}
          {user.role === "admin" && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Admin</span>}
          {banned && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">Banned</span>}
        </p>
        <p className="truncate text-sm text-muted">
          @{user.username} · {user.email}
          {!user.emailVerified && " · unverified"}
        </p>
        {banned && user.banReason && <p className="truncate text-xs text-danger">Reason: {user.banReason}</p>}
      </div>
      <span className="hidden shrink-0 text-xs text-subtle sm:block">{formatChatTime(user.createdAt)}</span>
      {!isMe && (
        <ActionDropdown actions={actions}>
          <IconButton label={`Options for ${user.displayName}`} size="sm">
            <MoreVertical />
          </IconButton>
        </ActionDropdown>
      )}
      <ConfirmDialog
        open={confirmBan}
        onOpenChange={setConfirmBan}
        title={`Ban ${user.displayName}?`}
        description="They'll be signed out everywhere immediately and won't be able to sign back in. Their messages stay unless you remove them."
        confirmLabel="Ban account"
        loading={setBan.isPending}
        onConfirm={() => setBan.mutate({ userId: user.id, banned: true, name: user.displayName }, { onSuccess: () => setConfirmBan(false) })}
      />
    </li>
  );
}

function Users({ meId }: { meId: string }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AdminUserFilter>("all");
  const q = useDebounced(search).trim();
  const query = useAdminUsers(q, filter);
  const users = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Search people"
        hideLabel
        type="search"
        placeholder="Search by name, username or email"
        leading={<Search />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        inputClassName="h-10 rounded-full border-transparent bg-surface-2 focus:bg-surface"
      />
      <Pills label="Filter users" options={ADMIN_USER_FILTERS} value={filter} onChange={setFilter} />

      {query.isPending ? (
        <Rows count={6} />
      ) : query.isError ? (
        <ErrorState title="Couldn't load users" error={query.error} onRetry={() => query.refetch()} />
      ) : users.length === 0 ? (
        <EmptyState icon={UserRound} title="No people found" description={q ? `Nothing matches “${q}”.` : `No ${FILTER_LABELS[filter].toLowerCase()} accounts.`} />
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <UserRow key={u.id} user={u} meId={meId} />
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}

/* ── Reports ────────────────────────────────────────────────────────────── */

const STATUS_STYLE: Record<ReportStatus, string> = {
  open: "bg-warning-soft text-warning",
  reviewed: "bg-surface-3 text-muted",
  actioned: "bg-danger-soft text-danger",
  dismissed: "bg-surface-3 text-muted",
};

function ReportCard({ report }: { report: AdminReport }) {
  const resolve = useResolveReport();
  const isMessage = report.subject === "message";
  const busy = resolve.isPending;

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Avatar name={report.targetUser?.displayName ?? "?"} src={report.targetUser?.avatarUrl ?? null} seed={report.targetId} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">
            {isMessage ? "Message from " : ""}
            {report.targetUser?.displayName ?? "Deleted account"}
          </p>
          <p className="truncate text-sm text-muted">
            {REPORT_REASON_LABELS[report.reason]} · reported by {report.reporter?.displayName ?? "someone"} · {formatChatTime(report.createdAt)}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_STYLE[report.status])}>
          {report.status}
        </span>
      </div>

      {report.snapshot && (
        <blockquote className="rounded-xl border-l-[3px] border-border-strong bg-surface-2 px-3 py-2 text-sm break-words whitespace-pre-wrap">
          {report.snapshot}
        </blockquote>
      )}
      {report.note && <p className="text-sm text-muted">“{report.note}”</p>}

      {report.status === "open" && (
        <div className="flex flex-wrap gap-2">
          {isMessage && (
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => resolve.mutate({ reportId: report.id, status: "actioned", removeMessage: true })}
            >
              <Trash2 className="size-4" /> Remove message
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => resolve.mutate({ reportId: report.id, status: "reviewed" })}>
            <CheckCheck className="size-4" /> Mark reviewed
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => resolve.mutate({ reportId: report.id, status: "dismissed" })}>
            Dismiss
          </Button>
        </div>
      )}
    </li>
  );
}

function Reports() {
  const [status, setStatus] = useState<ReportStatus | "all">("open");
  const query = useAdminReports(status);
  const reports = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  return (
    <div className="flex flex-col gap-4">
      <Pills label="Filter reports" options={["all", ...REPORT_STATUSES] as const} value={status} onChange={setStatus} />
      {query.isPending ? (
        <Rows count={4} />
      ) : query.isError ? (
        <ErrorState title="Couldn't load reports" error={query.error} onRetry={() => query.refetch()} />
      ) : reports.length === 0 ? (
        <EmptyState icon={Flag} title="Nothing to review" description={status === "open" ? "No open reports right now." : `No ${status} reports.`} />
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function AdminPage() {
  const me = useCurrentUser();
  const [tab, setTab] = useState<Tab>("overview");
  const stats = useAdminStats();

  // The server answers 404 for non-admins regardless; this only avoids a pointless request.
  if (me.role !== "admin") return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="shrink-0 border-b border-border bg-surface pt-safe">
        <div className="flex h-14 items-center gap-2 px-4 md:px-6">
          <ShieldCheck className="size-5 text-accent" />
          <h1 className="text-lg font-semibold">Admin</h1>
          {stats.data && stats.data.reports.open > 0 && (
            <span className="ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-fg">
              {stats.data.reports.open}
              <span className="sr-only"> open reports</span>
            </span>
          )}
        </div>
        <div role="tablist" aria-label="Admin sections" className="flex gap-2 px-4 pb-2 md:px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors",
                tab === t.id ? "bg-primary-soft text-accent" : "bg-surface-2 text-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6">
          {tab === "overview" && <Overview />}
          {tab === "users" && <Users meId={me.id} />}
          {tab === "reports" && <Reports />}
        </div>
      </div>
      {stats.isFetching && !stats.isPending && (
        <span className="sr-only" role="status">
          <Spinner label="Refreshing" />
        </span>
      )}
    </div>
  );
}
