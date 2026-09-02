import { describe, expect, it } from "vitest";
import { normalizeReviewableSilenceRanges } from "./silence";

describe("reviewable silence evidence", () => {
  it("drops floating-point edge fragments that would display as 0.0 seconds", () => {
    expect(
      normalizeReviewableSilenceRanges([
        { start: 1, end: 1.00001 },
        { start: 3, end: 3.02 },
      ]),
    ).toEqual([]);
  });

  it("merges overlapping evidence before enforcing the review threshold", () => {
    expect(
      normalizeReviewableSilenceRanges([
        { start: 2, end: 2.04 },
        { start: 2.03, end: 2.08 },
        { start: 5, end: 5.25 },
      ]),
    ).toEqual([
      { start: 2, end: 2.08 },
      { start: 5, end: 5.25 },
    ]);
  });
});
