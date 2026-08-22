import { describe, expect, it } from "vitest";
import { planEditorRequest } from "./ai";

describe("editor AI planner", () => {
  it("returns a validated removeRanges operation for the required command", () => {
    const plan = planEditorRequest("Remove the first 5 seconds.", []);
    expect(plan.operations).toEqual([
      expect.objectContaining({
        type: "removeRanges",
        ranges: [{ start: 0, end: 5 }],
      }),
    ]);
  });

  it("does not invent a timeline mutation for unsupported requests", () => {
    const plan = planEditorRequest("Make it cinematic.", []);
    expect(plan.operations).toEqual([]);
  });
});
