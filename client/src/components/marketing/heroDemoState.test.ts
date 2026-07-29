import { describe, expect, it } from "vitest";
import {
  CYCLE_MS,
  COLLAPSE_MS,
  HOLD_MS,
  SCAN_MS,
  demoState,
  formatClock,
  phaseAt,
} from "./heroDemoState";

// Mirrors the component's real numbers: 12:40 of footage, ~24% dead air.
const TOTAL = 760;
const KEPT = 0.7618;

describe("formatClock", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(579)).toBe("9:39");
    expect(formatClock(760)).toBe("12:40");
  });

  it("never renders a negative clock", () => {
    expect(formatClock(-5)).toBe("0:00");
  });

  it("rounds rather than truncates, so it cannot disagree with rounded math", () => {
    // Math.floor(15.6) would render 0:15 while the arithmetic used 16.
    expect(formatClock(15.6)).toBe("0:16");
  });
});

describe("phaseAt", () => {
  it("sweeps the scan across the scan window without collapsing", () => {
    expect(phaseAt(0)).toEqual({ scan: 0, collapse: 0 });
    expect(phaseAt(SCAN_MS / 2).scan).toBeCloseTo(0.5, 5);
    expect(phaseAt(SCAN_MS / 2).collapse).toBe(0);
  });

  it("holds the finished scan before cutting anything", () => {
    const p = phaseAt(SCAN_MS + HOLD_MS / 2);
    expect(p.scan).toBe(1);
    expect(p.collapse).toBe(0);
  });

  it("eases the collapse to fully cut", () => {
    const mid = phaseAt(SCAN_MS + HOLD_MS + COLLAPSE_MS / 2);
    expect(mid.collapse).toBeGreaterThan(0);
    expect(mid.collapse).toBeLessThan(1);
    expect(phaseAt(SCAN_MS + HOLD_MS + COLLAPSE_MS).collapse).toBe(1);
  });

  it("settles fully cut and loops", () => {
    expect(phaseAt(CYCLE_MS - 1)).toEqual({ scan: 1, collapse: 1 });
    expect(phaseAt(CYCLE_MS)).toEqual({ scan: 0, collapse: 0 });
  });

  it("stays in range for negative elapsed time", () => {
    const p = phaseAt(-1);
    expect(p.scan).toBeGreaterThanOrEqual(0);
    expect(p.collapse).toBeGreaterThanOrEqual(0);
  });
});

describe("demoState honesty", () => {
  it("claims nothing removed while still scanning", () => {
    const s = demoState({ scan: 0.5, collapse: 0 }, TOTAL, KEPT);
    expect(s.stage).toBe("scanning");
    expect(s.cutSeconds).toBe(0);
    expect(s.remaining).toBe(TOTAL);
  });

  it("reports spans found — not cut — during the hold", () => {
    const s = demoState({ scan: 1, collapse: 0 }, TOTAL, KEPT);
    expect(s.stage).toBe("found");
    // Regression: copy once read "Removed 50 spans" and "0:00 cut" together.
    expect(s.cutSeconds).toBe(0);
    expect(s.targetCutSeconds).toBeGreaterThan(0);
  });

  it("reports a cut only once the collapse is visibly underway", () => {
    expect(demoState({ scan: 1, collapse: 0.5 }, TOTAL, KEPT).stage).toBe("cutting");
    expect(demoState({ scan: 1, collapse: 1 }, TOTAL, KEPT).stage).toBe("cutting");
  });

  it("never announces a cut before the visual shows one", () => {
    // Any stage claiming "cut" must have a non-zero collapse behind it.
    for (let t = 0; t <= CYCLE_MS; t += 25) {
      const phase = phaseAt(t);
      const s = demoState(phase, TOTAL, KEPT);
      if (s.stage === "cutting") expect(phase.collapse).toBeGreaterThan(0);
      if (phase.collapse === 0) expect(s.cutSeconds).toBe(0);
    }
  });
});

describe("demoState arithmetic reconciles", () => {
  it("keeps remaining + cut exactly equal to the total in every frame", () => {
    // Regression: independent floats rendered "12:40 -> 12:24" with "0:15 cut".
    for (let t = 0; t <= CYCLE_MS * 2; t += 10) {
      const s = demoState(phaseAt(t), TOTAL, KEPT);
      expect(s.cutSeconds + s.remaining).toBe(TOTAL);
    }
  });

  it("keeps the RENDERED clocks reconciling, not just the raw numbers", () => {
    const parse = (c: string) => {
      const [m, s] = c.split(":").map(Number);
      return m * 60 + s;
    };
    for (let t = 0; t <= CYCLE_MS; t += 10) {
      const s = demoState(phaseAt(t), TOTAL, KEPT);
      expect(parse(formatClock(s.remaining)) + parse(formatClock(s.cutSeconds))).toBe(TOTAL);
    }
  });

  it("reaches exactly the advertised cut when the pass completes", () => {
    const s = demoState({ scan: 1, collapse: 1 }, TOTAL, KEPT);
    expect(s.cutSeconds).toBe(s.targetCutSeconds);
  });

  it("produces whole seconds so no clock is ever mid-second", () => {
    const s = demoState({ scan: 1, collapse: 0.37 }, TOTAL, KEPT);
    expect(Number.isInteger(s.cutSeconds)).toBe(true);
    expect(Number.isInteger(s.remaining)).toBe(true);
  });

  it("never exceeds the total or goes negative for out-of-range input", () => {
    for (const collapse of [-1, 0, 0.5, 1, 2]) {
      const s = demoState({ scan: 1, collapse }, TOTAL, KEPT);
      expect(s.cutSeconds).toBeGreaterThanOrEqual(0);
      expect(s.remaining).toBeGreaterThanOrEqual(0);
      expect(s.remaining).toBeLessThanOrEqual(TOTAL);
    }
  });

  it("handles degenerate ratios without producing nonsense", () => {
    expect(demoState({ scan: 1, collapse: 1 }, TOTAL, 1).cutSeconds).toBe(0);
    expect(demoState({ scan: 1, collapse: 1 }, TOTAL, 0).remaining).toBe(0);
  });
});
