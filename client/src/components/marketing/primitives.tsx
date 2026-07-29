/**
 * Marketing design-system primitives.
 *
 * Every Reelio marketing section composes from these, so spacing, motion and
 * glass treatment stay consistent without repeating utility soup in each file.
 *
 * Motion rule: all animation here is opt-out. `useReducedMotion` reads the OS
 * setting and every primitive degrades to a static, fully legible state rather
 * than simply animating faster.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

/* ────────────────────────── motion preference ────────────────────────── */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ────────────────────────── anchor availability ────────────────────────── */

/**
 * Filters in-page anchors down to the ones whose target actually exists.
 *
 * The nav and hero advertise sections by id. Hard-coding that list ships dead
 * links whenever a section has not been built yet (it briefly shipped six of
 * them), and a link that scrolls nowhere reads as a broken site. Resolving
 * against the live DOM means the nav can only ever offer real destinations, and
 * new sections light up on their own as they mount.
 */
export function useExistingAnchors(hrefs: readonly string[]): Set<string> {
  const key = hrefs.join(",");
  const [present, setPresent] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const resolve = () => {
      const found = hrefs.filter((h) => {
        if (!h.startsWith("#")) return true; // real routes are not our business
        const id = h.slice(1);
        return id.length > 0 && document.getElementById(id) !== null;
      });
      setPresent((prev) => {
        // Only swap the Set when membership really changed, so a MutationObserver
        // firing on every scroll-reveal cannot loop us through renders forever.
        if (prev.size === found.length && found.every((h) => prev.has(h))) return prev;
        return new Set(found);
      });
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return present;
}

/**
 * Runs `tick` on every animation frame while the element is on screen.
 * Off-screen sections stop animating entirely, which is what keeps a page full
 * of live demos from pinning the CPU.
 */
export function useRafWhenVisible(
  tick: (elapsedMs: number) => void,
  enabled = true,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reduced) return;
    let raf = 0;
    let visible = false;
    const start = performance.now();
    const loop = () => {
      if (!visible) return;
      tick(performance.now() - start);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(loop);
        } else {
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [tick, enabled, reduced]);

  return ref;
}

/* ────────────────────────── layout ────────────────────────── */

/** Consistent page gutter and max width across every section. */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Section({
  children,
  className = "",
  id,
  label,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  label?: string;
}) {
  return (
    <section id={id} aria-label={label} className={`relative py-20 sm:py-28 lg:py-32 ${className}`}>
      {children}
    </section>
  );
}

/* ────────────────────────── reveal ────────────────────────── */

/**
 * Fade-and-rise on scroll. `delay` staggers siblings.
 * Under reduced motion the content is simply present from the start.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "span";
}) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  const reduced = useReducedMotion();
  const style: CSSProperties = reduced
    ? {}
    : {
        transitionDelay: `${delay}ms`,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "none" : "translateY(18px)",
      };
  return (
    <Tag
      ref={ref as never}
      className={`${reduced ? "" : "transition-all duration-700 ease-out"} ${className}`}
      style={style}
    >
      {children}
    </Tag>
  );
}

/* ────────────────────────── surfaces ────────────────────────── */

/** Glass panel: the standard Reelio content surface. */
export function GlassCard({
  children,
  className = "",
  interactive = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  /** Set when the card is a scroll target, so anchors can resolve to it. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={[
        "relative overflow-hidden rounded-2xl border border-white/[0.08]",
        "bg-white/[0.02] backdrop-blur-xl",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
        interactive
          ? "transition-[transform,border-color,background-color] duration-300 hover:-translate-y-1 hover:border-white/[0.16] hover:bg-white/[0.04] motion-reduce:transform-none motion-reduce:transition-none"
          : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/** Brand gradient text, used sparingly for the accented clause of a headline. */
export function GradientText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`bg-gradient-to-r from-[var(--reelio-violet)] via-[#9d7cff] to-[var(--reelio-cyan)] bg-clip-text text-transparent ${className}`}
    >
      {children}
    </span>
  );
}

/** Small uppercase section eyebrow. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  align = "center",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  align?: "center" | "left";
}) {
  const alignment = align === "center" ? "text-center items-center mx-auto" : "text-left items-start";
  return (
    <div className={`flex max-w-3xl flex-col gap-4 ${alignment}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="text-balance text-3xl font-extrabold leading-[1.08] tracking-[-0.02em] text-white sm:text-4xl lg:text-[44px]">
        {title}
      </h2>
      {sub ? <p className="text-pretty text-base leading-relaxed text-zinc-400 sm:text-lg">{sub}</p> : null}
    </div>
  );
}

/** Soft radial brand glow used behind hero and CTA blocks. */
export function Glow({
  className = "",
  from = "var(--reelio-violet)",
  opacity = 0.22,
}: {
  className?: string;
  from?: string;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-full blur-[100px] ${className}`}
      style={{ background: from, opacity }}
    />
  );
}
