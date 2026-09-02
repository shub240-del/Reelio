import { useEffect, useState, type ComponentType } from "react";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Circle,
  ListPlus,
  Loader2,
  Mic,
  Music2,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  TextCursorInput,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { type EditPlan, type EditOp, describeOp } from "@shared/editOps";

interface AIAgentPanelProps {
  userEmail?: string;
  onExecuteQuickAction: (actionType: string) => void;
  onSendMessage: (message: string) => void;
  onNewChat: () => void;
  aiLoading: boolean;
  aiPhase:
    | "idle"
    | "analysing"
    | "requesting"
    | "applying"
    | "cancelling"
    | "error";
  aiAvailable: boolean;
  assetCount: number;
  timelineDuration: number;
  pendingPlan: EditPlan | null;
  selectedOpIndices: number[];
  onToggleOpSelection: (index: number) => void;
  onPreviewOperation?: (index: number) => void;
  onApplyPlan: (ops?: EditOp[]) => void;
  onRejectPlan: () => void;
  onCancel: () => void;
  onRetry: () => void;
  canRetry: boolean;
  proposalProvenance: {
    source: string;
    provider: string | null;
    observations: string[];
    inferences: string[];
    unsupported: string[];
  } | null;
  aiMessages: { role: string; content: string }[];
}

interface QuickAction {
  id: string;
  title: string;
  description: string;
  button: string;
  icon: ComponentType<{ className?: string }>;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "auto-captions",
    title: "Auto Captions",
    description:
      "Generate measured, timestamped cues with the configured speech provider. No placeholder transcript text is created.",
    button: "Generate captions",
    icon: TextCursorInput,
  },
  {
    id: "silence",
    title: "Remove Silence",
    description:
      "Measure low-amplitude ranges from the real audio track, then review every proposed cut before applying it.",
    button: "Detect silence",
    icon: Search,
  },
  {
    id: "restart-phrases",
    title: "Detect Restart Phrases",
    description:
      "Ask the agent to identify repeated phrase starts. Cuts are proposed only when timestamped evidence supports them.",
    button: "Review restart phrases",
    icon: RotateCcw,
  },
  {
    id: "filler-words",
    title: "Remove Filler Words",
    description:
      "Use exact word timestamps from a completed transcript and open a reviewable, undoable removal proposal.",
    button: "Review filler words",
    icon: TextCursorInput,
  },
  {
    id: "first-takes",
    title: "Remove First Takes",
    description:
      "Ask the agent to find abandoned first takes and prepare supported cuts for review without changing the timeline.",
    button: "Review first takes",
    icon: Scissors,
  },
  {
    id: "sync-music",
    title: "Cut to Beat",
    description:
      "Prepare a timing proposal from media already on the timeline. Unsupported beat claims are not invented.",
    button: "Review music sync",
    icon: Music2,
  },
  {
    id: "create-short",
    title: "Create Short",
    description:
      "Ask for a concise cut using the current timeline and selection. The agent must return reviewable edit operations before anything changes.",
    button: "Review short edit",
    icon: Scissors,
  },
];

function EmptyAgentState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-start px-4 pb-2 pt-2 text-center">
      <svg
        viewBox="0 0 112 112"
        className="mb-1 h-14 w-14"
        role="img"
        aria-label="AI agent"
      >
        <path
          d="M56 17V29"
          stroke="#9b9b9f"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <circle cx="56" cy="14" r="6" fill="#9b9b9f" />
        <rect
          x="27"
          y="29"
          width="58"
          height="62"
          rx="23"
          fill="none"
          stroke="#9b9b9f"
          strokeWidth="6"
        />
        <path
          d="M27 49H22C18.7 49 16 51.7 16 55V68C16 71.3 18.7 74 22 74H27M85 49H90C93.3 49 96 51.7 96 55V68C96 71.3 93.3 74 90 74H85"
          fill="none"
          stroke="#9b9b9f"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <rect x="42" y="51" width="10" height="18" rx="5" fill="#4f8fe8" />
        <rect x="66" y="51" width="10" height="18" rx="5" fill="#4f8fe8" />
      </svg>
      <p className="max-w-[230px] text-[12px] leading-4 text-[#74747c]">
        Ask for edits directly, like cut clips, add captions, or fix timing.
      </p>
    </div>
  );
}

