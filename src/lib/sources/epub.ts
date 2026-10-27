import JSZip from "jszip";
import { chunkParagraphs, type Paragraph } from "./paragraphs";

export type EpubChunk = {
  content: string;
  chapterTitle: string | null;
  pageNumber: number | null;
};

export type EpubExtractResult = {
  title: string | null;
  author: string | null;
  isbn: string | null;
  chunks: EpubChunk[];
  /** Whitespace-collapsed text, as the previous extractor produced it — used to match re-imports. */
  matchText: string;
};

function xmlText(doc: Document, ...selectors: string[]): string | null {
  for (const sel of selectors) {
    const val = doc.querySelector(sel)?.textContent?.trim();
    if (val) return val;
  }
  return null;
}

const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, figcaption";

/** A spine document as paragraphs (leaf block elements), its first heading, and its flat text. */
function htmlToParagraphs(html: string): { paragraphs: string[]; heading: string | null; flat: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head").forEach((el) => el.remove());
  const flat = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  const squash = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim();

  // Leaf blocks only, so a <li><p>…</p></li> is not read twice
  const blocks = Array.from(doc.body?.querySelectorAll(BLOCKS) ?? []).filter((el) => !el.querySelector(BLOCKS));
  const paragraphs = blocks.map((el) => squash(el.textContent)).filter(Boolean);
  const heading = squash(doc.body?.querySelector("h1, h2, h3")?.textContent ?? null) || null;

  // No block markup at all (plain <div>s): fall back to the flat text
  return { paragraphs: paragraphs.length ? paragraphs : flat ? [flat] : [], heading, flat };
}

export async function extractEpub(file: File): Promise<EpubExtractResult> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. container.xml → find content.opf path
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) throw new Error("Invalid ePub: missing META-INF/container.xml");

  const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("Invalid ePub: cannot locate content.opf");

  // 2. content.opf → metadata + spine
  const opfXml = await zip.file(opfPath)?.async("text");
  if (!opfXml) throw new Error("Invalid ePub: cannot read content.opf");

  const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");
  const opfBase = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  // 3. Extract metadata
  const title = xmlText(opfDoc, "dc\\:title", "title");
  const author = xmlText(opfDoc, "dc\\:creator", "creator");
  const rawIsbn = xmlText(opfDoc, "dc\\:identifier", "identifier");
  const isbn = rawIsbn?.replace(/^urn:isbn:/i, "") ?? null;

  // 4. Build chapter title map from nav document (ePub3) or ncx (ePub2)
  const chapterTitles = new Map<string, string>();

  const navItem = opfDoc.querySelector('item[properties="nav"]');
  if (navItem) {
    const navPath = opfBase + navItem.getAttribute("href");
    const navHtml = await zip.file(navPath)?.async("text").catch(() => null);
    if (navHtml) {
      const navDoc = new DOMParser().parseFromString(navHtml, "text/html");
      navDoc.querySelectorAll("nav a").forEach((a) => {
        const href = (a.getAttribute("href") ?? "").split("#")[0];
        const text = a.textContent?.trim() ?? "";
        if (href && text) chapterTitles.set(href, text);
      });
    }
  }

  // ePub2 fallback: parse toc.ncx
  if (chapterTitles.size === 0) {
    const ncxItem = opfDoc.querySelector('item[media-type="application/x-dtbncx+xml"]');
    if (ncxItem) {
      const ncxPath = opfBase + ncxItem.getAttribute("href");
      const ncxXml = await zip.file(ncxPath)?.async("text").catch(() => null);
      if (ncxXml) {
        const ncxDoc = new DOMParser().parseFromString(ncxXml, "application/xml");
        ncxDoc.querySelectorAll("navPoint").forEach((np) => {
          const href = (np.querySelector("content")?.getAttribute("src") ?? "").split("#")[0];
          const text = np.querySelector("navLabel text")?.textContent?.trim() ?? "";
          if (href && text) chapterTitles.set(href, text);
        });
      }
    }
  }

  // 5. Walk the spine and extract paragraphs per chapter
  const paragraphs: Paragraph[] = [];
  const flatParts: string[] = [];

  const spineItemrefs = Array.from(opfDoc.querySelectorAll("spine itemref"));
  for (const itemref of spineItemrefs) {
    const idref = itemref.getAttribute("idref");
    if (!idref) continue;
    const item = opfDoc.querySelector(`item[id="${idref}"]`);
    const href = item?.getAttribute("href");
    if (!href) continue;

    const filePath = opfBase + href;
    const html = await zip.file(filePath)?.async("text").catch(() => null);
    if (!html) continue;

    const doc = htmlToParagraphs(html);
    if (doc.flat.length < 80) continue; // skip near-empty files (TOC pages, covers)
    flatParts.push(doc.flat);

    const basename = href.split("/").pop() ?? href;
    const chapterTitle = chapterTitles.get(basename) ?? chapterTitles.get(href) ?? doc.heading;
    for (const text of doc.paragraphs) paragraphs.push({ text, chapterTitle, pageNumber: null });
  }

  return { title, author, isbn, chunks: chunkParagraphs(paragraphs), matchText: flatParts.join(" ") };
}
