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

// The ANDROID client with the YouTube Android app User-Agent bypasses both:
//  - UNPLAYABLE/LOGIN_REQUIRED responses from the player API on datacenter IPs
//  - EU GDPR consent gates (which only apply to web browser contexts)
// The timedtext URLs returned by this client are accessible from any IP.
const ANDROID_CLIENT_VERSION = "20.10.38";
const ANDROID_UA = `com.google.android.youtube/${ANDROID_CLIENT_VERSION} (Linux; U; Android 14)`;

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };

type PlayerResponse = {
  videoDetails?: { title?: string; author?: string; shortDescription?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
};

async function fetchPlayerResponse(videoId: string): Promise<PlayerResponse | null> {
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ANDROID_UA,
      },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: ANDROID_CLIENT_VERSION } },
        videoId,
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as PlayerResponse;
  } catch {
    return null;
  }
}

// Parse YouTube's timedtext format 3 XML: <p t="ms"> paragraphs with nested <s> words.
function parseTimedtextXml(xml: string): YouTubeTimedSegment[] {
  const segments: YouTubeTimedSegment[] = [];
  for (const m of xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeHtml(
      m[2].replace(/<s[^>]*>/g, "").replace(/<\/s>/g, "").replace(/\s+/g, " ").trim(),
    );
    if (text) segments.push({ startSeconds: parseInt(m[1]) / 1000, text });
  }
  // Fallback: old-style <text start="s"> format
  if (segments.length === 0) {
    for (const m of xml.matchAll(/<text[^>]+start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
      const text = decodeHtml(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (text) segments.push({ startSeconds: parseFloat(m[1]), text });
    }
  }
  return segments;
}

export async function fetchYouTubeVideo(url: string): Promise<YouTubeData> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL — cannot extract video ID");

  // oEmbed: most reliable source for title + channel name, works from any IP
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

  const player = await fetchPlayerResponse(videoId);

  const title = oembedTitle ?? player?.videoDetails?.title ?? `YouTube video ${videoId}`;
  const author = oembedAuthor ?? player?.videoDetails?.author ?? null;
  const description = (player?.videoDetails?.shortDescription ?? "").slice(0, 500);

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
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
        const segments = parseTimedtextXml(xml);
        if (segments.length > 0) {
          timedSegments = segments;
          transcript = segments.map((s) => s.text).join(" ");
        }
      }
    } catch {}
  }

  return { title, author, url, videoId, description, transcript, transcriptAvailable, timedSegments };
}

// Chunk transcript into ~5-min timed segments (300 words each), prefixed with [MM:SS]
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
