import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputField, PasswordField } from "@/components/form-fields";

export function LoginPage() {
  const { login, hasUsers } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const err = await login(email, password);
      if (err) {
        setError(err);
        return;
      }
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-display">Sign in</h1>
      <p className="mt-2 mb-8 text-body text-slate">Your folders, keys and history are tied to this account.</p>

      <form className="flex flex-col gap-5" onSubmit={(e) => void onSubmit(e)}>
        <InputField
          name="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
        />
        <PasswordField
          name="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && (
          <Alert variant="problem">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in" : "Sign in"}
        </Button>
      </form>

      <p className="mt-8 text-body text-slate">
        {hasUsers ? "Need another account? " : "First time here? "}
        <Link to="/register" className="text-foreground underline decoration-input underline-offset-4 hover:decoration-black">
          Create one
        </Link>
      </p>
    </>
  );
}
