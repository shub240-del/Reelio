import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  FileText,
  Film,
  Layers3,
  Mic2,
  Play,
  Sparkles,
  Wand2,
  Youtube,
} from "lucide-react";
import { Link } from "wouter";
import { ReelioLogo } from "@/components/brand/ReelioLogo";
import {
  Container,
  Eyebrow,
  GlassCard,
  Glow,
  GradientText,
  Reveal,
  Section,
  SectionHeading,
} from "./primitives";

const FEATURES = [
  {
    number: "01",
    icon: Mic2,
    title: "Cut the dead air",
    description:
      "Reelio finds quiet stretches in real recordings and turns them into reviewable timeline edits.",
    label: "Audio intelligence",
    tone: "cyan",
  },
  {
    number: "02",
    icon: Wand2,
    title: "Edit by asking",
    description:
      "Describe the change in plain language, then inspect the operation before it touches your timeline.",
    label: "AI edit agent",
    tone: "violet",
  },
  {
    number: "03",
    icon: Layers3,
    title: "Keep the timeline",
    description:
      "Every edit stays editable. Trim, split, move, duplicate, undo, and redo without leaving the browser.",
    label: "Frame-by-frame control",
    tone: "violet",
  },
  {
    number: "04",
    icon: FileText,
    title: "Make the next cut",
    description:
      "Move from raw footage to a clean review copy without losing the source assets or project context.",
    label: "Creator workflow",
    tone: "cyan",
  },
] as const;

const USE_CASES = [
  {
    icon: Youtube,
    title: "YouTube",
    copy: "Tighten long-form recordings without losing your edit decisions.",
  },
  {
    icon: Mic2,
    title: "Podcasts",
    copy: "Remove pauses and shape conversations into a clean listening rhythm.",
  },
  {
    icon: Clapperboard,
    title: "Short-form",
    copy: "Find a focused starting point for clips, reels, and social cuts.",
  },
  {
    icon: Film,
    title: "Marketing",
    copy: "Turn interviews, demos, and explainers into review-ready edits.",
  },
];

const FAQS = [
  [
    "Does Reelio replace my editor?",
    "No. Reelio accelerates the first pass and leaves you with a real timeline you can continue editing.",
  ],
  [
    "Where does my footage go?",
    "Guest projects use local browser persistence. Cloud workflows use the configured project storage and authentication services.",
  ],
  [
    "What can I ask the AI agent to do?",
    "The current verified commands include removing the first five seconds and detecting/removing silence from real audio assets.",
  ],
  [
    "Can I export the result?",
    "The browser export path produces a playable WebM. Audio mixing and complete export parity are still being expanded.",
  ],
] as const;

