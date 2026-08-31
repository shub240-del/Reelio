import { useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Scissors,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { type EditPlan, type EditOp, describeOp } from "@shared/editOps";

interface AIAgentPanelProps {
  userEmail?: string;
  onExecuteQuickAction: (actionType: string) => void;
  onSendMessage: (message: string) => void;
  aiLoading: boolean;
  aiAvailable: boolean;
  assetCount: number;
  timelineDuration: number;
  pendingPlan: EditPlan | null;
  selectedOpIndices: number[];
  onToggleOpSelection: (index: number) => void;
  onApplyPlan: (ops?: EditOp[]) => void;
  onRejectPlan: () => void;
  aiMessages: { role: string; content: string }[];
}

export function AIAgentPanel({
  userEmail = "Local workspace",
  onExecuteQuickAction,
  onSendMessage,
  aiLoading,
  aiAvailable,
  assetCount,
  timelineDuration,
  pendingPlan,
  selectedOpIndices,
  onToggleOpSelection,
  onApplyPlan,
  onRejectPlan,
  aiMessages,
}: AIAgentPanelProps) {
  const [activeTab, setActiveTab] = useState<"quick" | "report">("quick");
  const [expandedAction, setExpandedAction] = useState<string | null>("silence");
  const [customInput, setCustomInput] = useState("");

  const handleSend = () => {
    const message = customInput.trim();
    if (!message || aiLoading) return;
    onSendMessage(message);
    setCustomInput("");
  };

  const actions = [
    {
      id: "silence",
      title: "Detect real silence",
      description: "Decodes the actual audio track, proposes low-amplitude ranges, and waits for your review.",
      button: "Scan for silence",
    },
    {
      id: "first-five",
      title: "Remove first five seconds",
      description: "Creates a deterministic, reviewable timeline cut without requiring an AI provider.",
      button: "Propose five-second cut",
    },
  ] as const;

  return (
    <aside className="flex min-h-[420px] w-full min-w-0 flex-col bg-[#111117] text-white lg:h-full lg:w-80 lg:min-w-[320px] lg:border-l lg:border-white/[0.07]" aria-label="Edit assistant">
      <div className="flex items-center justify-between border-b border-white/[0.07] bg-[#0e0e13] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-sky-500/20 text-sky-400"><Bot className="h-3.5 w-3.5" /></span>
          <span className="text-xs font-semibold tracking-wide">Edit Assistant</span>
        </div>
        <span className="max-w-[150px] truncate rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-gray-400">{userEmail}</span>
      </div>

      <div className="flex items-center gap-4 border-b border-white/[0.07] bg-[#14141b] px-2" role="tablist" aria-label="Assistant views">
        <button type="button" role="tab" aria-selected={activeTab === "quick"} onClick={() => setActiveTab("quick")} className={`relative py-2 text-xs font-medium ${activeTab === "quick" ? "text-sky-400" : "text-gray-400 hover:text-gray-200"}`}>
          Quick actions
          {activeTab === "quick" ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sky-400" /> : null}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "report"} onClick={() => setActiveTab("report")} className={`relative py-2 text-xs font-medium ${activeTab === "report" ? "text-sky-400" : "text-gray-400 hover:text-gray-200"}`}>
          Evidence status
          {activeTab === "report" ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sky-400" /> : null}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {aiMessages.length > 0 ? (
          <section aria-label="Assistant conversation" aria-live="polite" className="space-y-2">
            {aiMessages.slice(-6).map((message, index) => (
              <div key={`${message.role}-${index}`} className={`whitespace-pre-wrap rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${message.role === "user" ? "ml-5 border-sky-500/25 bg-sky-500/10 text-sky-100" : "mr-5 border-white/[0.07] bg-[#181822] text-gray-300"}`}>
                <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-gray-500">{message.role === "user" ? "You" : "Reelio"}</span>
                {message.content}
              </div>
            ))}
          </section>
        ) : null}

        {pendingPlan ? (
          <section className="overflow-hidden rounded-xl border border-sky-500/40 bg-[#161622] shadow-xl" aria-label="Edit plan review">
            <div className="flex items-center justify-between border-b border-white/[0.08] bg-sky-500/10 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-sky-400" />
                <div className="min-w-0"><div className="text-xs font-semibold">Edit plan review</div><div className="truncate text-[10px] text-gray-400">{pendingPlan.summary}</div></div>
              </div>
              <button type="button" onClick={onRejectPlan} aria-label="Dismiss edit plan" className="rounded p-1 text-gray-400 hover:bg-white/5 hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="max-h-60 space-y-2 overflow-y-auto p-3">
              <div className="flex justify-between text-[11px] text-gray-400"><span>{pendingPlan.operations.length} proposed</span><span className="text-sky-400">{selectedOpIndices.length} selected</span></div>
              {pendingPlan.operations.map((op, index) => {
                const selected = selectedOpIndices.includes(index);
                return (
                  <button key={index} type="button" aria-pressed={selected} onClick={() => onToggleOpSelection(index)} className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left text-xs ${selected ? "border-sky-500/50 bg-sky-500/15 text-white" : "border-white/[0.06] bg-white/[0.02] text-gray-400"}`}>
                    {selected ? <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" /> : <Square className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span>{describeOp(op)}</span>
                  </button>
                );
              })}
            </div>
            <div className="space-y-2 border-t border-white/[0.08] bg-black/40 p-3">
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onApplyPlan()} disabled={selectedOpIndices.length === 0 || aiLoading} className="h-8 flex-1 bg-sky-500 text-xs text-white hover:bg-sky-600"><Check className="mr-1 h-3.5 w-3.5" />Apply selected</Button>
                <Button size="sm" variant="outline" onClick={() => onApplyPlan(pendingPlan.operations)} disabled={aiLoading} className="h-8 border-white/15 text-xs">Apply all</Button>
              </div>
              <Button size="sm" variant="ghost" onClick={onRejectPlan} className="h-7 w-full text-[11px] text-gray-400 hover:text-red-400">Dismiss without changes</Button>
            </div>
          </section>
        ) : activeTab === "quick" ? (
          <section className="space-y-2" aria-label="Verified quick actions">
            {!aiAvailable ? (
              <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-200"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />NVIDIA reasoning is not configured. The two local evidence-based actions below still work.</div>
            ) : null}
            {actions.map((action) => {
              const open = expandedAction === action.id;
              return (
                <div key={action.id} className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#181822]">
                  <button type="button" aria-expanded={open} onClick={() => setExpandedAction(open ? null : action.id)} className="flex w-full items-center justify-between p-2.5 text-left text-xs font-medium text-gray-200 hover:bg-white/[0.03]">
                    <span className="flex items-center gap-2"><Scissors className="h-3.5 w-3.5 text-sky-400" />{action.title}</span>
                    {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {open ? <div className="space-y-2 border-t border-white/[0.04] p-2.5"><p className="text-[11px] leading-relaxed text-gray-400">{action.description}</p><Button size="sm" disabled={aiLoading || assetCount === 0} onClick={() => onExecuteQuickAction(action.id)} className="h-8 w-full bg-sky-600 text-[11px] text-white hover:bg-sky-500">{aiLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}{action.button}</Button></div> : null}
                </div>
              );
            })}
          </section>
        ) : (
          <section className="space-y-3" aria-label="Media evidence status">
            <div className="rounded-lg border border-white/[0.07] bg-[#181822] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-400"><FileText className="h-4 w-4" />Verified project state</div>
              <dl className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded bg-black/20 p-2"><dt className="text-[10px] text-gray-500">Media assets</dt><dd className="text-sm font-bold">{assetCount}</dd></div>
                <div className="rounded bg-black/20 p-2"><dt className="text-[10px] text-gray-500">Timeline duration</dt><dd className="text-sm font-bold">{timelineDuration.toFixed(1)}s</dd></div>
              </dl>
            </div>
            <p className="rounded-lg border border-white/[0.07] bg-[#181822] p-3 text-[11px] leading-relaxed text-gray-400">Silence evidence is decoded from real audio when available. Transcript, filler-word, speaker, and scene evidence remain unavailable until a real provider is connected; Reelio will not synthesize them.</p>
          </section>
        )}
      </div>

      <div className="border-t border-white/[0.07] bg-[#0e0e13] p-2.5">
        <label htmlFor="reelio-edit-prompt" className="sr-only">Ask the edit assistant</label>
        <div className="relative flex items-center">
          <input id="reelio-edit-prompt" type="text" value={customInput} onChange={(event) => setCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleSend(); }} placeholder="Describe a timeline edit…" disabled={aiLoading} className="w-full rounded-md border border-white/[0.08] bg-[#181822] py-2 pl-3 pr-9 text-xs text-white placeholder:text-gray-500 focus:border-sky-500/50 focus:outline-none" />
          <button type="button" onClick={handleSend} disabled={aiLoading || !customInput.trim()} aria-label="Send edit instruction" className="absolute right-1.5 rounded p-1 text-sky-400 hover:text-sky-300 disabled:opacity-40">{aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</button>
        </div>
      </div>
    </aside>
  );
}
