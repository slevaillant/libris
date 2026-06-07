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

// Split markdown by ## and ### headings, respecting 600-token limit (~2400 chars)
function chunkMarkdown(markdown: string, filePath: string): GithubChunk[] {
  const MAX_CHARS = 2400;
  const lines = markdown.split("\n");
  const chunks: GithubChunk[] = [];

  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text.length > 80) {
      // Split oversized sections at paragraph boundary
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
      buffer.push(line);
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
  return atob(data.content.replace(/\n/g, ""));
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
      const text = atob(readmeData.content.replace(/\n/g, ""));
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
