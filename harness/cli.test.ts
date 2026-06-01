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

const IDEA = `---
id: idea-001
title: Test Idea
one_liner: One liner
team: [alice]
---
Pitch covering problem, solution, market, team, traction.
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

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jmb-cli-"));
  fs.mkdirSync(path.join(root, "ideas"), { recursive: true });
  fs.writeFileSync(path.join(root, "ideas", "idea-001.md"), IDEA);
  fs.writeFileSync(path.join(root, "persona.md"), PERSONA);
  fs.writeFileSync(path.join(root, "raw-ok.json"), RAW_OK);
  fs.writeFileSync(path.join(root, "raw-bad.json"), RAW_BAD);
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
});
