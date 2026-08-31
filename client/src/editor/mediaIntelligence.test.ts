import { describe, expect, it } from "vitest";
import {
  detectFillerWords,
  type WordTimestamp,
} from "./mediaIntelligence";

describe("Media Intelligence & Evidence Extraction", () => {
  it("detects single-word and two-word filler tokens with exact timestamps", () => {
    const words: WordTimestamp[] = [
      { word: "Hello", start: 0.0, end: 0.5 },
      { word: "um", start: 0.6, end: 1.0 },
      { word: "everyone", start: 1.1, end: 1.6 },
      { word: "you", start: 1.7, end: 1.9 },
      { word: "know", start: 1.9, end: 2.2 },
      { word: "today", start: 2.3, end: 2.7 },
    ];

    const fillers = detectFillerWords(words);
    expect(fillers).toHaveLength(2);
    expect(fillers[0]).toEqual({
      text: "um",
      start: 0.6,
      end: 1.0,
      duration: 0.4,
    });
    expect(fillers[1]).toEqual({
      text: "you know",
      start: 1.7,
      end: 2.2,
      duration: 0.5,
    });
  });

  it("does not flag ordinary timestamped speech as filler evidence", () => {
    const words: WordTimestamp[] = [
      { word: "Welcome", start: 0, end: 0.4 },
      { word: "everyone", start: 0.5, end: 1 },
    ];
    expect(detectFillerWords(words)).toEqual([]);
  });
});
