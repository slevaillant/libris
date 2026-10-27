// Weekly "Friday deep-dive" email. Built for a ≤15-minute read whose job is to decide
// which 3–4 sources to read this afternoon: a reading list first, then one scannable
// brief per topic (takeaway, bullets, tension, sources with a one-line "why read").

export type TopicReference = {
  ref: number; // the [n] used in the brief
  title: string;
  author: string | null;
  chapterTitle: string | null;
  url: string;
  why: string | null; // what reading this passage's source gives you
};

export type RadarPick = {
  title: string;
  author: string | null;
  chapterTitle: string | null;
  url: string;
  why: string; // why this matters now for a product leader — not tied to the week
};

export type TopicBrief = {
  theme: string;
  takeaway: string;
  ideas: { text: string; refs: number[] }[];
  tension: string | null;
  readFirst: { ref: number; why: string } | null;
  references: TopicReference[]; // only the ones the brief cites or annotates
  discoveredResources?: { url: string; title: string; sourceType: string; ingested: boolean }[];
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const refTags = (refs: number[]) =>
  refs.length ? ` <span style="color:#9ca3af;font-size:11px;">${refs.map((r) => `[${r}]`).join("")}</span>` : "";

const sourceLine = (r: TopicReference) =>
  `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:#4f46e5;text-decoration:none;font-weight:600;">${esc(r.title)}</a>` +
  (r.author ? ` <span style="color:#6b7280;">— ${esc(r.author)}</span>` : "") +
  (r.chapterTitle ? ` <span style="color:#9ca3af;">· ${esc(r.chapterTitle)}</span>` : "");

/** One plain-text rendering of a brief — used for the text email and as quiz material. */
export function briefToText(t: TopicBrief): string {
  return [
    t.takeaway,
    ...t.ideas.map((i) => `- ${i.text}${i.refs.length ? ` ${i.refs.map((r) => `[${r}]`).join("")}` : ""}`),
    t.tension ? `Tension: ${t.tension}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildWeeklyDigestEmail(
  displayName: string,
  librarianName: string,
  date: string,
  topics: TopicBrief[],
  { quizUrl, notice, radar }: { quizUrl?: string; notice?: string; radar?: RadarPick } = {},
): { subject: string; html: string; text: string } {
  const subject = `Friday deep-dive — ${date}`;

  // This afternoon's reading list: each topic's "read first", in topic order
  const reads = topics
    .map((t) => ({ topic: t, ref: t.readFirst && t.references.find((r) => r.ref === t.readFirst!.ref) }))
    .filter((x): x is { topic: TopicBrief; ref: TopicReference } => Boolean(x.ref))
    .slice(0, 4);

  const label = (text: string) =>
    `<p style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px;">${text}</p>`;

  const readingListHtml = reads.length
    ? `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px 18px;margin:0 0 20px;">
        ${label("📖 This afternoon — read these")}
        ${reads
          .map(
            ({ topic, ref }, i) => `
          <p style="font-size:13px;line-height:1.5;margin:0 0 10px;">
            <strong>${i + 1}.</strong> ${sourceLine(ref)}<br>
            <span style="color:#374151;">${esc(topic.readFirst!.why)}</span>
            <span style="color:#9ca3af;font-size:11px;"> — ${esc(topic.theme)}</span>
          </p>`,
          )
          .join("")}
        ${quizUrl ? `<p style="margin:12px 0 0;"><a href="${esc(quizUrl)}" target="_blank" rel="noopener" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:12px;font-weight:600;padding:8px 18px;border-radius:8px;">Then test yourself — quiz →</a></p>` : ""}
      </div>`
    : "";

  const topicsHtml = topics
    .map(
      (t) => `
    <div style="border-top:1px solid #e5e7eb;padding:20px 0;">
      ${label(esc(t.theme))}
      <p style="font-size:14px;line-height:1.55;font-weight:600;color:#111827;margin:0 0 10px;">${esc(t.takeaway)}</p>
      <ul style="margin:0 0 10px;padding-left:18px;">
        ${t.ideas.map((i) => `<li style="font-size:13px;line-height:1.55;color:#111827;margin:0 0 6px;">${esc(i.text)}${refTags(i.refs)}</li>`).join("")}
      </ul>
      ${t.tension ? `<p style="font-size:13px;line-height:1.55;color:#92400e;margin:0 0 12px;">⚖️ ${esc(t.tension)}</p>` : ""}
      ${
        t.references.length
          ? `<div style="background:#f9fafb;border-radius:8px;padding:10px 12px;">
          ${t.references
            .map(
              (r) => `
            <p style="font-size:12px;line-height:1.5;margin:0 0 6px;">
              <span style="color:#6b7280;font-weight:600;">[${r.ref}]</span> ${sourceLine(r)}
              ${r.why ? `<br><span style="color:#374151;">${esc(r.why)}</span>` : ""}
            </p>`,
            )
            .join("")}
        </div>`
          : ""
      }
      ${
        t.discoveredResources?.length
          ? `<p style="font-size:12px;color:#6b7280;margin:10px 0 0;">📥 New in your library: ${t.discoveredResources
              .map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener" style="color:#4f46e5;text-decoration:none;">${esc(d.title)}</a>`)
              .join(" · ")}</p>`
          : ""
      }
    </div>`,
    )
    .join("");

  const radarHtml = radar
    ? `<div style="border-top:1px solid #e5e7eb;padding:20px 0;">
        ${label("🧭 Beyond this week")}
        <p style="font-size:13px;line-height:1.55;margin:0 0 6px;">${sourceLine({ ...radar, ref: 0, why: null })}</p>
        <p style="font-size:13px;line-height:1.55;color:#374151;margin:0;">${esc(radar.why)}</p>
      </div>`
    : "";

  const html = `
  <!DOCTYPE html>
  <html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fff;color:#111827;">
    <h1 style="font-size:16px;font-weight:600;margin:0 0 4px;">${esc(librarianName)} · ${esc(date)}</h1>
    <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">${esc(displayName)}, ${topics.length} topic${topics.length === 1 ? "" : "s"} from your week, and what your library says about ${topics.length === 1 ? "it" : "them"}.</p>
    ${notice ? `<p style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin:0 0 20px;">${esc(notice)}</p>` : ""}
    ${readingListHtml}
    ${topicsHtml}
    ${radarHtml}
    <div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:16px;">
      <p style="font-size:11px;color:#9ca3af;margin:0;">Libris · [n] numbers point to the passages listed under each topic.</p>
    </div>
  </body>
  </html>`;

  const text = [
    notice ?? null,
    reads.length
      ? `THIS AFTERNOON — READ THESE\n${reads
          .map(({ topic, ref }, i) => `${i + 1}. ${ref.title}${ref.author ? ` — ${ref.author}` : ""}\n   ${topic.readFirst!.why}\n   ${ref.url}`)
          .join("\n")}${quizUrl ? `\n\nQuiz: ${quizUrl}` : ""}`
      : null,
    radar ? `BEYOND THIS WEEK\n${radar.title}${radar.author ? ` — ${radar.author}` : ""}\n${radar.why}\n${radar.url}` : null,
    ...topics.map(
      (t) =>
        `${t.theme.toUpperCase()}\n\n${briefToText(t)}\n\n${t.references
          .map((r) => `[${r.ref}] ${r.title}${r.author ? ` — ${r.author}` : ""}${r.why ? `\n    ${r.why}` : ""}\n    ${r.url}`)
          .join("\n")}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  return { subject, html, text };
}
