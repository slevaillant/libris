import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, ArrowRight, RotateCcw, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateQuizQuestions, type QuizQuestion } from "@/lib/quiz.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/quiz/$runId")({
  component: QuizPage,
});

// ─── Result screen ────────────────────────────────────────────────────────────

function ResultScreen({
  questions,
  answers,
  onRestart,
}: {
  questions: QuizQuestion[];
  answers: Record<string, string>;
  onRestart: () => void;
}) {
  const correct = questions.filter((q) => answers[q.id] === q.correctOptionId).length;
  const total = questions.length;
  const pct = Math.round((correct / total) * 100);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-1">
        <p className="text-3xl font-semibold tabular-nums">{correct}/{total}</p>
        <p className="text-sm text-muted-foreground">{pct}% correct</p>
      </div>

      <p className="text-xs text-muted-foreground max-w-xs">
        {pct === 100
          ? "Perfect — you absorbed every insight from today's digest."
          : pct >= 60
          ? "Good retention. Review the explanations below to reinforce the gaps."
          : "Worth re-reading those sections — the summaries are in your digest email."}
      </p>

      <div className="w-full max-w-sm space-y-3">
        {questions.map((q) => {
          const chosen = answers[q.id];
          const isCorrect = chosen === q.correctOptionId;
          const correctOption = q.options.find((o) => o.id === q.correctOptionId);
          return (
            <div
              key={q.id}
              className={cn(
                "rounded-lg border px-3.5 py-3 text-left space-y-1",
                isCorrect ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5",
              )}
            >
              <div className="flex items-start gap-2">
                {isCorrect ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                )}
                <p className="text-[11px] font-medium leading-snug">{q.question}</p>
              </div>
              {!isCorrect && correctOption && (
                <p className="text-[10px] text-muted-foreground pl-5">
                  Correct: {correctOption.text}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground/70 pl-5 italic">{q.explanation}</p>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" size="sm" onClick={onRestart} className="gap-1.5 text-xs">
          <RotateCcw className="h-3 w-3" />
          Retry
        </Button>
        <Link
          to="/chat"
          className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-7 px-3"
        >
          <BookOpen className="h-3 w-3" />
          Ask Lumen
        </Link>
      </div>
    </div>
  );
}

// ─── Question card ─────────────────────────────────────────────────────────────

function QuestionCard({
  question,
  index,
  total,
  onAnswer,
}: {
  question: QuizQuestion;
  index: number;
  total: number;
  onAnswer: (optionId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const revealed = selected !== null;

  const pick = (id: string) => {
    if (revealed) return;
    setSelected(id);
  };

  return (
    <div className="flex flex-1 flex-col gap-5 px-5 py-6">
      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
            {question.theme}
          </p>
          <p className="text-[9px] text-muted-foreground/50">
            {index + 1} / {total}
          </p>
        </div>
        <div className="h-0.5 w-full rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-foreground/30 transition-all"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <p className="text-sm font-medium leading-snug">{question.question}</p>

      {/* Options */}
      <div className="flex flex-col gap-2">
        {question.options.map((opt) => {
          const isChosen = selected === opt.id;
          const isCorrect = opt.id === question.correctOptionId;

          let variant: "neutral" | "correct" | "wrong" | "dim" = "neutral";
          if (revealed) {
            if (isCorrect) variant = "correct";
            else if (isChosen) variant = "wrong";
            else variant = "dim";
          }

          return (
            <button
              key={opt.id}
              type="button"
              disabled={revealed}
              onClick={() => pick(opt.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-xs leading-snug transition-all",
                variant === "neutral" &&
                  "border-border bg-card hover:bg-accent/50 hover:border-foreground/20 active:scale-[0.99] cursor-pointer",
                variant === "correct" && "border-green-500/60 bg-green-500/10 text-green-700 dark:text-green-400",
                variant === "wrong" && "border-destructive/60 bg-destructive/10 text-destructive",
                variant === "dim" && "border-border/40 bg-card/40 text-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold uppercase",
                  variant === "neutral" && "border-border text-muted-foreground",
                  variant === "correct" && "border-green-500/60 text-green-600 dark:text-green-400",
                  variant === "wrong" && "border-destructive/60 text-destructive",
                  variant === "dim" && "border-border/30 text-muted-foreground/30",
                )}
              >
                {opt.id}
              </span>
              {opt.text}
            </button>
          );
        })}
      </div>

      {/* Explanation + next */}
      {revealed && (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed italic">
            {question.explanation}
          </p>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onAnswer(selected!)}
          >
            {index + 1 < total ? (
              <>Next <ArrowRight className="h-3 w-3" /></>
            ) : (
              "See results"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

function QuizPage() {
  const { runId } = Route.useParams();
  const generateFn = useServerFn(generateQuizQuestions);

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const loadQuestions = () => {
    setLoading(true);
    setError(null);
    setQuestions(null);
    setCurrentIndex(0);
    setAnswers({});
    setDone(false);
    generateFn({ data: { digestRunId: runId } })
      .then((res) => setQuestions(res.questions))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load quiz"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadQuestions(); }, [runId]);

  const handleAnswer = (questionId: string, optionId: string) => {
    const updated = { ...answers, [questionId]: optionId };
    setAnswers(updated);
    if (currentIndex + 1 < (questions?.length ?? 0)) {
      setCurrentIndex((i) => i + 1);
    } else {
      setDone(true);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-5 gap-3">
        <Link
          to="/digest"
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Digest
        </Link>
        <span className="text-muted-foreground/30">|</span>
        <h1 className="text-xs font-medium">Memory check</h1>
      </header>

      {loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-xs">Generating questions…</p>
        </div>
      )}

      {error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-xs text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={loadQuestions} className="text-xs">
            Try again
          </Button>
        </div>
      )}

      {!loading && !error && questions && !done && (
        <QuestionCard
          question={questions[currentIndex]}
          index={currentIndex}
          total={questions.length}
          onAnswer={(optionId) => handleAnswer(questions[currentIndex].id, optionId)}
        />
      )}

      {!loading && !error && questions && done && (
        <ResultScreen
          questions={questions}
          answers={answers}
          onRestart={loadQuestions}
        />
      )}
    </div>
  );
}
