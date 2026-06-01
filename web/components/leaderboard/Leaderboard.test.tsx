import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ReputationReport } from "@/lib/schema";

import { Leaderboard } from "./Leaderboard";

/**
 * A `ReputationReport` with three snapshots deliberately stored OUT of
 * rep_score order. Shape mirrors `runs/seed-001/report.json` (real seeded run)
 * so the fixture stays faithful to the harness output.
 *
 * Stored order: Drew 4.9, Vatsa 7.55, Daniel 6.9
 * Expected ranked order (desc): Vatsa 7.55, Daniel 6.9, Drew 4.9
 */
const report: ReputationReport = {
  run_id: "seed-001",
  evaluator_version: "eval@v1",
  snapshots: [
    {
      name: "Drew Mailen",
      judge: { judge_id: "drew-mailen", judge_version: 1, kind: "judge" },
      rep_score: 4.9,
      n_meta: 2,
      components: { reasoning_quality: 7, calibration: 4.5, insight: 5.5, bias: 4.5 },
    },
    {
      name: "Vatsa Shah",
      judge: { judge_id: "vatsa-shah", judge_version: 1, kind: "judge" },
      rep_score: 7.55,
      n_meta: 2,
      components: { reasoning_quality: 8.5, calibration: 7, insight: 8.5, bias: 2.5 },
    },
    {
      name: "Daniel Merja",
      judge: { judge_id: "daniel-merja", judge_version: 1, kind: "judge" },
      rep_score: 6.9,
      n_meta: 2,
      components: { reasoning_quality: 8, calibration: 6, insight: 8, bias: 2.5 },
    },
  ],
};

describe("Leaderboard", () => {
  it("renders snapshots sorted by rep_score descending", () => {
    render(<Leaderboard report={report} />);

    // Read each judge name node; assert DOM order matches the desc ranking
    // (Vatsa 7.55 → Daniel 6.9 → Drew 4.9), not the stored fixture order.
    const vatsa = screen.getByText("Vatsa Shah");
    const daniel = screen.getByText("Daniel Merja");
    const drew = screen.getByText("Drew Mailen");

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(vatsa, daniel)).toBe(true);
    expect(follows(daniel, drew)).toBe(true);
  });

  it("shows a gold medal on the top (rank 1) row", () => {
    render(<Leaderboard report={report} />);

    // RankMedal renders the medal as role="img" aria-label="Rank N".
    const rank1 = screen.getByRole("img", { name: "Rank 1" });
    expect(rank1).toBeInTheDocument();
    expect(rank1).toHaveTextContent("🥇");
  });

  it("places the highest-rep judge in the rank-1 medal row", () => {
    render(<Leaderboard report={report} />);

    // The rank-1 medal and the top judge's name share a row container.
    const rank1 = screen.getByRole("img", { name: "Rank 1" });
    const row = rank1.closest("div.grid") as HTMLElement;
    expect(row).toBeTruthy();
    expect(within(row).getByText("Vatsa Shah")).toBeInTheDocument();
  });
});
