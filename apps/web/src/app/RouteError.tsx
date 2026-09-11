import { AlertTriangle, Compass, RefreshCw } from "lucide-react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";

/** Catches render/loader errors anywhere in the app so a crash never leaves a blank screen. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  // After a deploy, old lazy chunks disappear; a reload picks up the new version.
  const staleChunk =
    error instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(error.message);
  if (!staleChunk) console.error(error);

  return (
    <div className="h-app grid place-items-center">
      <EmptyState
        icon={staleChunk ? RefreshCw : AlertTriangle}
        title={staleChunk ? "A new version is available" : "Something went wrong"}
        description={staleChunk ? "Reload to get the latest version of ChatApp." : "An unexpected error occurred. Reloading usually fixes it."}
        action={
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            {!staleChunk && (
              <Button variant="secondary" onClick={() => window.location.assign("/")}>
                Go home
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="h-app grid place-items-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Link to="/" className="font-semibold text-accent hover:underline">
            Back to chats
          </Link>
        }
      />
    </div>
  );
}
