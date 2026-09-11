import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useConnection } from "@/stores/connection";

/** Slim status bar: Offline / Connecting… / Reconnecting…. Hidden when all is well. */
export function ConnectionBanner() {
  const online = useOnlineStatus();
  const status = useConnection((s) => s.status);

  // Brief blips (e.g. a fast reconnect) shouldn't flash a banner.
  const [showSocketIssue, setShowSocketIssue] = useState(false);
  useEffect(() => {
    if (status === "connected") return setShowSocketIssue(false);
    const t = setTimeout(() => setShowSocketIssue(true), 1500);
    return () => clearTimeout(t);
  }, [status]);

  if (!online) {
    return (
      <div role="status" className="flex shrink-0 items-center justify-center gap-2 bg-warning-soft px-3 py-1.5 text-sm font-medium text-warning">
        <WifiOff className="size-4" /> You're offline. Messages will send when you reconnect.
      </div>
    );
  }
  if (showSocketIssue && status !== "connected") {
    return (
      <div role="status" className="flex shrink-0 items-center justify-center gap-2 bg-primary-soft px-3 py-1.5 text-sm font-medium text-accent">
        <Spinner className="size-3.5" /> {status === "connecting" ? "Connecting…" : "Reconnecting…"}
      </div>
    );
  }
  return null;
}
