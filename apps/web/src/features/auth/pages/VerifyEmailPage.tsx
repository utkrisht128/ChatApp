import { useEffect, useRef } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/States";
import { errorMessage } from "@/lib/api";
import { useMe, useVerifyEmail } from "../api";

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const verify = useVerifyEmail();
  const me = useMe();
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use: guard against StrictMode's double effect run.
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(token);
  }, [token, verify]);

  const continueLink = (
    <Link to={me.data ? "/" : "/login"} className="font-semibold text-accent hover:underline">
      {me.data ? "Continue to ChatApp" : "Sign in"}
    </Link>
  );

  if (!token || verify.isError) {
    return (
      <EmptyState
        icon={CircleX}
        title="We couldn't verify your email"
        description={token ? errorMessage(verify.error) : "This link is incomplete. Open it from your email again."}
        action={
          me.data ? (
            <Link to="/settings/account" className="font-semibold text-accent hover:underline">
              Send a new link
            </Link>
          ) : (
            continueLink
          )
        }
      />
    );
  }
  if (verify.isSuccess) {
    return <EmptyState icon={CircleCheck} title="Email verified" description="Thanks — your account is all set." action={continueLink} />;
  }
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <Spinner className="text-muted" label="Verifying" />
      <p className="text-sm text-muted">Verifying your email…</p>
    </div>
  );
}
