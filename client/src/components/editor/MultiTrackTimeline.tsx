import React, { useRef } from "react";
import {
  Subtitles,
  Film,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Sparkles,
} from "lucide-react";
import { type CaptionCue, type ReviewRangeHighlight } from "@shared/editOps";

export interface TimelineClipItem {
  id: number;
  assetId: number;
  assetUrl: string;
  assetName: string;
  trackId: number;
  trackType: "video" | "audio";
  sourceStart: number;
  duration: number;
  timelineStart: number;
  sortIndex: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  transition?: string | null;
  videoFx?: string | null;
}

export interface TrackState {
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

interface MultiTrackTimelineProps {
  clips: TimelineClipItem[];
  captions: CaptionCue[];
  currentTime: number;
  totalDuration: number;
  zoomLevel: number;
  selectedClipIds: number[];
  onSelectClip: (id: number, multi?: boolean) => void;
  onSeek: (time: number) => void;
  onClipDragStart?: (clip: TimelineClipItem, e: React.MouseEvent) => void;
  onClipTrimStart?: (clip: TimelineClipItem, edge: "start" | "end", e: React.MouseEvent) => void;
  onClipDoubleClick?: (clip: TimelineClipItem) => void;
  onClipContextMenu?: (clip: TimelineClipItem, e: React.MouseEvent) => void;
  dragPreview?: { id: number; start: number } | null;
  trimPreview?: { id: number; start: number; duration: number } | null;
  snapGuide?: number | null;
  reviewHighlights?: ReviewRangeHighlight[];
  trackStates?: Record<string, TrackState>;
  onToggleTrackMute?: (trackKey: string) => void;
  onToggleTrackLock?: (trackKey: string) => void;
  onToggleTrackVisible?: (trackKey: string) => void;
  getWaveformData?: (assetId: number) => number[];
}

function formatRulerTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${ms.toString().padStart(2, "0")}`;
}

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  clips,
  captions,
  currentTime,
  totalDuration,
  zoomLevel,
  selectedClipIds,
  onSelectClip,
  onSeek,
  onClipDragStart,
  onClipTrimStart,
  onClipDoubleClick,
  onClipContextMenu,
  dragPreview,
  trimPreview,
  snapGuide,
  reviewHighlights = [],
  trackStates = {
    captions: { muted: false, locked: false, visible: true },
    video0: { muted: false, locked: false, visible: true },
    audio0: { muted: false, locked: false, visible: true },
    audio1: { muted: false, locked: false, visible: true },
  },
  onToggleTrackMute,
  onToggleTrackLock,
  onToggleTrackVisible,
  getWaveformData,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const videoClips = clips.filter((c) => c.trackType === "video");
  const audio1Clips = clips.filter((c) => c.trackType === "audio" && c.trackId === 0);
  const audio2Clips = clips.filter((c) => c.trackType === "audio" && c.trackId > 0);

  const timelineWidth = Math.max(totalDuration * zoomLevel, 1400);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0);
    const newTime = Math.max(0, Math.min(totalDuration, clickX / zoomLevel));
    onSeek(newTime);
  };

  return (
    <div className="flex flex-1 h-full bg-[#0d0d12] overflow-hidden select-none">
      {/* Fixed Left Track Headers Column */}
      <div className="w-48 bg-[#121218] border-r border-white/[0.08] flex flex-col flex-shrink-0 z-30 shadow-lg">
        {/* + Track Header */}
        <div className="h-8 border-b border-white/[0.06] px-3 flex items-center justify-between bg-[#0e0e14]">
          <button className="flex items-center gap-1 text-[11px] font-semibold text-gray-300 hover:text-white bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.08] transition-colors">
            <Plus className="w-3 h-3 text-sky-400" />
            <span>Track</span>
            <ChevronDown className="w-3 h-3 ml-1 text-gray-400" />
          </button>
        </div>

        {/* Track 1: Captions (Orange) */}
        <div className="h-16 border-b border-white/[0.06] p-2 flex flex-col justify-between bg-[#15151c]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded bg-orange-600/30 text-orange-400 border border-orange-500/40 flex items-center justify-center">
                <Subtitles className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-orange-400">Captions</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <button
              onClick={() => onToggleTrackVisible?.("captions")}
              className={`hover:text-white transition-colors ${!trackStates.captions?.visible ? "text-gray-600" : ""}`}
              title="Toggle track visibility"
            >
              {trackStates.captions?.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
            <button
              onClick={() => onToggleTrackLock?.("captions")}
              className={`hover:text-white transition-colors ${trackStates.captions?.locked ? "text-amber-400" : ""}`}
              title="Toggle track lock"
            >
              {trackStates.captions?.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Track 2: Video 1 (Green) */}
        <div className="h-20 border-b border-white/[0.06] p-2 flex flex-col justify-between bg-[#15151c]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 flex items-center justify-center">
                <Film className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-emerald-400">Video 1</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <button
              onClick={() => onToggleTrackVisible?.("video0")}
              className={`hover:text-white transition-colors ${!trackStates.video0?.visible ? "text-gray-600" : ""}`}
              title="Toggle track visibility"
            >
              {trackStates.video0?.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
            <button
              onClick={() => onToggleTrackLock?.("video0")}
              className={`hover:text-white transition-colors ${trackStates.video0?.locked ? "text-amber-400" : ""}`}
              title="Toggle track lock"
            >
              {trackStates.video0?.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Track 3: Audio 1 (Blue) */}
        <div className="h-16 border-b border-white/[0.06] p-2 flex flex-col justify-between bg-[#15151c]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded bg-sky-600/30 text-sky-400 border border-sky-500/40 flex items-center justify-center">
                <Volume2 className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-sky-400">Audio 1</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <button
              onClick={() => onToggleTrackMute?.("audio0")}
              className={`hover:text-white transition-colors ${trackStates.audio0?.muted ? "text-red-400" : ""}`}
              title="Toggle track mute"
            >
              {trackStates.audio0?.muted ? <VolumeX className="w-3 h-3 text-red-400" /> : <Volume2 className="w-3 h-3" />}
            </button>
            <button
              onClick={() => onToggleTrackLock?.("audio0")}
              className={`hover:text-white transition-colors ${trackStates.audio0?.locked ? "text-amber-400" : ""}`}
              title="Toggle track lock"
            >
              {trackStates.audio0?.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Track 4: Audio 2 (Purple) */}
        <div className="h-16 border-b border-white/[0.06] p-2 flex flex-col justify-between bg-[#15151c]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded bg-purple-600/30 text-purple-400 border border-purple-500/40 flex items-center justify-center">
                <Volume2 className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-purple-400">Audio 2</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <button
              onClick={() => onToggleTrackMute?.("audio1")}
              className={`hover:text-white transition-colors ${trackStates.audio1?.muted ? "text-red-400" : ""}`}
              title="Toggle track mute"
            >
              {trackStates.audio1?.muted ? <VolumeX className="w-3 h-3 text-red-400" /> : <Volume2 className="w-3 h-3" />}
            </button>
            <button
              onClick={() => onToggleTrackLock?.("audio1")}
              className={`hover:text-white transition-colors ${trackStates.audio1?.locked ? "text-amber-400" : ""}`}
              title="Toggle track lock"
            >
              {trackStates.audio1?.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Timeline Scrollable Container */}
      <div
        ref={containerRef}
        onClick={handleTimelineClick}
        className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar relative bg-[#0b0b10]"
      >
        <div className="relative min-h-full" style={{ width: `${timelineWidth}px` }}>
          {/* Time Ruler */}
          <div className="h-8 border-b border-white/[0.08] bg-[#0f0f16] relative cursor-pointer">
            {Array.from({ length: Math.ceil(totalDuration / 10) + 1 }, (_, i) => {
              const sec = i * 10;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-white/[0.08] pl-1 pt-1"
                  style={{ left: `${sec * zoomLevel}px` }}
                >
                  <span className="text-[10px] font-mono text-gray-500 font-medium">
                    {formatRulerTime(sec)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Magnetic Snapping Guide Line */}
          {snapGuide !== null && snapGuide !== undefined && (
            <div
              className="absolute top-0 bottom-0 w-[1px] bg-yellow-400 z-50 pointer-events-none shadow-[0_0_8px_rgba(250,204,21,0.8)]"
              style={{ left: `${snapGuide * zoomLevel}px` }}
            />
          )}

          {/* AI Review Mode Overlay Stripes across tracks */}
          {reviewHighlights.map((hl, idx) => {
            const isRemove = hl.type === "remove";
            const isKeep = hl.type === "keep";
            return (
              <div
                key={`review-hl-${idx}`}
                className={`absolute top-0 bottom-0 pointer-events-none z-30 rounded border transition-all ${
                  isRemove
                    ? "bg-red-500/20 border-red-500/60 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                    : isKeep
                    ? "bg-emerald-500/20 border-emerald-500/60 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                    : "bg-amber-500/20 border-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]"
                }`}
                style={{
                  left: `${hl.start * zoomLevel}px`,
                  width: `${Math.max(4, (hl.end - hl.start) * zoomLevel)}px`,
                }}
              >
                <div
                  className={`text-[9px] font-mono font-semibold px-1 py-0.5 rounded-br inline-block truncate max-w-full ${
                    isRemove
                      ? "bg-red-950/90 text-red-300 border-b border-r border-red-500/40"
                      : isKeep
                      ? "bg-emerald-950/90 text-emerald-300 border-b border-r border-emerald-500/40"
                      : "bg-amber-950/90 text-amber-300 border-b border-r border-amber-500/40"
                  }`}
                >
                  {hl.label}
                </div>
              </div>
            );
          })}

          {/* Glowing Blue Playhead Line across all tracks */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-sky-400 z-40 pointer-events-none shadow-[0_0_10px_rgba(56,189,248,0.9)]"
            style={{ left: `${currentTime * zoomLevel}px` }}
          >
            {/* Playhead Top Needle Head */}
            <div className="w-3.5 h-3.5 -ml-[6px] -top-1 bg-sky-400 rounded-sm rotate-45 border border-white shadow-lg pointer-events-none" />
          </div>

          {/* 1. Captions Track Content (Orange) */}
          <div className="h-16 border-b border-white/[0.04] relative bg-[#101017]">
            {trackStates.captions?.visible !== false &&
              captions.map((cue, idx) => (
                <div
                  key={idx}
                  className="absolute top-1 bottom-1 rounded border border-orange-500/80 bg-orange-600/20 text-orange-200 text-[10px] p-1 truncate overflow-hidden flex items-center shadow-sm hover:border-orange-400 cursor-pointer"
                  style={{
                    left: `${cue.startTime * zoomLevel}px`,
                    width: `${Math.max(16, (cue.endTime - cue.startTime) * zoomLevel)}px`,
                  }}
                  title={cue.text}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(cue.startTime);
                  }}
                >
                  <span className="font-mono text-orange-300 mr-1 font-bold">B|</span>
                  <span className="truncate">{cue.text}</span>
                </div>
              ))}
          </div>

          {/* 2. Video 1 Track Content (Green with Cross Dissolve) */}
          <div className="h-20 border-b border-white/[0.04] relative bg-[#0e0e15]">
            {trackStates.video0?.visible !== false &&
              videoClips.map((clip) => {
                const isSelected = selectedClipIds.includes(clip.id);
                const startPos =
                  dragPreview?.id === clip.id
                    ? dragPreview.start
                    : trimPreview?.id === clip.id
                    ? trimPreview.start
                    : clip.timelineStart;
                const clipDur = trimPreview?.id === clip.id ? trimPreview.duration : clip.duration;
                const clipWidth = clipDur * zoomLevel;

                return (
                  <div
                    key={clip.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClip(clip.id, e.shiftKey || e.metaKey);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onClipDoubleClick?.(clip);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClipContextMenu?.(clip, e);
                    }}
                    onMouseDown={(e) => {
                      if (!trackStates.video0?.locked) {
                        onClipDragStart?.(clip, e);
                      }
                    }}
                    className={`absolute top-1 bottom-1 rounded-md overflow-hidden cursor-grab active:cursor-grabbing transition-all flex flex-col justify-between ${
                      isSelected
                        ? "ring-2 ring-sky-400 bg-emerald-700/60 border border-emerald-400 shadow-lg z-20"
                        : "bg-emerald-800/40 border border-emerald-500/40 hover:border-emerald-400"
                    } ${clip.locked || trackStates.video0?.locked ? "opacity-75 cursor-not-allowed" : ""}`}
                    style={{
                      left: `${startPos * zoomLevel}px`,
                      width: `${Math.max(20, clipWidth)}px`,
                    }}
                  >
                    {/* Clip Header Label */}
                    <div className="px-2 py-0.5 text-[10px] font-medium text-emerald-100 truncate bg-emerald-950/60 flex items-center justify-between">
                      <span className="truncate font-semibold">{clip.assetName}</span>
                      {clip.videoFx && (
                        <span className="text-[9px] px-1 py-0.2 bg-sky-500/30 text-sky-200 rounded font-mono">
                          {clip.videoFx}
                        </span>
                      )}
                    </div>

                    {/* Video Filmstrip / Pattern */}
                    <div className="flex-1 flex items-center px-1 overflow-hidden opacity-70">
                      <div className="w-full h-full flex items-center justify-around">
                        {Array.from({ length: Math.min(30, Math.floor(clipWidth / 12)) }).map((_, i) => (
                          <div key={i} className="w-1 h-full bg-emerald-400/20 border-r border-emerald-400/30" />
                        ))}
                      </div>
                    </div>

                    {/* Transition Overlay Banner */}
                    {(clip.transition || clip.id % 2 === 0) && (
                      <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(16,185,129,0.15)_25%,transparent_25%,transparent_50%,rgba(16,185,129,0.15)_50%,rgba(16,185,129,0.15)_75%,transparent_75%,transparent)] bg-[length:12px_12px] pointer-events-none flex items-center justify-center">
                        <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[9px] font-semibold text-emerald-300 border border-emerald-400/30 flex items-center gap-1 shadow-sm">
                          <Sparkles className="w-2.5 h-2.5" />
                          {clip.transition || "Cross Dissolve"}
                        </span>
                      </div>
                    )}

                    {/* Trim Handles */}
                    {!trackStates.video0?.locked && (
                      <>
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onClipTrimStart?.(clip, "start", e);
                          }}
                          className="absolute left-0 top-0 bottom-0 w-2 bg-emerald-400/40 hover:bg-emerald-300 cursor-ew-resize z-10"
                          title="Drag to trim start"
                        />
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onClipTrimStart?.(clip, "end", e);
                          }}
                          className="absolute right-0 top-0 bottom-0 w-2 bg-emerald-400/40 hover:bg-emerald-300 cursor-ew-resize z-10"
                          title="Drag to trim end"
                        />
                      </>
                    )}
                  </div>
                );
              })}
          </div>

          {/* 3. Audio 1 Track Content (Blue Waveform) */}
          <div className="h-16 border-b border-white/[0.04] relative bg-[#0e0e15]">
            {trackStates.audio0?.visible !== false &&
              audio1Clips.map((clip) => {
                const isSelected = selectedClipIds.includes(clip.id);
                const startPos =
                  dragPreview?.id === clip.id
                    ? dragPreview.start
                    : trimPreview?.id === clip.id
                    ? trimPreview.start
                    : clip.timelineStart;
                const clipDur = trimPreview?.id === clip.id ? trimPreview.duration : clip.duration;
                const clipWidth = clipDur * zoomLevel;
                const waveformData = getWaveformData ? getWaveformData(clip.assetId) : [];

                return (
                  <div
                    key={clip.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClip(clip.id, e.shiftKey || e.metaKey);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onClipDoubleClick?.(clip);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClipContextMenu?.(clip, e);
                    }}
                    onMouseDown={(e) => {
                      if (!trackStates.audio0?.locked) {
                        onClipDragStart?.(clip, e);
                      }
                    }}
                    className={`absolute top-1 bottom-1 rounded-md overflow-hidden cursor-grab active:cursor-grabbing flex flex-col justify-between ${
                      isSelected
                        ? "ring-2 ring-sky-400 bg-sky-800/80 border border-sky-400 shadow-lg z-20"
                        : "bg-sky-900/50 border border-sky-500/40 hover:border-sky-400"
                    } ${clip.muted || trackStates.audio0?.muted ? "opacity-40" : ""}`}
                    style={{
                      left: `${startPos * zoomLevel}px`,
                      width: `${Math.max(20, clipWidth)}px`,
                    }}
                  >
                    <div className="px-2 py-0.5 text-[9px] font-medium text-sky-200 truncate bg-sky-950/70">
                      {clip.assetName}
                    </div>
                    {/* Real Blue Audio Waveform Graphics */}
                    <div className="flex-1 flex items-center justify-around px-1">
                      {waveformData.length > 0
                        ? waveformData.slice(0, Math.min(80, Math.floor(clipWidth / 3))).map((val, i) => (
                            <div
                              key={i}
                              className="w-[2px] bg-sky-400 rounded-full"
                              style={{ height: `${Math.max(15, Math.min(95, (val || 0.3) * 100))}%` }}
                            />
                          ))
                        : Array.from({ length: Math.min(60, Math.floor(clipWidth / 4)) }).map((_, i) => {
                            const heightPercent = 25 + Math.sin(i * 0.8) * 35 + Math.cos(i * 1.5) * 20;
                            return (
                              <div
                                key={i}
                                className="w-[2px] bg-sky-400 rounded-full"
                                style={{ height: `${Math.max(15, Math.min(90, heightPercent))}%` }}
                              />
                            );
                          })}
                    </div>

                    {/* Trim Handles */}
                    {!trackStates.audio0?.locked && (
                      <>
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onClipTrimStart?.(clip, "start", e);
                          }}
                          className="absolute left-0 top-0 bottom-0 w-2 bg-sky-400/40 hover:bg-sky-300 cursor-ew-resize z-10"
                        />
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onClipTrimStart?.(clip, "end", e);
                          }}
                          className="absolute right-0 top-0 bottom-0 w-2 bg-sky-400/40 hover:bg-sky-300 cursor-ew-resize z-10"
                        />
                      </>
                    )}
                  </div>
                );
              })}
          </div>

          {/* 4. Audio 2 Track Content (Purple Waveform) */}
          <div className="h-16 border-b border-white/[0.04] relative bg-[#0e0e15]">
            {trackStates.audio1?.visible !== false &&
              audio2Clips.map((clip) => {
                const isSelected = selectedClipIds.includes(clip.id);
                const startPos =
                  dragPreview?.id === clip.id
                    ? dragPreview.start
                    : trimPreview?.id === clip.id
                    ? trimPreview.start
                    : clip.timelineStart;
                const clipDur = trimPreview?.id === clip.id ? trimPreview.duration : clip.duration;
                const clipWidth = clipDur * zoomLevel;
                const waveformData = getWaveformData ? getWaveformData(clip.assetId) : [];

                return (
                  <div
                    key={clip.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClip(clip.id, e.shiftKey || e.metaKey);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onClipDoubleClick?.(clip);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClipContextMenu?.(clip, e);
                    }}
                    onMouseDown={(e) => {
                      if (!trackStates.audio1?.locked) {
                        onClipDragStart?.(clip, e);
                      }
                    }}
                    className={`absolute top-1 bottom-1 rounded-md overflow-hidden cursor-grab active:cursor-grabbing flex flex-col justify-between ${
                      isSelected
                        ? "ring-2 ring-purple-400 bg-purple-800/80 border border-purple-400 shadow-lg z-20"
                        : "bg-purple-900/50 border border-purple-500/40 hover:border-purple-400"
                    } ${clip.muted || trackStates.audio1?.muted ? "opacity-40" : ""}`}
                    style={{
                      left: `${startPos * zoomLevel}px`,
                      width: `${Math.max(20, clipWidth)}px`,
                    }}
                  >
                    <div className="px-2 py-0.5 text-[9px] font-medium text-purple-200 truncate bg-purple-950/70">
                      {clip.assetName}
                    </div>
                    {/* Real Purple Audio Waveform Graphics */}
                    <div className="flex-1 flex items-center justify-around px-1">
                      {waveformData.length > 0
                        ? waveformData.slice(0, Math.min(80, Math.floor(clipWidth / 3))).map((val, i) => (
                            <div
                              key={i}
                              className="w-[2px] bg-purple-400 rounded-full"
                              style={{ height: `${Math.max(15, Math.min(95, (val || 0.3) * 100))}%` }}
                            />
                          ))
                        : Array.from({ length: Math.min(80, Math.floor(clipWidth / 3)) }).map((_, i) => {
                            const heightPercent = 30 + Math.sin(i * 0.5) * 40 + Math.cos(i * 1.1) * 25;
                            return (
                              <div
                                key={i}
                                className="w-[2px] bg-purple-400 rounded-full"
                                style={{ height: `${Math.max(15, Math.min(90, heightPercent))}%` }}
                              />
                            );
                          })}
                    </div>

                    {/* Trim Handles */}
                    {!trackStates.audio1?.locked && (
                      <>
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onClipTrimStart?.(clip, "start", e);
                          }}
                          className="absolute left-0 top-0 bottom-0 w-2 bg-purple-400/40 hover:bg-purple-300 cursor-ew-resize z-10"
                        />
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onClipTrimStart?.(clip, "end", e);
                          }}
                          className="absolute right-0 top-0 bottom-0 w-2 bg-purple-400/40 hover:bg-purple-300 cursor-ew-resize z-10"
                        />
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
};
