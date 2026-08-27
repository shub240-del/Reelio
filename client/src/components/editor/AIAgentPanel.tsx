import React, { useState } from "react";
import {
  Bot,
  Plus,
  Subtitles,
  Search,
  RefreshCw,
  Mic,
  Scissors,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Send,
  Loader2,
  Check,
  CheckSquare,
  Square,
  X,
  FileText,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type EditPlan,
  type EditOp,
  describeOp,
} from "@shared/editOps";

interface AIAgentPanelProps {
  userEmail?: string;
  onExecuteQuickAction: (actionType: string, options?: any) => void;
  onSendMessage: (message: string) => void;
  aiLoading: boolean;
  pendingPlan: EditPlan | null;
  selectedOpIndices: number[];
  onToggleOpSelection: (index: number) => void;
  onApplyPlan: (ops?: any) => void;
  onRejectPlan: () => void;
  aiMessages: { role: string; content: string }[];
}

export const AIAgentPanel: React.FC<AIAgentPanelProps> = ({
  userEmail = "shubhamkumar92240@gmail.com",
  onExecuteQuickAction,
  onSendMessage,
  aiLoading,
  pendingPlan,
  selectedOpIndices,
  onToggleOpSelection,
  onApplyPlan,
  onRejectPlan,
  aiMessages,
}) => {
  const [activeTab, setActiveTab] = useState<"quick" | "report">("quick");
  const [expandedAction, setExpandedAction] = useState<string | null>("silence");
  const [customInput, setCustomInput] = useState("");

  const toggleAccordion = (id: string) => {
    setExpandedAction((prev) => (prev === id ? null : id));
  };

  const handleSend = () => {
    if (!customInput.trim() || aiLoading) return;
    onSendMessage(customInput.trim());
    setCustomInput("");
  };

  return (
    <div className="flex flex-col h-full bg-[#111117] border-l border-white/[0.07] text-white w-80 min-w-[320px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.07] bg-[#0e0e13]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-sky-500/20 text-sky-400 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold tracking-wide text-white">AI Agent</span>
        </div>
        <div className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[10px] text-gray-400 font-mono truncate max-w-[150px]">
          {userEmail}
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center justify-between px-2 border-b border-white/[0.07] bg-[#14141b]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab("quick")}
            className={`py-2 text-xs font-medium relative transition-colors ${
              activeTab === "quick" ? "text-sky-400 font-semibold" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Quick Actions
            {activeTab === "quick" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("report")}
            className={`py-2 text-xs font-medium relative transition-colors ${
              activeTab === "report" ? "text-sky-400 font-semibold" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Video Analysis Report
            {activeTab === "report" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-400 rounded-full" />
            )}
          </button>
        </div>
        <button
          onClick={() => {
            setActiveTab("quick");
            setCustomInput("Make this video a 30 second highlight short.");
          }}
          className="w-5 h-5 rounded hover:bg-white/[0.08] text-gray-400 hover:text-white flex items-center justify-center"
          title="New prompt"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 no-scrollbar">
        {pendingPlan ? (
          /* AI Review Mode */
          <div className="flex flex-col bg-[#161622] border border-sky-500/40 rounded-xl overflow-hidden shadow-xl animate-in fade-in zoom-in-95">
            <div className="p-3 bg-sky-500/10 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400 animate-pulse" />
                <div>
                  <div className="text-xs font-semibold text-white">AI Edit Plan Review</div>
                  <div className="text-[10px] text-gray-400 truncate max-w-[180px]">{pendingPlan.summary}</div>
                </div>
              </div>
              <button onClick={onRejectPlan} className="text-gray-400 hover:text-white p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
              <div className="text-[11px] text-gray-400 flex justify-between">
                <span>Proposed Operations ({pendingPlan.operations.length})</span>
                <span className="text-sky-400 font-medium">{selectedOpIndices.length} selected</span>
              </div>
              {pendingPlan.operations.map((op: EditOp, idx: number) => {
                const isSelected = selectedOpIndices.includes(idx);
                return (
                  <div
                    key={idx}
                    onClick={() => onToggleOpSelection(idx)}
                    className={`p-2 rounded-lg border text-xs cursor-pointer flex items-start gap-2 transition-all ${
                      isSelected
                        ? "bg-sky-500/15 border-sky-500/50 text-white"
                        : "bg-white/[0.02] border-white/[0.06] text-gray-400 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5 text-sky-400">
                      {isSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-200 truncate">{describeOp(op)}</div>
                      {op.type === "removeRanges" && (
                        <div className="text-[10px] text-red-400 font-mono mt-0.5">
                          {op.ranges.map((r: { start: number; end: number }) => `${r.start.toFixed(1)}s–${r.end.toFixed(1)}s`).join(", ")}
                        </div>
                      )}
                      {op.type === "keepRanges" && (
                        <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                          {op.ranges.map((r: { start: number; end: number }) => `${r.start.toFixed(1)}s–${r.end.toFixed(1)}s`).join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t border-white/[0.08] bg-black/40 flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => onApplyPlan()}
                  disabled={selectedOpIndices.length === 0}
                  className="flex-1 h-8 bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium"
                >
                  <Check className="w-3.5 h-3.5 mr-1" />
                  Apply Selected ({selectedOpIndices.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onApplyPlan(pendingPlan.operations)}
                  className="h-8 border-white/15 hover:bg-white/10 text-xs"
                >
                  Apply All
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={onRejectPlan}
                className="h-7 text-[11px] text-gray-400 hover:text-red-400"
              >
                Reject / Dismiss
              </Button>
            </div>
          </div>
        ) : activeTab === "quick" ? (
          /* Quick Action Accordion Cards */
          <div className="space-y-2">
            {/* 1. Auto Captions */}
            <div className="rounded-lg bg-[#181822] border border-white/[0.07] overflow-hidden">
              <button
                onClick={() => toggleAccordion("captions")}
                className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-gray-200 hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <Subtitles className="w-3.5 h-3.5 text-orange-400" />
                  <span>Auto Captions</span>
                </div>
                {expandedAction === "captions" ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {expandedAction === "captions" && (
                <div className="p-2.5 pt-0 text-xs space-y-2 border-t border-white/[0.04]">
                  <p className="text-[11px] text-gray-400 mt-2">
                    Transcribes audio and creates synced subtitles on the Captions track.
                  </p>
                  <Button
                    size="sm"
                    disabled={aiLoading}
                    onClick={() => onExecuteQuickAction("captions")}
                    className="w-full h-7 bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-medium"
                  >
                    Generate Captions
                  </Button>
                </div>
              )}
            </div>

            {/* 2. Remove Silence */}
            <div className="rounded-lg bg-[#181822] border border-white/[0.07] overflow-hidden">
              <button
                onClick={() => toggleAccordion("silence")}
                className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-gray-200 hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-sky-400" />
                  <span>Remove Silence</span>
                </div>
                {expandedAction === "silence" ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {expandedAction === "silence" && (
                <div className="p-2.5 pt-0 text-xs space-y-2 border-t border-white/[0.04]">
                  <p className="text-[11px] text-gray-400 mt-2">
                    Scans audio for dead air and silence pauses greater than 0.4s and ripples timeline.
                  </p>
                  <Button
                    size="sm"
                    disabled={aiLoading}
                    onClick={() => onExecuteQuickAction("silence")}
                    className="w-full h-7 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium"
                  >
                    {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Scissors className="w-3.5 h-3.5 mr-1" />}
                    Detect & Remove Silence
                  </Button>
                </div>
              )}
            </div>

            {/* 3. Detect Restart Phrases */}
            <div className="rounded-lg bg-[#181822] border border-white/[0.07] overflow-hidden">
              <button
                onClick={() => toggleAccordion("restarts")}
                className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-gray-200 hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Detect Restart Phrases</span>
                </div>
                {expandedAction === "restarts" ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {expandedAction === "restarts" && (
                <div className="p-2.5 pt-0 text-xs space-y-2 border-t border-white/[0.04]">
                  <p className="text-[11px] text-gray-400 mt-2">
                    Finds repeated sentences or restarts where you corrected yourself.
                  </p>
                  <Button
                    size="sm"
                    disabled={aiLoading}
                    onClick={() => onExecuteQuickAction("restarts")}
                    className="w-full h-7 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium"
                  >
                    Find Repeated Takes
                  </Button>
                </div>
              )}
            </div>

            {/* 4. Remove Filler Words */}
            <div className="rounded-lg bg-[#181822] border border-white/[0.07] overflow-hidden">
              <button
                onClick={() => toggleAccordion("fillers")}
                className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-gray-200 hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <Mic className="w-3.5 h-3.5 text-purple-400" />
                  <span>Remove Filler Words</span>
                </div>
                {expandedAction === "fillers" ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {expandedAction === "fillers" && (
                <div className="p-2.5 pt-0 text-xs space-y-2 border-t border-white/[0.04]">
                  <p className="text-[11px] text-gray-400 mt-2">
                    Removes "um", "uh", "like", "you know" speech patterns seamlessly.
                  </p>
                  <Button
                    size="sm"
                    disabled={aiLoading}
                    onClick={() => onExecuteQuickAction("fillers")}
                    className="w-full h-7 bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-medium"
                  >
                    Remove Fillers ("um", "like")
                  </Button>
                </div>
              )}
            </div>

            {/* 5. Remove First Takes */}
            <div className="rounded-lg bg-[#181822] border border-white/[0.07] overflow-hidden">
              <button
                onClick={() => toggleAccordion("firsttakes")}
                className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-gray-200 hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <Scissors className="w-3.5 h-3.5 text-rose-400" />
                  <span>Remove First Takes</span>
                </div>
                {expandedAction === "firsttakes" ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {expandedAction === "firsttakes" && (
                <div className="p-2.5 pt-0 text-xs space-y-2 border-t border-white/[0.04]">
                  <p className="text-[11px] text-gray-400 mt-2">
                    Trims off camera setup, claps, and warmup intro takes before primary speech.
                  </p>
                  <Button
                    size="sm"
                    disabled={aiLoading}
                    onClick={() => onExecuteQuickAction("firsttakes")}
                    className="w-full h-7 bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-medium"
                  >
                    Trim Warmup Takes
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Video Analysis Report Tab */
          <div className="space-y-3 p-1">
            <div className="p-3 rounded-lg bg-[#181822] border border-white/[0.07]">
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 mb-1.5">
                <FileText className="w-4 h-4" />
                Intelligence Summary
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed">
                Timeline analyzed across video, audio waveforms, and speech transcripts with NVIDIA NIM reasoning.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-2.5 rounded-lg bg-[#181822] border border-white/[0.07]">
                <div className="text-sm font-bold text-white">4K / 1080p</div>
                <div className="text-[10px] text-gray-400">Resolution</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#181822] border border-white/[0.07]">
                <div className="text-sm font-bold text-emerald-400">Indexed</div>
                <div className="text-[10px] text-gray-400">Media State</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Natural Language Prompt Box at bottom */}
      <div className="p-2.5 border-t border-white/[0.07] bg-[#0e0e13]">
        <div className="relative flex items-center">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Ask AI Agent to edit..."
            disabled={aiLoading}
            className="w-full bg-[#181822] border border-white/[0.08] rounded-md pl-3 pr-8 py-1.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-sky-500/50"
          />
          <button
            onClick={handleSend}
            disabled={aiLoading || !customInput.trim()}
            className="absolute right-1.5 p-1 text-sky-400 hover:text-sky-300 disabled:opacity-40"
          >
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
