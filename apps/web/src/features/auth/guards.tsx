import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useSearchParams } from "react-router";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/forms";
import { useMe } from "./api";

/** Full-screen loader. After a few seconds it explains that a free-tier server may be waking up. */
export function Splash({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="h-app flex flex-col items-center justify-center gap-5 px-6 text-center">
      <LogoMark className="size-14" />
      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3">
          <p className="max-w-xs text-sm text-muted">{errorMessage(error)}</p>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Spinner className="text-muted" label="Loading" />
          <p className={`max-w-xs text-sm text-muted transition-opacity duration-500 ${slow ? "opacity-100" : "opacity-0"}`} aria-live="polite">
            {slow ? "Waking up the server — this can take up to a minute after a period of inactivity." : ""}
          </p>
        </>
      )}
    </div>
  );
}

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Splash />;
  if (me.isError) return <Splash error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) {
    const here = location.pathname + location.search;
    return <Navigate to={here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`} replace />;
  }
  return <Outlet />;
}

/** Login/register screens: bounce signed-in users into the app. */
export function GuestOnly() {
  const me = useMe();
  const [params] = useSearchParams();
  if (me.isPending) return <Splash />;
  if (me.data) return <Navigate to={safeNext(params.get("next"))} replace />;
  return <Outlet />;
}
