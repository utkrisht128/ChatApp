import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/api";
import { squarePhoto } from "@/lib/media";
import { uploadBlob } from "@/lib/upload";

/** Shows a photo with change/remove controls. Crops to a square, uploads, then calls `apply`. */
export function AvatarPicker({
  name,
  src,
  seed,
  apply,
}: {
  name: string;
  src: string | null;
  seed: string;
  /** Receives the uploaded file id (or null to remove). */
  apply: (fileId: string | null) => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await task();
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error && err.name !== "ApiError" ? "That image couldn't be read. Try a JPEG or PNG." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const blob = await squarePhoto(file);
      const uploaded = await uploadBlob(blob, { purpose: "avatar", kind: "image", name: "photo" });
      await apply(uploaded.id);
    }, "Photo updated");
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="group relative rounded-full" aria-label="Change photo">
        <Avatar name={name} src={src} seed={seed} size="2xl" />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100 group-focus-visible:bg-black/40 group-focus-visible:opacity-100">
          <Camera className="size-7" />
        </span>
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white">
            <Spinner label="Uploading photo" />
          </span>
        )}
      </button>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          <Camera className="size-4" /> {src ? "Change photo" : "Add photo"}
        </Button>
        {src && (
          <Button variant="danger-ghost" size="sm" disabled={busy} onClick={() => void run(() => apply(null), "Photo removed")}>
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
    </div>
  );
}
