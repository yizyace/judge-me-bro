import type { IdeaReviewSummary } from "@/lib/schema";
import { cx } from "@/lib/cx";

/** Consensus verdict → pill colour. advance=green, borderline=amber, pass=red. */
const VERDICT_STYLES: Record<IdeaReviewSummary["consensus_verdict"], string> = {
  advance: "border-good/40 bg-good/15 text-good",
  borderline: "border-warn/40 bg-warn/15 text-[#fbbf24]",
  pass: "border-bad/40 bg-bad/15 text-bad",
};

const VERDICT_LABEL: Record<IdeaReviewSummary["consensus_verdict"], string> = {
  advance: "Advance",
  borderline: "Borderline",
  pass: "Pass",
};

const SCORE_AXES = [
  ["problem", "Problem"],
  ["solution", "Solution"],
  ["market", "Market"],
  ["team", "Team"],
  ["traction", "Traction"],
] as const;

/**
 * THE one consolidated review for the run — a prominent card synthesising every
 * Phase-1 evaluation: the consensus verdict, the a/b/p verdict tally, the mean
 * weighted total, the five mean-score mini-bars, the templated narrative, and
 * the pooled top strengths / top risks / key questions.
 */
export function PanelSummary({ summary }: { summary: IdeaReviewSummary }) {
  const { verdict_counts: vc } = summary;

  return (
    <section aria-label="Panel summary">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-bold tracking-[-0.01em]">Panel summary</h2>
        <span className="text-[13px] font-semibold text-muted">
          {summary.n_judges} {summary.n_judges === 1 ? "judge" : "judges"}
        </span>
      </div>

      <div className="board-top flex flex-col gap-6 rounded-2xl border border-[#3b557f] p-6">
        {/* ── Headline row: verdict + tally + mean total ───────────────── */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <span
            className={cx(
              "rounded-full border px-4 py-1.5 text-[14px] font-bold uppercase tracking-[0.04em]",
              VERDICT_STYLES[summary.consensus_verdict],
            )}
          >
            {VERDICT_LABEL[summary.consensus_verdict]}
          </span>

          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Tally label="advance" tone="text-good" n={vc.advance} />
            <Tally label="borderline" tone="text-[#fbbf24]" n={vc.borderline} />
            <Tally label="pass" tone="text-bad" n={vc.pass} />
          </div>

          <div className="ml-auto flex items-end gap-2">
            <span className="text-[40px] font-extrabold leading-none tracking-[-0.03em]">
              {summary.mean_weighted_total.toFixed(1)}
            </span>
            <span className="mb-1.5 text-[12px] font-semibold text-muted">/ 10 mean</span>
          </div>
        </div>

        {/* ── Mean scores: five mini-bars ──────────────────────────────── */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          {SCORE_AXES.map(([key, label]) => (
            <MeanBar key={key} label={label} value={summary.mean_scores[key]} />
          ))}
        </div>

        {/* ── Narrative ────────────────────────────────────────────────── */}
        <p className="text-[15px] leading-relaxed text-text/95">{summary.narrative}</p>

        {/* ── Pooled strengths / risks ─────────────────────────────────── */}
        <div className="grid gap-5 sm:grid-cols-2">
          <PointList title="Top strengths" tone="good" points={summary.top_strengths} />
          <PointList title="Top risks" tone="bad" points={summary.top_risks} />
        </div>

        {/* ── Key questions ────────────────────────────────────────────── */}
        {summary.key_questions.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-accent">
              Key questions
            </div>
            <ul className="flex flex-col gap-2">
              {summary.key_questions.map((q, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-[14px] leading-snug text-text/90"
                >
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** A single verdict count, e.g. "2 advance". */
function Tally({ label, tone, n }: { label: string; tone: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cx("font-extrabold", tone)}>{n}</span>
      <span className="text-muted">{label}</span>
    </span>
  );
}

/** One labelled mean-score mini-bar (1–10). */
function MeanBar({ label, value }: { label: string; value: number }) {
  const widthPct = `${(Math.max(0, Math.min(10, value)) / 10) * 100}%`;
  return (
    <div className="text-[12px]">
      <div className="mb-1 flex justify-between text-muted">
        <span>{label}</span>
        <span className="font-bold text-text">{value.toFixed(1)}</span>
      </div>
      <div
        className="h-[7px] overflow-hidden rounded-full bg-bar-bg"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
      >
        <div className="fill-good h-full rounded-full" style={{ width: widthPct }} />
      </div>
    </div>
  );
}

/** A titled bullet list; an empty list renders a dash. */
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
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
        {title}
      </div>
      {points.length === 0 ? (
        <p className="text-[13px] text-muted">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {points.map((p, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug text-text/90">
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
