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
  // 'captions' = raw YouTube captions (many short segments → chunked by chunkTranscriptWithTimestamps)
  // 'gemini'   = Gemini chapter summaries (pre-chunked, use each segment directly as a chunk)
  transcriptSource: "captions" | "gemini" | null;
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

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; shortDescription?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
};

// Strategy 0 (primary): Supadata transcript API — works from any IP, no cookies needed.
// Free tier: 100 credits/month (1 credit per transcript).
// Set via: npx wrangler secret put SUPADATA_API_KEY
async function fetchCaptionsViaSupadata(videoId: string): Promise<{ segments: YouTubeTimedSegment[] | null; status: string }> {
  const apiKey = (process.env.SUPADATA_API_KEY ?? "").trim();
  if (!apiKey) return { segments: null, status: "no_supadata_key" };

  const res = await fetch(
    `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=en`,
    { headers: { "x-api-key": apiKey } },
  ).catch(() => null);

  if (!res?.ok) {
    console.log(`[yt] supadata http=${res?.status}`);
    return { segments: null, status: `supadata_http_${res?.status ?? "err"}` };
  }

  const data = (await res.json()) as {
    content?: { text: string; offset: number; duration: number; lang: string }[];
    error?: string;
    message?: string;
  };

  if (data.error || !data.content?.length) {
    console.log(`[yt] supadata error=${data.error ?? "empty"}`);
    return { segments: null, status: `supadata_${data.error ?? "empty"}` };
  }

  // offset is milliseconds → convert to seconds
  const segments: YouTubeTimedSegment[] = data.content.map((c) => ({
    startSeconds: c.offset / 1000,
    text: c.text,
  }));

  console.log(`[yt] supadata: ${segments.length} segments`);
  return { segments, status: "ok_supadata" };
}

// Build SAPISIDHASH auth header from SAPISID cookie value.
async function sapisidAuth(cookies: string): Promise<string | null> {
  const sapisid =
    cookies.match(/(?:^|;\s*)__Secure-3PAPISID=([^;]+)/)?.[1] ??
    cookies.match(/(?:^|;\s*)SAPISID=([^;]+)/)?.[1];
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const msg = `${ts} ${sapisid} https://www.youtube.com`;
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(msg));
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `SAPISIDHASH ${ts}_${hex}`;
}

// Strategy 1 (primary when YOUTUBE_COOKIES is set): authenticated ANDROID player API.
// Cookie-authenticated requests bypass the datacenter IP block YouTube applies to
// unauthenticated server-side requests. Set via: npx wrangler secret put YOUTUBE_COOKIES
async function fetchCaptionsAuthenticated(videoId: string): Promise<{ segments: YouTubeTimedSegment[] | null; status: string }> {
  const cookies = (process.env.YOUTUBE_COOKIES ?? "").trim();
  if (!cookies) return { segments: null, status: "no_cookies" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
    "Cookie": cookies,
  };
  const auth = await sapisidAuth(cookies);
  if (auth) headers["Authorization"] = auth;

  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers,
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    }),
  }).catch(() => null);

  if (!res?.ok) return { segments: null, status: `auth_http_${res?.status ?? "err"}` };
  const data = (await res.json()) as PlayerResponse;
  const playability = data.playabilityStatus?.status ?? "UNKNOWN";
  console.log(`[yt] auth player playability=${playability}`);
  if (playability !== "OK") return { segments: null, status: `auth_${playability}` };

  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return extractSegmentsFromTracks(tracks, "auth");
}

// Strategy 2: WEB innertube client — same client YouTube's own website uses.
async function fetchCaptionsViaWebClient(videoId: string): Promise<{ segments: YouTubeTimedSegment[] | null; status: string }> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": "2.20241201.06.00",
      "Origin": "https://www.youtube.com",
      "Referer": `https://www.youtube.com/watch?v=${videoId}`,
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20241201.06.00", hl: "en", gl: "US" } },
      videoId,
    }),
  }).catch(() => null);

  if (!res?.ok) return { segments: null, status: `web_http_${res?.status ?? "err"}` };
  const data = (await res.json()) as PlayerResponse;
  const playability = data.playabilityStatus?.status ?? "UNKNOWN";
  console.log(`[yt] WEB client playability=${playability}`);
  if (playability !== "OK") return { segments: null, status: `web_${playability}` };

  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return extractSegmentsFromTracks(tracks, "web");
}

async function extractSegmentsFromTracks(tracks: CaptionTrack[], source: string): Promise<{ segments: YouTubeTimedSegment[] | null; status: string }> {
  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];
  if (!track?.baseUrl) return { segments: null, status: `${source}_no_tracks` };

  const xmlRes = await fetch(track.baseUrl).catch(() => null);
  if (!xmlRes?.ok) return { segments: null, status: `${source}_xml_fetch_failed` };

  const xml = await xmlRes.text();
  const segments = parseTimedtextXml(xml);
  console.log(`[yt] ${source}: ${segments.length} segments lang=${track.languageCode}`);
  return { segments: segments.length > 0 ? segments : null, status: segments.length > 0 ? `ok_${source}` : `${source}_empty_xml` };
}

