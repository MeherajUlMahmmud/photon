import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { AppErrorBoundary } from "@/components/error-boundary";
import { AuthProvider } from "@/hooks/use-auth";
import { KeymapProvider } from "@/hooks/use-keymap";
import { ToastProvider } from "@/hooks/use-toast";
import { router } from "@/router";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <KeymapProvider>
            <RouterProvider router={router} />
          </KeymapProvider>
        </AuthProvider>
      </ToastProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
