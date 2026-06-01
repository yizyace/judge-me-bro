import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  titleCase,
  buildReport,
  renderLeaderboardHtml,
  renderReportMarkdown,
  writeReport,
} from "./report.js";
import { Store } from "./store.js";
import type { ReputationReport, ReputationComponents } from "./schemas.js";

const RUN = "2026-06-01T18-00Z";
const EVAL = "eval@v1";

const COMPONENTS: ReputationComponents = {
  reasoning_quality: 8.7,
  calibration: 8.1,
  insight: 9.0,
  bias: 2.4,
};

const PERSONA = (id: string, version: number, name: string): string => `---
id: ${id}
kind: founder
version: ${version}
name: ${name}
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
Sample ${name}.
`;

/** Append a reputation row directly (bypasses aggregation; for seeding history). */
function seedRep(
  store: Store,
  judgeId: string,
  version: number,
  repScore: number,
  runId: string,
): void {
  store.appendReputation({
    judge_id: judgeId,
    judge_version: version,
    evaluator_version: EVAL,
    run_id: runId,
    rep_score: repScore,
    n_meta: 12,
    components_json: JSON.stringify(COMPONENTS),
  });
}

let root: string;
let store: Store;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jmb-report-"));
  store = new Store({ root, dbPath: ":memory:" });
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("titleCase", () => {
  it("title-cases a kebab slug", () => {
    expect(titleCase("paul-graham")).toBe("Paul Graham");
    expect(titleCase("jessica-livingston")).toBe("Jessica Livingston");
    expect(titleCase("dana")).toBe("Dana");
  });
});

describe("buildReport (reputation.md §3.2)", () => {
  it("uses the persona display name when a persona exists", () => {
    store.putPersona(PERSONA("paul-graham", 3, "Paul Graham"));
    seedRep(store, "paul-graham", 3, 8.4, RUN);
    const report = buildReport(store, RUN, EVAL);
    expect(report.snapshots).toHaveLength(1);
    expect(report.snapshots[0]?.name).toBe("Paul Graham");
    expect(report.snapshots[0]?.judge.kind).toBe("founder");
  });

  it("falls back to a title-cased id when no persona exists", () => {
    seedRep(store, "marcus-liang", 1, 6.6, RUN);
    const report = buildReport(store, RUN, EVAL);
    expect(report.snapshots[0]?.name).toBe("Marcus Liang");
    // No persona and no judge_version row -> default kind "judge".
    expect(report.snapshots[0]?.judge.kind).toBe("judge");
  });

  it("derives kind from the judge_version table when only that is registered", () => {
    // Registering a persona also registers judge_version; remove the file after
    // to simulate a ledger-only judge (persona missing, judge_version present).
    const p = store.putPersona(PERSONA("dana-reyes", 1, "Dana Reyes"));
    fs.rmSync(path.join(root, p.path));
    seedRep(store, "dana-reyes", 1, 7.3, RUN);
    const report = buildReport(store, RUN, EVAL);
    // No persona file now -> name falls back to title-cased id; kind from table.
    expect(report.snapshots[0]?.name).toBe("Dana Reyes");
    expect(report.snapshots[0]?.judge.kind).toBe("founder");
  });

  it("attaches prev_rep_score from the prior version under the same evaluator", () => {
    seedRep(store, "paul-graham", 2, 6.4, "run-prev"); // predecessor
    seedRep(store, "paul-graham", 3, 7.0, RUN); // current run
    const report = buildReport(store, RUN, EVAL);
    const snap = report.snapshots.find((s) => s.judge.judge_version === 3);
    expect(snap?.prev_rep_score).toBe(6.4);
  });

  it("omits prev_rep_score for a judge's first version", () => {
    seedRep(store, "priya-anand", 1, 5.8, RUN);
    const report = buildReport(store, RUN, EVAL);
    expect(report.snapshots[0]).not.toHaveProperty("prev_rep_score");
  });

  it("parses components_json into the components object", () => {
    seedRep(store, "paul-graham", 3, 8.4, RUN);
    const report = buildReport(store, RUN, EVAL);
    expect(report.snapshots[0]?.components).toEqual(COMPONENTS);
  });

  it("only includes rows for the requested run + evaluator", () => {
    seedRep(store, "paul-graham", 3, 8.4, RUN);
    seedRep(store, "marcus-liang", 1, 6.6, "other-run");
    const report = buildReport(store, RUN, EVAL);
    expect(report.snapshots).toHaveLength(1);
    expect(report.snapshots[0]?.judge.judge_id).toBe("paul-graham");
  });
});

