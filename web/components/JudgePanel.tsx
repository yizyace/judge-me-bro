"use client";

import { useEffect, useState } from "react";

import { cx } from "@/lib/cx";

/** One judge persona as returned by `GET /api/judges`. */
export type Judge = {
  judge_id: string;
  judge_version: number;
  kind: string;
  name: string;
  domains: string[];
  values: string[];
  voice: string;
  rubric_weights: Record<string, number>;
};

/** Judges preselected when the panel first loads (canonical hackathon panel). */
export const DEFAULT_JUDGE_IDS = ["vatsa-shah", "daniel-merja", "drew-mailen"];

/** Hard cap on panel size — the harness rejects runs with >5 judges. */
export const MAX_JUDGES = 5;

type JudgePanelProps = {
  /** Currently selected judge ids (controlled). */
  selectedIds: string[];
  /** Called with the next selection whenever it changes. */
  onChange: (judgeIds: string[]) => void;
  /** Surfaced to the parent so it can gate Submit / pick defaults. */
  onLoaded?: (judges: Judge[]) => void;
};

/**
 * A small FOUNDER / JUDGE pill.
 *
 * Inlined deliberately (rather than importing `components/leaderboard/KindTag`)
 * to keep the setup flow decoupled from the leaderboard. Colors mirror the
 * judge-blue / founder-green design tokens.
 */
function KindBadge({ kind }: { kind: string }) {
  const isFounder = kind === "founder";
  return (
    <span
      className={cx(
        "rounded-full px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.04em]",
        isFounder ? "bg-[#314026] text-[#c8e6a0]" : "bg-[#243b6b] text-[#bcd0ff]",
      )}
    >
      {kind || "judge"}
    </span>
  );
}

/** Small rounded chip used for a judge's domains. */
function DomainChips({ domains }: { domains: string[] }) {
  if (domains.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {domains.map((d) => (
        <span
          key={d}
          className="rounded-full border border-line bg-bg/40 px-2 py-[1px] text-[10px] text-muted"
        >
          {d}
        </span>
      ))}
    </div>
  );
}

/**
 * Multiselect panel over the judge + founder directory.
 *
 * Fetches `/api/judges` on mount and, on first load, preselects exactly
 * {@link DEFAULT_JUDGE_IDS} (only ids that actually exist). The selection is
 * controlled by the parent. Selected judges render as removable chips; the rest
 * of the directory renders as an "add" grid. A {@link MAX_JUDGES} hard cap
 * disables further additions and shows an `N/5` counter.
 */
export function JudgePanel({ selectedIds, onChange, onLoaded }: JudgePanelProps) {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/judges")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load judges (${res.status})`);
        return res.json() as Promise<Judge[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setJudges(data);
        onLoaded?.(data);
        // Preselect the canonical panel once, only if the parent hasn't already
        // supplied a selection. Keep only ids that exist in the directory.
        if (selectedIds.length === 0) {
          const present = new Set(data.map((j) => j.judge_id));
          const preset = DEFAULT_JUDGE_IDS.filter((id) => present.has(id));
          if (preset.length > 0) onChange(preset);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load judges");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Fetch once on mount; the parent owns the selection thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = new Map(judges.map((j) => [j.judge_id, j] as const));
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter((j): j is Judge => Boolean(j));
  const selectedSet = new Set(selectedIds);
  const available = judges.filter((j) => !selectedSet.has(j.judge_id));
  const atCap = selectedIds.length >= MAX_JUDGES;

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  function add(id: string) {
    if (selectedSet.has(id) || selectedIds.length >= MAX_JUDGES) return;
    onChange([...selectedIds, id]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-semibold text-text">Judge panel</label>
        <span
          className={cx(
            "text-xs font-medium tabular-nums",
            atCap ? "text-accent" : "text-muted",
          )}
        >
          {selectedIds.length}/{MAX_JUDGES}
        </span>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      {loading && <p className="text-sm text-muted">Loading judges…</p>}

      {/* ── Selected: removable chips ─────────────────────────────────── */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((j) => (
            <span
              key={j.judge_id}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-panel-2 py-1 pl-3 pr-1.5 text-sm text-text"
            >
              <span className="font-medium">{j.name}</span>
              <KindBadge kind={j.kind} />
              <button
                type="button"
                onClick={() => remove(j.judge_id)}
                aria-label={`Remove ${j.name}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-bad/20 hover:text-bad focus:outline-none focus:ring-1 focus:ring-accent"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Directory: add grid ───────────────────────────────────────── */}
      {!loading && !error && available.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            {atCap ? "Panel full — remove a judge to swap." : "Add from the directory:"}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {available.map((j) => (
              <button
                key={j.judge_id}
                type="button"
                disabled={atCap}
                onClick={() => add(j.judge_id)}
                className={cx(
                  "flex flex-col gap-1.5 rounded-lg border border-line bg-panel-2 p-3 text-left transition-colors",
                  atCap
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-accent/60 hover:bg-panel-2/70 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{j.name}</span>
                  <KindBadge kind={j.kind} />
                </span>
                <DomainChips domains={j.domains} />
                {j.voice && (
                  <span className="line-clamp-1 text-xs text-muted">{j.voice}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
