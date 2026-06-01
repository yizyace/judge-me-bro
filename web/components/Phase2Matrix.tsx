import type { JudgeRefName } from "@/lib/events";
import { cx } from "@/lib/cx";

import {
  judgeKey,
  pairKey,
  type MetaDone,
  type PairKey,
} from "@/components/useRunStream";

/** Agreement → glyph + tone. agree=✓ good, partially=~ muted, disagree=✗ bad. */
const AGREEMENT: Record<MetaDone["agreement"], { glyph: string; tone: string; label: string }> = {
  agree: { glyph: "✓", tone: "text-good", label: "agrees" },
  partially: { glyph: "~", tone: "text-muted", label: "partially agrees" },
  disagree: { glyph: "✗", tone: "text-bad", label: "disagrees" },
};

/**
 * The Phase-2 judge-to-judge analysis: an N×N grid where rows are raters and
 * columns are targets. The diagonal is a self-exclusion blank ("—"). Each
 * off-diagonal cell is idle, then shows an "analyzing…" spinner, then the
 * `meta_score` + an agreement glyph (with `notes` as its tooltip) once that
 * rater→target `meta_done` arrives. Progress is "k / N×(N−1)".
 */
export function Phase2Matrix({
  judges,
  phase2,
}: {
  judges: JudgeRefName[];
  phase2: Map<PairKey, MetaDone>;
}) {
  const n = judges.length;
  const total = n * (n - 1);
  const done = phase2.size;

  return (
    <section aria-label="Judge-to-judge analysis">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-bold tracking-[-0.01em]">
          Judge-to-judge analysis{" "}
          <span className="text-[14px] font-medium text-muted">
            — each judge evaluates the others
          </span>
        </h2>
        <span className="text-[13px] font-semibold text-muted" aria-live="polite">
          {done} / {total}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-panel p-4">
        <table className="w-full border-separate border-spacing-1 text-[13px]">
          <thead>
            <tr>
              {/* Corner label: rows are raters ↓, cols are targets →. */}
              <th className="p-2 text-left align-bottom text-[11px] font-semibold text-muted">
                rater &darr; / target &rarr;
              </th>
              {judges.map((target) => (
                <th
                  key={judgeKey(target)}
                  scope="col"
                  className="max-w-[120px] truncate p-2 text-center text-[12px] font-bold"
                  title={target.name}
                >
                  {target.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {judges.map((rater) => (
              <tr key={judgeKey(rater)}>
                <th
                  scope="row"
                  className="max-w-[140px] truncate p-2 text-left text-[12px] font-bold"
                  title={rater.name}
                >
                  {rater.name}
                </th>
                {judges.map((target) => {
                  const isSelf = judgeKey(rater) === judgeKey(target);
                  const meta = isSelf
                    ? undefined
                    : phase2.get(pairKey(judgeKey(rater), judgeKey(target)));
                  return (
                    <td key={judgeKey(target)} className="p-0">
                      <Cell isSelf={isSelf} meta={meta} rater={rater} target={target} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A single matrix cell: self-blank, pending spinner, or filled score + glyph. */
function Cell({
  isSelf,
  meta,
  rater,
  target,
}: {
  isSelf: boolean;
  meta?: MetaDone;
  rater: JudgeRefName;
  target: JudgeRefName;
}) {
  if (isSelf) {
    return (
      <div
        className="flex h-14 items-center justify-center rounded-md bg-panel-2/40 text-muted"
        aria-label="self (excluded)"
      >
        —
      </div>
    );
  }

  if (!meta) {
    return (
      <div
        className="flex h-14 flex-col items-center justify-center rounded-md border border-line bg-panel-2"
        aria-busy
        aria-label={`${rater.name} analyzing ${target.name}`}
      >
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-bar-bg border-t-accent" />
        <span className="mt-1 text-[10px] text-muted">analyzing…</span>
      </div>
    );
  }

  const a = AGREEMENT[meta.agreement];
  return (
    <div
      className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border border-line bg-panel-2"
      title={meta.notes}
      aria-label={`${rater.name} ${a.label} with ${target.name}; meta score ${meta.meta_score.toFixed(1)}`}
    >
      <span className="text-[18px] font-extrabold leading-none tracking-[-0.02em] text-text">
        {meta.meta_score.toFixed(1)}
      </span>
      <span className={cx("text-[14px] font-bold leading-none", a.tone)} aria-hidden>
        {a.glyph}
      </span>
    </div>
  );
}
