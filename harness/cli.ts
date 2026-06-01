#!/usr/bin/env tsx
import * as fs from "node:fs";
import matter from "gray-matter";
import { ZodError } from "zod";
import { Store } from "./store.js";
import { DEFAULT_EVALUATOR_VERSION, PersonaFrontmatter, KINDS, type Kind } from "./schemas.js";
import { formatZodError } from "./util.js";
import { validateIdeaOutput, persistIdeaEvaluation } from "./eval.js";
import { validateMetaOutput, persistMetaEvaluation } from "./meta.js";
import { aggregateRun } from "./reputation.js";
import { buildReport, renderReportMarkdown, writeReport } from "./report.js";
import { computeIdeaReviewSummary } from "./summary.js";

/**
 * judge-me-bro harness CLI — deterministic plumbing only (NO LLM calls).
 *
 * The markdown judging subagents (Claude Code, subscription) invoke these
 * subcommands over Bash to validate model output, compute derived fields,
 * persist records, aggregate reputation, and render reports. Validation
 * failures print agent-readable `- path: message` lines and exit non-zero,
 * writing nothing (fail-closed) so the subagent can run its repair loop.
 */

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || !a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function req(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (v === undefined) fail(`missing required --${name}`);
  return v;
}

/** Split a comma-separated flag value into trimmed, non-empty ids. */
function csv(v: string | undefined): string[] {
  if (v === undefined) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Intersect available items with a requested id subset (fail-closed). With no
 * requested ids the full list passes through (current behavior). Any requested
 * id that matches nothing aborts with `unknown <label> id(s): …` and a non-zero
 * exit, so a scoped run never silently drops a typo'd judge/idea.
 */
function selectSubset<T>(items: T[], idOf: (item: T) => string, requested: string[], label: string): T[] {
  if (requested.length === 0) return items;
  const available = new Set(items.map(idOf));
  const missing = requested.filter((id) => !available.has(id));
  if (missing.length > 0) fail(`unknown ${label} id(s): ${missing.join(", ")}`);
  const want = new Set(requested);
  return items.filter((item) => want.has(idOf(item)));
}

function asKind(v: string): Kind {
  if ((KINDS as readonly string[]).includes(v)) return v as Kind;
  return fail(`invalid kind: ${v} (expected judge|founder)`);
}

function readText(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return fail(`cannot read file: ${p}`);
  }
}

