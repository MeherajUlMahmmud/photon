import * as React from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputField, PasswordField } from "@/components/form-fields";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const err = await register({ email, password, first_name: firstName, last_name: lastName });
      if (err) {
        setError(err);
        return;
      }
      navigate("/", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-display">Create an account</h1>
      <p className="mt-2 mb-8 text-body text-slate">Photon keeps your folders, keys and history under it.</p>

      <form className="flex flex-col gap-5" onSubmit={(e) => void onSubmit(e)}>
        <div className="grid grid-cols-2 gap-3">
          <InputField
            name="first_name"
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            autoFocus
            required
          />
          <InputField
            name="last_name"
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
        </div>
        <InputField
          name="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <PasswordField
          name="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          description="At least 8 characters, with an uppercase letter, a lowercase letter and a digit."
          required
        />
        {error && (
          <Alert variant="problem">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating account" : "Create account"}
        </Button>
      </form>

      <p className="mt-8 text-body text-slate">
        Already have one?{" "}
        <Link to="/login" className="text-foreground underline decoration-input underline-offset-4 hover:decoration-black">
          Sign in
        </Link>
      </p>
    </>
  );
}
