import React from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Minus,
  Plus,
  Maximize2,
  Minimize2,
  Square,
  Sparkles,
} from "lucide-react";

interface FloatingPlayerControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onGoToStart: () => void;
  onSkipForward: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const FloatingPlayerControls: React.FC<FloatingPlayerControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onGoToStart,
  onSkipForward,
  isMuted,
  onToggleMute,
  onZoomIn,
  onZoomOut,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  return (
    <div className="flex items-center gap-4 px-5 py-2 rounded-full bg-[#12121c]/90 backdrop-blur-md border border-white/[0.08] shadow-2xl">
      {/* Previous / Skip Back */}
      <button
        onClick={onGoToStart}
        className="w-8 h-8 rounded-full hover:bg-white/[0.08] text-gray-300 hover:text-white flex items-center justify-center transition-colors"
        title="Go to start"
      >
        <SkipBack className="w-4 h-4" />
      </button>

      {/* Big Circular Blue Glowing Play/Pause Button */}
      <button
        onClick={onTogglePlay}
        className="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-500 to-sky-400 text-white flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.5)] hover:shadow-[0_0_22px_rgba(56,189,248,0.7)] hover:scale-105 active:scale-95 transition-all"
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-white" />
        ) : (
          <Play className="w-4 h-4 fill-white ml-0.5" />
        )}
      </button>

      {/* Next / Skip Forward */}
      <button
        onClick={onSkipForward}
        className="w-8 h-8 rounded-full hover:bg-white/[0.08] text-gray-300 hover:text-white flex items-center justify-center transition-colors"
        title="Skip forward 5s"
      >
        <SkipForward className="w-4 h-4" />
      </button>

      <div className="w-[1px] h-4 bg-white/[0.1] mx-1" />

      {/* Volume */}
      <button
        onClick={onToggleMute}
        className="w-7 h-7 rounded-full hover:bg-white/[0.08] text-gray-300 hover:text-white flex items-center justify-center transition-colors"
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
      </button>

      {/* Scale controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          className="w-6 h-6 rounded hover:bg-white/[0.08] text-gray-400 hover:text-white flex items-center justify-center"
          title="Zoom out preview"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onZoomIn}
          className="w-6 h-6 rounded hover:bg-white/[0.08] text-gray-400 hover:text-white flex items-center justify-center"
          title="Zoom in preview"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Fullscreen */}
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          className="w-7 h-7 rounded-full hover:bg-white/[0.08] text-gray-300 hover:text-white flex items-center justify-center transition-colors"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
};
