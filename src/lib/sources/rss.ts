export type RssArticle = {
  title: string;
  author: string | null;
  url: string;
  publishedDate: string | null;
  content: string;
};

export type RssFeedMeta = {
  newsletterTitle: string;
  description: string | null;
  articles: RssArticle[];
};

// Extract text between two XML/HTML tags (first match only)
function tagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : null;
}

// Extract CDATA content or plain text from a tag
function cdataOrText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return decodeEntities((m[1] ?? m[2] ?? "").trim());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h[1-6]|li|blockquote|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

function parseItems(xml: string): RssArticle[] {
  // Support both RSS <item> and Atom <entry>
  const itemRe = /<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi;
  const items = xml.match(itemRe) ?? [];

  return items.slice(0, 20).map((item): RssArticle => {
    const title = cdataOrText(item, "title") ?? "Untitled";

    // URL: try <link> (RSS) or <link href="..."> (Atom)
    const linkHref = item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
    const linkText = cdataOrText(item, "link");
    const url = linkHref ?? linkText ?? "";

    // Author: try dc:creator, author, or <name> inside <author>
    const author =
      cdataOrText(item, "dc:creator") ??
      cdataOrText(item, "author") ??
      tagText(item, "name") ??
      null;

    // Date: try pubDate or published/updated
    const rawDate =
      cdataOrText(item, "pubDate") ??
      cdataOrText(item, "published") ??
      cdataOrText(item, "updated") ??
      null;
    const publishedDate = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : null;

    // Content: prefer content:encoded, then content, then description
    const rawContent =
      cdataOrText(item, "content:encoded") ??
      cdataOrText(item, "content") ??
      cdataOrText(item, "description") ??
      "";

    const content = stripHtml(rawContent);

    return { title, author, url, publishedDate, content };
  });
}

export async function fetchSubstackFeed(handleOrUrl: string): Promise<RssFeedMeta> {
  // Accept full URLs (custom domains like news.aakashg.com) or bare handles (lenny)
  const feedUrl = handleOrUrl.startsWith("http")
    ? handleOrUrl.replace(/\/$/, "").replace(/\/feed$/, "") + "/feed"
    : `https://${handleOrUrl}.substack.com/feed`;

  const res = await fetch(feedUrl, {
    headers: { "User-Agent": "Libris/1.0 (personal knowledge indexer)" },
  });
  if (!res.ok) throw new Error(`Could not fetch feed for "${handleOrUrl}" (HTTP ${res.status})`);

  const xml = await res.text();

  const newsletterTitle =
    // RSS <channel><title>
    ((): string | null => {
      const channelMatch = xml.match(/<channel[\s\S]*?>([\s\S]*?)<item/i);
      if (!channelMatch) return null;
      return cdataOrText(channelMatch[1], "title");
    })() ??
    // Atom <feed><title>
    ((): string | null => {
      const feedMatch = xml.match(/<feed[\s\S]*?>([\s\S]*?)<entry/i);
      if (!feedMatch) return null;
      return cdataOrText(feedMatch[1], "title");
    })() ??
    `${handleOrUrl} (Newsletter)`;

  const description =
    ((): string | null => {
      const channelMatch = xml.match(/<channel[\s\S]*?>([\s\S]*?)<item/i);
      if (!channelMatch) return null;
      return cdataOrText(channelMatch[1], "description");
    })() ?? null;

  const articles = parseItems(xml);

  return { newsletterTitle, description, articles };
}
