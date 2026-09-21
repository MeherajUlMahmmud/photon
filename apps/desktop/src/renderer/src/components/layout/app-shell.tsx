import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { ChatsProvider, useChats } from "@/hooks/use-chats";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppErrorBoundary } from "@/components/error-boundary";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { HeaderActionsProvider, HeaderActionsSlot } from "@/components/layout/header-actions";

/** Signed-in shell: collapsible sidebar + page outlet. Redirects to /login otherwise. */
export function AppShell() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "authenticated") {
    return (
      <ChatsProvider>
        <HeaderActionsProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="h-svh max-h-svh">
              <header className="flex h-11 shrink-0 items-center gap-2 px-3">
                <SidebarTrigger />
                <Separator orientation="vertical" className="mx-1 h-4" />
                <Breadcrumb pathname={location.pathname} />
                <HeaderActionsSlot className="ml-auto flex items-center gap-1" />
              </header>
              <div className="min-h-0 flex-1 overflow-auto">
                {/* Keyed on pathname so a crashed page resets when the user navigates away. */}
                <AppErrorBoundary key={location.pathname}>
                  <Outlet />
                </AppErrorBoundary>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </HeaderActionsProvider>
      </ChatsProvider>
    );
  }

  return <Navigate to="/login" replace state={{ from: location }} />;
}

const TITLES: Record<string, string> = {
  "": "Workspace",
  chat: "Chat",
  space: "Space",
  settings: "Settings",
  providers: "API keys",
  account: "Account",
  security: "Password",
  help: "Help",
};

function Breadcrumb({ pathname }: { pathname: string }) {
  const { get } = useChats();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = parts.length ? parts : [""];
  // /chat/:id shows the chat's title instead of its id.
  const chatTitle = parts[0] === "chat" && parts[1] ? get(parts[1])?.title : undefined;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-small">
      {crumbs.map((part, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate/60">/</span>}
          <span className={i === crumbs.length - 1 ? "text-foreground" : "text-slate"}>
            {(i === 1 && chatTitle) || TITLES[part] || (part.length > 12 ? `${part.slice(0, 8)}…` : part)}
          </span>
        </span>
      ))}
    </nav>
  );
}
