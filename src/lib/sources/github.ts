export type GithubChunk = {
  content: string;
  sectionTitle: string | null;
  filePath: string;
};

export type GithubRepoMeta = {
  title: string;
  description: string | null;
  url: string;
  defaultBranch: string;
  chunks: GithubChunk[];
};

// Decode base64 GitHub API content as UTF-8 (atob gives Latin-1, corrupting multibyte chars)
function base64ToUtf8(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

// Convert markdown to plain readable text suitable for embedding
function stripMarkdown(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    // Nested badge/image links: [![alt](img)](url) → remove (pure noise)
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    // Images: ![alt](url) → remove
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Bold+italic, bold, italic
    .replace(/\*{3}([^*\n]+)\*{3}/g, "$1")
    .replace(/\*{2}([^*\n]+)\*{2}/g, "$1")
    .replace(/_{2}([^_\n]+)_{2}/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    // Headings → plain text
    .replace(/^#{1,6}\s+/gm, "")
    // Code fences → keep content
    .replace(/^```[^\n]*\n([\s\S]*?)^```/gm, "$1")
    // Inline code → plain text
    .replace(/`([^`]+)`/g, "$1")
    // Blockquotes
    .replace(/^>\s*/gm, "")
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // HTML tags
    .replace(/<[^>]+>/g, " ")
    // HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // Table separator rows: |---|---|
    .replace(/^\|[-:|\s]+\|$/gm, "")
    // Collapse whitespace
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split markdown by ## and ### headings, respecting 600-token limit (~2400 chars)
function chunkMarkdown(markdown: string, filePath: string): GithubChunk[] {
  const MAX_CHARS = 2400;
  const lines = markdown.split("\n");
  const chunks: GithubChunk[] = [];

  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = stripMarkdown(buffer.join("\n"));
    if (text.length > 80) {
      if (text.length > MAX_CHARS) {
        const paragraphs = text.split(/\n\n+/);
        let sub = "";
        for (const para of paragraphs) {
          if ((sub + "\n\n" + para).length > MAX_CHARS && sub) {
            chunks.push({ content: sub.trim(), sectionTitle: currentTitle, filePath });
            sub = para;
          } else {
            sub = sub ? `${sub}\n\n${para}` : para;
          }
        }
        if (sub.trim()) chunks.push({ content: sub.trim(), sectionTitle: currentTitle, filePath });
      } else {
        chunks.push({ content: text, sectionTitle: currentTitle, filePath });
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    if (/^#{2,3}\s/.test(line)) {
      flush();
      currentTitle = line.replace(/^#{2,3}\s+/, "").trim();
      // Don't push the heading into buffer — it's captured as sectionTitle
    } else {
      buffer.push(line);
    }
  }
  flush();

  return chunks;
}

function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

async function githubFetch(path: string, token?: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Libris/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function getFileContent(
  owner: string,
  repo: string,
  filePath: string,
  token?: string,
): Promise<string | null> {
  const res = await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, token);
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== "base64") return null;
  return base64ToUtf8(data.content);
}

async function listDir(
  owner: string,
  repo: string,
  dirPath: string,
  token?: string,
): Promise<{ name: string; path: string; type: string }[]> {
  const res = await githubFetch(`/repos/${owner}/${repo}/contents/${dirPath}`, token);
  if (!res.ok) return [];
  const data = (await res.json()) as { name: string; path: string; type: string }[];
  return Array.isArray(data) ? data : [];
}

export async function fetchGithubRepo(repoUrl: string, token?: string): Promise<GithubRepoMeta> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) throw new Error("Invalid GitHub URL");
  const { owner, repo } = parsed;

  // Repo metadata
  const metaRes = await githubFetch(`/repos/${owner}/${repo}`, token);
  if (!metaRes.ok) {
    throw new Error(`GitHub repo not found or not accessible (HTTP ${metaRes.status})`);
  }
  const meta = (await metaRes.json()) as {
    full_name: string;
    description: string | null;
    html_url: string;
    default_branch: string;
  };

  const chunks: GithubChunk[] = [];

  // README (always fetch)
  const readmeRes = await githubFetch(`/repos/${owner}/${repo}/readme`, token);
  if (readmeRes.ok) {
    const readmeData = (await readmeRes.json()) as { content?: string; encoding?: string };
    if (readmeData.content && readmeData.encoding === "base64") {
      const text = base64ToUtf8(readmeData.content);
      chunks.push(...chunkMarkdown(text, "README.md"));
    }
  }

  // docs/**/*.md (up to 20 files)
  const docsFiles = await listDir(owner, repo, "docs", token);
  const mdFiles = docsFiles
    .filter((f) => f.type === "file" && f.name.endsWith(".md"))
    .slice(0, 20);

  await Promise.all(
    mdFiles.map(async (f) => {
      const content = await getFileContent(owner, repo, f.path, token);
      if (content) chunks.push(...chunkMarkdown(content, f.path));
    }),
  );

  return {
    title: meta.full_name,
    description: meta.description,
    url: meta.html_url,
    defaultBranch: meta.default_branch,
    chunks,
  };
}
