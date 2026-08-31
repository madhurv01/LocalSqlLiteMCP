import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1) return "<1 ms";
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const RISK_META: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  safe: { label: "Safe", className: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  low: { label: "Low", className: "text-sky-600 dark:text-sky-400", dot: "bg-sky-500" },
  moderate: { label: "Moderate", className: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  high: { label: "High", className: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
  critical: { label: "Critical", className: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
};
