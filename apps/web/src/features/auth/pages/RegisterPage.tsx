import { useState, type FormEvent } from "react";
import { AtSign } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { registerSchema } from "@chat/shared";
import { Button } from "@/components/ui/Button";
import { PasswordField, TextField } from "@/components/ui/TextField";
import { AuthHeading, FormAlert } from "@/layouts/AuthLayout";
import { fromServer, validate, type FieldErrors } from "@/lib/forms";
import { useRegister } from "../api";

export default function RegisterPage() {
  const [values, setValues] = useState({ displayName: "", username: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const register = useRegister();

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const input = { ...values, displayName: values.displayName.trim() || undefined };
    const { data, errors } = validate(registerSchema, input);
    setErrors(errors);
    if (!data) return;
    register.mutate(input, {
      onSuccess: () => toast.success("Account created", { description: "Check your inbox to verify your email." }),
      onError: (err) => {
        const { fields, message } = fromServer(err);
        setErrors(fields);
        setFormError(message);
      },
    });
  };

  return (
    <>
      <AuthHeading title="Create your account" subtitle="It takes less than a minute." />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormAlert message={formError} />
        <TextField label="Name" name="name" autoComplete="name" autoFocus value={values.displayName} onChange={set("displayName")} error={errors.displayName} hint="How you'll appear to others. Optional." />
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          leading={<AtSign />}
          value={values.username}
          onChange={set("username")}
          error={errors.username}
          hint="3–24 letters, numbers or underscores."
        />
        <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" value={values.email} onChange={set("email")} error={errors.email} />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set("password")}
          error={errors.password}
          hint="At least 8 characters. A short phrase is easier to remember."
        />
        <Button type="submit" size="lg" loading={register.isPending} className="mt-2">
          Create account
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