// Strategy 2: scrape the watch page and extract captionTracks from the embedded JSON.
// Uses balanced-bracket extraction rather than a full-JSON regex.
async function fetchCaptionsFromPage(videoId: string): Promise<{ segments: YouTubeTimedSegment[] | null; status: string }> {
  const res = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "SOCS=CAI; CONSENT=YES+42",
      },
    },
  ).catch(() => null);

  if (!res?.ok) return { segments: null, status: `page_http_${res?.status ?? "err"}` };
  if (res.url.includes("consent.youtube") || res.url.includes("/sorry/")) {
    return { segments: null, status: "page_consent_redirect" };
  }

  const html = await res.text();
  const keyIdx = html.indexOf('"captionTracks":');
  if (keyIdx === -1) return { segments: null, status: "page_no_caption_tracks" };

  const arrayStart = html.indexOf("[", keyIdx);
  if (arrayStart === -1) return { segments: null, status: "page_no_array" };

  let depth = 0, arrayEnd = -1;
  const limit = Math.min(arrayStart + 100_000, html.length);
  for (let i = arrayStart; i < limit; i++) {
    if (html[i] === "[" || html[i] === "{") depth++;
    else if (html[i] === "]" || html[i] === "}") {
      if (--depth === 0) { arrayEnd = i; break; }
    }
  }
  if (arrayEnd === -1) return { segments: null, status: "page_bracket_mismatch" };

  let tracks: CaptionTrack[];
  try {
    tracks = JSON.parse(html.slice(arrayStart, arrayEnd + 1)) as CaptionTrack[];
  } catch {
    return { segments: null, status: "page_json_parse_failed" };
  }

  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];

  if (!track?.baseUrl) return { segments: null, status: "page_no_baseurl" };

  const xmlRes = await fetch(track.baseUrl).catch(() => null);
  if (!xmlRes?.ok) return { segments: null, status: "page_timedtext_fetch_failed" };

  const xml = await xmlRes.text();
  const segments = parseTimedtextXml(xml);
  console.log(`[yt] page scrape: ${segments.length} segments`);
  return { segments: segments.length > 0 ? segments : null, status: segments.length > 0 ? "ok_page" : "page_empty_xml" };
}

// Gemini fallback: used when no captions exist (unlisted, no subtitles, etc.).
// Asks for chapter-level summaries with timestamps rather than a word-for-word transcript —
// a full transcript of a 2hr+ video would exceed practical token limits.
// Each returned segment is a complete, citable summary → used directly as a chunk.
export async function fetchTranscriptViaGemini(videoId: string): Promise<YouTubeTimedSegment[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              fileData: {
                fileUri: `https://www.youtube.com/watch?v=${videoId}`,
                mimeType: "video/mp4",
              },
            },
            {
              text: "Identify the main topic sections of this video from start to finish. For each section write exactly one line in this format: [M:SS] 2-3 sentence summary of what is discussed in this section. Aim for 8-20 sections covering the whole video. No other text.",
            },
          ],
        }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
      }),
    },
  ).catch(() => null);

  if (!res?.ok) return null;
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (data.error) { console.log("[yt] gemini error:", data.error.message); return null; }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) return null;

  const segments: YouTubeTimedSegment[] = [];
  for (const m of text.matchAll(/\[(\d+):(\d{2})\]\s*(.+?)(?=\n\[|\s*$)/gs)) {
    const t = m[3].trim();
    if (t) segments.push({ startSeconds: parseInt(m[1]) * 60 + parseInt(m[2]), text: t });
  }
  console.log(`[yt] gemini returned ${segments.length} chapter summaries`);
  return segments.length > 0 ? segments : null;
}

export async function fetchYouTubeVideo(url: string): Promise<YouTubeData> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL — cannot extract video ID");

  // oEmbed: reliable metadata from any IP, no auth needed
  let title = `YouTube video ${videoId}`;
  let author: string | null = null;
  const oembedRes = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
  ).catch(() => null);
  if (oembedRes?.ok) {
    const oembed = (await oembedRes.json()) as { title?: string; author_name?: string };
    title = oembed.title ?? title;
    author = oembed.author_name ?? null;
  }

  // Try caption strategies in priority order
  const supResult = await fetchCaptionsViaSupadata(videoId);
  console.log(`[yt] supadata status=${supResult.status}`);

  const authResult = supResult.segments ? null : await fetchCaptionsAuthenticated(videoId);
  if (authResult) console.log(`[yt] auth status=${authResult.status}`);

  const pageResult = (supResult.segments || authResult?.segments) ? null : await fetchCaptionsFromPage(videoId);
  if (pageResult) console.log(`[yt] page status=${pageResult.status}`);

  const timedSegments = supResult.segments ?? authResult?.segments ?? pageResult?.segments ?? null;
  const transcriptStatus = timedSegments
    ? (supResult.segments ? supResult.status : authResult?.segments ? authResult.status : pageResult!.status)
    : (pageResult?.status ?? authResult?.status ?? supResult.status);

  console.log(`[yt] final transcript status=${transcriptStatus} segments=${timedSegments?.length ?? 0}`);
  const transcript = timedSegments?.map((s: YouTubeTimedSegment) => s.text).join(" ") ?? null;

  return {
    title,
    author,
    url,
    videoId,
    description: title,
    transcript,
    transcriptAvailable: timedSegments !== null,
    timedSegments,
    transcriptSource: timedSegments ? "captions" : null,
  };
}

// Chunk raw caption segments into ~5-min timed chunks (300 words each), prefixed [MM:SS].
// Used for 'captions' source — segments are short and need merging.
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
