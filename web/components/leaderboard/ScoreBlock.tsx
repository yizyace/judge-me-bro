/** The big reputation number, scale caption, and critique count. */
export function ScoreBlock({ repScore, nMeta }: { repScore: number; nMeta: number }) {
  return (
    <div className="col-start-2 mt-1.5 text-left sm:col-auto sm:mt-0 sm:text-right">
      <div className="text-[38px] font-extrabold leading-none">{repScore.toFixed(1)}</div>
      <div className="text-[12px] text-muted">/ 10 reputation</div>
      <div className="mt-1.5 text-[12px] text-muted">{nMeta} critiques</div>
    </div>
  );
}
