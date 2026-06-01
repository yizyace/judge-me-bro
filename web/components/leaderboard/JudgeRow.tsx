import type { ReputationSnapshot } from "@/lib/schema";
import { computeDelta } from "@/lib/report";
import { cx } from "@/lib/cx";
import { RankMedal } from "./RankMedal";
import { KindTag } from "./KindTag";
import { DeltaBadge } from "./DeltaBadge";
import { DimensionBar } from "./DimensionBar";
import { ScoreBlock } from "./ScoreBlock";

/** One leaderboard row: rank, identity + dimension bars, and the score. */
export function JudgeRow({
  snapshot,
  rank,
  isTop,
}: {
  snapshot: ReputationSnapshot;
  rank: number;
  isTop: boolean;
}) {
  const { name, judge, rep_score, n_meta, components: c } = snapshot;
  const delta = computeDelta(snapshot);

  return (
    <div
      className={cx(
        "grid grid-cols-[40px_1fr] items-center gap-[18px] rounded-[14px] border p-[18px_22px]",
        "transition-[transform,border-color] duration-[120ms] ease-out hover:-translate-y-0.5",
        "sm:grid-cols-[56px_1fr_132px]",
        isTop ? "board-top border-[#3b557f]" : "border-line bg-panel hover:border-[#38445a]",
      )}
    >
      <RankMedal rank={rank} isTop={isTop} />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 text-[20px] font-bold">
          <span>{name}</span>
          <KindTag kind={judge.kind} />
          <span className="text-[13px] font-semibold text-muted">v{judge.judge_version}</span>
          {delta && <DeltaBadge delta={delta} judgeVersion={judge.judge_version} />}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-[18px] gap-y-[10px] sm:grid-cols-4">
          <DimensionBar label="Reasoning" value={c.reasoning_quality} />
          <DimensionBar label="Calibration" value={c.calibration} />
          <DimensionBar label="Insight" value={c.insight} />
          <DimensionBar label="Bias" value={c.bias} isBias />
        </div>
      </div>

      <ScoreBlock repScore={rep_score} nMeta={n_meta} />
    </div>
  );
}
