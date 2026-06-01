import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "./store.js";
import type { IdeaEvaluation } from "./schemas.js";

const PERSONA = (id: string, version: number): string => `---
id: ${id}
kind: founder
version: ${version}
source_urls:
  - https://example.com/${id}
distilled_at: 2026-06-01
distilled_by: distiller@v1
domains: [b2b]
values:
  - clear wedge
red_flags:
  - solution in search of a problem
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
Sample persona ${id} v${version}.
`;

const IDEA = `---
id: idea-014
title: Test Idea
one_liner: A one liner
team: [alice, bob]
---
Full pitch body.
`;

let root: string;
let store: Store;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jmb-store-"));
  store = new Store({ root, dbPath: ":memory:" });
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ledger schema", () => {
  it("creates the three ledger tables", () => {
    const names = (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(expect.arrayContaining(["judge_version", "evaluator", "reputation"]));
  });
});

describe("personas", () => {
  it("putPersona writes the file and registers the version; getPersona round-trips", () => {
    const res = store.putPersona(PERSONA("paul-graham", 1));
    expect(res.path).toBe(path.join("personas", "founders", "paul-graham@1.md"));
    expect(fs.existsSync(path.join(root, res.path))).toBe(true);
    expect(store.getPersona("paul-graham", 1)?.frontmatter.id).toBe("paul-graham");
    const jv = store.db.prepare("SELECT * FROM judge_version WHERE judge_id=?").get("paul-graham") as {
      version: number;
      persona_path: string;
    };
    expect(jv.version).toBe(1);
    expect(jv.persona_path).toBe(res.path);
  });

  it("activeJudges returns the highest version per id", () => {
    store.putPersona(PERSONA("paul-graham", 1));
    store.putPersona(PERSONA("paul-graham", 2));
    store.putPersona(PERSONA("jessica", 1));
    const active = store
      .activeJudges()
      .map((p) => `${p.frontmatter.id}@${p.frontmatter.version}`)
      .sort();
    expect(active).toEqual(["jessica@1", "paul-graham@2"]);
  });
});

describe("ideas", () => {
  it("listIdeas + getIdea parse frontmatter", () => {
    fs.mkdirSync(path.join(root, "ideas"), { recursive: true });
    fs.writeFileSync(path.join(root, "ideas", "idea-014.md"), IDEA);
    expect(store.listIdeas()).toHaveLength(1);
    expect(store.getIdea("idea-014")?.frontmatter.title).toBe("Test Idea");
  });
});

describe("run artifacts", () => {
  it("writeEvaluation + readEvaluations round-trip", () => {
    const ev: IdeaEvaluation = {
      run_id: "2026-06-01T18-00Z",
      created_at: "2026-06-01T18:00:00Z",
      evaluator_version: "eval@v1",
      judge: { judge_id: "paul-graham", judge_version: 1, kind: "founder" },
      idea_id: "idea-014",
      scores: { problem: 8, solution: 6, market: 7, team: 5, traction: 3 },
      weighted_total: 6.3,
      output: {
        assessments: {
          problem: { score: 8, reason: "real pain" },
          solution: { score: 6, reason: "unproven" },
          market: { score: 7, reason: "broad" },
          team: { score: 5, reason: "thin" },
          traction: { score: 3, reason: "none" },
        },
        verdict: "borderline",
        confidence: 0.6,
        rationale: "Strong wedge.",
        key_question: "10x?",
        strengths: ["pain"],
        risks: ["incumbents"],
      },
    };
    const rel = store.writeEvaluation(ev);
    expect(rel).toBe(path.join("runs", "2026-06-01T18-00Z", "evaluations", "paul-graham@1--idea-014.json"));
    const back = store.readEvaluations("2026-06-01T18-00Z");
    expect(back).toHaveLength(1);
    expect(back[0]?.weighted_total).toBe(6.3);
  });
});

describe("reputation ledger (append-only)", () => {
  const mkRow = (version: number, rep: number) => ({
    judge_id: "paul-graham",
    judge_version: version,
    evaluator_version: "eval@v1",
    run_id: `run-${version}`,
    rep_score: rep,
    n_meta: 12,
    components_json: JSON.stringify({ reasoning_quality: 8, calibration: 7, insight: 8, bias: 3 }),
  });

  it("appends rows without mutating prior ones, and queries them in order", () => {
    store.appendReputation(mkRow(1, 7.1));
    store.appendReputation(mkRow(2, 8.4));
    const rows = store.queryReputation({ judge_id: "paul-graham" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.rep_score)).toEqual([7.1, 8.4]);
  });

  it("previousRepScore finds the prior version under the same evaluator", () => {
    store.appendReputation(mkRow(1, 7.1));
    store.appendReputation(mkRow(2, 8.4));
    expect(store.previousRepScore("paul-graham", 2, "eval@v1")).toBe(7.1);
    expect(store.previousRepScore("paul-graham", 1, "eval@v1")).toBeNull();
  });
});
