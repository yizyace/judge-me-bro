import type { ReputationSnapshot } from "@/lib/schema";

/** Rank order: highest reputation first. Returns a new array (input untouched). */
export function sortByRep(snapshots: readonly ReputationSnapshot[]): ReputationSnapshot[] {
  return [...snapshots].sort((a, b) => b.rep_score - a.rep_score);
}

/** A dimension value (0–10) as a clamped CSS width percentage. */
export function pct(value: number): string {
  return `${Math.max(0, Math.min(100, (value / 10) * 100))}%`;
}

export type DeltaDirection = "up" | "down" | "flat";

export interface Delta {
  direction: DeltaDirection;
  /** Signed change, rounded to one decimal place. */
  value: number;
}

/** Version-over-version reputation change, or null when there's no prior version. */
export function computeDelta(snapshot: ReputationSnapshot): Delta | null {
  if (snapshot.prev_rep_score == null) return null;
  const value = Math.round((snapshot.rep_score - snapshot.prev_rep_score) * 10) / 10;
  const direction: DeltaDirection = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return { direction, value };
}