function ProductShowcase() {
  const [step, setStep] = useState<"scan" | "review" | "apply">("scan");
  const steps = [
    {
      id: "scan",
      label: "Analyse",
      caption: "Reelio reads the rhythm of your footage.",
    },
    {
      id: "review",
      label: "Review",
      caption: "Inspect the suggested ranges before applying them.",
    },
    {
      id: "apply",
      label: "Apply",
      caption: "The timeline becomes shorter, not flatter.",
    },
  ] as const;
  const scanWidth = step === "scan" ? "38%" : step === "review" ? "66%" : "92%";
  const cutWidth = step === "apply" ? "24%" : step === "review" ? "10%" : "0%";

  return (
    <Section
      id="showcase"
      className="overflow-hidden pt-10 sm:pt-16 lg:pt-24"
      label="Product showcase"
    >
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="The edit, in view"
            title={
              <>
                A calmer way to go from footage to{" "}
                <GradientText>finished.</GradientText>
              </>
            }
            sub="Reelio brings the agent, the source media, and the timeline into one focused workspace so the next decision is always visible."
          />
        </Reveal>

        <Reveal delay={100} className="mt-12">
          <GlassCard className="p-3 sm:p-5 lg:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-2 pb-4 sm:px-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--reelio-violet)]/15 text-[var(--reelio-violet-hi)]">
                  <Sparkles size={16} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    Interview — first pass
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    A real timeline, with an agent beside it
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-[var(--reelio-cyan)]/25 bg-[var(--reelio-cyan)]/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
                {step === "apply" ? "Timeline updated" : "Draft suggestion"}
              </span>
            </div>

            <div className="grid gap-4 pt-4 lg:grid-cols-[1.45fr_0.75fr]">
              <div className="rounded-xl border border-white/[0.07] bg-[#0b0b12] p-3 sm:p-4">
                <div className="flex aspect-[16/8] items-center justify-center overflow-hidden rounded-lg border border-white/[0.06] bg-[#12121b]">
                  <div className="relative h-full w-full max-w-2xl overflow-hidden bg-[radial-gradient(circle_at_52%_45%,rgba(124,92,255,0.28),transparent_28%),linear-gradient(135deg,#121226,#090910)]">
                    <div className="absolute inset-x-[12%] top-[15%] h-px bg-white/10" />
                    <div className="absolute inset-x-[12%] bottom-[18%] h-px bg-white/10" />
                    <div className="absolute left-[18%] top-[28%] h-28 w-36 rounded-full bg-[var(--reelio-violet)]/20 blur-2xl" />
                    <div className="absolute right-[18%] top-[24%] h-32 w-32 rounded-full bg-[var(--reelio-cyan)]/10 blur-2xl" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur">
                        <Play size={19} fill="currentColor" />
                      </div>
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between text-[10px] font-mono text-zinc-500">
                      <span>00:00:12.4</span>
                      <span>01:08:42.0</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-white/[0.06] bg-[#10101a] p-3">
                  <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                    <span>Video track</span>
                    <span>Audio track</span>
                  </div>
                  <div className="relative h-12 overflow-hidden rounded-md bg-white/[0.025]">
                    <div
                      className="absolute inset-y-1 left-0 rounded-sm bg-gradient-to-r from-[var(--reelio-violet)]/60 to-[var(--reelio-violet)]/20"
                      style={{ width: scanWidth }}
                    />
                    <div className="absolute inset-y-2 left-[41%] w-[7%] rounded-sm bg-[var(--reelio-cyan)]/35" />
                    <div className="absolute inset-y-2 left-[63%] w-[5%] rounded-sm bg-[var(--reelio-cyan)]/35" />
                    <div
                      className="absolute inset-y-0 transition-all duration-700"
                      style={{
                        left: scanWidth,
                        width: cutWidth,
                        background:
                          "repeating-linear-gradient(135deg,rgba(34,211,238,.35) 0 4px,transparent 4px 8px)",
                      }}
                    />
                    <div className="absolute bottom-1 left-2 right-2 flex items-end gap-1 opacity-80">
                      {Array.from({ length: 56 }, (_, i) => (
                        <span
                          key={i}
                          className="flex-1 rounded-full bg-[var(--reelio-cyan)]/35"
                          style={{ height: `${8 + ((i * 17) % 23)}%` }}
                        />
                      ))}
                    </div>
                    <div
                      className="absolute bottom-0 top-0 w-px bg-white/90 shadow-[0_0_12px_rgba(255,255,255,.75)] transition-all duration-700"
                      style={{ left: scanWidth }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0b0b12] p-4 sm:p-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  <Sparkles size={14} className="text-[var(--reelio-cyan)]" />{" "}
                  Agent notes
                </div>
                <p className="mt-4 text-[15px] leading-relaxed text-zinc-200">
                  {steps.find(item => item.id === step)?.caption}
                </p>
                <div className="mt-6 space-y-2">
                  {steps.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStep(item.id)}
                      className={`reelio-focus flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${step === item.id ? "border-[var(--reelio-violet)]/45 bg-[var(--reelio-violet)]/10" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"}`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${step === item.id ? "bg-[var(--reelio-violet)] text-white" : "bg-white/[0.08] text-zinc-500"}`}
                      >
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-zinc-200">
                        {item.label}
                      </span>
                      {step === item.id ? (
                        <Check
                          size={15}
                          className="ml-auto text-[var(--reelio-cyan)]"
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
                <Link
                  href="/projects"
                  className="reelio-focus mt-auto inline-flex items-center gap-2 pt-8 text-sm font-semibold text-white"
                >
                  Open the real editor{" "}
                  <ArrowRight size={15} className="text-[var(--reelio-cyan)]" />
                </Link>
              </div>
            </div>
          </GlassCard>
        </Reveal>
      </Container>
    </Section>
  );
}

function FeatureSections() {
  return (
    <Section
      id="features"
      className="relative overflow-hidden"
      label="Reelio features"
    >
      <Glow
        className="left-[-18rem] top-1/3 h-[32rem] w-[32rem]"
        from="var(--reelio-cyan)"
        opacity={0.05}
      />
      <Container>
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Built for the messy middle"
            title={
              <>
                The small decisions that make a{" "}
                <GradientText>better cut.</GradientText>
              </>
            }
            sub="Fast enough to feel immediate. Structured enough to stay trustworthy."
          />
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Reveal key={feature.number} delay={index * 80}>
                <GlassCard interactive className="h-full p-6 sm:p-7">
                  <div className="flex items-start justify-between">
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-xl ${feature.tone === "cyan" ? "bg-[var(--reelio-cyan)]/10 text-[var(--reelio-cyan)]" : "bg-[var(--reelio-violet)]/12 text-[var(--reelio-violet-hi)]"}`}
                    >
                      <Icon size={20} />
                    </span>
                    <span className="font-mono text-xs text-zinc-600">
                      {feature.number}
                    </span>
                  </div>
                  <p className="mt-7 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    {feature.label}
                  </p>
                  <h3 className="mt-3 text-2xl font-bold tracking-[-0.02em] text-white">
                    {feature.title}
                  </h3>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">
                    {feature.description}
                  </p>
                  <div className="mt-8 h-px w-full bg-gradient-to-r from-white/10 to-transparent" />
                  <div className="mt-5 flex items-center gap-2 text-xs text-zinc-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--reelio-cyan)]" />{" "}
                    Works with the timeline you already have
                  </div>
                </GlassCard>
              </Reveal>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}

function WorkflowSection() {
  const items = [
    [
      "01",
      "Upload footage",
      "Bring in the real source media. Reelio probes the file and keeps the asset attached to your project.",
    ],
    [
      "02",
      "Ask Reelio",
      "Describe a concrete edit in the AI panel and receive a structured operation to review.",
    ],
    [
      "03",
      "Review and apply",
      "Your timeline stays visible while you inspect the proposed ranges and apply the change.",
    ],
    [
      "04",
      "Export a cut",
      "Download a playable review file, then return to the editable project whenever the story changes.",
    ],
  ];
  return (
    <Section
      id="workflow"
      className="border-y border-white/[0.05] bg-white/[0.012]"
      label="How Reelio works"
    >
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="A clear loop"
            title={
              <>
                Less guessing. More <GradientText>momentum.</GradientText>
              </>
            }
            sub="Reelio is designed around the decisions creators actually make between upload and export."
          />
        </Reveal>
        <div className="mt-14 grid gap-3 md:grid-cols-4">
          {items.map(([number, title, copy], index) => (
            <Reveal key={number} delay={index * 70}>
              <div className="relative h-full rounded-2xl border border-white/[0.07] bg-[#0d0d14] p-5 sm:p-6">
                <span className="font-mono text-xs text-[var(--reelio-cyan)]">
                  {number}
                </span>
                <h3 className="mt-12 text-lg font-bold text-white">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                  {copy}
                </p>
                {index < items.length - 1 ? (
                  <ArrowRight
                    aria-hidden="true"
                    size={16}
                    className="absolute right-4 top-6 hidden text-zinc-700 md:block"
                  />
                ) : null}
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

function UseCasesSection() {
  return (
    <Section id="templates" label="Use cases">
      <Container>
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="One workspace, many cuts"
            title={
              <>
                For the work that starts as a{" "}
                <GradientText>recording.</GradientText>
              </>
            }
            sub="Keep the craft in your hands while Reelio handles the tedious first pass."
          />
        </Reveal>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((item, index) => {
            const Icon = item.icon;
            return (
              <Reveal key={item.title} delay={index * 65}>
                <GlassCard interactive className="h-full p-5">
                  <Icon size={19} className="text-[var(--reelio-violet-hi)]" />
                  <h3 className="mt-10 text-lg font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                    {item.copy}
                  </p>
                </GlassCard>
              </Reveal>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}

function PricingFaqSection() {
  return (
    <Section
      id="pricing"
      className="border-t border-white/[0.05]"
      label="Get started and questions"
    >
      <Container>
        <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
          <Reveal>
            <div>
              <Eyebrow>Start with the real thing</Eyebrow>
              <h2 className="mt-5 text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">
                A focused workspace for your next{" "}
                <GradientText>good cut.</GradientText>
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-400">
                Start locally, keep your projects editable, and see whether an
                agent-led first pass fits your workflow.
              </p>
              <Link
                href="/projects"
                className="reelio-focus mt-8 inline-flex items-center gap-2 rounded-xl bg-[var(--reelio-violet)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--reelio-violet-hi)]"
              >
                Start editing <ArrowRight size={16} />
              </Link>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div id="faq" className="space-y-2 scroll-mt-24">
              {FAQS.map(([question, answer]) => (
                <details
                  key={question}
                  className="group rounded-xl border border-white/[0.07] bg-white/[0.02] px-5 py-4"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-zinc-200">
                    <span>{question}</span>
                    <ChevronDown
                      size={16}
                      className="shrink-0 text-zinc-500 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="max-w-2xl pt-3 text-sm leading-relaxed text-zinc-500">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

function Footer() {
  return (
    <footer
      id="contact"
      className="relative overflow-hidden border-t border-white/[0.07] py-16 sm:py-20"
      aria-label="Footer"
    >
      <Glow
        className="right-[-10rem] top-[-10rem] h-[28rem] w-[28rem]"
        opacity={0.07}
      />
      <Container>
        <div className="flex flex-col justify-between gap-10 md:flex-row md:items-end">
          <div>
            <ReelioLogo size={32} />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-500">
              A browser-first editing workspace for turning real footage into a
              cut you can keep shaping.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-sm sm:grid-cols-3">
            <a
              href="#features"
              className="reelio-focus text-zinc-400 hover:text-white"
            >
              Features
            </a>
            <a
              href="#workflow"
              className="reelio-focus text-zinc-400 hover:text-white"
            >
              How it works
            </a>
            <a
              href="#templates"
              className="reelio-focus text-zinc-400 hover:text-white"
            >
              Use cases
            </a>
            <a
              href="#pricing"
              className="reelio-focus text-zinc-400 hover:text-white"
            >
              Get started
            </a>
            <a
              href="#faq"
              className="reelio-focus text-zinc-400 hover:text-white"
            >
              FAQ
            </a>
            <a
              href="mailto:hello@reelio.app"
              className="reelio-focus text-zinc-400 hover:text-white"
            >
              Contact
            </a>
          </div>
        </div>
        <div className="mt-14 flex flex-col justify-between gap-3 border-t border-white/[0.06] pt-5 text-xs text-zinc-600 sm:flex-row">
          <span>
            © {new Date().getFullYear()} Reelio. Built for real edits.
          </span>
          <span>Original product experience. No borrowed assets.</span>
        </div>
      </Container>
    </footer>
  );
}

export function ExperienceSections() {
  return (
    <>
      <ProductShowcase />
      <FeatureSections />
      <WorkflowSection />
      <UseCasesSection />
      <PricingFaqSection />
      <Footer />
    </>
  );
}

export default ExperienceSections;
