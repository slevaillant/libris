export type YouTubeTimedSegment = {
  startSeconds: number;
  text: string;
};

export type YouTubeTimedChunk = {
  text: string;       // prefixed with [MM:SS]
  startSeconds: number;
};

export type YouTubeData = {
  title: string;
  author: string | null;
  url: string;
  videoId: string;
  description: string;
  transcript: string | null;
  transcriptAvailable: boolean;
  timedSegments: YouTubeTimedSegment[] | null;
};

export function extractVideoId(url: string): string | null {
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };

// Fetch the watch page HTML and extract caption track URLs + description.
// This is the most reliable method from datacenter IPs because YouTube
// blocks the player API (UNPLAYABLE/LOGIN_REQUIRED) but serves the page normally.
async function extractTracksFromPage(
  videoId: string,
): Promise<{ tracks: CaptionTrack[]; description: string } | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  }).catch(() => null);

  if (!res?.ok) return null;
  const html = await res.text();

  // Extract captionTracks JSON array using a string-aware bracket counter
  let tracks: CaptionTrack[] = [];
  const ctIdx = html.indexOf('"captionTracks":');
  if (ctIdx !== -1) {
    const arrStart = html.indexOf("[", ctIdx);
    if (arrStart !== -1) {
      let depth = 0;
      let inStr = false;
      let escape = false;
      let i = arrStart;
      for (; i < html.length; i++) {
        const ch = html[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\" && inStr) { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (ch === "[" || ch === "{") depth++;
          else if (ch === "]" || ch === "}") { depth--; if (depth === 0) { i++; break; } }
        }
      }
      try {
        tracks = JSON.parse(html.slice(arrStart, i)) as CaptionTrack[];
      } catch {}
    }
  }

  // og:description is always present and contains the real video description
  const descMatch =
    html.match(/property="og:description" content="([^"]*)"/) ??
    html.match(/content="([^"]*)" property="og:description"/);
  const description = descMatch ? decodeHtml(descMatch[1]) : "";

  return { tracks, description };
}

// Player API fallback — returns tracks when called from non-datacenter IPs
const YT_CLIENTS = [
  {
    clientName: "7",
    clientVersion: "7.20231009.16.00",
    context: { client: { clientName: "TVHTML5", clientVersion: "7.20231009.16.00", hl: "en", gl: "US" } },
  },
  {
    clientName: "1",
    clientVersion: "2.20240101.00.00",
    context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en", gl: "US" } },
  },
];

type PlayerResponse = {
  videoDetails?: { title?: string; author?: string; shortDescription?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
};

async function fetchPlayerResponse(videoId: string): Promise<PlayerResponse | null> {
  for (const client of YT_CLIENTS) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-YouTube-Client-Name": client.clientName,
          "X-YouTube-Client-Version": client.clientVersion,
          "Origin": "https://www.youtube.com",
          "Referer": `https://www.youtube.com/watch?v=${videoId}`,
        },
        body: JSON.stringify({ context: client.context, videoId }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as PlayerResponse;
      if ((data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).length > 0) return data;
    } catch {}
  }
  return null;
}

export async function fetchYouTubeVideo(url: string): Promise<YouTubeData> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL — cannot extract video ID");

  // oEmbed: most reliable source for title + channel name
  let oembedTitle: string | null = null;
  let oembedAuthor: string | null = null;
  const oembedRes = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
  ).catch(() => null);
  if (oembedRes?.ok) {
    const oembed = (await oembedRes.json()) as { title?: string; author_name?: string };
    oembedTitle = oembed.title ?? null;
    oembedAuthor = oembed.author_name ?? null;
  }

  // Fetch caption tracks: try watch page first (works from datacenter IPs),
  // fall back to player API (works from residential/dev IPs).
  let tracks: CaptionTrack[] = [];
  let description = "";

  const pageData = await extractTracksFromPage(videoId).catch(() => null);
  if (pageData) {
    tracks = pageData.tracks;
    description = pageData.description.slice(0, 500);
  }

  if (tracks.length === 0) {
    const player = await fetchPlayerResponse(videoId);
    if (player) {
      tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      if (!description) description = (player.videoDetails?.shortDescription ?? "").slice(0, 500);
    }
  }

  const title = oembedTitle ?? `YouTube video ${videoId}`;
  const author = oembedAuthor;

  // Prefer manual English track, then auto-generated, then any language
  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];

  let transcript: string | null = null;
  let timedSegments: YouTubeTimedSegment[] | null = null;
  const transcriptAvailable = tracks.length > 0;

  if (track?.baseUrl) {
    try {
      const xmlRes = await fetch(track.baseUrl);
      if (xmlRes.ok) {
        const xml = await xmlRes.text();
        const segments: YouTubeTimedSegment[] = [];
        for (const m of xml.matchAll(/<text[^>]+start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
          const text = decodeHtml(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
          if (text) segments.push({ startSeconds: parseFloat(m[1]), text });
        }
        if (segments.length > 0) {
          timedSegments = segments;
          transcript = segments.map((s) => s.text).join(" ");
        }
      }
    } catch {}
  }

  return { title, author, url, videoId, description, transcript, transcriptAvailable, timedSegments };
}

// Chunk transcript into ~2-min timed segments (300 words each), prefixed with [MM:SS]
export function chunkTranscriptWithTimestamps(
  segments: YouTubeTimedSegment[],
  wordsPerChunk = 300,
): YouTubeTimedChunk[] {
  if (segments.length === 0) return [];

  const chunks: YouTubeTimedChunk[] = [];
  let wordBuffer: string[] = [];
  let chunkStart = segments[0].startSeconds;

  for (const seg of segments) {
    if (wordBuffer.length === 0) chunkStart = seg.startSeconds;
    wordBuffer.push(...seg.text.split(/\s+/).filter(Boolean));

    if (wordBuffer.length >= wordsPerChunk) {
      chunks.push({ text: `[${formatTimestamp(chunkStart)}] ${wordBuffer.join(" ")}`, startSeconds: chunkStart });
      wordBuffer = [];
    }
  }

  if (wordBuffer.length > 15) {
    chunks.push({ text: `[${formatTimestamp(chunkStart)}] ${wordBuffer.join(" ")}`, startSeconds: chunkStart });
  }

  return chunks;
}

// Plain text chunking without timestamps (kept for fallback)
export function chunkTranscript(transcript: string): string[] {
  const words = transcript.split(/\s+/).filter(Boolean);
  const WORDS_PER_CHUNK = 300;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    const chunk = words.slice(i, i + WORDS_PER_CHUNK).join(" ");
    if (chunk.trim().length > 50) chunks.push(chunk);
  }
  return chunks;
}
