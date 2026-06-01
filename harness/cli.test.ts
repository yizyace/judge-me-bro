import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("harness/cli.ts");

function cli(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const PERSONA = `---
id: test-judge
kind: judge
version: 1
name: Test Judge
source_urls:
  - https://example.com/test
distilled_at: 2026-06-01
distilled_by: distiller@v1
domains: [devtools]
values:
  - clear wedge
red_flags:
  - no traction
rubric_weights:
  problem: 0.2
  solution: 0.3
  market: 0.2
  team: 0.2
  traction: 0.1
voice: terse
calibration_notes: rewards depth
---
## Background
Test persona.
`;

const PERSONA_2 = `---
id: other-judge
kind: founder
version: 1
name: Other Judge
source_urls:
  - https://example.com/other
distilled_at: 2026-06-01
distilled_by: distiller@v1
domains: [b2b]
values:
  - clear wedge
red_flags:
  - no traction
rubric_weights:
  problem: 0.3
  solution: 0.2
  market: 0.2
  team: 0.2
  traction: 0.1
voice: terse
calibration_notes: discounts demos
---
## Background
Other persona.
`;

const PERSONA_3 = `---
id: third-judge
kind: judge
version: 1
name: Third Judge
source_urls:
  - https://example.com/third
distilled_at: 2026-06-01
distilled_by: distiller@v1
domains: [fintech]
values:
  - clear wedge
red_flags:
  - no traction
rubric_weights:
  problem: 0.2
  solution: 0.2
  market: 0.2
  team: 0.2
  traction: 0.2
voice: terse
calibration_notes: rewards proof
---
## Background
Third persona.
`;

const IDEA = `---
id: idea-001
title: Test Idea
one_liner: One liner
team: [alice]
---
Pitch covering problem, solution, market, team, traction.
`;

const IDEA_2 = `---
id: idea-002
title: Second Idea
one_liner: Another one liner
team: [bob]
---
Another pitch covering problem, solution, market, team, traction.
`;

const RAW_OK = JSON.stringify({
  assessments: {
    problem: { score: 8, reason: "real" },
    solution: { score: 6, reason: "ok" },
    market: { score: 7, reason: "broad" },
    team: { score: 5, reason: "thin" },
    traction: { score: 3, reason: "none" },
  },
  verdict: "borderline",
  confidence: 0.6,
  rationale: "Strong wedge, weak proof.",
  key_question: "10x?",
  strengths: ["pain"],
  risks: ["incumbents"],
});

const badObj = JSON.parse(RAW_OK);
badObj.assessments.problem.score = 99; // out of range -> must fail validation
const RAW_BAD = JSON.stringify(badObj);

/** Build a Phase-1 raw output with uniform scores + the given verdict/lists. */
function rawEval(opts: {
  score: number;
  verdict: "advance" | "borderline" | "pass";
  strengths: string[];
  risks: string[];
  key_question: string;
}): string {
  const a = { score: opts.score, reason: "uniform score for a deterministic mean" };
  return JSON.stringify({
    assessments: { problem: a, solution: a, market: a, team: a, traction: a },
    verdict: opts.verdict,
    confidence: 0.7,
    rationale: "Deterministic fixture evaluation.",
    key_question: opts.key_question,
    strengths: opts.strengths,
    risks: opts.risks,
  });
}

// Three judges, all on idea-001. Uniform per-judge scores keep the weighted
// total = the score regardless of weights (Σ weight = 1), so means are exact.
// Verdicts: advance, advance, borderline -> majority "advance"; scores 8,8,5 ->
// mean 7.00. Strengths/risks overlap to exercise pooling + frequency ranking.
const RAW_J1 = rawEval({
  score: 8,
  verdict: "advance",
  strengths: ["Sharp wedge", "Fast team"],
  risks: ["Incumbents"],
  key_question: "What is the moat?",
});
const RAW_J2 = rawEval({
  score: 8,
  verdict: "advance",
  strengths: ["sharp wedge", "Clear demand"],
  risks: ["incumbents", "Thin moat"],
  key_question: "How do you reach buyers?",
});
const RAW_J3 = rawEval({
  score: 5,
  verdict: "borderline",
  strengths: ["Sharp Wedge"],
  risks: ["Regulatory risk"],
  key_question: "What about churn?",
});

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jmb-cli-"));
  fs.mkdirSync(path.join(root, "ideas"), { recursive: true });
  fs.writeFileSync(path.join(root, "ideas", "idea-001.md"), IDEA);
  fs.writeFileSync(path.join(root, "ideas", "idea-002.md"), IDEA_2);
  fs.writeFileSync(path.join(root, "persona.md"), PERSONA);
  fs.writeFileSync(path.join(root, "persona-2.md"), PERSONA_2);
  fs.writeFileSync(path.join(root, "persona-3.md"), PERSONA_3);
  fs.writeFileSync(path.join(root, "raw-ok.json"), RAW_OK);
  fs.writeFileSync(path.join(root, "raw-bad.json"), RAW_BAD);
  fs.writeFileSync(path.join(root, "raw-j1.json"), RAW_J1);
  fs.writeFileSync(path.join(root, "raw-j2.json"), RAW_J2);
  fs.writeFileSync(path.join(root, "raw-j3.json"), RAW_J3);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("harness CLI (subprocess)", () => {
  it("persona:put installs a valid persona; persona:validate rejects a bad one", () => {
    const put = cli(["persona:put", "--raw", "persona.md"], root);
    expect(put.code).toBe(0);
    expect(put.stdout.trim()).toBe(path.join("personas", "judges", "test-judge@1.md"));
    expect(fs.existsSync(path.join(root, "personas/judges/test-judge@1.md"))).toBe(true);

    fs.writeFileSync(path.join(root, "bad.md"), PERSONA.replace("problem: 0.2", "problem: 0.9"));
    const val = cli(["persona:validate", "--raw", "bad.md"], root);
    expect(val.code).not.toBe(0);
    expect(val.stderr).toMatch(/rubric_weights|sum/i);
  }, 30000);

  it("eval:persist writes a valid evaluation and fail-closes on invalid output", () => {
    cli(["persona:put", "--raw", "persona.md"], root);

    const ok = cli(
      [
        "eval:persist", "--run", "2026-06-01T18-00Z", "--evaluator", "eval@v1",
        "--judge-id", "test-judge", "--judge-version", "1", "--kind", "judge",
        "--idea", "idea-001", "--raw", "raw-ok.json",
      ],
      root,
    );
    expect(ok.code).toBe(0);
    const expected = path.join("runs", "2026-06-01T18-00Z", "evaluations", "test-judge@1--idea-001.json");
    expect(ok.stdout.trim()).toBe(expected);
    const written = JSON.parse(fs.readFileSync(path.join(root, expected), "utf8"));
    // harness-computed: 8*.2 + 6*.3 + 7*.2 + 5*.2 + 3*.1 = 6.1
    expect(written.weighted_total).toBeCloseTo(6.1, 5);

    const bad = cli(
      [
        "eval:persist", "--run", "r2", "--judge-id", "test-judge", "--judge-version", "1",
        "--kind", "judge", "--idea", "idea-001", "--raw", "raw-bad.json",
      ],
      root,
    );
    expect(bad.code).not.toBe(0);
    expect(fs.existsSync(path.join(root, "runs", "r2"))).toBe(false); // fail-closed
  }, 30000);

  it("run:init lists active judges and ideas as JSON", () => {
    cli(["persona:put", "--raw", "persona.md"], root);
    const res = cli(["run:init", "--evaluator", "eval@v1"], root);
    expect(res.code).toBe(0);
    const plan = JSON.parse(res.stdout);
    expect(plan.evaluator_version).toBe("eval@v1");
    expect(plan.judges.map((j: { judge_id: string }) => j.judge_id)).toContain("test-judge");
    expect(plan.ideas.map((i: { id: string }) => i.id)).toContain("idea-001");
  }, 30000);

  it("run:init --judges/--idea scopes the plan to the chosen subset", () => {
    cli(["persona:put", "--raw", "persona.md"], root);
    cli(["persona:put", "--raw", "persona-2.md"], root);
    const res = cli(
      ["run:init", "--run", "scoped", "--judges", "test-judge", "--idea", "idea-001"],
      root,
    );
    expect(res.code).toBe(0);
    const plan = JSON.parse(res.stdout);
    // Only the requested judge + idea survive the intersection.
    expect(plan.judges.map((j: { judge_id: string }) => j.judge_id)).toEqual(["test-judge"]);
    expect(plan.ideas.map((i: { id: string }) => i.id)).toEqual(["idea-001"]);

    // The persisted run.json matches the scoped plan.
    const written = JSON.parse(
      fs.readFileSync(path.join(root, "runs", "scoped", "run.json"), "utf8"),
    );
    expect(written.judges.map((j: { judge_id: string }) => j.judge_id)).toEqual(["test-judge"]);
    expect(written.ideas.map((i: { id: string }) => i.id)).toEqual(["idea-001"]);
  }, 30000);

  it("run:init --ideas accepts a comma-separated subset", () => {
    cli(["persona:put", "--raw", "persona.md"], root);
    const res = cli(["run:init", "--run", "two-ideas", "--ideas", "idea-001,idea-002"], root);
    expect(res.code).toBe(0);
    const plan = JSON.parse(res.stdout);
    expect(plan.ideas.map((i: { id: string }) => i.id).sort()).toEqual(["idea-001", "idea-002"]);
  }, 30000);

  it("run:init fails closed on an unknown judge id (writes nothing)", () => {
    cli(["persona:put", "--raw", "persona.md"], root);
    const res = cli(["run:init", "--run", "bad-judge", "--judges", "nope"], root);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/unknown judge id/i);
    expect(fs.existsSync(path.join(root, "runs", "bad-judge"))).toBe(false);
  }, 30000);

  it("run:init fails closed on an unknown idea id (writes nothing)", () => {
    cli(["persona:put", "--raw", "persona.md"], root);
    const res = cli(["run:init", "--run", "bad-idea", "--idea", "idea-999"], root);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/unknown idea id/i);
    expect(fs.existsSync(path.join(root, "runs", "bad-idea"))).toBe(false);
  }, 30000);

  it("report:json writes a valid ReputationReport to runs/<id>/report.json", () => {
    const runId = "report-run";
    const res = cli(["report:json", "--run", runId], root);
    expect(res.code).toBe(0);
    // stdout stays clean; the written path goes to stderr.
    expect(res.stdout.trim()).toBe("");
    const rel = path.join("runs", runId, "report.json");
    expect(res.stderr).toContain(rel);
    const report = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    expect(report.run_id).toBe(runId);
    expect(report.evaluator_version).toBe("eval@v1");
    expect(Array.isArray(report.snapshots)).toBe(true);
  }, 30000);

  it("report:json --stdout prints the report JSON to stdout", () => {
    const runId = "report-stdout";
    const res = cli(["report:json", "--run", runId, "--stdout"], root);
    expect(res.code).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.run_id).toBe(runId);
    expect(Array.isArray(report.snapshots)).toBe(true);
  }, 30000);

  it("summary:json aggregates a run's evaluations into one IdeaReviewSummary", () => {
    const runId = "summary-run";
    // Install three judges and persist one Phase-1 evaluation each on idea-001.
    cli(["persona:put", "--raw", "persona.md"], root);
    cli(["persona:put", "--raw", "persona-2.md"], root);
    cli(["persona:put", "--raw", "persona-3.md"], root);
    const persist = (judgeId: string, kind: string, raw: string) =>
      cli(
        [
          "eval:persist", "--run", runId, "--evaluator", "eval@v1",
          "--judge-id", judgeId, "--judge-version", "1", "--kind", kind,
          "--idea", "idea-001", "--raw", raw,
        ],
        root,
      );
    expect(persist("test-judge", "judge", "raw-j1.json").code).toBe(0);
    expect(persist("other-judge", "founder", "raw-j2.json").code).toBe(0);
    expect(persist("third-judge", "judge", "raw-j3.json").code).toBe(0);

    // Default run: stdout stays clean; the written path goes to stderr.
    const res = cli(["summary:json", "--run", runId], root);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe("");
    const rel = path.join("runs", runId, "summary.json");
    expect(res.stderr).toContain(rel);

    const summary = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    expect(summary.run_id).toBe(runId);
    expect(summary.idea_id).toBe("idea-001");
    expect(summary.n_judges).toBe(3);
    // Verdicts advance, advance, borderline -> majority advance.
    expect(summary.verdict_counts).toEqual({ advance: 2, borderline: 1, pass: 0 });
    expect(summary.consensus_verdict).toBe("advance");
    // Uniform per-judge scores 8,8,5 (Σ weight = 1) -> mean 7.00 on every axis.
    expect(summary.mean_weighted_total).toBeCloseTo(7.0, 5);
    for (const c of ["problem", "solution", "market", "team", "traction"]) {
      expect(summary.mean_scores[c]).toBeCloseTo(7.0, 5);
    }
    // "sharp wedge" appears in all three (case-insensitive) -> most-frequent,
    // ranked first. Display casing is the first-seen occurrence: evaluations are
    // read in filename order (other-, test-, third-judge), so other-judge's
    // lowercase "sharp wedge" wins.
    expect(summary.top_strengths[0]).toBe("sharp wedge");
    expect(summary.top_strengths.length).toBeLessThanOrEqual(5);
    // Deduped case-insensitively: no two entries share a lowercased form.
    const lowered = summary.top_strengths.map((s: string) => s.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
    // "incumbents" appears twice -> ranked first among risks (first-seen casing).
    expect(summary.top_risks[0]).toBe("incumbents");
    // One key question per judge.
    expect(summary.key_questions).toHaveLength(3);
    // Templated narrative reflects the consensus + counts + mean + top strength.
    expect(summary.narrative).toContain("advance");
    expect(summary.narrative).toContain("7.00/10");
    expect(summary.narrative).toContain("sharp wedge");
  }, 30000);

  it("summary:json --stdout prints the summary; fails closed on an empty run", () => {
    const runId = "summary-stdout";
    cli(["persona:put", "--raw", "persona.md"], root);
    cli(
      [
        "eval:persist", "--run", runId, "--evaluator", "eval@v1",
        "--judge-id", "test-judge", "--judge-version", "1", "--kind", "judge",
        "--idea", "idea-001", "--raw", "raw-ok.json",
      ],
      root,
    );
    const res = cli(["summary:json", "--run", runId, "--stdout"], root);
    expect(res.code).toBe(0);
    const summary = JSON.parse(res.stdout);
    expect(summary.run_id).toBe(runId);
    expect(summary.n_judges).toBe(1);

    // A run with no evaluations fails closed (writes nothing).
    const empty = cli(["summary:json", "--run", "no-evals"], root);
    expect(empty.code).not.toBe(0);
    expect(empty.stderr).toMatch(/no evaluations/i);
    expect(fs.existsSync(path.join(root, "runs", "no-evals", "summary.json"))).toBe(false);
  }, 30000);
});
