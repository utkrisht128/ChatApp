import { useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { GROUP_LIMITS, type PublicUser } from "@chat/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { FormAlert } from "@/layouts/AuthLayout";
import { fromServer } from "@/lib/forms";
import { useUi } from "@/stores/ui";
import { useCreateGroup } from "./api";
import { UserPicker } from "./UserPicker";

export function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<"members" | "details">("members");
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const create = useCreateGroup();
  const navigate = useNavigate();
  const setView = useUi((s) => s.setChatListView);

  const reset = () => {
    setStep("members");
    setMembers([]);
    setName("");
    setDescription("");
    setError(undefined);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the group a name");
    create.mutate(
      { name: name.trim(), description: description.trim() || undefined, memberIds: members.map((m) => m.id) },
      {
        onSuccess: (chat) => {
          onOpenChange(false);
          reset();
          setView("all");
          navigate(`/c/${chat.id}`);
        },
        onError: (err) => {
          const { fields, message } = fromServer(err);
          setError(message ?? Object.values(fields)[0]);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      {step === "members" ? (
        <DialogContent
          title="New group"
          description={members.length ? `${members.length} selected` : "Add people to your group."}
          className="sm:h-[min(620px,85dvh)]"
          bodyClassName="flex flex-col px-3"
          footer={
            <Button disabled={members.length === 0} onClick={() => setStep("details")}>
              Next
            </Button>
          }
        >
          <UserPicker selected={members} onChange={setMembers} max={GROUP_LIMITS.maxMembers - 1} />
        </DialogContent>
      ) : (
        <DialogContent title="Name your group" description={`${members.length + 1} members including you`}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <IconButton label="Back to members" size="sm" className="-mt-2 -ml-2" onClick={() => setStep("members")}>
              <ArrowLeft />
            </IconButton>
            <FormAlert message={error} />
            <div className="flex items-center gap-3">
              <Avatar name={name || "Group"} seed={name || "group"} size="lg" />
              <TextField
                className="flex-1"
                label="Group name"
                autoFocus
                maxLength={GROUP_LIMITS.name}
                value={name}
                onChange={(e) => (setName(e.target.value), setError(undefined))}
              />
            </div>
            <TextAreaField
              label="Description"
              hint={`Optional · ${description.length}/${GROUP_LIMITS.description}`}
              maxLength={GROUP_LIMITS.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex -space-x-2" aria-label="Members">
              {members.slice(0, 8).map((m) => (
                <Avatar key={m.id} name={m.displayName} src={m.avatarUrl} seed={m.id} size="sm" className="rounded-full ring-2 ring-surface" />
              ))}
              {members.length > 8 && <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold ring-2 ring-surface">+{members.length - 8}</span>}
            </div>
            <Button type="submit" size="lg" loading={create.isPending}>
              Create group
            </Button>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
