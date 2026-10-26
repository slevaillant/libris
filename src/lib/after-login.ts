// Remembers which page a signed-out visitor asked for (e.g. /quiz/<id> from the digest
// email) so they land there after the magic-link sign-in, not on /library.
// Two carriers: localStorage (same browser) and a ?next= param in the magic link
// (when the email opens in another browser, e.g. a mail app's in-app browser).

const KEY = "libris:after-login";

/** Only same-app paths: blocks open redirects such as "//evil.com" or "https://…". */
export function isSafeInternalPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\") &&
    !path.startsWith("/login") &&
    path.length < 500
  );
}

export function rememberAfterLogin(path: string): void {
  if (!isSafeInternalPath(path)) return;
  try {
    localStorage.setItem(KEY, path);
  } catch {
    /* storage unavailable — the ?next= param still carries it */
  }
}

export function peekAfterLogin(): string | null {
  try {
    const p = localStorage.getItem(KEY);
    return isSafeInternalPath(p) ? p : null;
  } catch {
    return null;
  }
}

/** Returns the pending destination (URL ?next= first, then storage) and clears it. */
export function takeAfterLogin(search: string): string | null {
  const fromUrl = new URLSearchParams(search).get("next");
  const stored = peekAfterLogin();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  if (isSafeInternalPath(fromUrl)) return fromUrl;
  return stored;
}
