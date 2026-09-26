import * as React from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { ChatsProvider, useChats } from "@/hooks/use-chats";
import { SkillsProvider } from "@/hooks/use-skills";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppErrorBoundary } from "@/components/error-boundary";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { HeaderActionsProvider, HeaderActionsSlot } from "@/components/layout/header-actions";
import { useShortcut } from "@/hooks/use-keymap";

/** Signed-in shell: collapsible sidebar + page outlet. Redirects to /login otherwise. */
export function AppShell() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "authenticated") {
    return (
      <ChatsProvider>
        <SkillsProvider>
          <HeaderActionsProvider>
            <SidebarProvider>
              <AnnotationInbox />
              <AppShortcuts />
              <AppSidebar />
              {/* min-w-0: a flex item otherwise grows to fit its widest child and pushes past the window. */}
              <SidebarInset className="h-svh max-h-svh min-w-0">
                <header className="flex h-11 shrink-0 items-center gap-2 px-3">
                  <SidebarTrigger />
                  <Separator orientation="vertical" className="mx-1 h-4" />
                  <Breadcrumb pathname={location.pathname} />
                  <HeaderActionsSlot className="ml-auto flex items-center gap-1" />
                </header>
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                  {/* Keyed on pathname so a crashed page resets when the user navigates away. */}
                  <AppErrorBoundary key={location.pathname}>
                    <Outlet />
                  </AppErrorBoundary>
                </div>
              </SidebarInset>
            </SidebarProvider>
          </HeaderActionsProvider>
        </SkillsProvider>
      </ChatsProvider>
    );
  }

  return <Navigate to="/login" replace state={{ from: location }} />;
}

/** Window-wide shortcuts that navigate; rebindable in Settings > Shortcuts. */
function AppShortcuts() {
  const navigate = useNavigate();
  useShortcut("app.new-chat", () => navigate("/chat"), { inFields: true });
  useShortcut("app.open-settings", () => navigate("/settings"), { inFields: true });
  return null;
}

/** Annotated screenshots sent to "New chat" from the overlay open a fresh plain chat with the picture attached. */
function AnnotationInbox() {
  const navigate = useNavigate();
  React.useEffect(() => {
    async function take() {
      const annotation = await window.photon.takeAppAnnotation();
      if (annotation) navigate("/chat", { state: { annotation } });
    }
    // A freshly opened window mounts after the hand-off was queued, so check on mount too.
    void take();
    return window.photon.onAppAnnotation(() => void take());
  }, [navigate]);
  return null;
}

const TITLES: Record<string, string> = {
  "": "Workspace",
  chat: "Chat",
  space: "Space",
  settings: "Settings",
  providers: "API keys",
  skills: "Skills",
  account: "Account",
  security: "Password",
  companion: "Companion",
  shortcuts: "Shortcuts",
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
