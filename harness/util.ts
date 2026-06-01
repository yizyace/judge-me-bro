import type { ZodError } from "zod";

/**
 * Shared deterministic helpers used across the harness (no LLM, no I/O).
 *  - extractFirstJsonObject: pull the model's JSON out of prose/code fences
 *  - formatZodError: compact, agent-readable validation errors for the repair loop
 *  - round2 / clamp: derived-field math (weighted_total, meta_score, rep_score)
 */

/**
 * Extract the first balanced top-level JSON object from arbitrary model text,
 * tolerating surrounding prose and ```json code fences (evaluation.md §4).
 * Scans for the first `{` and returns the slice up to its matching `}`,
 * respecting string literals and escapes. Throws if none is found or the
 * slice is not valid JSON.
 */
export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in model output");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error("unbalanced JSON object in model output");
}

/** Format a ZodError into compact `- path: message` lines for the repair loop. */
export function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `- ${e.path.join(".") || "(root)"}: ${e.message}`).join("\n");
}

/** Round to 2 decimals — the derived-field convention (evaluation.md §2.5/§3.7). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Clamp a number to the inclusive [min, max] range. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
