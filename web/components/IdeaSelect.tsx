"use client";

import { useEffect, useState } from "react";

import { cx } from "@/lib/cx";

/** One idea as returned by `GET /api/ideas`. */
export type Idea = {
  id: string;
  title: string;
  one_liner: string;
  team: string[];
};

/** The idea selected by default when the catalog loads. */
export const DEFAULT_IDEA_ID = "idea-001";

type IdeaSelectProps = {
  /** Currently selected idea id (controlled). */
  value: string;
  /** Called with the new idea id when the selection changes. */
  onChange: (ideaId: string) => void;
  /** Surfaced to the parent so it can gate Submit / pick the default. */
  onLoaded?: (ideas: Idea[]) => void;
};

/**
 * A styled `<select>` over the idea catalog.
 *
 * Fetches `/api/ideas` on mount, renders each idea as an option, and shows the
 * selected idea's one-liner + team as helper text. The selection is controlled
 * by the parent; once the catalog loads we default to {@link DEFAULT_IDEA_ID}
 * (falling back to the first idea) via `onChange`, unless the parent already
 * holds a valid id.
 */
export function IdeaSelect({ value, onChange, onLoaded }: IdeaSelectProps) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/ideas")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ideas (${res.status})`);
        return res.json() as Promise<Idea[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setIdeas(data);
        onLoaded?.(data);
        // Default the selection once, only if the parent doesn't already hold a
        // valid id. Prefer idea-001; fall back to the first idea.
        const hasCurrent = data.some((i) => i.id === value);
        if (!hasCurrent) {
          const fallback = data.find((i) => i.id === DEFAULT_IDEA_ID) ?? data[0];
          if (fallback) onChange(fallback.id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load ideas");
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

  const selected = ideas.find((i) => i.id === value) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="idea-select" className="text-sm font-semibold text-text">
        Idea
      </label>

      <div className="relative">
        <select
          id="idea-select"
          value={value}
          disabled={loading || !!error || ideas.length === 0}
          onChange={(e) => onChange(e.target.value)}
          className={cx(
            "w-full appearance-none rounded-lg border border-line bg-panel-2 px-3 py-2.5 pr-9",
            "text-sm text-text shadow-sm transition-colors",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {loading && <option>Loading ideas…</option>}
          {!loading && ideas.length === 0 && <option>No ideas available</option>}
          {ideas.map((idea) => (
            <option key={idea.id} value={idea.id}>
              {idea.title || idea.id}
            </option>
          ))}
        </select>
        {/* Chevron — purely decorative, hidden from a11y tree. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        >
          ▾
        </span>
      </div>

      {error ? (
        <p className="text-sm text-bad">{error}</p>
      ) : selected ? (
        <p className="text-sm text-muted">
          {selected.one_liner}
          {selected.team.length > 0 && (
            <span className="text-muted/70"> · {selected.team.join(", ")}</span>
          )}
        </p>
      ) : (
        !loading && <p className="text-sm text-muted">Select an idea to judge.</p>
      )}
    </div>
  );
}
