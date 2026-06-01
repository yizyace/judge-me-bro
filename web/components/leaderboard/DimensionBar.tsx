import { pct } from "@/lib/report";

/** One labelled meta-dimension bar. Bias is a penalty (shorter is better). */
export function DimensionBar({
  label,
  value,
  isBias = false,
}: {
  label: string;
  value: number;
  isBias?: boolean;
}) {
  const caption = isBias ? `${label} (penalty)` : label;
  return (
    <div className="text-[12px]">
      <div className="mb-1 flex justify-between text-muted">
        <span>{caption}</span>
        <span className="font-bold text-text">{value.toFixed(1)}</span>
      </div>
      <div
        className="h-[7px] overflow-hidden rounded-full bg-bar-bg"
        role="progressbar"
        aria-label={caption}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
      >
        <div
          className={(isBias ? "fill-bias" : "fill-good") + " h-full rounded-full"}
          style={{ width: pct(value) }}
        />
      </div>
    </div>
  );
}
