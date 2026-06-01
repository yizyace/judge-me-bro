import { useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdeaSelect, type Idea, DEFAULT_IDEA_ID } from "./IdeaSelect";

const IDEAS: Idea[] = [
  { id: "idea-000", title: "Zeroth Idea", one_liner: "first in list", team: ["A"] },
  { id: "idea-001", title: "Canonical Idea", one_liner: "the default", team: ["B", "C"] },
  { id: "idea-002", title: "Other Idea", one_liner: "another one", team: [] },
];

/** Controlled wrapper holding the selected idea id (IdeaSelect is controlled). */
function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <IdeaSelect
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/ideas")) {
        return new Response(JSON.stringify(IDEAS), {
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

describe("IdeaSelect", () => {
  it("defaults the selection to idea-001 once the catalog loads", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // The component should default to idea-001, NOT the first list entry.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(DEFAULT_IDEA_ID));
    expect(DEFAULT_IDEA_ID).toBe("idea-001");

    // The <select> reflects idea-001 and its one-liner shows as helper text.
    const select = screen.getByLabelText("Idea") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("idea-001"));
    expect(screen.getByText("the default", { exact: false })).toBeInTheDocument();
  });
});
