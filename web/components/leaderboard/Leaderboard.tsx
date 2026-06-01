import type { ReputationReport } from "@/lib/schema";
import { sortByRep } from "@/lib/report";
import { Header } from "./Header";
import { MetaBar } from "./MetaBar";
import { JudgeRow } from "./JudgeRow";
import { Footer } from "./Footer";

/** The full report surface: header, run meta, ranked rows, legend. */
export function Leaderboard({ report }: { report: ReputationReport }) {
  const rows = sortByRep(report.snapshots);

  return (
    <div className="px-[clamp(16px,5vw,64px)] pt-8 pb-16">
      <Header />
      <MetaBar
        runId={report.run_id}
        evaluatorVersion={report.evaluator_version}
        judgeCount={report.snapshots.length}
      />

      <div className="flex flex-col gap-[14px]">
        {rows.map((snapshot, i) => (
          <JudgeRow
            key={`${snapshot.judge.judge_id}@${snapshot.judge.judge_version}`}
            snapshot={snapshot}
            rank={i + 1}
            isTop={i === 0}
          />
        ))}
      </div>

      <Footer />
    </div>
  );
}
