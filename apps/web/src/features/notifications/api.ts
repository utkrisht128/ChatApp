import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The VAPID key arrives base64url-encoded; PushManager wants raw bytes. */
function decodeKey(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Web Push for this browser. Notifications are per-device (the subscription belongs to
 * this browser), which is why this is a local toggle rather than an account setting.
 */
export function usePush() {
  const supported = pushSupported();
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : "denied");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supported) return setReady(true);
    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (cancelled) return;
        setEnabled(Boolean(sub));
        setReady(true);
      })
      .catch(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        if (result === "denied") toast.error("Notifications are blocked", { description: "Allow them for this site in your browser settings." });
        return;
      }
      const { key } = await api<{ key: string | null }>("/push/key");
      if (!key) {
        toast.error("Notifications aren't available", { description: "This server has no push keys configured." });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(key) });
      const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api<void>("/push/subscribe", { method: "POST", body: { endpoint, keys } });
      setEnabled(true);
      toast.success("Notifications on for this device");
    } catch (err) {
      toast.error("Couldn't turn on notifications", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api<void>("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setEnabled(false);
      toast.success("Notifications off for this device");
    } catch (err) {
      toast.error("Couldn't turn off notifications", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, enabled, permission, busy, ready, enable, disable };
}
