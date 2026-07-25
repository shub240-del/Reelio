/*
 * RuffCut Landing Page
 * Dark theme (#0a0a0f), orange (#f97316) accent, white text
 * Sections: Hero, AI Tools (3+2 grid), How It Works, Content Creators, CTA, Footer
 */

import { useState } from "react";
import {
  Play,
  FolderOpen,
  Upload,
  Sparkles,
  CheckCircle,
  ArrowRight,
  Gamepad2,
  Mic,
  Smartphone,
  Film,
  Trophy,
  Scissors,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const DOG_ICON_SMALL = "/manus-storage/ruffcut-dog-icon-small_65d0c3ed.png";
const MASCOT = "/manus-storage/ruffcut-mascot_99de878b.png";
const EDITOR_PREVIEW = "/manus-storage/ruffcut-editor-preview_a73b73df.png";
const TOOL_FILLER = "/manus-storage/tool-remove-filler_5a7707f0.png";
const TOOL_BADTAKES = "/manus-storage/tool-delete-bad-takes_f9cbe55d.png";
const TOOL_PAUSES = "/manus-storage/tool-remove-pauses_17442e21.png";
const TOOL_CAPTIONS = "/manus-storage/tool-add-captions_8bd35d74.png";
const TOOL_SYNC = "/manus-storage/tool-sync-music_3f4d7a27.png";
const CARD_SHORTFORM = "/manus-storage/card-shortform_a6c930b1.png";
const CARD_LONGFORM = "/manus-storage/card-longform_ac73c7a3.png";
const CARD_EXPLAINERS = "/manus-storage/card-explainers_db82b7aa.png";
const CARD_SOCIAL = "/manus-storage/card-social_91563441.png";
const GAMING_IMG = "/manus-storage/card-gaming_d39158d4.jpg";
const PODCAST_IMG = "/manus-storage/card-podcast_e931b7ed.jpg";
const SPORTS_IMG = "/manus-storage/card-sports_b8c46a34.png";

const tools = [
  {
    num: 1,
    title: "Remove filler words",
    subtitle: "Clean up ums and uhs.",
    image: TOOL_FILLER,
  },
  {
    num: 2,
    title: "Delete bad takes",
    subtitle: "Cut mistakes faster.",
    image: TOOL_BADTAKES,
  },
  {
    num: 3,
    title: "Remove long pauses",
    subtitle: "Trim dead air.",
    image: TOOL_PAUSES,
  },
  {
    num: 4,
    title: "Add captions",
    subtitle: "Caption speech instantly.",
    image: TOOL_CAPTIONS,
  },
  {
    num: 5,
    title: "Sync clips to music",
    subtitle: "Edit on the beat.",
    image: TOOL_SYNC,
  },
];

const steps = [
  {
    num: 1,
    icon: <Upload className="w-8 h-8" />,
    title: "Upload or open the demo",
    desc: "Bring your raw footage or try our demo project.",
  },
  {
    num: 2,
    icon: <Sparkles className="w-8 h-8" />,
    title: "Generate a first cut",
    desc: "RuffCut scans for pauses, filler words, restarts, and bad takes.",
  },
  {
    num: 3,
    icon: <CheckCircle className="w-8 h-8" />,
    title: "Review and apply",
    desc: "Preview suggestions, apply what you want, or keep it all.",
  },
];

const contentCards = [
  { icon: <Gamepad2 className="w-5 h-5" />, label: "Gaming", desc: "Cut long sessions into punchy highlights.", img: GAMING_IMG },
  { icon: <Mic className="w-5 h-5" />, label: "Podcasts", desc: "Trim pauses, restarts, and filler.", img: PODCAST_IMG },
  { icon: <Smartphone className="w-5 h-5" />, label: "Social clips", desc: "Make vertical edits move faster.", img: CARD_SOCIAL },
  { icon: <Scissors className="w-5 h-5" />, label: "Short-form edits", desc: "Turn raw clips into tighter vertical videos.", img: CARD_SHORTFORM, featured: true },
  { icon: <Film className="w-5 h-5" />, label: "Long-form video", desc: "Start from a clean rough cut.", img: CARD_LONGFORM, featured: true },
  { icon: <MessageSquare className="w-5 h-5" />, label: "Explainers", desc: "Clean up tutorials and talking-head lessons.", img: CARD_EXPLAINERS },
  { icon: <Trophy className="w-5 h-5" />, label: "Sports clips", desc: "Find the moments worth keeping.", img: SPORTS_IMG },
];

function ToolCard({ tool, wide }: { tool: typeof tools[0]; wide?: boolean }) {
  return (
    <div className="group rounded-xl overflow-hidden border border-white/[0.06] bg-[#141420] hover:border-orange-500/25 transition-all duration-300">
      <div className="p-5 pb-3">
        <div className="flex items-center gap-3 mb-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-500 text-white text-sm font-bold flex-shrink-0">
            {tool.num}
          </span>
          <span className="text-[11px] text-gray-500 uppercase tracking-[0.15em] font-semibold">Tool</span>
        </div>
        <h3 className="text-[17px] font-bold text-white mb-0.5">{tool.title}</h3>
        <p className="text-sm text-gray-400">{tool.subtitle}</p>
      </div>
      <div className="px-4 pb-4">
        <div className="rounded-lg overflow-hidden bg-[#0a0a12] border border-white/[0.04]">
          <img
            src={tool.image}
            alt={tool.title}
            className={`w-full ${wide ? "h-[200px]" : "h-[180px]"} object-cover`}
          />
        </div>
      </div>
    </div>
  );
}

function ContentCardItem({
  card,
  isActive,
  onClick,
  position,
}: {
  card: typeof contentCards[0];
  isActive: boolean;
  onClick: () => void;
  position: number;
}) {
  const total = contentCards.length;
  const offset = position - 3;
  const translateX = offset * 80;
  const scale = isActive ? 1 : 0.88;
  const opacity = isActive ? 1 : Math.max(0.35, 0.7 - Math.abs(offset) * 0.12);

  return (
    <button
      onClick={onClick}
      className={`absolute transition-all duration-500 ease-out rounded-xl overflow-hidden ${
        isActive ? "ring-2 ring-orange-500/40 shadow-[0_0_50px_rgba(249,115,22,0.12)]" : ""
      }`}
      style={{
        transform: `translateX(${translateX}px) scale(${scale})`,
        opacity,
        zIndex: isActive ? 30 : 20 - Math.abs(offset),
        width: isActive ? "280px" : "200px",
        height: isActive ? "380px" : "300px",
      }}
    >
      <img src={card.img} alt={card.label} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-orange-400">{card.icon}</span>
          <span className="text-white font-semibold text-sm">{card.label}</span>
        </div>
        <p className="text-gray-300 text-xs leading-relaxed">{card.desc}</p>
      </div>
    </button>
  );
}

export default function Home() {
  const [activeCard, setActiveCard] = useState(3);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0f]/85 backdrop-blur-md border-b border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          <a href="#" className="flex items-center gap-2">
            <img src={DOG_ICON_SMALL} alt="RuffCut" className="w-7 h-7" />
            <span className="text-[22px] font-bold text-white tracking-tight">
              Ruff<span className="text-orange-500">Cut</span>
            </span>
          </a>
          <nav className="flex items-center gap-6">
            <a
              href="https://discord.gg/9QEhuThb9N"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Discord
            </a>
            <a
              href="#"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Submit feedback
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-28 pb-16 lg:pt-36 lg:pb-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-16 items-center">
            <div>
              <h1 className="text-[44px] sm:text-5xl lg:text-[56px] font-black leading-[1.08] tracking-tight mb-3">
                No more boring,
                <br />
                repetitive editing.
              </h1>
              <p className="text-[26px] sm:text-[30px] font-bold text-orange-500 mb-3">
                AI edits your footage.
              </p>
              <p className="text-gray-400 text-[17px] mb-8">
                Generate a clean rough draft in minutes.
              </p>
              <div className="flex flex-wrap gap-3 mb-5">
                <Button
                  size="lg"
                  className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 gap-2 h-12"
                >
                  <Play className="w-4 h-4" />
                  Try Demo Project
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="bg-[#141420] border-white/10 text-white hover:bg-[#1e1e2e] gap-2 h-12 px-5"
                >
                  <FolderOpen className="w-4 h-4" />
                  Open editor
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-sm text-gray-500 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                Free to use editor. No credit card required.
              </p>
            </div>
            <div className="relative">
              <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl shadow-black/40">
                <img
                  src={EDITOR_PREVIEW}
                  alt="RuffCut editor preview"
                  className="w-full h-auto"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      </div>

      {/* AI Editing Tools Section */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-12">
            <p className="text-orange-500 text-[13px] font-semibold uppercase tracking-[0.2em] mb-3">
              AI Editing Tools
            </p>
            <h2 className="text-3xl sm:text-[38px] font-bold text-white leading-tight">
              Clean up the cuts that slow you down
            </h2>
          </div>

          {/* Tool Cards Grid: 3 on top, 2 on bottom */}
          <div className="space-y-6">
            {/* Top row: 3 cards */}
            <div className="grid md:grid-cols-3 gap-6">
              {tools.slice(0, 3).map((tool) => (
                <ToolCard key={tool.num} tool={tool} />
              ))}
            </div>
            {/* Bottom row: 2 cards */}
            <div className="grid md:grid-cols-2 gap-6">
              {tools.slice(3).map((tool) => (
                <ToolCard key={tool.num} tool={tool} wide />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-[38px] font-bold text-white mb-3">
              How it works
            </h2>
            <p className="text-gray-400 text-[17px]">
              Edit your video in 3 easy steps.
            </p>
          </div>

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-center gap-8 md:gap-0">
            {/* Arrow connectors (desktop) */}
            <div className="hidden md:flex absolute left-0 right-0 top-10 items-center justify-center pointer-events-none z-0">
              <div className="w-[30%] h-0.5 bg-gradient-to-r from-orange-500/0 via-orange-500/40 to-orange-500/0 mx-auto" />
            </div>

            {steps.map((step, i) => (
              <div
                key={step.num}
                className="relative flex-1 flex flex-col items-center text-center px-4 z-10"
              >
                <div className="w-[68px] h-[68px] rounded-2xl bg-[#141420] border border-white/10 flex items-center justify-center text-orange-500 mb-5">
                  {step.icon}
                </div>
                <div className="text-[48px] font-black text-orange-500 mb-3 leading-none">
                  {step.num}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
                <p className="text-sm text-gray-400 max-w-[220px] leading-relaxed">
                  {step.desc}
                </p>
                {i < steps.length - 1 && (
                  <ArrowRight className="hidden md:block w-6 h-6 text-orange-500/40 absolute right-[-12px] top-10" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      </div>

      {/* Built for Content Creators */}
      <section className="py-20 lg:py-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-[38px] font-bold text-white mb-3">
              Built for content creators and editors
            </h2>
            <p className="text-gray-400 text-[17px] max-w-xl mx-auto">
              Try RuffCut on podcasts, highlights, explainers, social clips, and
              long-form edits.
            </p>
          </div>

          {/* Staggered Content Cards */}
          <div className="relative flex items-center justify-center h-[420px] mt-4">
            {contentCards.map((card, i) => (
              <ContentCardItem
                key={i}
                card={card}
                isActive={activeCard === i}
                onClick={() => setActiveCard(i)}
                position={i}
              />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 lg:py-24 bg-gradient-to-b from-[#0a0a0f] via-[#0e1420] to-[#0c1a2e]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="flex items-start gap-5 lg:gap-7">
              <img
                src={MASCOT}
                alt="RuffCut mascot"
                className="w-28 h-28 lg:w-36 lg:h-36 flex-shrink-0"
              />
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1">
                  Free to use video editor.
                </h2>
                <p className="text-[18px] font-semibold text-gray-200 mb-3">
                  Start cutting cleaner videos today.
                </p>
                <p className="text-gray-400 max-w-md text-[15px] leading-relaxed">
                  Open the editor, try the AI tools, and join Discord to share
                  feedback with the RuffCut team.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 flex-shrink-0">
              <a
                href="https://discord.gg/9QEhuThb9N"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  size="lg"
                  variant="outline"
                  className="bg-[#1e1e2e] border-white/10 text-white hover:bg-[#2a2a3a] gap-2 h-11"
                >
                  <MessageSquare className="w-4 h-4" />
                  Join Discord
                </Button>
              </a>
              <Button
                size="lg"
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold h-11 px-6"
              >
                Start using now!
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={DOG_ICON_SMALL} alt="RuffCut" className="w-7 h-7" />
              <div>
                <span className="text-base font-bold text-white">RuffCut</span>
                <p className="text-xs text-gray-500">
                  Your dawg that edits for you.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="https://discord.gg/9QEhuThb9N"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Discord
              </a>
              <a
                href="#"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Submit feedback
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