describe("renderLeaderboardHtml", () => {
  function sampleReport(): ReputationReport {
    store.putPersona(PERSONA("paul-graham", 3, "Paul Graham"));
    seedRep(store, "paul-graham", 3, 8.4, RUN);
    return buildReport(store, RUN, EVAL);
  }

  it("injects valid JSON between the markers; output contains run_id + judge name", () => {
    const html = renderLeaderboardHtml(sampleReport());
    expect(html).toContain("/* DATA:START */");
    expect(html).toContain("/* DATA:END */");
    expect(html).toContain(RUN);
    expect(html).toContain("Paul Graham");

    // The injected DATA block must parse as JSON equal to the report.
    const start = html.indexOf("/* DATA:START */") + "/* DATA:START */".length;
    const end = html.indexOf("/* DATA:END */");
    const block = html.slice(start, end);
    const jsonText = block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonText) as ReputationReport;
    expect(parsed.run_id).toBe(RUN);
    expect(parsed.snapshots[0]?.name).toBe("Paul Graham");
  });

  it("keeps a single DATA block (the sample default is replaced, not duplicated)", () => {
    const html = renderLeaderboardHtml(sampleReport());
    const occurrences = html.split("const DATA =").length - 1;
    expect(occurrences).toBe(1);
  });

  it("throws when the template lacks the markers", () => {
    const bad = path.join(root, "no-markers.html");
    fs.writeFileSync(bad, "<html><script>const DATA = {};</script></html>");
    expect(() => renderLeaderboardHtml(sampleReport(), bad)).toThrow(/marker/i);
  });
});

describe("renderReportMarkdown", () => {
  it("renders a leaderboard sorted by rep_score with rank, kind, version, delta", () => {
    store.putPersona(PERSONA("paul-graham", 3, "Paul Graham"));
    seedRep(store, "paul-graham", 2, 6.4, "run-prev");
    seedRep(store, "paul-graham", 3, 8.4, RUN);
    seedRep(store, "priya-anand", 1, 5.8, RUN);
    const md = renderReportMarkdown(buildReport(store, RUN, EVAL));

    expect(md).toContain("# Judge Me Bro");
    expect(md).toContain(`\`${RUN}\``);
    expect(md).toContain("| Rank | Name |");
    // Higher rep_score (Paul Graham 8.4) sorts above Priya (5.8).
    const pgIdx = md.indexOf("Paul Graham");
    const priyaIdx = md.indexOf("Priya Anand");
    expect(pgIdx).toBeGreaterThan(-1);
    expect(priyaIdx).toBeGreaterThan(-1);
    expect(pgIdx).toBeLessThan(priyaIdx);
    // Delta badge for the improved v3 (8.4 - 6.4 = +2.0).
    expect(md).toContain("▲ +2.0");
    // First-version judge has no predecessor.
    expect(md).toContain("v1");
  });
});

describe("writeReport", () => {
  it("writes leaderboard.html and report.md under runs/<run_id>/ and returns both paths", () => {
    store.putPersona(PERSONA("paul-graham", 3, "Paul Graham"));
    seedRep(store, "paul-graham", 3, 8.4, RUN);
    const report = buildReport(store, RUN, EVAL);
    const { htmlPath, mdPath } = writeReport(store, report);

    expect(htmlPath).toBe(path.join("runs", RUN, "leaderboard.html"));
    expect(mdPath).toBe(path.join("runs", RUN, "report.md"));
    expect(fs.existsSync(path.join(root, htmlPath))).toBe(true);
    expect(fs.existsSync(path.join(root, mdPath))).toBe(true);

    const html = fs.readFileSync(path.join(root, htmlPath), "utf8");
    expect(html).toContain("/* DATA:START */");
    expect(html).toContain(RUN);
    const md = fs.readFileSync(path.join(root, mdPath), "utf8");
    expect(md).toContain("Paul Graham");
  });
});
