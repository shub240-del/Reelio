import React from "react";
import {
  Eye,
  EyeOff,
  PictureInPicture2,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

export interface InspectorClip {
  id: number;
  assetName: string;
  trackType: "video" | "audio";
  timelineStart: number;
  sourceStart: number;
  duration: number;
  muted: boolean;
  visible: boolean;
  volume?: number;
  trackVolume?: number;
  scale?: number;
  positionX?: number;
  positionY?: number;
  cropLeft?: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  videoFx?: string | null;
}

type RenderPatch = Partial<
  Pick<
    InspectorClip,
    | "volume"
    | "trackVolume"
    | "scale"
    | "positionX"
    | "positionY"
    | "cropLeft"
    | "cropTop"
    | "cropRight"
    | "cropBottom"
  >
>;

interface ClipInspectorPanelProps {
  clip: InspectorClip;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onUpdate: (patch: RenderPatch) => void;
  onUpdateTrackVolume: (volume: number) => void;
  onApplyVideoFx: (effect: string | null) => void;
}

const VIDEO_EFFECTS = [
  "Cinematic LUT",
  "Vibrant HDR",
  "Film Grain",
  "Vignette Blur",
  "Glow Accent",
  "Sharpen",
];

function CommitRange({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="block text-[10px] text-gray-400">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono text-gray-300">
          {value.toFixed(step < 0.1 ? 2 : 1)}{suffix}
        </span>
      </span>
      <input
        key={`${label}-${value}`}
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onBlur={event => onCommit(Number(event.currentTarget.value))}
        onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="mt-1 w-full accent-sky-500"
        aria-label={label}
      />
    </label>
  );
}

export const ClipInspectorPanel: React.FC<ClipInspectorPanelProps> = ({
  clip,
  onClose,
  onToggleMute,
  onToggleVisibility,
  onDelete,
  onUpdate,
  onUpdateTrackVolume,
  onApplyVideoFx,
}) => (
  <aside
    aria-label={`Inspector for ${clip.assetName}`}
    className="absolute inset-x-2 top-2 z-40 max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border border-white/10 bg-[#15151d]/95 shadow-2xl backdrop-blur-xl no-scrollbar sm:left-auto sm:right-3 sm:top-3 sm:w-72"
  >
    <div className="sticky top-0 z-10 flex items-start gap-2 border-b border-white/[0.08] bg-[#15151d]/95 px-3 py-2.5 backdrop-blur-xl">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-300">
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-xs font-semibold text-white">Clip Inspector</h2>
        <p className="truncate text-[10px] text-gray-500" title={clip.assetName}>
          {clip.assetName}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        aria-label="Close clip inspector"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>

    <div className="space-y-3 p-3">
      <div className="grid grid-cols-3 gap-1.5">
        {[
          ["Start", clip.timelineStart],
          ["In", clip.sourceStart],
          ["Duration", clip.duration],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
            <div className="text-[9px] text-gray-600">{label}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-gray-300">
              {(value as number).toFixed(2)}s
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={clip.muted}
          className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[10px] font-medium transition-colors ${
            clip.muted
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-white/[0.08] bg-white/[0.025] text-gray-300 hover:bg-white/5"
          }`}
        >
          {clip.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          {clip.muted ? "Muted" : "Audio on"}
        </button>
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-pressed={clip.visible}
          className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[10px] font-medium transition-colors ${
            clip.visible
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
              : "border-white/[0.08] bg-white/[0.025] text-gray-500"
          }`}
        >
          {clip.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {clip.visible ? "Visible" : "Hidden"}
        </button>
      </div>

      <div className="space-y-2 rounded-lg border border-white/[0.07] bg-black/10 p-2.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Audio</h3>
        <CommitRange
          label="Clip volume"
          value={clip.volume ?? 1}
          min={0}
          max={2}
          step={0.05}
          suffix="×"
          onCommit={volume => onUpdate({ volume })}
        />
        <CommitRange
          label="Track volume"
          value={clip.trackVolume ?? 1}
          min={0}
          max={2}
          step={0.05}
          suffix="×"
          onCommit={onUpdateTrackVolume}
        />
      </div>

      {clip.trackType === "video" ? (
        <>
          <div className="space-y-2 rounded-lg border border-white/[0.07] bg-black/10 p-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Transform</h3>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onUpdate({ scale: 0.35, positionX: 0.6, positionY: -0.6 })}
                  className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-sky-300"
                  title="Picture in picture"
                  aria-label="Apply picture-in-picture transform"
                >
                  <PictureInPicture2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate({
                      scale: 1,
                      positionX: 0,
                      positionY: 0,
                      cropLeft: 0,
                      cropTop: 0,
                      cropRight: 0,
                      cropBottom: 0,
                    })
                  }
                  className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-sky-300"
                  title="Reset transform and crop"
                  aria-label="Reset transform and crop"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <CommitRange label="Scale" value={clip.scale ?? 1} min={0.1} max={4} step={0.05} suffix="×" onCommit={scale => onUpdate({ scale })} />
            <CommitRange label="Horizontal position" value={clip.positionX ?? 0} min={-1} max={1} step={0.05} onCommit={positionX => onUpdate({ positionX })} />
            <CommitRange label="Vertical position" value={clip.positionY ?? 0} min={-1} max={1} step={0.05} onCommit={positionY => onUpdate({ positionY })} />
          </div>

          <div className="space-y-2 rounded-lg border border-white/[0.07] bg-black/10 p-2.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Crop</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <CommitRange label="Left crop" value={clip.cropLeft ?? 0} min={0} max={0.45} step={0.01} onCommit={cropLeft => onUpdate({ cropLeft })} />
              <CommitRange label="Right crop" value={clip.cropRight ?? 0} min={0} max={0.45} step={0.01} onCommit={cropRight => onUpdate({ cropRight })} />
              <CommitRange label="Top crop" value={clip.cropTop ?? 0} min={0} max={0.45} step={0.01} onCommit={cropTop => onUpdate({ cropTop })} />
              <CommitRange label="Bottom crop" value={clip.cropBottom ?? 0} min={0} max={0.45} step={0.01} onCommit={cropBottom => onUpdate({ cropBottom })} />
            </div>
          </div>

          <label className="block text-[10px] text-gray-400">
            Video effect
            <select
              value={clip.videoFx ?? ""}
              onChange={event => onApplyVideoFx(event.target.value || null)}
              className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#1b1b24] px-2 py-2 text-[11px] text-gray-200 outline-none focus:border-sky-500/50"
            >
              <option value="">None</option>
              {VIDEO_EFFECTS.map(effect => (
                <option key={effect} value={effect}>{effect}</option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[10px] font-semibold text-red-300 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <Trash2 className="h-3 w-3" />
        Delete clip
      </button>
    </div>
  </aside>
);