/** Generate a filesystem-safe run id like 2026-06-01T18-00-00Z. */
function genRunId(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = parseFlags(argv.slice(1));
const store = new Store();

try {
  switch (cmd) {
    case "persona:validate": {
      const parsed = matter(readText(req(flags, "raw")));
      const r = PersonaFrontmatter.safeParse(parsed.data);
      if (!r.success) fail(formatZodError(r.error));
      console.log(`ok: persona ${r.data.id}@${r.data.version} valid`);
      break;
    }

    case "persona:put": {
      const res = store.putPersona(readText(req(flags, "raw")));
      console.log(res.path);
      break;
    }

    case "eval:validate": {
      const r = validateIdeaOutput(readText(req(flags, "raw")));
      if (!r.ok) fail(r.errors);
      console.log("ok: IdeaEvaluationOutput valid");
      break;
    }

    case "eval:persist": {
      const r = validateIdeaOutput(readText(req(flags, "raw")));
      if (!r.ok) fail(r.errors);
      const judgeId = req(flags, "judge-id");
      const judgeVersion = Number.parseInt(req(flags, "judge-version"), 10);
      const persona = store.getPersona(judgeId, judgeVersion);
      if (!persona) fail(`persona not found: ${judgeId}@${judgeVersion}`);
      const out = persistIdeaEvaluation(store, {
        run_id: req(flags, "run"),
        evaluator_version: flags["evaluator"] ?? DEFAULT_EVALUATOR_VERSION,
        judge: { judge_id: judgeId, judge_version: judgeVersion, kind: asKind(req(flags, "kind")) },
        idea_id: req(flags, "idea"),
        output: r.value,
        rubric_weights: persona.frontmatter.rubric_weights,
      });
      console.log(out.path);
      break;
    }

    case "meta:validate": {
      const r = validateMetaOutput(readText(req(flags, "raw")));
      if (!r.ok) fail(r.errors);
      console.log("ok: MetaEvaluationOutput valid");
      break;
    }

    case "meta:persist": {
      const raterId = req(flags, "rater-id");
      const raterVersion = Number.parseInt(req(flags, "rater-version"), 10);
      const targetId = req(flags, "target-id");
      const targetVersion = Number.parseInt(req(flags, "target-version"), 10);
      if (raterId === targetId && raterVersion === targetVersion) {
        fail(`self-exclusion: ${raterId}@${raterVersion} cannot rate itself`);
      }
      const r = validateMetaOutput(readText(req(flags, "raw")));
      if (!r.ok) fail(r.errors);
      const out = persistMetaEvaluation(store, {
        run_id: req(flags, "run"),
        evaluator_version: flags["evaluator"] ?? DEFAULT_EVALUATOR_VERSION,
        rater: { judge_id: raterId, judge_version: raterVersion, kind: asKind(req(flags, "rater-kind")) },
        target: { judge_id: targetId, judge_version: targetVersion, kind: asKind(req(flags, "target-kind")) },
        idea_id: req(flags, "idea"),
        output: r.value,
      });
      console.log(out.path);
      break;
    }

    case "reputation": {
      const rows = aggregateRun(store, req(flags, "run"), flags["evaluator"] ?? DEFAULT_EVALUATOR_VERSION);
      for (const row of rows) {
        console.log(`${row.judge_id}@${row.judge_version} rep_score=${row.rep_score} n_meta=${row.n_meta}`);
      }
      console.log(`aggregated ${rows.length} judge version(s)`);
      break;
    }

    case "report": {
      const report = buildReport(store, req(flags, "run"), flags["evaluator"] ?? DEFAULT_EVALUATOR_VERSION);
      const paths = writeReport(store, report);
      console.log(renderReportMarkdown(report));
      console.log(`\nwrote ${paths.htmlPath}`);
      console.log(`wrote ${paths.mdPath}`);
      break;
    }

    case "report:json": {
      const report = buildReport(store, req(flags, "run"), flags["evaluator"] ?? DEFAULT_EVALUATOR_VERSION);
      const json = JSON.stringify(report, null, 2) + "\n";
      const rel = store.writeRunFile(report.run_id, "report.json", json);
      // Keep stdout clean by default (path -> stderr); --stdout emits the JSON.
      if (flags["stdout"] === "true") process.stdout.write(json);
      console.error(`wrote ${rel}`);
      break;
    }

    case "summary:json": {
      const runId = req(flags, "run");
      // Read the run's Phase-1 evaluations (parsed + validated by the Store).
      const evals = store.readEvaluations(runId);
      if (evals.length === 0) fail(`no evaluations found for run ${runId} (runs/${runId}/evaluations/)`);
      // Single-idea panel summary: derive the idea from the evaluations.
      const ideaId = evals[0]!.idea_id;
      const summary = computeIdeaReviewSummary(runId, ideaId, evals);
      const json = JSON.stringify(summary, null, 2) + "\n";
      const rel = store.writeRunFile(runId, "summary.json", json);
      // Keep stdout clean by default (path -> stderr); --stdout emits the JSON.
      if (flags["stdout"] === "true") process.stdout.write(json);
      console.error(`wrote ${rel}`);
      break;
    }

    case "run:init": {
      const evaluator = flags["evaluator"] ?? DEFAULT_EVALUATOR_VERSION;
      const runId = flags["run"] ?? genRunId();
      // Optional subset filters (--judges a,b / --idea x / --ideas x,y). Absent
      // flags keep the full panel; unknown ids fail-closed (see selectSubset).
      const wantJudges = csv(flags["judges"]);
      const wantIdeas = [...csv(flags["idea"]), ...csv(flags["ideas"])];
      const activeJudges = selectSubset(
        store.activeJudges(),
        (p) => p.frontmatter.id,
        wantJudges,
        "judge",
      );
      const activeIdeas = selectSubset(store.listIdeas(), (i) => i.frontmatter.id, wantIdeas, "idea");
      store.upsertEvaluator(evaluator, JSON.stringify({ evaluator }), "judge-me-bro baseline evaluator");
      const judges = activeJudges.map((p) => {
        store.registerJudgeVersion(p.frontmatter, p.path);
        return {
          judge_id: p.frontmatter.id,
          judge_version: p.frontmatter.version,
          kind: p.frontmatter.kind,
          name: p.frontmatter.name ?? p.frontmatter.id,
          persona_path: p.path,
        };
      });
      const ideas = activeIdeas.map((i) => ({
        id: i.frontmatter.id,
        path: i.path,
        title: i.frontmatter.title,
      }));
      const plan = { run_id: runId, evaluator_version: evaluator, judges, ideas };
      store.writeRunFile(runId, "run.json", JSON.stringify(plan, null, 2) + "\n");
      console.log(JSON.stringify(plan, null, 2));
      break;
    }

    default: {
      const usage =
        "judge-me-bro harness — usage: tsx harness/cli.ts <subcommand> [flags]\n" +
        "subcommands: persona:validate persona:put eval:validate eval:persist " +
        "meta:validate meta:persist reputation report report:json summary:json run:init";
      console.log(usage);
      process.exit(cmd ? 2 : 1);
    }
  }
} catch (err) {
  if (err instanceof ZodError) fail(formatZodError(err));
  fail(err instanceof Error ? err.message : String(err));
} finally {
  store.close();
}
