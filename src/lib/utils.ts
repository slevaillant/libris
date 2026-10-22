import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Postgres text columns reject NUL characters ("unsupported Unicode escape sequence"),
// which some PDF/ePub extractions contain.
export function stripNul(text: string): string {
  return text.replace(/\u0000/g, "");
}
