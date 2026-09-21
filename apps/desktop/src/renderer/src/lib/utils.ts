import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Electron wraps main-process errors as "Error invoking remote method '…': Error: <msg>". */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(n: number | null | undefined): string {
  return n == null ? "" : n.toLocaleString();
}
