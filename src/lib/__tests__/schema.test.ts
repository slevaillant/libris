import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Schema definitions (mirror the DB constraints) ────────────────────
// These are the validation rules the application must enforce before
// hitting the DB. They catch bad data at the boundary, not in SQL.

const SOURCE_TYPES = [
  "physical_book", "ebook", "pdf",
  "substack", "github_repo", "web_article", "highlight_only",
] as const;

const INGEST_STATUSES = [
  "pending", "processing", "complete", "failed", "skipped",
] as const;

const CHUNK_TYPES = [
  "chapter_summary", "passage", "highlight", "key_idea",
] as const;

const MEMORY_TYPES = [
  "semantic_cache", "episodic", "preference", "pattern",
] as const;

const DIGEST_THEME_TYPES = [
  "problem", "decision", "open_question", "topic",
] as const;

const sourceInsertSchema = z.object({
  user_id:      z.string().uuid(),
  source_type:  z.enum(SOURCE_TYPES),
  title:        z.string().min(1),
  author:       z.string().optional(),
  isbn:         z.string().optional(),
  url:          z.string().url().optional(),
  authority_tier: z.number().int().min(1).max(5).default(3),
  ingest_status:  z.enum(INGEST_STATUSES).default("pending"),
  user_rating:    z.number().int().min(1).max(5).optional(),
  tags:           z.array(z.string()).default([]),
});

const chunkInsertSchema = z.object({
  source_id:    z.string().uuid(),
  user_id:      z.string().uuid(),
  chunk_index:  z.number().int().min(0),
  content:      z.string().min(1),
  chunk_type:   z.enum(CHUNK_TYPES).default("passage"),
  chapter_title: z.string().optional(),
  token_count:  z.number().int().positive().optional(),
});

const highlightInsertSchema = z.object({
  user_id:   z.string().uuid(),
  source_id: z.string().uuid(),
  content:   z.string().min(1),
  note:      z.string().optional(),
  chapter:   z.string().optional(),
  page:      z.number().int().positive().optional(),
});

const memoryInsertSchema = z.object({
  user_id:     z.string().uuid(),
  memory_type: z.enum(MEMORY_TYPES),
  content:     z.string().min(1),
  confidence:  z.number().min(0).max(1).default(1.0),
});

const nudgeInsertSchema = z.object({
  user_id:    z.string().uuid(),
  query_text: z.string().min(1),
  themes:     z.array(z.string()).default([]),
});

const digestThemeInsertSchema = z.object({
  digest_run_id: z.string().uuid(),
  user_id:       z.string().uuid(),
  theme_text:    z.string().min(1),
  theme_type:    z.enum(DIGEST_THEME_TYPES),
});

