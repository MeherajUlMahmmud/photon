import * as React from "react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { Fact, Facts } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/pages/settings/settings-layout";

export function AccountSettingsPage() {
  const { user, setUser, call, info, logout } = useAuth();
  const { toast } = useToast();
  const [firstName, setFirstName] = React.useState(user?.first_name ?? "");
  const [lastName, setLastName] = React.useState(user?.last_name ?? "");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    try {
      const updated = await call((t) => window.photon.updateProfile(t, { first_name: firstName, last_name: lastName }));
      setUser(updated);
      toast("Name saved");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsSection title="Your name" description="Shown in the sidebar. The email address is your sign-in and cannot change here.">
        <form
          className="grid max-w-md gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="first">First name</Label>
              <Input id="first" className="bg-sheet" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="last">Last name</Label>
              <Input id="last" className="bg-sheet" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} readOnly className="font-mono text-small text-slate" />
          </div>
          <div>
            <Button type="submit" disabled={busy}>
              Save name
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection title="This session">
        <Facts>
          <Fact term="Signed in">{formatDateTime(user?.last_login) || "Just now"}</Fact>
          <Fact term="Account since">{formatDateTime(user?.created_at)}</Fact>
          <Fact term="Server">
            {info?.name} {info?.version}
          </Fact>
        </Facts>
        <div className="mt-6">
          <Button variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}
