import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { passwordSchema } from "@chat/shared";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { PasswordField } from "@/components/ui/TextField";
import { AuthHeading, FormAlert } from "@/layouts/AuthLayout";
import { fromServer, type FieldErrors } from "@/lib/forms";
import { meKey, useResetPassword } from "../api";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const reset = useResetPassword();
  const navigate = useNavigate();
  const qc = useQueryClient();

  if (!token) {
    return (
      <EmptyState
        icon={KeyRound}
        title="This link is incomplete"
        description="Open the link from your email again, or request a new one."
        action={
          <Link to="/forgot-password" className="font-semibold text-accent hover:underline">
            Request a new link
          </Link>
        }
      />
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const parsed = passwordSchema.safeParse(password);
    const next: FieldErrors = {};
    if (!parsed.success) next.password = parsed.error.issues[0]?.message ?? "Invalid password";
    if (password !== confirm) next.confirm = "Passwords don't match";
    setErrors(next);
    if (Object.keys(next).length) return;

    reset.mutate(
      { token, password },
      {
        onSuccess: () => {
          qc.setQueryData(meKey, null); // every session was revoked server-side
          toast.success("Password updated", { description: "Sign in with your new password." });
          navigate("/login", { replace: true });
        },
        onError: (err) => {
          const { fields, message } = fromServer(err);
          setErrors(fields);
          setFormError(message);
        },
      },
    );
  };

  return (
    <>
      <AuthHeading title="Choose a new password" subtitle="You'll be signed out on every device after changing it." />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormAlert message={formError} />
        <PasswordField label="New password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="At least 8 characters." />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Button type="submit" size="lg" loading={reset.isPending}>
          Update password
        </Button>
      </form>
      {formError && (
        <p className="mt-6 text-center text-sm">
          <Link to="/forgot-password" className="font-semibold text-accent hover:underline">
            Request a new link
          </Link>
        </p>
      )}
    </>
  );
}
