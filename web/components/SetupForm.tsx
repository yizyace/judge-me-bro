"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cx } from "@/lib/cx";
import { IdeaSelect } from "@/components/IdeaSelect";
import { JudgePanel, MAX_JUDGES } from "@/components/JudgePanel";

/** Panel-size bounds enforced client-side; the server re-validates on POST. */
const MIN_JUDGES = 3;

/**
 * The run-setup form.
 *
 * Composes {@link IdeaSelect} + {@link JudgePanel} + a Submit button. On submit
 * it POSTs `{ ideaId, judgeIds }` to `/api/run`; on `{ run_id }` it navigates to
 * `/run/<run_id>`. Submit is enabled only with one idea and 3–{@link MAX_JUDGES}
 * judges selected. While the request is in flight the button shows "Starting…"
 * and is disabled; 400/409 (and any other) errors are surfaced inline.
 */
export function SetupForm() {
  const router = useRouter();

  const [ideaId, setIdeaId] = useState("");
  const [judgeIds, setJudgeIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const judgeCountValid =
    judgeIds.length >= MIN_JUDGES && judgeIds.length <= MAX_JUDGES;
  const canSubmit = !pending && ideaId !== "" && judgeCountValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId, judgeIds }),
      });

      // The API returns `{ error }` on 400/409/500 and `{ run_id }` on success.
      const data = (await res.json().catch(() => null)) as
        | { run_id?: string; error?: string }
        | null;

      if (!res.ok) {
        setError(data?.error ?? `Request failed (${res.status})`);
        return;
      }

      const runId = data?.run_id;
      if (!runId) {
        setError("Run started but no run id was returned.");
        return;
      }

      // Navigate to the run view; keep `pending` true so the button stays
      // disabled through the route transition.
      router.push(`/run/${runId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start run");
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 rounded-2xl border border-line bg-panel p-6 shadow-xl"
    >
      <IdeaSelect value={ideaId} onChange={setIdeaId} />

      <div className="h-px bg-line" aria-hidden />

      <JudgePanel selectedIds={judgeIds} onChange={setJudgeIds} />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cx(
            "w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-panel",
            canSubmit
              ? "bg-accent text-bg hover:bg-accent/90"
              : "cursor-not-allowed bg-panel-2 text-muted",
          )}
        >
          {pending ? "Starting…" : "Start judging"}
        </button>
        {!judgeCountValid && !pending && (
          <p className="text-center text-xs text-muted">
            Pick {MIN_JUDGES}–{MAX_JUDGES} judges to start.
          </p>
        )}
      </div>
    </form>
  );
}
