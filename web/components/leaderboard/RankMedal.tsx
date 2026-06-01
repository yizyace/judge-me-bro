const MEDALS = ["🥇", "🥈", "🥉"] as const;

/** Medal emoji for the top three, otherwise the plain rank number. */
export function RankMedal({ rank, isTop }: { rank: number; isTop: boolean }) {
  const medal = MEDALS[rank - 1];
  return (
    <div className={"text-center text-[30px] font-extrabold " + (isTop ? "text-accent" : "text-muted")}>
      {medal ? (
        <span className="text-[26px]" role="img" aria-label={`Rank ${rank}`}>
          {medal}
        </span>
      ) : (
        <span aria-label={`Rank ${rank}`}>{rank}</span>
      )}
    </div>
  );
}
