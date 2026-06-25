import { stripHtml, decodeEntities } from "./rss";

export type WebArticleData = {
  title: string;
  author: string | null;
  url: string;
  publishedDate: string | null;
  content: string;
};

function metaContent(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const m = html.match(
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
        "i",
      ),
    ) ?? html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
        "i",
      ),
    );
    if (m) return m[1].trim();
  }
  return null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

export async function fetchWebArticle(url: string): Promise<WebArticleData> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; Libris/1.0; personal knowledge indexer)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (res.status === 402 || res.status === 403) {
    throw new Error("paywalled");
  }
  if (!res.ok) {
    throw new Error(`Fetch failed (HTTP ${res.status})`);
  }

  const html = await res.text();

  // Extract metadata from <meta> tags
  const title = decodeEntities(
    metaContent(html, "og:title", "twitter:title") ??
    titleTag(html) ??
    url,
  );

  const author =
    metaContent(html, "author", "article:author", "twitter:creator") ?? null;

  const rawDate =
    metaContent(html, "article:published_time", "og:article:published_time", "datePublished") ??
    null;
  const publishedDate = rawDate
    ? new Date(rawDate).toISOString().slice(0, 10)
    : null;

  // Extract body content: prefer <article>, <main>, then <body>
  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ??
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const rawBody = articleMatch?.[1] ?? html;
  const content = stripHtml(rawBody);

  if (content.length < 200) {
    throw new Error("Could not extract readable content from this page");
  }

  return { title, author, url, publishedDate, content };
}
