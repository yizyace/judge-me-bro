import type { JudgeRefName } from "@/lib/events";
import { cx } from "@/lib/cx";
import { KindTag } from "@/components/leaderboard/KindTag";

import type { EvalDone } from "@/components/useRunStream";

/** Verdict → pill colour. advance=green, borderline=amber, pass=red. */
const VERDICT_STYLES: Record<EvalDone["verdict"], string> = {
  advance: "border-good/40 bg-good/15 text-good",
  borderline: "border-warn/40 bg-warn/15 text-[#fbbf24]",
  pass: "border-bad/40 bg-bad/15 text-bad",
};

const VERDICT_LABEL: Record<EvalDone["verdict"], string> = {
  advance: "Advance",
  borderline: "Borderline",
  pass: "Pass",
};

/** The five rubric criteria, in the order the score chips are rendered. */
const SCORE_AXES = [
  ["problem", "Problem"],
  ["solution", "Solution"],
  ["market", "Market"],
  ["team", "Team"],
  ["traction", "Traction"],
] as const;

/**
 * One judge's Phase-1 review.
 *
 * Pending (no `evaluation`) → a shimmering "scoring…" skeleton holding the
 * judge's identity. Filled → name + {@link KindTag}, the big `weighted_total`,
 * a verdict pill, the five 1–10 score chips, the rationale, the key question,
 * and the strengths / risks lists.
 */
export function JudgeEvalCard({
  judge,
  evaluation,
}: {
  judge: JudgeRefName;
  evaluation?: EvalDone;
}) {
  const pending = !evaluation;

  return (
    <article
      className={cx(
        "flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5",
        pending && "animate-pulse",
      )}
      aria-busy={pending}
    >
      {/* ── Identity row ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[17px] font-bold tracking-[-0.01em]">{judge.name}</h3>
        <KindTag kind={judge.kind} />
        <span className="text-[12px] font-semibold text-muted">v{judge.judge_version}</span>

        {evaluation ? (
          <span
            className={cx(
              "ml-auto rounded-full border px-3 py-1 text-[12px] font-bold uppercase tracking-[0.04em]",
              VERDICT_STYLES[evaluation.verdict],
            )}
          >
            {VERDICT_LABEL[evaluation.verdict]}
          </span>
        ) : (
          <span className="ml-auto text-[12px] font-medium text-muted">scoring…</span>
        )}
      </header>

      {pending ? (
        <PendingBody />
      ) : (
        <FilledBody evaluation={evaluation} />
      )}
    </article>
  );
}

/** Skeleton body shown until this judge's `eval_done` arrives. */
function PendingBody() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex items-end gap-2">
        <div className="h-9 w-16 rounded-md bg-bar-bg" />
        <div className="mb-1 h-3 w-10 rounded bg-bar-bg" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SCORE_AXES.map(([key]) => (
          <div key={key} className="h-6 w-[68px] rounded-md bg-bar-bg" />
        ))}
      </div>
      <div className="h-3 w-full rounded bg-bar-bg" />
      <div className="h-3 w-4/5 rounded bg-bar-bg" />
    </div>
  );
}

/** The full review, rendered once `evaluation` is present. */
function FilledBody({ evaluation }: { evaluation: EvalDone }) {
  return (
    <>
      {/* Big weighted total. */}
      <div className="flex items-end gap-2">
        <span className="text-[34px] font-extrabold leading-none tracking-[-0.03em] text-text">
          {evaluation.weighted_total.toFixed(1)}
        </span>
        <span className="mb-1 text-[12px] font-semibold text-muted">/ 10 weighted</span>
      </div>

      {/* Five score chips. */}
      <div className="flex flex-wrap gap-1.5">
        {SCORE_AXES.map(([key, label]) => (
          <ScoreChip key={key} label={label} value={evaluation.scores[key]} />
        ))}
      </div>

      {/* Rationale. */}
      <p className="text-[13px] leading-relaxed text-text/90">{evaluation.rationale}</p>

      {/* Key question. */}
      <div className="rounded-xl border border-line bg-panel-2 px-3.5 py-2.5">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-accent">
          Key question
        </div>
        <p className="text-[13px] leading-snug text-text/90">{evaluation.key_question}</p>
      </div>

      {/* Strengths / risks. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PointList title="Strengths" tone="good" points={evaluation.strengths} />
        <PointList title="Risks" tone="bad" points={evaluation.risks} />
      </div>
    </>
  );
}

/** One labelled 1–10 score chip. */
function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="font-bold text-text">{value}</span>
    </span>
  );
}

/** A titled bullet list for strengths or risks; empty lists render a dash. */
function PointList({
  title,
  tone,
  points,
}: {
  title: string;
  tone: "good" | "bad";
  points: string[];
}) {
  const dot = tone === "good" ? "text-good" : "text-bad";
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
        {title}
      </div>
      {points.length === 0 ? (
        <p className="text-[13px] text-muted">—</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {points.map((p, i) => (
            <li key={i} className="flex gap-1.5 text-[13px] leading-snug text-text/90">
              <span className={cx("select-none", dot)} aria-hidden>
                •
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
