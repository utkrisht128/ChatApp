import { useState } from "react";
import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from "@chat/shared";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { RadioRows, SettingsGroup, SwitchRow } from "@/components/ui/Switch";
import { TextAreaField } from "@/components/ui/TextField";
import { useReport, useSetBlocked } from "./api";

export type ReportTarget = {
  subject: "user" | "message";
  /** The message id, or the user id. */
  id: string;
  name: string;
  /** Present for message reports, so the sender can be blocked at the same time. */
  senderId?: string;
};

const REASON_OPTIONS = REPORT_REASONS.map((value) => ({ value, label: REPORT_REASON_LABELS[value] }));

/** Reports a message or a person, optionally blocking them at the same time. */
export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const report = useReport();
  const setBlocked = useSetBlocked();
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);

  const blockableId = target?.subject === "user" ? target.id : target?.senderId;

  const close = () => {
    onClose();
    setReason("spam");
    setNote("");
    setAlsoBlock(false);
  };

  const submit = () => {
    if (!target) return;
    report.mutate(
      { subject: target.subject, targetId: target.id, reason, note: note.trim() },
      {
        onSuccess: () => {
          if (alsoBlock && blockableId) setBlocked.mutate({ userId: blockableId, blocked: true, name: target.name });
          close();
        },
      },
    );
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        title={target?.subject === "message" ? "Report message" : `Report ${target?.name ?? "user"}`}
        description="Reports are reviewed by moderators. The reported content is shared with them."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" loading={report.isPending} onClick={submit}>
              Send report
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <SettingsGroup title="Reason">
            <RadioRows label="Reason for reporting" value={reason} options={REASON_OPTIONS} onValueChange={(v) => setReason(v as ReportReason)} />
          </SettingsGroup>
          <TextAreaField
            label="Anything else? (optional)"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            hint={`${note.length}/500`}
            placeholder="Add any detail that would help a moderator."
          />
          {blockableId && (
            <SettingsGroup>
              <SwitchRow
                label={`Also block ${target?.name}`}
                description="They won't be able to message you."
                checked={alsoBlock}
                onCheckedChange={setAlsoBlock}
              />
            </SettingsGroup>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
