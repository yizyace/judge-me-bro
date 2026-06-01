const CODE = "rounded-md bg-panel-2 px-[7px] py-0.5 text-text";

/** Run / evaluator / judge-count line under the header. */
export function MetaBar({
  runId,
  evaluatorVersion,
  judgeCount,
}: {
  runId: string;
  evaluatorVersion: string;
  judgeCount: number;
}) {
  return (
    <div className="mt-1.5 mb-7 flex flex-wrap gap-[18px] text-[13px] text-muted">
      <span>
        Run <code className={CODE}>{runId}</code>
      </span>
      <span>
        Evaluator <code className={CODE}>{evaluatorVersion}</code>
      </span>
      <span>{judgeCount} judges</span>
    </div>
  );
}
