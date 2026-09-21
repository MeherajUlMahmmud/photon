import * as React from "react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/form-fields";
import { SettingsSection } from "@/pages/settings/settings-layout";

export function SecuritySettingsPage() {
  const { call, tokens } = useAuth();
  const { toast } = useToast();
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("The two new passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      // The server blacklists every refresh token and hands back a fresh pair.
      // Returning it in the `tokens` slot makes `call` persist it like a rotation.
      await call(async (t) => {
        const res = await window.photon.changePassword(t, { old_password: oldPassword, new_password: newPassword });
        return { data: res.data, tokens: res.data };
      });
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      toast("Password changed. Other devices are signed out.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection title="Password" description="Changing it signs out every other device. This one stays signed in.">
      <form className="grid max-w-md gap-5" onSubmit={(e) => void submit(e)}>
        <PasswordField
          name="old_password"
          label="Current password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <PasswordField
          name="new_password"
          label="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          description="At least 8 characters, with an uppercase letter, a lowercase letter and a digit."
          required
        />
        <PasswordField
          name="confirm_password"
          label="New password again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          error={confirm && newPassword !== confirm ? "Does not match the new password." : undefined}
          required
        />
        {error && (
          <Alert variant="problem">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div>
          <Button type="submit" disabled={busy || !tokens}>
            Change password
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
