import { useState, type FormEvent } from "react";
import { LogOut, MessageCircle, MoreVertical, Pencil, ShieldCheck, ShieldOff, UserMinus, UserPlus } from "lucide-react";
import { useNavigate } from "react-router";
import { GROUP_LIMITS, type ChatSummary, type GroupInfo, type GroupMember, type GroupPermission, type PublicUser } from "@chat/shared";
import { ActionDropdown, type Action } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { RadioRows, SettingsGroup } from "@/components/ui/Switch";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { useCurrentUser } from "@/features/auth/api";
import { useOpenDirectChat } from "@/features/chats/api";
import { formatLastSeen } from "@/lib/format";
import { AvatarPicker } from "@/components/AvatarPicker";
import { useAddMembers, useGroup, useLeaveGroup, useRemoveMember, useSetGroupAvatar, useSetRole, useUpdateGroup } from "./api";
import { UserPicker } from "./UserPicker";

const PERMISSION_OPTIONS: { value: GroupPermission; label: string }[] = [
  { value: "all", label: "All members" },
  { value: "admins", label: "Only admins" },
];

function EditGroupDialog({ group, open, onOpenChange }: { group: GroupInfo; open: boolean; onOpenChange: (o: boolean) => void }) {
  const update = useUpdateGroup(group.id);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate({ name: name.trim(), description: description.trim() }, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit group">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField label="Group name" autoFocus maxLength={GROUP_LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} error={name.trim() ? undefined : "Give the group a name"} />
          <TextAreaField label="Description" maxLength={GROUP_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} hint={`${description.length}/${GROUP_LIMITS.description}`} />
          <Button type="submit" loading={update.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddMembersDialog({ group, open, onOpenChange }: { group: GroupInfo; open: boolean; onOpenChange: (o: boolean) => void }) {
  const add = useAddMembers(group.id);
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const activeIds = group.members.filter((m) => m.active).map((m) => m.user.id);
  const room = GROUP_LIMITS.maxMembers - activeIds.length;
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && setPicked([]))}>
      <DialogContent
        title="Add members"
        description={room > 0 ? `Up to ${room} more can join.` : "This group is full."}
        className="sm:h-[min(620px,85dvh)]"
        bodyClassName="flex flex-col px-3"
        footer={
          <Button
            disabled={!picked.length}
            loading={add.isPending}
            onClick={() => add.mutate(picked.map((u) => u.id), { onSuccess: () => (onOpenChange(false), setPicked([])) })}
          >
            Add {picked.length || ""}
          </Button>
        }
      >
        <UserPicker selected={picked} onChange={setPicked} excludeIds={activeIds} max={Math.min(room, 50)} />
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ m, group, chat }: { m: GroupMember; group: GroupInfo; chat: ChatSummary }) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const setRole = useSetRole(group.id);
  const remove = useRemoveMember(group.id);
  const openDirect = useOpenDirectChat();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isMe = m.user.id === me.id;
  const myRole = chat.role;
  const iAmAdmin = myRole !== "member";
  const canManage = iAmAdmin && !isMe && m.role !== "owner" && !(m.role === "admin" && myRole !== "owner");

  const actions: Action[] = [
    {
      id: "message",
      label: `Message ${m.user.displayName}`,
      icon: MessageCircle,
      hidden: isMe,
      onSelect: () => openDirect.mutate(m.user.id, { onSuccess: (c) => navigate(`/c/${c.id}`) }),
    },
    { id: "promote", label: "Make admin", icon: ShieldCheck, hidden: !canManage || m.role !== "member", onSelect: () => setRole.mutate({ userId: m.user.id, role: "admin" }) },
    { id: "demote", label: "Remove admin rights", icon: ShieldOff, hidden: !canManage || m.role !== "admin", onSelect: () => setRole.mutate({ userId: m.user.id, role: "member" }) },
    { id: "remove", label: "Remove from group", icon: UserMinus, danger: true, hidden: !canManage, onSelect: () => setConfirmRemove(true) },
  ];
  const presence = m.user.online ? "online" : m.user.lastSeenAt !== undefined ? formatLastSeen(m.user.lastSeenAt) : `@${m.user.username}`;

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Avatar name={m.user.displayName} src={m.user.avatarUrl} seed={m.user.id} online={m.user.online} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{isMe ? "You" : m.user.displayName}</p>
        <p className={presence === "online" ? "truncate text-xs text-accent" : "truncate text-xs text-muted"}>{presence}</p>
      </div>
      {m.role !== "member" && (
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{m.role === "owner" ? "Owner" : "Admin"}</span>
      )}
      {actions.some((a) => !a.hidden) && (
        <ActionDropdown actions={actions}>
          <IconButton label={`Options for ${m.user.displayName}`} size="sm">
            <MoreVertical />
          </IconButton>
        </ActionDropdown>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${m.user.displayName}?`}
        description="They'll no longer be able to see or send messages in this group."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(m.user.id, { onSuccess: () => setConfirmRemove(false) })}
      />
    </li>
  );
}

export function GroupDetails({ chat, quickActions }: { chat: ChatSummary; quickActions: React.ReactNode }) {
  const group = useGroup(chat.id);
  const update = useUpdateGroup(chat.id);
  const setAvatar = useSetGroupAvatar(chat.id);
  const leave = useLeaveGroup(chat.id);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (group.isPending) {
    return (
      <div role="status" aria-label="Loading group" className="flex flex-col items-center gap-3 p-8">
        <Skeleton className="size-28 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  }
  if (group.isError) return <ErrorState title="Couldn't load group info" error={group.error} onRetry={() => group.refetch()} />;

  const g = group.data;
  const admin = chat.role !== "member";
  const canEdit = admin || g.permissions.editInfo === "all";
  const canAdd = admin || g.permissions.addMembers === "all";
  const active = g.members.filter((m) => m.active);

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="flex flex-col items-center px-6 pt-8 text-center">
        {canEdit ? (
          <AvatarPicker name={g.name} src={g.avatarUrl} seed={g.id} apply={(fileId) => setAvatar.mutateAsync(fileId)} />
        ) : (
          <Avatar name={g.name} src={g.avatarUrl} seed={g.id} size="2xl" />
        )}
        <h2 className="mt-4 text-xl font-semibold break-words">{g.name}</h2>
        <p className="text-sm text-muted">
          Group · {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
        </p>
        {g.description && <p className="mt-3 max-w-xs text-sm whitespace-pre-line">{g.description}</p>}
        {canEdit && (
          <Button variant="ghost" size="sm" className="mt-2 text-accent" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
        )}
        <div className="mt-4 w-full">{quickActions}</div>
      </div>

      <section aria-label="Members" className="flex flex-col">
        <div className="flex items-center justify-between px-4 pb-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{active.length} members</h3>
          {canAdd && (
            <Button variant="ghost" size="sm" className="text-accent" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" /> Add
            </Button>
          )}
        </div>
        <ul>
          {active.map((m) => (
            <MemberRow key={m.user.id} m={m} group={g} chat={chat} />
          ))}
        </ul>
      </section>

      {admin && (
        <div className="flex flex-col gap-5 px-3">
          <SettingsGroup title="Who can send messages">
            <RadioRows label="Who can send messages" value={g.permissions.send} options={PERMISSION_OPTIONS} onValueChange={(v) => update.mutate({ permissions: { send: v } })} />
          </SettingsGroup>
          <SettingsGroup title="Who can add members">
            <RadioRows label="Who can add members" value={g.permissions.addMembers} options={PERMISSION_OPTIONS} onValueChange={(v) => update.mutate({ permissions: { addMembers: v } })} />
          </SettingsGroup>
          <SettingsGroup title="Who can edit group info">
            <RadioRows label="Who can edit group info" value={g.permissions.editInfo} options={PERMISSION_OPTIONS} onValueChange={(v) => update.mutate({ permissions: { editInfo: v } })} />
          </SettingsGroup>
        </div>
      )}

      <div className="px-3">
        <Button variant="danger-ghost" className="w-full justify-start" onClick={() => setConfirmLeave(true)}>
          <LogOut className="size-4" /> Leave group
        </Button>
      </div>

      {editing && <EditGroupDialog group={g} open={editing} onOpenChange={setEditing} />}
      <AddMembersDialog group={g} open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this group?"
        description={chat.role === "owner" ? "Ownership will pass to another admin (or the longest-standing member)." : "You'll stop receiving its messages."}
        confirmLabel="Leave group"
        loading={leave.isPending}
        onConfirm={() => leave.mutate(undefined, { onSuccess: () => navigate("/", { replace: true }) })}
      />
    </div>
  );
}
