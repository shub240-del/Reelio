/**
 * Deterministic model behind the hero's silence-removal demo.
 *
 * This lives apart from the component because the demo makes factual claims
 * on screen — "50 spans removed", "12:40 -> 9:39", "3:01 of dead air cut" —
 * and those numbers have to agree with each other in every frame. Two separate
 * bugs shipped here already: copy that claimed a cut during the hold phase,
 * and clocks formatted from independent floats that did not add up. Keeping the
 * arithmetic pure means both classes are covered by tests instead of by eye.
 */

export interface Phase {
  /** 0..1 progress of the scan sweep across the waveform. */
  scan: number;
  /** 0..1 how far the detected silence has been cut out. */
  collapse: number;
}

/** The demo narrates three distinct claims; they must never be conflated. */
export type DemoStage = "scanning" | "found" | "cutting";

export const SCAN_MS = 2200;
export const HOLD_MS = 700;
export const COLLAPSE_MS = 1100;
export const SETTLE_MS = 2200;
export const CYCLE_MS = SCAN_MS + HOLD_MS + COLLAPSE_MS + SETTLE_MS;

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function phaseAt(elapsed: number): Phase {
  const t = ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  if (t < SCAN_MS) return { scan: t / SCAN_MS, collapse: 0 };
  if (t < SCAN_MS + HOLD_MS) return { scan: 1, collapse: 0 };
  if (t < SCAN_MS + HOLD_MS + COLLAPSE_MS) {
    const p = (t - SCAN_MS - HOLD_MS) / COLLAPSE_MS;
    // easeInOutCubic keeps the collapse from feeling mechanical.
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return { scan: 1, collapse: eased };
  }
  return { scan: 1, collapse: 1 };
}

export interface DemoState {
  stage: DemoStage;
  /** Whole seconds removed so far. Whole, so the two clocks reconcile. */
  cutSeconds: number;
  /** Whole seconds left. Always exactly totalSeconds - cutSeconds. */
  remaining: number;
  /** Seconds the pass will remove once it finishes. */
  targetCutSeconds: number;
}

/**
 * Derives every number and claim the demo shows from one phase.
 *
 * cutSeconds is rounded to a whole second FIRST and remaining is derived from
 * it, so `remaining + cutSeconds === totalSeconds` holds exactly. Formatting
 * two independent floats is what let "12:40 -> 12:24" ship next to
 * "0:15 of dead air cut", which are a second apart.
 */
export function demoState(phase: Phase, totalSeconds: number, keptRatio: number): DemoState {
  const clampedCollapse = Math.min(1, Math.max(0, phase.collapse));
  const removable = totalSeconds * (1 - Math.min(1, Math.max(0, keptRatio)));
  const cutSeconds = Math.round(removable * clampedCollapse);
  return {
    // During the hold the spans are only found, never yet removed, so the
    // status copy must not claim a cut has happened.
    stage: phase.scan < 1 ? "scanning" : clampedCollapse <= 0.02 ? "found" : "cutting",
    cutSeconds,
    remaining: totalSeconds - cutSeconds,
    targetCutSeconds: Math.round(removable),
  };
}
