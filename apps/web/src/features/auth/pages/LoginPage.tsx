import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { loginSchema } from "@chat/shared";
import { Button } from "@/components/ui/Button";
import { PasswordField, TextField } from "@/components/ui/TextField";
import { AuthHeading, FormAlert } from "@/layouts/AuthLayout";
import { fromServer, validate, type FieldErrors } from "@/lib/forms";
import { useLogin } from "../api";

export default function LoginPage() {
  const [values, setValues] = useState({ identifier: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const login = useLogin();

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const { data, errors } = validate(loginSchema, values);
    setErrors(errors);
    if (!data) return;
    // On success the GuestOnly guard redirects into the app.
    login.mutate(values, {
      onError: (err) => {
        const { fields, message } = fromServer(err);
        setErrors(fields);
        setFormError(message);
      },
    });
  };

  return (
    <>
      <AuthHeading title="Welcome back" subtitle="Sign in to continue your conversations." />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormAlert message={formError} />
        <TextField
          label="Username or email"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={values.identifier}
          onChange={set("identifier")}
          error={errors.identifier}
        />
        <div className="flex flex-col gap-1.5">
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            value={values.password}
            onChange={set("password")}
            error={errors.password}
          />
          <Link to="/forgot-password" className="self-end text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={login.isPending} className="mt-2">
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        New here?{" "}
        <Link to="/register" className="font-semibold text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
