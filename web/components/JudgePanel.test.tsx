import { useState } from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JudgePanel, type Judge, DEFAULT_JUDGE_IDS, MAX_JUDGES } from "./JudgePanel";

/** Build a minimal but schema-shaped judge directory entry. */
function judge(id: string, name: string, kind = "judge"): Judge {
  return {
    judge_id: id,
    judge_version: 1,
    kind,
    name,
    domains: ["ai"],
    values: ["clarity"],
    voice: `${name} sounds like this.`,
    rubric_weights: { problem: 0.2, solution: 0.2, market: 0.2, team: 0.2, traction: 0.2 },
  };
}

// ~8 judges including the three canonical hackathon ids.
const DIRECTORY: Judge[] = [
  judge("vatsa-shah", "Vatsa Shah"),
  judge("daniel-merja", "Daniel Merja"),
  judge("drew-mailen", "Drew Mailen"),
  judge("paul-graham", "Paul Graham", "founder"),
  judge("elad-gil", "Elad Gil", "founder"),
  judge("sam-altman", "Sam Altman", "founder"),
  judge("naval-ravikant", "Naval Ravikant", "founder"),
  judge("patrick-collison", "Patrick Collison", "founder"),
];

/** Controlled wrapper: JudgePanel owns no selection state, so the test does. */
function Harness({ onChange }: { onChange?: (ids: string[]) => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  return (
    <JudgePanel
      selectedIds={selectedIds}
      onChange={(ids) => {
        setSelectedIds(ids);
        onChange?.(ids);
      }}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/judges")) {
        return new Response(JSON.stringify(DIRECTORY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JudgePanel", () => {
  it("preselects exactly the three canonical hackathon judges", async () => {
    render(<Harness />);

    // After the directory loads, the three defaults appear as removable chips.
    await waitFor(() => {
      for (const id of DEFAULT_JUDGE_IDS) {
        const name = DIRECTORY.find((j) => j.judge_id === id)!.name;
        expect(screen.getByRole("button", { name: `Remove ${name}` })).toBeInTheDocument();
      }
    });

    // The counter reflects exactly three selected.
    expect(screen.getByText(`3/${MAX_JUDGES}`)).toBeInTheDocument();

    // And no OTHER judge is preselected (no extra remove buttons).
    const removeButtons = screen.getAllByRole("button", { name: /^Remove / });
    expect(removeButtons).toHaveLength(DEFAULT_JUDGE_IDS.length);
    expect(DEFAULT_JUDGE_IDS).toEqual(["vatsa-shah", "daniel-merja", "drew-mailen"]);
  });

  it("disables the add controls once the cap of 5 is reached", async () => {
    render(<Harness />);

    // Start: 3 preselected.
    await screen.findByRole("button", { name: "Remove Vatsa Shah" });
    expect(screen.getByText(`3/${MAX_JUDGES}`)).toBeInTheDocument();

    // Add controls are enabled while under the cap.
    const addPaul = screen.getByRole("button", { name: /Paul Graham/ });
    expect(addPaul).toBeEnabled();

    // Add two more → 5 total, hitting MAX_JUDGES.
    fireEvent.click(addPaul);
    await screen.findByRole("button", { name: "Remove Paul Graham" });
    fireEvent.click(screen.getByRole("button", { name: /Elad Gil/ }));
    await screen.findByRole("button", { name: "Remove Elad Gil" });

    expect(screen.getByText(`5/${MAX_JUDGES}`)).toBeInTheDocument();

    // Every remaining directory add-button is now disabled (cannot exceed 5).
    const stillAvailable = ["Sam Altman", "Naval Ravikant", "Patrick Collison"];
    for (const name of stillAvailable) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeDisabled();
    }
  });

  it("cannot exceed 5 even when an add is attempted at the cap", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await screen.findByRole("button", { name: "Remove Vatsa Shah" });

    // Fill to the cap (3 preselected + 2).
    fireEvent.click(screen.getByRole("button", { name: /Paul Graham/ }));
    await screen.findByRole("button", { name: "Remove Paul Graham" });
    fireEvent.click(screen.getByRole("button", { name: /Elad Gil/ }));
    await screen.findByRole("button", { name: "Remove Elad Gil" });
    expect(screen.getByText(`5/${MAX_JUDGES}`)).toBeInTheDocument();

    // A disabled button won't fire onClick; force the attempt anyway and assert
    // selection never grows past the cap.
    const sam = screen.getByRole("button", { name: /Sam Altman/ });
    fireEvent.click(sam);
    expect(screen.getByText(`5/${MAX_JUDGES}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Sam Altman" })).not.toBeInTheDocument();

    // No onChange call ever produced a selection longer than MAX_JUDGES.
    for (const call of onChange.mock.calls) {
      const ids = call[0] as string[];
      expect(ids.length).toBeLessThanOrEqual(MAX_JUDGES);
    }
  });
});
