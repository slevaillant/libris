// Email sending via Resend API.
// Set RESEND_API_KEY in wrangler secrets. Falls back to console log if unset (local dev).
// TODO: migrate to Cloudflare Email Workers before production.

export type EmailResult = { sent: boolean; error?: string };

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Local dev — log to console instead of sending
    console.log(`[email] Would send to ${to}: "${subject}"`);
    return { sent: false, error: "RESEND_API_KEY not set — email logged to console" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Lumen <digest@libris.app>",
        to,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, error: `Resend error ${res.status}: ${body}` };
    }

    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

// ─── Digest email HTML template ───────────────────────────────────────────────

export type DigestSection = {
  theme: string;
  synthesis: string;
  citations: { title: string; author: string | null; chapterTitle: string | null }[];
  readingSuggestion: { title: string; chapter: string } | null;
};

export function buildDigestEmail(
  displayName: string,
  librarianName: string,
  date: string,
  sections: DigestSection[],
): { subject: string; html: string; text: string } {
  const subject = `Your library for today — ${date}`;

  const sectionHtml = sections
    .map(
      (s) => `
    <div style="border-top:1px solid #e5e7eb;padding:24px 0;">
      <p style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">
        ${s.theme}
      </p>
      <p style="font-size:14px;line-height:1.7;color:#111827;margin:0 0 16px;">${s.synthesis}</p>
      ${
        s.citations.length > 0
          ? `<div style="margin:0 0 12px;">
          ${s.citations
            .map(
              (c) => `
            <p style="font-size:12px;color:#374151;margin:4px 0;">
              📚 <strong>${c.title}</strong>${c.author ? ` — ${c.author}` : ""}
              ${c.chapterTitle ? `<br><span style="color:#6b7280;padding-left:18px;">${c.chapterTitle}</span>` : ""}
            </p>`,
            )
            .join("")}
        </div>`
          : ""
      }
      ${
        s.readingSuggestion
          ? `<p style="font-size:12px;color:#4f46e5;margin:0;">
          → Suggested re-read: <strong>${s.readingSuggestion.title}</strong>${s.readingSuggestion.chapter ? `, ${s.readingSuggestion.chapter}` : ""}
        </p>`
          : ""
      }
    </div>`,
    )
    .join("");

  const html = `
  <!DOCTYPE html>
  <html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fff;color:#111827;">
    <h1 style="font-size:16px;font-weight:600;margin:0 0 4px;">${librarianName}</h1>
    <p style="font-size:13px;color:#6b7280;margin:0 0 8px;">Good morning, ${displayName}.</p>
    <p style="font-size:13px;color:#6b7280;margin:0 0 24px;">${date}</p>
    ${sectionHtml}
    ${
      sections.length === 0
        ? `<p style="font-size:13px;color:#6b7280;">Nothing matched your library today. Consider adding more sources on the topics you discussed.</p>`
        : ""
    }
    <div style="border-top:1px solid #e5e7eb;margin-top:32px;padding-top:16px;">
      <p style="font-size:11px;color:#9ca3af;margin:0;">Libris · Your personal knowledge library</p>
    </div>
  </body>
  </html>`;

  const text = sections
    .map((s) => `${s.theme.toUpperCase()}\n\n${s.synthesis}\n\n${s.citations.map((c) => `• ${c.title}${c.chapterTitle ? ` — ${c.chapterTitle}` : ""}`).join("\n")}\n`)
    .join("\n---\n\n");

  return { subject, html, text };
}
