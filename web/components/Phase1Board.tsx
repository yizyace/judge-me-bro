import type { JudgeRefName } from "@/lib/events";

import { JudgeEvalCard } from "@/components/JudgeEvalCard";
import { judgeKey, type EvalDone, type JudgeKey } from "@/components/useRunStream";

/**
 * The Phase-1 board: one {@link JudgeEvalCard} per judge on the panel, each
 * pending (skeleton) until its `eval_done` payload lands in `phase1`. Shows a
 * "k / N" progress readout in the header.
 */
export function Phase1Board({
  judges,
  phase1,
}: {
  judges: JudgeRefName[];
  phase1: Map<JudgeKey, EvalDone>;
}) {
  const done = phase1.size;
  const total = judges.length;

  return (
    <section aria-label="Judges' reviews">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-bold tracking-[-0.01em]">Judges&rsquo; reviews</h2>
        <span className="text-[13px] font-semibold text-muted" aria-live="polite">
          {done} / {total}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {judges.map((judge) => (
          <JudgeEvalCard
            key={judgeKey(judge)}
            judge={judge}
            evaluation={phase1.get(judgeKey(judge))}
          />
        ))}
      </div>
    </section>
  );
}
