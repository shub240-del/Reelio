import { describe, expect, it } from "vitest";
import {
  detectFillerWords,
  generateSpeechSegments,
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

  it("partitions audio duration into speech windows around silence ranges", () => {
    const silenceRanges = [
      { start: 5.0, end: 8.0 },
      { start: 15.0, end: 18.0 },
    ];

    const segments = generateSpeechSegments(25.0, "test-video.mp4", silenceRanges);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    // First segment should end near 5.0s
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBeLessThanOrEqual(5.0);

    // All words must have valid sequential timestamps
    for (const seg of segments) {
      expect(seg.words.length).toBeGreaterThan(0);
      for (let i = 1; i < seg.words.length; i++) {
        expect(seg.words[i].start).toBeGreaterThanOrEqual(seg.words[i - 1].start);
      }
    }
  });

  it("handles zero or negative duration gracefully", () => {
    expect(generateSpeechSegments(0, "empty.mp4")).toEqual([]);
    expect(generateSpeechSegments(-5, "empty.mp4")).toEqual([]);
  });
});
