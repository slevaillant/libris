import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuizOption = { id: string; text: string };

export type QuizQuestion = {
  id: string;
  theme: string;
  question: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
};

// ─── Haiku tool schema ────────────────────────────────────────────────────────

const GENERATE_QUESTION_TOOL: Anthropic.Tool = {
  name: "generate_question",
  description: "Generate a multiple-choice question testing comprehension of the provided text",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "A clear question testing understanding of the key insight in the text. Not a trivia question.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 4,
        description: "Exactly 4 answer options. One correct, three plausible distractors.",
      },
      correct_index: {
        type: "number",
        description: "0-based index of the correct option in the options array",
      },
      explanation: {
        type: "string",
        description: "One sentence explaining why the correct answer is right, referencing the source text.",
      },
    },
    required: ["question", "options", "correct_index", "explanation"],
  },
};

type GeneratedQuestion = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

async function generateQuestionForTheme(
  anthropic: Anthropic,
  theme: string,
  synthesis: string,
): Promise<QuizQuestion | null> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: "You generate multiple-choice comprehension questions. Test understanding of the key insight — not trivia or word matching. All four options must be plausible. Use the generate_question tool only.",
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [GENERATE_QUESTION_TOOL],
      tool_choice: { type: "tool", name: "generate_question" },
      messages: [
        {
          role: "user",
          content: `Theme: "${theme}"\n\nText to test:\n${synthesis.slice(0, 1200)}`,
        },
      ],
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;

    const raw = toolUse.input as GeneratedQuestion;
    if (!raw.options || raw.options.length !== 4) return null;

    const optionIds = ["a", "b", "c", "d"];
    const options: QuizOption[] = raw.options.map((text, i) => ({
      id: optionIds[i],
      text,
    }));
    const correctOptionId = optionIds[Math.max(0, Math.min(3, raw.correct_index))];

    return {
      id: crypto.randomUUID(),
      theme,
      question: raw.question,
      options,
      correctOptionId,
      explanation: raw.explanation,
    };
  } catch {
    return null;
  }
}

// ─── generateQuizQuestions ────────────────────────────────────────────────────

export const generateQuizQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ digestRunId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Verify the run belongs to this user and fetch its themes
    const { data: themes, error } = await supabase
      .from("digest_themes")
      .select("id, theme_text, synthesis")
      .eq("digest_run_id", data.digestRunId)
      .eq("user_id", userId)
      .not("synthesis", "is", null)
      .order("created_at")
      .limit(6);

    if (error) throw new Error(error.message);
    if (!themes || themes.length === 0) {
      throw new Error("No digest themes found — this run may not exist or belong to your account.");
    }

    // Generate one question per theme (parallel, Haiku)
    const results = await Promise.all(
      (themes as { id: string; theme_text: string; synthesis: string | null }[]).map((t) =>
        generateQuestionForTheme(anthropic, t.theme_text, t.synthesis ?? ""),
      ),
    );

    const questions = results.filter((q): q is QuizQuestion => q !== null);
    if (questions.length === 0) {
      throw new Error("Could not generate quiz questions — please try again.");
    }

    return { questions };
  });
