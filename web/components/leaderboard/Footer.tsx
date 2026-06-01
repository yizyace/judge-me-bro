const CODE = "rounded-[5px] bg-panel-2 px-1.5 py-px text-text";

/** Legend ("Reading this") plus how to load real run data ("Live data"). */
export function Footer() {
  return (
    <footer className="mt-9 text-[12px] leading-[1.6] text-muted">
      <p>
        <strong className="text-text">Reading this:</strong> reputation = mean{" "}
        <code className={CODE}>meta_score</code> across all critiques a judge received in
        Phase 2. Each bar is a dimension mean. <em>Bias</em> is a penalty (shorter is
        better). The <code className={CODE}>▲</code> badge shows the change from the
        judge's previous distilled version against the same evaluator.
      </p>
      <p className="mt-2">
        <strong className="text-text">Live data:</strong> drop a run's aggregated{" "}
        <code className={CODE}>ReputationReport</code> at{" "}
        <code className={CODE}>runs/&lt;run_id&gt;/reputation.json</code>, then load it with{" "}
        <code className={CODE}>?data=&lt;url&gt;</code> (try{" "}
        <code className={CODE}>?data=/sample-reputation.json</code>). With no parameter the
        page renders bundled sample data. The contract lives in{" "}
        <code className={CODE}>harness/schemas.ts</code>.
      </p>
    </footer>
  );
}
