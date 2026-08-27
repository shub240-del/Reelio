import React from "react";
import {
  Undo2,
  Redo2,
  Scissors,
  Trash2,
  Bookmark,
  Magnet,
  Layers,
  Minus,
  Plus,
  SplitSquareVertical,
  Maximize2,
  Sparkles,
  Zap,
} from "lucide-react";

interface TimelineToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canSplit: boolean;
  onSplit: () => void;
  canDelete: boolean;
  onDelete: () => void;
  onAddMarker: () => void;
  snapping: boolean;
  onToggleSnapping: () => void;
  currentTime: number;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleRipple?: () => void;
  isRippleActive?: boolean;
}

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30); // 30 FPS frames
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
}

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canSplit,
  onSplit,
  canDelete,
  onDelete,
  onAddMarker,
  snapping,
  onToggleSnapping,
  currentTime,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onToggleRipple,
  isRippleActive = false,
}) => {
  return (
    <div className="h-11 bg-[#101016] border-t border-b border-white/[0.07] px-4 flex items-center justify-between text-xs select-none">
      {/* Left Operations Group */}
      <div className="flex items-center gap-1.5">
        {/* Undo / Redo */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
            canUndo ? "text-gray-300 hover:text-white hover:bg-white/[0.06]" : "text-gray-600 cursor-not-allowed"
          }`}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
            canRedo ? "text-gray-300 hover:text-white hover:bg-white/[0.06]" : "text-gray-600 cursor-not-allowed"
          }`}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-[1px] h-4 bg-white/[0.1] mx-1" />

        {/* SPLIT Button */}
        <button
          onClick={onSplit}
          disabled={!canSplit}
          className={`h-7 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1.5 transition-all uppercase tracking-wider ${
            canSplit
              ? "bg-white/[0.04] text-gray-200 border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.2]"
              : "text-gray-600 border border-white/[0.03] cursor-not-allowed"
          }`}
          title="Split clip at playhead (S)"
        >
          <Scissors className="w-3 h-3" />
          <span>Split</span>
        </button>

        {/* DELETE Button */}
        <button
          onClick={onDelete}
          disabled={!canDelete}
          className={`h-7 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1.5 transition-all uppercase tracking-wider ${
            canDelete
              ? "bg-white/[0.04] text-gray-200 border border-white/[0.08] hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40"
              : "text-gray-600 border border-white/[0.03] cursor-not-allowed"
          }`}
          title="Delete selected clip (Del)"
        >
          <Trash2 className="w-3 h-3" />
          <span>Delete</span>
        </button>

        {/* MARKER Button */}
        <button
          onClick={onAddMarker}
          className="h-7 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1.5 bg-white/[0.04] text-gray-200 border border-white/[0.08] hover:bg-white/[0.08] uppercase tracking-wider transition-all"
          title="Add Marker (M)"
        >
          <Bookmark className="w-3 h-3 text-sky-400" />
          <span>Marker</span>
        </button>

        {/* SNAPPING Toggle */}
        <button
          onClick={onToggleSnapping}
          className={`h-7 px-3 rounded text-[11px] font-semibold flex items-center gap-1.5 uppercase tracking-wider transition-all ${
            snapping
              ? "bg-sky-500/20 text-sky-300 border border-sky-500/50 shadow-[0_0_10px_rgba(56,189,248,0.2)]"
              : "bg-white/[0.04] text-gray-400 border border-white/[0.08] hover:text-white"
          }`}
          title="Toggle snapping"
        >
          <Magnet className="w-3.5 h-3.5" />
          <span>Snapping</span>
        </button>

        {/* GROUP Button */}
        <button
          className="h-7 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1.5 bg-white/[0.04] text-gray-400 border border-white/[0.08] hover:text-white uppercase tracking-wider transition-all opacity-70 hover:opacity-100"
          title="Group clips"
        >
          <Layers className="w-3 h-3" />
          <span>Group</span>
        </button>
      </div>

      {/* Center LCD Timecode Display */}
      <div className="flex items-center justify-center">
        <div className="px-4 py-1 rounded bg-[#0b0b10] border border-sky-500/30 font-mono text-sm font-semibold tracking-widest text-sky-400 shadow-[inset_0_1px_4px_rgba(0,0,0,0.8)]">
          {formatTimecode(currentTime)}
        </div>
      </div>

      {/* Right Tools & Zoom Stepper */}
      <div className="flex items-center gap-2">
        {/* Ripple / Slip Tool */}
        <button
          onClick={onToggleRipple}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
            isRippleActive
              ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
              : "text-gray-400 hover:text-white hover:bg-white/[0.06]"
          }`}
          title="Ripple Edit Mode"
        >
          <Zap className="w-3.5 h-3.5" />
        </button>

        {/* View Mode icons */}
        <div className="flex items-center bg-[#15151f] rounded p-0.5 border border-white/[0.08]">
          <button className="w-6 h-6 rounded bg-sky-500/30 text-sky-300 flex items-center justify-center">
            <SplitSquareVertical className="w-3 h-3" />
          </button>
        </div>

        {/* Zoom Stepper: - 2.48 px/sec + */}
        <div className="flex items-center bg-[#15151f] rounded border border-white/[0.08] px-1 py-0.5">
          <button
            onClick={onZoomOut}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white"
            title="Zoom out"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="px-2 font-mono text-[11px] text-gray-300">
            {(zoomLevel / 25).toFixed(2)} px/sec
          </span>
          <button
            onClick={onZoomIn}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white"
            title="Zoom in"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
