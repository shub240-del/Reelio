/**
 * Hero centrepiece — an original, self-demonstrating visualisation of Reelio's
 * core operation: detect dead air, cut it, close the gaps.
 *
 * Not a screenshot and not a mockup of an editor UI. Everything here is drawn
 * as SVG from a deterministic seeded dataset, and it animates the actual
 * transformation the product performs (`removeRanges` in shared/timeline.ts):
 * silence spans are marked, then collapsed, and the running time drops.
 *
 * Under prefers-reduced-motion it renders the settled "after" state with the
 * spans still labelled, so the idea survives without any movement.
 */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./primitives";
import { demoState, formatClock, phaseAt, type Phase } from "./heroDemoState";

/* ────────────────────────── deterministic source data ────────────────────────── */

/** Mulberry32 — small seeded PRNG so the waveform is identical on every render. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Bar {
  amp: number;
  silent: boolean;
}

/** Alternating speech runs and silence gaps, shaped to look like real dialogue. */
function buildBars(): Bar[] {
  const rand = seeded(20260729);
  const bars: Bar[] = [];
  const plan: [boolean, number][] = [
    [false, 26],
    [true, 9],
    [false, 31],
    [true, 12],
    [false, 22],
    [true, 7],
    [false, 34],
    [true, 14],
    [false, 28],
    [true, 8],
    [false, 19],
  ];
  for (const [silent, count] of plan) {
    for (let i = 0; i < count; i++) {
      if (silent) {
        bars.push({ amp: 0.03 + rand() * 0.04, silent: true });
      } else {
        // Envelope so each run swells and tapers like a spoken phrase.
        const t = i / Math.max(1, count - 1);
        const envelope = Math.sin(Math.PI * t) * 0.65 + 0.35;
        bars.push({ amp: Math.min(1, (0.3 + rand() * 0.7) * envelope), silent: false });
      }
    }
  }
  return bars;
}

const BARS = buildBars();
const SILENT_COUNT = BARS.filter((b) => b.silent).length;
const TOTAL_SECONDS = 760; // 12:40 of source footage
const KEPT_RATIO = (BARS.length - SILENT_COUNT) / BARS.length;

/* ────────────────────────── component ────────────────────────── */

const VIEW_W = 620;
const VIEW_H = 132;
const GAP = 1.4;

export function HeroDemo() {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduced ? { scan: 1, collapse: 1 } : { scan: 0, collapse: 0 });
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (reduced) {
      setPhase({ scan: 1, collapse: 1 });
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let running = false;
    const start = performance.now();
    const loop = () => {
      if (!running) return;
      setPhase(phaseAt(performance.now() - start));
      raf = requestAnimationFrame(loop);
    };
    // Only animate while on screen — a hero that keeps painting after you
    // scroll past is a battery drain for no benefit.
    const io = new IntersectionObserver(
      ([entry]) => {
        running = entry.isIntersecting;
        cancelAnimationFrame(raf);
        if (running) raf = requestAnimationFrame(loop);
      },
      { threshold: 0.15 },
    );
    io.observe(host);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // Bar width so that the expanded strip exactly fills the viewBox.
  const fullBarW = (VIEW_W - GAP * (BARS.length - 1)) / BARS.length;

  // Lay bars out left to right; silent bars shrink toward zero as collapse -> 1.
  let cursor = 0;
  const laid = BARS.map((bar, i) => {
    const w = bar.silent ? fullBarW * (1 - phase.collapse) : fullBarW;
    const x = cursor;
    cursor += w + GAP * (bar.silent ? 1 - phase.collapse : 1);
    // A bar is "reached" by the scan sweep once the sweep passes its position.
    const reached = i / BARS.length <= phase.scan;
    return { ...bar, x, w, reached, index: i };
  });

  const scanX = phase.scan * VIEW_W;
  const { stage, cutSeconds, remaining, targetCutSeconds } = demoState(phase, TOTAL_SECONDS, KEPT_RATIO);
  const detecting = stage === "scanning";

  return (
    <div ref={hostRef} className="relative w-full">
      {/* Status bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            {!reduced && detecting ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--reelio-cyan)] opacity-70" />
            ) : null}
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: detecting ? "var(--reelio-cyan)" : "var(--reelio-violet)" }}
            />
          </span>
          <span className="text-[13px] font-medium text-zinc-300">
            {stage === "scanning"
              ? "Example audio scan…"
              : stage === "found"
                ? `Found ${SILENT_COUNT} silent spans`
                : `Removed ${SILENT_COUNT} silent spans`}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[13px] tabular-nums">
          <span className={phase.collapse > 0.02 ? "text-zinc-500 line-through" : "text-zinc-300"}>
            {formatClock(TOTAL_SECONDS)}
          </span>
          {phase.collapse > 0.02 ? (
            <>
              <span className="text-zinc-600">→</span>
              <span className="font-semibold text-[var(--reelio-cyan)]">{formatClock(remaining)}</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Waveform */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        role="img"
        aria-label={`Illustrative waveform demonstrating how silence removal could shorten a ${formatClock(TOTAL_SECONDS)} recording to ${formatClock(TOTAL_SECONDS - targetCutSeconds)}.`}
      >
        <defs>
          <linearGradient id="reelio-wave" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="var(--reelio-violet)" />
          </linearGradient>
          <linearGradient id="reelio-scan" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--reelio-cyan)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--reelio-cyan)" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        {laid.map((bar) => {
          const h = Math.max(2, bar.amp * (VIEW_H - 16));
          const y = (VIEW_H - h) / 2;
          if (bar.w <= 0.05) return null;
          const silentReached = bar.silent && bar.reached;
          return (
            <rect
              key={bar.index}
              x={bar.x}
              y={y}
              width={Math.max(0.4, bar.w)}
              height={h}
              rx={Math.min(1.6, bar.w / 2)}
              fill={silentReached ? "var(--reelio-cyan)" : bar.silent ? "#3f3f46" : "url(#reelio-wave)"}
              opacity={silentReached ? 0.55 * (1 - phase.collapse * 0.7) : bar.reached ? 1 : 0.38}
            />
          );
        })}

        {/* Sweep head */}
        {detecting && !reduced ? (
          <>
            <rect x={Math.max(0, scanX - 90)} y="0" width="90" height={VIEW_H} fill="url(#reelio-scan)" opacity="0.35" />
            <rect x={scanX} y="0" width="1.6" height={VIEW_H} fill="var(--reelio-cyan)" />
          </>
        ) : null}
      </svg>

      {/* Result chips */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Chip tone="violet">Example: {SILENT_COUNT} spans</Chip>
        <Chip tone="cyan">
          {stage === "cutting"
            ? `${formatClock(cutSeconds)} of dead air cut`
            : `${formatClock(targetCutSeconds)} of dead air found`}
        </Chip>
        <Chip tone="plain">{stage === "cutting" ? "Timeline updated" : "Timeline ready"}</Chip>
      </div>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "violet" | "cyan" | "plain" }) {
  const styles = {
    violet: "border-[var(--reelio-violet)]/35 bg-[var(--reelio-violet)]/12 text-violet-200",
    cyan: "border-[var(--reelio-cyan)]/35 bg-[var(--reelio-cyan)]/10 text-cyan-200",
    plain: "border-white/10 bg-white/[0.03] text-zinc-400",
  }[tone];
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors duration-500 ${styles}`}
    >
      {children}
    </span>
  );
}

export default HeroDemo;
