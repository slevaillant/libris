export type YouTubeData = {
  title: string;
  author: string | null;
  url: string;
  videoId: string;
  description: string;
  transcript: string | null;
  transcriptAvailable: boolean;
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

// YouTube internal web client context — bypasses consent pages and regional blocks
const YT_CLIENT_CONTEXT = {
  client: {
    clientName: "WEB",
    clientVersion: "2.20231030.00.00",
    hl: "en",
    gl: "US",
  },
};

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

  // youtubei player API: returns structured JSON with description + caption tracks
  // This is the same endpoint the YouTube web app uses — no consent page involved
  const playerRes = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": "2.20231030.00.00",
      "Origin": "https://www.youtube.com",
      "Referer": `https://www.youtube.com/watch?v=${videoId}`,
    },
    body: JSON.stringify({ context: YT_CLIENT_CONTEXT, videoId }),
  });

  if (!playerRes.ok) {
    throw new Error(`YouTube player API failed (HTTP ${playerRes.status})`);
  }

  type PlayerResponse = {
    videoDetails?: { title?: string; author?: string; shortDescription?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
      };
    };
  };

  const player = (await playerRes.json()) as PlayerResponse;

  const title = oembedTitle ?? player.videoDetails?.title ?? `YouTube video ${videoId}`;
  const author = oembedAuthor ?? player.videoDetails?.author ?? null;
  const description = (player.videoDetails?.shortDescription ?? "").slice(0, 500);

  // Pick the best caption track: prefer manual English, then auto-generated English, then any
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];

  let transcript: string | null = null;
  const transcriptAvailable = tracks.length > 0;

  if (track?.baseUrl) {
    try {
      const xmlRes = await fetch(track.baseUrl);
      if (xmlRes.ok) {
        const xml = await xmlRes.text();
        const segments = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
          decodeHtml(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
        );
        transcript = segments.filter(Boolean).join(" ");
      }
    } catch {}
  }

  return { title, author, url, videoId, description, transcript, transcriptAvailable };
}

// Chunk transcript into ~2-min segments (~300 words each)
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
