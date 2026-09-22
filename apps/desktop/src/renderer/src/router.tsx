import { createHashRouter } from "react-router-dom";

import { RouteErrorBoundary } from "@/components/error-boundary";
import { AppShell } from "@/components/layout/app-shell";
import { AuthLayout } from "@/components/layout/auth-layout";
import { BootGate } from "@/components/layout/boot-gate";
import { LoginPage } from "@/pages/auth/login-page";
import { RegisterPage } from "@/pages/auth/register-page";
import { WorkspacePage } from "@/pages/workspace-page";
import { ChatPage } from "@/pages/chat-page";
import { SettingsLayout } from "@/pages/settings/settings-layout";
import { GeneralSettingsPage } from "@/pages/settings/general-page";
import { ProvidersSettingsPage } from "@/pages/settings/providers-page";
import { SkillsSettingsPage } from "@/pages/settings/skills-page";
import { AccountSettingsPage } from "@/pages/settings/account-page";
import { SecuritySettingsPage } from "@/pages/settings/security-page";
import { HelpPage } from "@/pages/help-page";
import { NotFoundPage } from "@/pages/not-found-page";

// Hash routing: the production renderer is loaded from file://, where
// history-based URLs have no server to fall back to.
export const router = createHashRouter([
  {
    element: <BootGate />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
        ],
      },
      {
        element: <AppShell />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: <WorkspacePage /> },
          { path: "chat", element: <ChatPage /> },
          { path: "chat/:chatId", element: <ChatPage /> },
          { path: "space/chat", element: <ChatPage inSpace /> },
          { path: "space/:workspaceId/chat", element: <ChatPage inSpace /> },
          {
            path: "settings",
            element: <SettingsLayout />,
            children: [
              { index: true, element: <GeneralSettingsPage /> },
              { path: "providers", element: <ProvidersSettingsPage /> },
              { path: "skills", element: <SkillsSettingsPage /> },
              { path: "account", element: <AccountSettingsPage /> },
              { path: "security", element: <SecuritySettingsPage /> },
            ],
          },
          { path: "help", element: <HelpPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