export function AIAgentPanel({
  userEmail = "Local workspace",
  onExecuteQuickAction,
  onSendMessage,
  onNewChat,
  aiLoading,
  aiPhase,
  aiAvailable,
  assetCount,
  timelineDuration,
  pendingPlan,
  selectedOpIndices,
  onToggleOpSelection,
  onPreviewOperation,
  onApplyPlan,
  onRejectPlan,
  onCancel,
  onRetry,
  canRetry,
  proposalProvenance,
  aiMessages,
}: AIAgentPanelProps) {
  const [activeTab, setActiveTab] = useState<"quick" | "chat">("quick");
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [showContext, setShowContext] = useState(false);

  useEffect(() => {
    if (pendingPlan) setActiveTab("chat");
  }, [pendingPlan]);

  const handleSend = () => {
    const message = customInput.trim();
    if (!message || aiLoading) return;
    onSendMessage(message);
    setCustomInput("");
    setActiveTab("chat");
  };

  const startNewChat = () => {
    onNewChat();
    setCustomInput("");
    setActiveTab("chat");
  };

  return (
    <aside
      className="flex min-h-[420px] w-full min-w-0 flex-col border-white/[0.09] bg-[#151518] text-white lg:h-full lg:min-h-0 lg:border-l"
      aria-label="Reelio AI Agent"
      data-ai-provider-ready={aiAvailable}
      data-asset-count={assetCount}
      data-timeline-duration={timelineDuration.toFixed(3)}
    >
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-white/[0.09] bg-[#17171a] px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Bot className="h-6 w-6 shrink-0 text-[#f1f1f2]" strokeWidth={2.2} />
          <h2 className="truncate text-[20px] font-bold tracking-[-0.035em] text-[#f4f4f5]">
            AI Agent
          </h2>
        </div>
        <div
          className="ml-3 flex min-w-0 max-w-[116px] items-center gap-2 text-left text-[11px] text-[#77777f] hover:text-[#a4a4aa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8fe8]"
          aria-label={`AI Agent account context: ${userEmail}`}
          title={userEmail}
        >
          <span className="truncate">{userEmail}</span>
        </div>
      </header>

      <div
        className="flex h-9 shrink-0 items-stretch border-b border-white/[0.09] bg-[#17171a] px-3"
        role="tablist"
        aria-label="AI Agent views"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "quick"}
          onClick={() => setActiveTab("quick")}
          className={`relative flex min-w-[116px] items-center gap-1.5 px-1 text-[13px] font-semibold focus-visible:outline-none focus-visible:bg-white/[0.035] ${
            activeTab === "quick"
              ? "text-[#f2f2f3]"
              : "text-[#74747c] hover:text-[#a4a4aa]"
          }`}
        >
          <ListPlus className="h-4 w-4" />
          Quick Actions
          {activeTab === "quick" ? (
            <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-[#57a6f6]" />
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
          className={`relative ml-3 flex min-w-[64px] items-center justify-center px-0 text-[13px] font-semibold focus-visible:outline-none focus-visible:bg-white/[0.035] ${
            activeTab === "chat"
              ? "text-[#f2f2f3]"
              : "text-[#74747c] hover:text-[#a4a4aa]"
          }`}
        >
          New Chat
          {activeTab === "chat" ? (
            <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-[#57a6f6]" />
          ) : null}
        </button>
        <button
          type="button"
          onClick={startNewChat}
          disabled={aiLoading}
          className="my-1 ml-auto flex w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.11] text-[#8c8c92] hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8fe8] disabled:opacity-40"
          aria-label="Start a new AI chat"
          title="Start a new chat"
        >
          <Plus className="h-5 w-5" strokeWidth={1.7} />
        </button>
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {aiPhase === "analysing"
          ? "Analysing local media evidence"
          : aiPhase === "requesting"
            ? "Requesting a server-side edit proposal"
            : aiPhase === "applying"
              ? "Applying validated edits"
              : aiPhase === "cancelling"
                ? "Cancelling request"
                : aiPhase === "error"
                  ? "The last AI request failed"
                  : "AI Agent ready"}
      </div>

      {activeTab === "quick" ? (
        <div className="flex-1 overflow-y-auto px-3 py-2 no-scrollbar">
          <section className="space-y-2" aria-label="AI quick actions">
            {QUICK_ACTIONS.map(action => {
              const Icon = action.icon;
              const open = expandedAction === action.id;
              return (
                <div
                  key={action.id}
                  className="overflow-hidden rounded-md border border-white/[0.12] bg-[#17171a]"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpandedAction(open ? null : action.id)}
                    className="flex min-h-8 w-full items-center justify-center gap-2 px-3 text-[12px] font-semibold text-[#9a9aa2] hover:bg-white/[0.025] hover:text-[#c4c4c8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4f8fe8]"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{action.title}</span>
                    {open ? (
                      <ChevronUp className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  {open ? (
                    <div className="space-y-3 border-t border-white/[0.08] px-4 pb-4 pt-3">
                      <p className="text-[12px] leading-5 text-[#7e7e86]">
                        {action.description}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        disabled={aiLoading || assetCount === 0}
                        onClick={() => {
                          onExecuteQuickAction(action.id);
                          setActiveTab("chat");
                        }}
                        className="h-8 w-full bg-[#3f7fbf] text-[12px] text-white hover:bg-[#4d91d4]"
                      >
                        {aiLoading ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {action.button}
                      </Button>
                      {assetCount === 0 ? (
                        <p className="text-center text-[10px] text-[#68686f]">
                          Add media to the project to use this action.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {aiMessages.length === 0 && !pendingPlan ? (
              <EmptyAgentState />
            ) : (
              <div className="space-y-3 p-4" aria-live="polite">
                {aiMessages.slice(-8).map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`whitespace-pre-wrap rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed ${
                      message.role === "user"
                        ? "ml-10 border-[#4f8fe8]/30 bg-[#4f8fe8]/10 text-[#dcecff]"
                        : "mr-10 border-white/[0.08] bg-[#202023] text-[#c1c1c6]"
                    }`}
                  >
                    <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#6e6e75]">
                      {message.role === "user" ? "You" : "Reelio"}
                    </span>
                    {message.content}
                  </div>
                ))}

                {pendingPlan ? (
                  <section
                    className="overflow-hidden rounded-xl border border-[#4f8fe8]/40 bg-[#1a1a20]"
                    aria-label="Edit plan review"
                  >
                    <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#4f8fe8]/10 p-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white">
                          Edit plan review
                        </div>
                        <div className="truncate text-[10px] text-[#8a8a92]">
                          {pendingPlan.summary}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onRejectPlan}
                        aria-label="Dismiss edit plan"
                        className="rounded p-1 text-[#8a8a92] hover:bg-white/5 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-y-auto p-3">
                      {proposalProvenance ? (
                        <p className="rounded-lg border border-white/[0.07] bg-black/20 p-2 text-[10px] leading-relaxed text-[#8a8a92]">
                          <span className="font-semibold text-[#c6c6ca]">
                            Source:
                          </span>{" "}
                          {proposalProvenance.source}
                          {proposalProvenance.provider
                            ? ` (${proposalProvenance.provider})`
                            : ""}
                        </p>
                      ) : null}
                      {pendingPlan.operations.map((op, index) => {
                        const selected = selectedOpIndices.includes(index);
                        return (
                          <button
                            key={index}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                              onToggleOpSelection(index);
                              onPreviewOperation?.(index);
                            }}
                            className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left text-xs ${
                              selected
                                ? "border-[#4f8fe8]/50 bg-[#4f8fe8]/15 text-white"
                                : "border-white/[0.06] bg-white/[0.02] text-[#8a8a92]"
                            }`}
                          >
                            {selected ? (
                              <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#57a6f6]" />
                            ) : (
                              <Square className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            )}
                            <span>{describeOp(op)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2 border-t border-white/[0.08] bg-black/25 p-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => onApplyPlan()}
                          disabled={selectedOpIndices.length === 0 || aiLoading}
                          className="h-8 flex-1 bg-[#3f7fbf] text-xs text-white hover:bg-[#4d91d4]"
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Apply selected
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onApplyPlan(pendingPlan.operations)}
                          disabled={aiLoading}
                          className="h-8 border-white/15 text-xs"
                        >
                          Apply all
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onRejectPlan}
                        className="h-7 w-full text-[11px] text-[#8a8a92] hover:text-red-300"
                      >
                        Reject without changes
                      </Button>
                    </div>
                  </section>
                ) : null}

                {aiPhase === "error" ? (
                  <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-[11px] text-rose-200">
                    <AlertCircle className="h-3.5 w-3.5" />
                    The last request failed.
                    {canRetry ? (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="ml-auto font-semibold text-white underline underline-offset-2"
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/[0.09] bg-[#17171a] p-2">
            <div className="rounded-[11px] border border-white/[0.1] bg-[#242427] px-2 pb-1 pt-1 shadow-sm">
              <label htmlFor="reelio-edit-prompt" className="sr-only">
                Message the edit assistant
              </label>
              <textarea
                id="reelio-edit-prompt"
                rows={1}
                value={customInput}
                onChange={event => setCustomInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                  if (event.key === "Escape" && aiLoading) onCancel();
                }}
                placeholder="Message..."
                disabled={aiLoading}
                className="min-h-7 w-full resize-none bg-transparent px-1 py-1 text-[12px] leading-4 text-white outline-none placeholder:text-[#77777f] disabled:opacity-50"
              />
              {showContext ? (
                <div
                  className="mb-2 grid grid-cols-3 gap-1.5 rounded-lg border border-white/[0.07] bg-black/20 p-2 text-center"
                  aria-label="Timeline context supplied to the AI Agent"
                >
                  <div>
                    <span className="block text-[9px] text-[#68686f]">Media</span>
                    <span className="text-[10px] font-medium text-[#b8b8bd]">{assetCount}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-[#68686f]">Timeline</span>
                    <span className="text-[10px] font-medium text-[#b8b8bd]">{timelineDuration.toFixed(1)}s</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-[#68686f]">AI provider</span>
                    <span className="text-[10px] font-medium text-[#b8b8bd]">{aiAvailable ? "Ready" : "Local only"}</span>
                  </div>
                </div>
              ) : null}
              <div className="flex h-7 items-center gap-2 text-[12px] text-[#a0a0a6]">
                <Circle className="h-5 w-5 text-[#696970]" strokeWidth={4} />
                <span
                  className="flex items-center gap-1.5 rounded px-0.5 py-1 hover:text-white"
                  title="Requests create reviewable edit proposals"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>Ask</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowContext(open => !open)}
                  aria-expanded={showContext}
                  className="flex items-center gap-1.5 rounded px-0.5 py-1 hover:text-white"
                  title="Timeline context"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>Context</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled
                  className="ml-auto rounded p-1 text-[#aaaab0] disabled:opacity-80"
                  aria-label="Voice input is not configured"
                  title="Voice input is not configured"
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={aiLoading ? onCancel : handleSend}
                  disabled={!aiLoading && !customInput.trim()}
                  aria-label={aiLoading ? "Cancel AI request" : "Send message"}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3f7fbf] text-[#b9d8f6] hover:bg-[#4b8dcc] hover:text-white disabled:opacity-55"
                >
                  {aiLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : customInput.trim() ? (
                    <Send className="h-4 w-4" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
