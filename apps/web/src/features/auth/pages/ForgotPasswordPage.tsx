import { useState, type FormEvent } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Link } from "react-router";
import { forgotPasswordSchema } from "@chat/shared";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { AuthHeading, FormAlert } from "@/layouts/AuthLayout";
import { errorMessage } from "@/lib/api";
import { validate } from "@/lib/forms";
import { useForgotPassword } from "../api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const forgot = useForgotPassword();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(forgotPasswordSchema, { email });
    setError(errors.email);
    if (data) forgot.mutate(data.email);
  };

  if (forgot.isSuccess) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-primary-soft text-accent">
          <MailCheck className="size-7" />
        </div>
        <AuthHeading title="Check your email" subtitle={`If an account exists for ${email}, we've sent a link to reset your password. It expires in 1 hour.`} />
        <Link to="/login" className="text-sm font-semibold text-accent hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back
      </Link>
      <AuthHeading title="Reset your password" subtitle="Enter the email you signed up with and we'll send you a reset link." />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormAlert message={forgot.isError ? errorMessage(forgot.error) : undefined} />
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
        <Button type="submit" size="lg" loading={forgot.isPending}>
          Send reset link
        </Button>
      </form>
    </>
  );
}
