import JSZip from "jszip";

export type EpubChunk = {
  content: string;
  chapterTitle: string | null;
};

export type EpubExtractResult = {
  title: string | null;
  author: string | null;
  isbn: string | null;
  chunks: EpubChunk[];
};

function xmlText(doc: Document, ...selectors: string[]): string | null {
  for (const sel of selectors) {
    const val = doc.querySelector(sel)?.textContent?.trim();
    if (val) return val;
  }
  return null;
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head").forEach((el) => el.remove());
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function chunkText(text: string, chapterTitle: string | null): EpubChunk[] {
  const paragraphs = text
    .split(/\s{3,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);

  const chunks: EpubChunk[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (Math.ceil(candidate.length / 4) > 600 && buffer) {
      chunks.push({ content: buffer, chapterTitle });
      buffer = para;
    } else {
      buffer = candidate;
    }
  }
  if (buffer.trim()) chunks.push({ content: buffer, chapterTitle });

  return chunks;
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

  // 5. Walk the spine and extract text per chapter
  const chunks: EpubChunk[] = [];

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

    const text = htmlToText(html);
    if (text.length < 80) continue; // skip near-empty files (TOC pages, covers)

    const basename = href.split("/").pop() ?? href;
    const chapterTitle = chapterTitles.get(basename) ?? chapterTitles.get(href) ?? null;

    chunks.push(...chunkText(text, chapterTitle));
  }

  return { title, author, isbn, chunks };
}