const userProfileInsertSchema = z.object({
  user_id:                  z.string().uuid(),
  display_name:             z.string().default(""),
  librarian_name:           z.string().default("Lumen"),
  timezone:                 z.string().default("Europe/Paris"),
  digest_enabled:           z.boolean().default(true),
  semantic_cache_threshold: z.number().min(0).max(1).default(0.92),
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("source schema", () => {
  const validSource = {
    user_id: "00000000-0000-0000-0000-000000000001",
    source_type: "physical_book" as const,
    title: "High Output Management",
    author: "Andy Grove",
  };

  it("accepts a valid physical book", () => {
    expect(() => sourceInsertSchema.parse(validSource)).not.toThrow();
  });

  it("rejects unknown source_type", () => {
    expect(() => sourceInsertSchema.parse({ ...validSource, source_type: "podcast" })).toThrow();
  });

  it("rejects missing title", () => {
    expect(() => sourceInsertSchema.parse({ ...validSource, title: "" })).toThrow();
  });

  it("rejects invalid URL", () => {
    expect(() => sourceInsertSchema.parse({ ...validSource, url: "not-a-url" })).toThrow();
  });

  it("rejects authority_tier outside 1–5", () => {
    expect(() => sourceInsertSchema.parse({ ...validSource, authority_tier: 0 })).toThrow();
    expect(() => sourceInsertSchema.parse({ ...validSource, authority_tier: 6 })).toThrow();
  });

  it("rejects user_rating outside 1–5", () => {
    expect(() => sourceInsertSchema.parse({ ...validSource, user_rating: 0 })).toThrow();
    expect(() => sourceInsertSchema.parse({ ...validSource, user_rating: 6 })).toThrow();
  });

  it("accepts all valid source types", () => {
    for (const source_type of SOURCE_TYPES) {
      expect(() => sourceInsertSchema.parse({ ...validSource, source_type })).not.toThrow();
    }
  });

  it("defaults authority_tier to 3", () => {
    const result = sourceInsertSchema.parse(validSource);
    expect(result.authority_tier).toBe(3);
  });

  it("defaults ingest_status to pending", () => {
    const result = sourceInsertSchema.parse(validSource);
    expect(result.ingest_status).toBe("pending");
  });
});

describe("chunk schema", () => {
  const validChunk = {
    source_id:   "00000000-0000-0000-0000-000000000001",
    user_id:     "00000000-0000-0000-0000-000000000002",
    chunk_index: 0,
    content:     "The output of a manager is the output of the units under their supervision.",
  };

  it("accepts a valid chunk", () => {
    expect(() => chunkInsertSchema.parse(validChunk)).not.toThrow();
  });

  it("rejects empty content", () => {
    expect(() => chunkInsertSchema.parse({ ...validChunk, content: "" })).toThrow();
  });

  it("rejects negative chunk_index", () => {
    expect(() => chunkInsertSchema.parse({ ...validChunk, chunk_index: -1 })).toThrow();
  });

  it("rejects unknown chunk_type", () => {
    expect(() => chunkInsertSchema.parse({ ...validChunk, chunk_type: "random" })).toThrow();
  });

  it("accepts all valid chunk types", () => {
    for (const chunk_type of CHUNK_TYPES) {
      expect(() => chunkInsertSchema.parse({ ...validChunk, chunk_type })).not.toThrow();
    }
  });

  it("defaults chunk_type to passage", () => {
    const result = chunkInsertSchema.parse(validChunk);
    expect(result.chunk_type).toBe("passage");
  });
});

describe("highlight schema", () => {
  const validHighlight = {
    user_id:   "00000000-0000-0000-0000-000000000001",
    source_id: "00000000-0000-0000-0000-000000000002",
    content:   "Speed comes from small teams with full context.",
  };

  it("accepts a valid highlight", () => {
    expect(() => highlightInsertSchema.parse(validHighlight)).not.toThrow();
  });

  it("rejects empty content", () => {
    expect(() => highlightInsertSchema.parse({ ...validHighlight, content: "" })).toThrow();
  });

  it("accepts optional note and chapter", () => {
    expect(() => highlightInsertSchema.parse({
      ...validHighlight,
      note: "This applies to my current team situation",
      chapter: "Chapter 4",
      page: 87,
    })).not.toThrow();
  });
});

describe("memory schema", () => {
  const validMemory = {
    user_id:     "00000000-0000-0000-0000-000000000001",
    memory_type: "episodic" as const,
    content:     "When asked about scaling teams, Grove Ch.4 was most relevant.",
  };

  it("accepts a valid memory", () => {
    expect(() => memoryInsertSchema.parse(validMemory)).not.toThrow();
  });

  it("rejects unknown memory_type", () => {
    expect(() => memoryInsertSchema.parse({ ...validMemory, memory_type: "long_term" })).toThrow();
  });

  it("accepts all valid memory types", () => {
    for (const memory_type of MEMORY_TYPES) {
      expect(() => memoryInsertSchema.parse({ ...validMemory, memory_type })).not.toThrow();
    }
  });

  it("rejects confidence outside 0–1", () => {
    expect(() => memoryInsertSchema.parse({ ...validMemory, confidence: -0.1 })).toThrow();
    expect(() => memoryInsertSchema.parse({ ...validMemory, confidence: 1.1 })).toThrow();
  });

  it("defaults confidence to 1.0", () => {
    const result = memoryInsertSchema.parse(validMemory);
    expect(result.confidence).toBe(1.0);
  });
});

describe("nudge schema", () => {
  const validNudge = {
    user_id:    "00000000-0000-0000-0000-000000000001",
    query_text: "What does my library say about managing remote teams?",
  };

  it("accepts a valid nudge", () => {
    expect(() => nudgeInsertSchema.parse(validNudge)).not.toThrow();
  });

  it("rejects empty query_text", () => {
    expect(() => nudgeInsertSchema.parse({ ...validNudge, query_text: "" })).toThrow();
  });

  it("defaults themes to empty array", () => {
    const result = nudgeInsertSchema.parse(validNudge);
    expect(result.themes).toEqual([]);
  });
});

describe("digest theme schema", () => {
  const validTheme = {
    digest_run_id: "00000000-0000-0000-0000-000000000001",
    user_id:       "00000000-0000-0000-0000-000000000002",
    theme_text:    "scaling team structure without losing speed",
    theme_type:    "problem" as const,
  };

  it("accepts a valid digest theme", () => {
    expect(() => digestThemeInsertSchema.parse(validTheme)).not.toThrow();
  });

  it("rejects unknown theme_type", () => {
    expect(() => digestThemeInsertSchema.parse({ ...validTheme, theme_type: "idea" })).toThrow();
  });

  it("accepts all valid theme types", () => {
    for (const theme_type of DIGEST_THEME_TYPES) {
      expect(() => digestThemeInsertSchema.parse({ ...validTheme, theme_type })).not.toThrow();
    }
  });

  it("rejects empty theme_text — anonymisation must produce something", () => {
    expect(() => digestThemeInsertSchema.parse({ ...validTheme, theme_text: "" })).toThrow();
  });
});

describe("user profile schema", () => {
  const validProfile = {
    user_id: "00000000-0000-0000-0000-000000000001",
  };

  it("accepts a minimal profile (just user_id)", () => {
    expect(() => userProfileInsertSchema.parse(validProfile)).not.toThrow();
  });

  it("defaults librarian_name to Lumen", () => {
    const result = userProfileInsertSchema.parse(validProfile);
    expect(result.librarian_name).toBe("Lumen");
  });

  it("defaults semantic_cache_threshold to 0.92", () => {
    const result = userProfileInsertSchema.parse(validProfile);
    expect(result.semantic_cache_threshold).toBe(0.92);
  });

  it("rejects threshold outside 0–1", () => {
    expect(() => userProfileInsertSchema.parse({
      ...validProfile,
      semantic_cache_threshold: 1.5,
    })).toThrow();
  });
});
