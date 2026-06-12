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

// Try clients in order: TVHTML5 bypasses bot detection best from server environments
const YT_CLIENTS = [
  {
    clientName: "7",
    clientVersion: "7.20231009.16.00",
    context: {
      client: { clientName: "TVHTML5", clientVersion: "7.20231009.16.00", hl: "en", gl: "US" },
    },
  },
  {
    clientName: "1",
    clientVersion: "2.20240101.00.00",
    context: {
      client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en", gl: "US" },
    },
  },
  {
    clientName: "3",
    clientVersion: "19.09.37",
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "19.09.37",
        androidSdkVersion: 30,
        hl: "en",
        gl: "US",
      },
    },
  },
];

type PlayerResponse = {
  videoDetails?: { title?: string; author?: string; shortDescription?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
    };
  };
};

async function fetchPlayerResponse(videoId: string): Promise<PlayerResponse> {
  let firstSuccessful: PlayerResponse | null = null;

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
          "User-Agent": "Mozilla/5.0 (compatible)",
        },
        body: JSON.stringify({ context: client.context, videoId }),
      });

      if (!res.ok) continue;

      const data = (await res.json()) as PlayerResponse;
      const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

      if (tracks.length > 0) return data;
      if (!firstSuccessful) firstSuccessful = data;
    } catch {}
  }

  if (firstSuccessful) return firstSuccessful;
  throw new Error("YouTube player API unavailable — all client contexts failed");
}

export async function fetchYouTubeVideo(url: string): Promise<YouTubeData> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL — cannot extract video ID");

  // oEmbed: reliable title + author, no auth or cookies needed
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

  const title = oembedTitle ?? player.videoDetails?.title ?? `YouTube video ${videoId}`;
  const author = oembedAuthor ?? player.videoDetails?.author ?? null;
  const description = (player.videoDetails?.shortDescription ?? "").slice(0, 500);

  // Prefer manual English track, then auto-generated, then any language
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
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

        // Parse segments preserving start timestamps
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
