import type { Delta } from "@/lib/report";

const BASE = "rounded-full px-[7px] py-px text-[12px] font-bold";

/** Version-over-version reputation change: ▲ up (green), ▼ down (red), – flat. */
export function DeltaBadge({ delta, judgeVersion }: { delta: Delta; judgeVersion: number }) {
  const title = `vs v${judgeVersion - 1}`;

  if (delta.direction === "up") {
    return (
      <span title={title} className={`${BASE} bg-good/15 text-good`}>
        ▲ +{delta.value.toFixed(1)}
      </span>
    );
  }
  if (delta.direction === "down") {
    return (
      <span title={title} className={`${BASE} bg-bad/15 text-bad`}>
        ▼ {delta.value.toFixed(1)}
      </span>
    );
  }
  return <span className={`${BASE} bg-panel-2 text-muted`}>– 0.0</span>;
}
