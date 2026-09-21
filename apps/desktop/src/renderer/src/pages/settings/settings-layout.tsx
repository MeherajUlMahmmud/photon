import { NavLink, Outlet } from "react-router-dom";

import { cn } from "@/lib/utils";
import { Page } from "@/components/layout/page";

const SECTIONS = [
  { to: "/settings", label: "Model", end: true },
  { to: "/settings/providers", label: "API keys" },
  { to: "/settings/account", label: "Account" },
  { to: "/settings/security", label: "Password" },
];

export function SettingsLayout() {
  return (
    <Page title="Settings" width="wide">
      <div className="grid gap-12 md:grid-cols-[10rem_minmax(0,68ch)]">
        <nav className="flex flex-col gap-1 md:sticky md:top-8 md:self-start" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.end}
              className={({ isActive }) =>
                cn(
                  "-ml-3 rounded-md px-3 py-1.5 text-body transition-colors",
                  isActive ? "bg-sheet font-medium text-foreground" : "text-slate hover:text-foreground",
                )
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </Page>
  );
}

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="pb-12 not-last:mb-12 not-last:border-b not-last:border-border">
      <h2 className="text-section">{title}</h2>
      {description && <p className="mt-2 max-w-[52ch] text-body text-slate">{description}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}
