/**
 * Hero section.
 *
 * Original copy and composition. The visual is HeroDemo — a live rendering of
 * the product's real core operation — deliberately chosen over a product
 * screenshot so that nothing on this page is a borrowed or staged image.
 */
import { Link } from "wouter";
import { ArrowRight, Play } from "lucide-react";
import { Container, GlassCard, GradientText, Glow } from "./primitives";
import { HeroDemo } from "./HeroDemo";

/** Honest capability line — every claim maps to shipped import support. */
const FACTS = ["MP4, MOV & WebM", "Runs in your browser", "Nothing to install"];

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-16 sm:pt-40 sm:pb-24" aria-label="Introduction">
      {/* Decorative background: CSS/SVG only, no raster art. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="reelio-grid reelio-fade-mask absolute inset-0 opacity-[0.55]" />
        <Glow className="reelio-drift left-1/2 top-[-14rem] h-[34rem] w-[46rem] -translate-x-1/2" opacity={0.16} />
        <Glow
          className="reelio-drift-slow right-[-10rem] top-[6rem] h-[26rem] w-[26rem]"
          from="var(--reelio-cyan)"
          opacity={0.09}
        />
      </div>

      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_1fr] lg:gap-16">
          {/* Copy */}
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--reelio-cyan)]" />
              AI editing agent, built in
            </span>

            <h1 className="mt-6 text-balance text-[2.6rem] font-extrabold leading-[1.03] tracking-[-0.03em] text-white sm:text-6xl">
              Raw footage in.
              <br />
              <GradientText>Finished edit out.</GradientText>
            </h1>

            <p className="mt-6 text-pretty text-lg leading-relaxed text-zinc-400">
              Reelio listens to your footage, cuts the dead air, writes the captions and hands back a real
              timeline — one you can still open and edit frame by frame.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/projects"
                className="reelio-focus group inline-flex items-center gap-2 rounded-xl bg-[var(--reelio-violet)] px-5 py-3 text-[15px] font-semibold text-white transition-all hover:bg-[var(--reelio-violet-hi)] hover:shadow-[0_14px_40px_-12px_var(--reelio-violet)]"
              >
                Start editing free
                <ArrowRight
                  size={17}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transform-none"
                />
              </Link>
              <a
                href="#features"
                className="reelio-focus inline-flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.03] px-5 py-3 text-[15px] font-semibold text-zinc-100 backdrop-blur transition-colors hover:border-white/[0.2] hover:bg-white/[0.06]"
              >
                <Play size={15} aria-hidden="true" />
                See it work
              </a>
            </div>

            <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2">
              {FACTS.map((fact) => (
                <li key={fact} className="flex items-center gap-2 text-[13px] text-zinc-500">
                  <span className="h-1 w-1 rounded-full bg-zinc-600" />
                  {fact}
                </li>
              ))}
            </ul>
          </div>

          {/* Live demo */}
          <GlassCard className="p-5 sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Silence removal
              </span>
              <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                live
              </span>
            </div>
            <HeroDemo />
          </GlassCard>
        </div>
      </Container>
    </section>
  );
}

export default Hero;
