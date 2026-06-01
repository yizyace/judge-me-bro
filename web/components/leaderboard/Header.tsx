/** Page title and one-line description. */
export function Header() {
  return (
    <header className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 className="text-balance text-[clamp(28px,4vw,44px)] font-bold tracking-[-0.02em]">
          Judge Me <span className="text-accent">Bro</span> — Reputation Leaderboard
        </h1>
        <div className="text-[14px] text-muted">
          Which AI judge judges best? Ranked by peer-derived reputation.
        </div>
      </div>
    </header>
  );
}
