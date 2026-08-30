import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  FileAudio,
  FileImage,
  FileVideo,
  ListChecks,
  ListFilter,
  Loader2,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
  FileText,
} from "lucide-react";
import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "wouter";
import { toast } from "sonner";
import { useTimelineHistory } from "@/editor/useTimelineHistory";
import {
  DragOrigin,
  MIN_CLIP_DURATION,
  applySnap,
  dragToStart,
  duplicateStart,
  isDrag,
  nextSelection,
  reindexTrack,
  resolveTrim,
  snapCandidates,
  splitOffset,
} from "@/editor/interaction";
import { useWaveform } from "@/hooks/useWaveform";
import { isSupportedMedia, probeMedia } from "@/editor/media";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import {
  applyEditOps,
  describeOp,
  describePlan,
  getAffectedRanges,
  type CaptionCue,
  type EditOp,
  type EditPlan,
  type ReviewRangeHighlight,
} from "../../../shared/editOps";
import { detectSilenceRanges } from "@/editor/silence";
import { extractMediaEvidence } from "@/editor/mediaIntelligence";
import { generateDemoCaptions, getActiveCue } from "@/editor/captions";
import { LeftCategoryNav, type CategoryTab, type MediaSubTab } from "@/components/editor/LeftCategoryNav";
import { MediaGrid } from "@/components/editor/MediaGrid";
import { AIAgentPanel } from "@/components/editor/AIAgentPanel";
import { FloatingPlayerControls } from "@/components/editor/FloatingPlayerControls";
import { TimelineToolbar } from "@/components/editor/TimelineToolbar";
import { MultiTrackTimeline } from "@/components/editor/MultiTrackTimeline";

/* ─── Types ─── */
interface TimelineClip {
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

/* ─── Helpers ─── */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function probeAudio(file: File): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This audio file could not be decoded")); };
    audio.src = url;
  });
}

function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image file could not be decoded")); };
    image.src = url;
  });
}

/**
 * Find which clip is active at a given timeline time.
 * Returns the clip if currentTime falls within [timelineStart, timelineStart + duration].
 */
function getActiveClip(clips: TimelineClip[], time: number): TimelineClip | null {
  const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
  for (const clip of sorted) {
    if (time >= clip.timelineStart && time < clip.timelineStart + clip.duration) {
      return clip;
    }
  }
  return null;
}

/**
 * Compute the total timeline duration from all clips.
 */
/**
 * How long the ruler should read. Floored at 60s so an empty timeline still
 * shows a usable scale - this is a DISPLAY value only.
 */
function computeTotalDuration(clips: TimelineClip[]): number {
  if (clips.length === 0) return 60;
  return Math.max(
    ...clips.map((c) => c.timelineStart + c.duration),
    60
  );
}

/**
 * Where the actual content ends, with no display floor.
 *
 * Appending must use this, never computeTotalDuration: that one floors at 60s,
 * so importing into an empty project dropped the first clip at t=60s, off the
 * visible timeline. The import looked like it had silently failed - the asset
 * appeared in the panel but the timeline stayed empty and the preview still
 * said "Upload a video to get started".
 */
function timelineContentEnd(clips: TimelineClip[]): number {
  let end = 0;
  for (const clip of clips) end = Math.max(end, clip.timelineStart + clip.duration);
  return end;
}

/* ─── Component ─── */
export default function Editor() {
  const { projectId } = useParams<{ projectId: string }>();
  const projId = parseInt(projectId || "0");
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  /* State */
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showAssets, setShowAssets] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(60); // px per second
  const [draggingClip, setDraggingClip] = useState<number | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  /**
   * Real selection, independent of the playhead. The prototype highlighted
   * whichever clip the playhead happened to be over and called that "selected",
   * so no operation could be aimed at a clip without first seeking to it.
   */
  const [selectedClipIds, setSelectedClipIds] = useState<number[]>([]);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  /** Live pixel offset of the clip being dragged, before it is committed. */
  const [dragPreview, setDragPreview] = useState<{ id: number; start: number } | null>(null);
  const [trimPreview, setTrimPreview] = useState<{ id: number; start: number; duration: number } | null>(null);
  const [clipMenu, setClipMenu] = useState<{ clipId: number; x: number; y: number } | null>(null);
  const [aiMessages, setAiMessages] = useState<Message[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<EditPlan | null>(null);
  const [selectedOpIndices, setSelectedOpIndices] = useState<number[]>([]);
  const [reviewInstruction, setReviewInstruction] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [captions, setCaptions] = useState<CaptionCue[]>([]);
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("media");
  const [activeSubTab, setActiveSubTab] = useState<MediaSubTab>("your-media");
  const [snapping, setSnapping] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isRippleActive, setIsRippleActive] = useState<boolean>(false);
  const [trackStates, setTrackStates] = useState<Record<string, { muted: boolean; locked: boolean; visible: boolean }>>({
    captions: { muted: false, locked: false, visible: true },
    video0: { muted: false, locked: false, visible: true },
    audio0: { muted: false, locked: false, visible: true },
    audio1: { muted: false, locked: false, visible: true },
  });

  const handleToggleTrackMute = (trackKey: string) => {
    setTrackStates((prev) => ({
      ...prev,
      [trackKey]: { ...prev[trackKey], muted: !prev[trackKey]?.muted },
    }));
    toast.info(`Track ${trackKey} ${!trackStates[trackKey]?.muted ? "muted" : "unmuted"}`);
  };

  const handleToggleTrackLock = (trackKey: string) => {
    setTrackStates((prev) => ({
      ...prev,
      [trackKey]: { ...prev[trackKey], locked: !prev[trackKey]?.locked },
    }));
    toast.info(`Track ${trackKey} ${!trackStates[trackKey]?.locked ? "locked" : "unlocked"}`);
  };

  const handleToggleTrackVisible = (trackKey: string) => {
    setTrackStates((prev) => ({
      ...prev,
      [trackKey]: { ...prev[trackKey], visible: !prev[trackKey]?.visible },
    }));
    toast.info(`Track ${trackKey} ${!trackStates[trackKey]?.visible ? "visible" : "hidden"}`);
  };

  const handleApplyTransition = async (transitionName: string) => {
    if (!activeClip) {
      toast.info("Select a video clip first to apply transition");
      return;
    }
    try {
      recordHistory(`Apply ${transitionName} transition`);
      await updateClipMutation.mutateAsync({ id: activeClip.id, transition: transitionName } as any);
      await refetchClips();
      toast.success(`Applied ${transitionName} to ${activeClip.assetName}`);
    } catch (err) {
      toast.error("Failed to apply transition: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleApplyVideoFx = async (fxName: string) => {
    if (!activeClip) {
      toast.info("Select a video clip first to apply video effect");
      return;
    }
    try {
      recordHistory(`Apply ${fxName} effect`);
      await updateClipMutation.mutateAsync({ id: activeClip.id, videoFx: fxName } as any);
      await refetchClips();
      toast.success(`Applied ${fxName} to ${activeClip.assetName}`);
    } catch (err) {
      toast.error("Failed to apply effect: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  /* Data fetching */
  const { data: project } = trpc.project.get.useQuery({ id: projId }, { enabled: !!user });
  const { data: assets, refetch: refetchAssets } = trpc.asset.list.useQuery(
    { projectId: projId },
    { enabled: !!user && projId > 0 }
  );
  const { data: clips, refetch: refetchClips } = trpc.clip.list.useQuery(
    { projectId: projId },
    { enabled: !!user && projId > 0 }
  );

  /* Mutation hooks */
  const uploadMutation = trpc.asset.upload.useMutation();
  const deleteAssetMutation = trpc.asset.delete.useMutation();
  const createClipMutation = trpc.clip.create.useMutation();
  const updateClipMutation = trpc.clip.update.useMutation();
  const deleteClipMutation = trpc.clip.delete.useMutation();
  const trimClipMutation = trpc.clip.trim.useMutation();
  const splitClipMutation = trpc.clip.split.useMutation();

  /**
   * Undo/Redo.
   *
   * The history reads the clip list through a ref because the derived
   * timelineClips array below is rebuilt on every render; a snapshot taken from
   * a captured copy would go stale between the edit and the undo.
   */
  const clipsRef = useRef<TimelineClip[]>([]);
  const selectionRef = useRef<number[]>([]);
  const autoplayNextRef = useRef(false);
  const audioRefs = useRef(new Map<number, HTMLAudioElement>());
  selectionRef.current = selectedClipIds;

  const {
    record: recordHistory,
    undo: performUndo,
    redo: performRedo,
    clear: clearUndoHistory,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
  } = useTimelineHistory({
    getClips: () => clipsRef.current,
    getSelection: () => selectionRef.current,
    setSelection: setSelectedClipIds,
    createClip: (clip) =>
      createClipMutation.mutateAsync({
        projectId: projId,
        assetId: clip.assetId,
        trackId: clip.trackId,
        trackType: clip.trackType,
        sourceStart: clip.sourceStart,
        duration: clip.duration,
        timelineStart: clip.timelineStart,
        sortIndex: clip.sortIndex,
        // Restoring a deleted clip must reuse its id, otherwise the redo that
        // follows would target a row that no longer exists.
        id: clip.id,
        locked: clip.locked,
        visible: clip.visible,
        muted: clip.muted,
      } as any),
    updateClip: (patch) => updateClipMutation.mutateAsync(patch as any),
    deleteClip: (id) => deleteClipMutation.mutateAsync({ id }),
    refetch: () => refetchClips(),
  });
  const { generateWaveform, getWaveform, isGenerating } = useWaveform();

  /* Derived */
  const timelineClips: TimelineClip[] = (clips ?? []).map((c) => {
    const asset = (assets ?? []).find((a) => a.id === c.assetId);
    return {
      ...c,
      assetUrl: asset?.url ?? "",
      assetName: asset?.name ?? "Unknown",
    };
  });

  // Keep the history's view of the timeline current; see clipsRef above.
  clipsRef.current = timelineClips;

  const totalDuration = computeTotalDuration(timelineClips);
  const activeCue = getActiveCue(captions, currentTime);
  const selectedClips = timelineClips.filter((c) => selectedClipIds.includes(c.id));
  const assetDurationOf = (assetId: number) =>
    (assets ?? []).find((a) => a.id === assetId)?.duration ?? 0;

  const reviewHighlights = useMemo<ReviewRangeHighlight[]>(() => {
    if (!pendingPlan) return [];
    const highlights: ReviewRangeHighlight[] = [];
    selectedOpIndices.forEach((idx) => {
      const op = pendingPlan.operations[idx];
      if (op) {
        highlights.push(...getAffectedRanges(op, timelineClips));
      }
    });
    return highlights;
  }, [pendingPlan, selectedOpIndices, timelineClips]);

  /* Generate waveforms when assets are loaded */
  useEffect(() => {
    if (assets && assets.length > 0) {
      for (const asset of assets) {
        if (!isGenerating(asset.id) && getWaveform(asset.id).length === 0) {
          generateWaveform(asset.id, asset.url);
        }
      }
    }
  }, [assets]);

  /* Restore track controls from localStorage on mount */
  useEffect(() => {
    if (projId > 0) {
      try {
        const stored = localStorage.getItem(`reelio-track-states-${projId}`);
        if (stored) setTrackStates(JSON.parse(stored) as typeof trackStates);
      } catch {
        /* corrupt storage — keep defaults */
      }
    }
  }, [projId]);

  /* Persist track controls for guest projects. */
  useEffect(() => {
    if (projId > 0) {
      localStorage.setItem(`reelio-track-states-${projId}`, JSON.stringify(trackStates));
    }
  }, [projId, trackStates]);

  /* Restore captions from localStorage on mount */
  useEffect(() => {
    if (projId > 0) {
      try {
        const stored = localStorage.getItem(`reelio-captions-${projId}`);
        if (stored) setCaptions(JSON.parse(stored) as CaptionCue[]);
      } catch {
        /* corrupt storage — ignore */
      }
    }
  }, [projId]);

  const activeClip = getActiveClip(timelineClips, currentTime);
  const activeAudioClips = timelineClips.filter(
    (clip) =>
      clip.trackType === "audio" &&
      clip.visible !== false &&
      trackStates[clip.trackId === 0 ? "audio0" : "audio1"]?.visible !== false &&
      !trackStates[clip.trackId === 0 ? "audio0" : "audio1"]?.muted &&
      clip.assetUrl &&
      currentTime >= clip.timelineStart &&
      currentTime < clip.timelineStart + clip.duration,
  );

  /** Keep every audible audio-track clip aligned with the shared timeline clock. */
  useEffect(() => {
    const activeIds = new Set(activeAudioClips.map((clip) => clip.id));
    for (const [id, audio] of audioRefs.current) {
      if (!activeIds.has(id)) audio.pause();
    }
    for (const clip of activeAudioClips) {
      const audio = audioRefs.current.get(clip.id);
      if (!audio) continue;
      const sourceTime = clip.sourceStart + currentTime - clip.timelineStart;
      if (Math.abs(audio.currentTime - sourceTime) > 0.08) audio.currentTime = sourceTime;
      const trackState = trackStates[clip.trackId === 0 ? "audio0" : "audio1"];
      audio.muted = clip.muted || trackState?.muted === true;
      audio.volume = audio.muted ? 0 : 1;
      if (isPlaying) {
        void audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    }
  }, [activeAudioClips, currentTime, isPlaying, trackStates]);

  const handleExport = async () => {
    if (exporting || timelineClips.length === 0) return;
    const videoClips = timelineClips.filter(
      (clip) =>
        clip.trackType === "video" &&
        clip.visible !== false &&
        trackStates.video0?.visible !== false &&
        clip.duration > 0,
    );
    if (videoClips.length === 0) {
      toast.error("Add a visible video clip before exporting");
      return;
    }
    const firstAsset = (assets ?? []).find((asset) => asset.id === videoClips[0].assetId);
    if (!firstAsset?.url) {
      toast.error("The video source is not available");
      return;
    }
    setExporting(true);
    setExportProgress(0);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = firstAsset.width || 1280;
      canvas.height = firstAsset.height || 720;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d || typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support browser-side video export");
      }

      // ── Audio mixing setup (gracefully omitted if AudioContext is unavailable) ──
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const audioCtx = AudioCtor ? new AudioCtor() : null;
      const audioDest = audioCtx?.createMediaStreamDestination() ?? null;

      type AudioEntry = { el: HTMLAudioElement; clip: TimelineClip };
      const audioEntries: AudioEntry[] = [];

      if (audioCtx && audioDest) {
        const audibleClips = timelineClips.filter((c) => {
          if (c.muted || c.visible === false || !c.assetUrl) return false;
          const trackKey = c.trackType === "video" ? "video0" : c.trackId === 0 ? "audio0" : "audio1";
          if (trackStates[trackKey]?.muted || trackStates[trackKey]?.visible === false) return false;
          const asset = (assets ?? []).find((a) => a.id === c.assetId);
          return c.trackType === "audio" || asset?.hasAudio;
        });
        for (const clip of audibleClips) {
          try {
            const el = document.createElement("audio");
            el.crossOrigin = "anonymous";
            el.src = clip.assetUrl;
            el.preload = "auto";
            await new Promise<void>((resolve) => {
              el.addEventListener("loadedmetadata", () => resolve(), { once: true });
              el.addEventListener("error", () => resolve(), { once: true }); // non-fatal
              setTimeout(resolve, 3000);
            });
            const srcNode = audioCtx.createMediaElementSource(el);
            srcNode.connect(audioDest);
            audioEntries.push({ el, clip });
          } catch {
            // Non-decodable audio clip — skip gracefully
          }
        }
      }

      // ── Combined stream & recorder ──
      const canvasStream = canvas.captureStream(30);
      const streamTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      if (audioDest) streamTracks.push(...audioDest.stream.getAudioTracks());
      const recordStream = new MediaStream(streamTracks);

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(recordStream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      });

      const source = document.createElement("video");
      source.muted = true;
      source.playsInline = true;
      source.preload = "auto";
      source.crossOrigin = "anonymous";

      recorder.start(250);
      const end = timelineContentEnd(timelineClips);

      for (let time = 0; time <= end; time += 1 / 30) {
        setExportProgress(Math.min(99, (time / end) * 100));

        const clip = videoClips.find(
          (candidate) =>
            time >= candidate.timelineStart &&
            time < candidate.timelineStart + candidate.duration,
        );
        ctx2d.fillStyle = "#000";
        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
        if (clip) {
          const asset = (assets ?? []).find((candidate) => candidate.id === clip.assetId);
          if (asset?.url) {
            if (source.src !== asset.url) {
              source.src = asset.url;
              await new Promise<void>((resolve, reject) => {
                source.onloadedmetadata = () => resolve();
                source.onerror = () => reject(new Error("A timeline source could not be decoded"));
              });
            }
            source.currentTime = clip.sourceStart + (time - clip.timelineStart);
            await new Promise<void>((resolve) => {
              const done = () => {
                source.removeEventListener("seeked", done);
                resolve();
              };
              source.addEventListener("seeked", done, { once: true });
              setTimeout(done, 1000);
            });
            ctx2d.drawImage(source, 0, 0, canvas.width, canvas.height);
          }
        }

        // Sync audio elements to the current export position so audio data
        // flows through the AudioContext → MediaStreamDestination → recorder.
        for (const { el, clip: audioClip } of audioEntries) {
          const srcTime = audioClip.sourceStart + (time - audioClip.timelineStart);
          if (
            time >= audioClip.timelineStart &&
            time < audioClip.timelineStart + audioClip.duration
          ) {
            if (Math.abs(el.currentTime - srcTime) > 0.15) el.currentTime = srcTime;
            void el.play().catch(() => undefined);
          } else if (!el.paused) {
            el.pause();
          }
        }

        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      recorder.stop();
      const blob = await stopped;

      // Cleanup
      for (const { el } of audioEntries) {
        el.pause();
        el.src = "";
      }
      if (audioCtx) void audioCtx.close();
      source.pause();
      source.removeAttribute("src");
      source.load();
      canvasStream.getTracks().forEach((track) => track.stop());
      recordStream.getTracks().forEach((track) => track.stop());

      if (blob.size === 0) throw new Error("Export produced an empty file");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project?.name || "reelio-export"}.webm`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const hasAudio = audioEntries.length > 0;
      toast.success(
        `Exported ${Math.round(blob.size / 1024)} KB WebM${hasAudio ? " with audio" : ""}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  /* Mutation for AI edit — calls NVIDIA NIM on the server */
  const aiEditMutation = trpc.ai.edit.useMutation();

  const toggleOpSelection = useCallback((index: number) => {
    setSelectedOpIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b),
    );
  }, []);

  const handleApplyPlan = useCallback(
    async (opsToApply?: EditOp[]) => {
      if (!pendingPlan) return;
      const targetOps =
        opsToApply ??
        selectedOpIndices.map((i) => pendingPlan.operations[i]).filter(Boolean);

      if (targetOps.length === 0) {
        toast.error("No operations selected to apply");
        return;
      }

      try {
        const latestAssets = (await refetchAssets()).data ?? assets ?? [];
        const assetMap = new Map(
          latestAssets.map((asset) => [
            asset.id,
            {
              id: asset.id,
              duration: asset.duration,
              hasAudio: asset.hasAudio ?? false,
              width: asset.width,
              height: asset.height,
              fps: asset.fps ?? 30,
            },
          ]),
        );

        const result = applyEditOps(timelineClips, assetMap, targetOps);

        if (
          result.applied.some((op) =>
            [
              "removeRanges",
              "removeClips",
              "trimClip",
              "moveClip",
              "setClipProps",
              "keepRanges",
              "splitClip",
            ].includes(op.type),
          )
        ) {
          // Snapshot history BEFORE persistence so undo restores correctly
          recordHistory(`AI: ${reviewInstruction.slice(0, 60)}`);

          // Persist the new timeline state through the existing mutation system
          const nextIds = new Set(result.clips.map((clip) => clip.id));
          for (const clip of timelineClips) {
            if (!nextIds.has(clip.id)) await deleteClipMutation.mutateAsync({ id: clip.id });
          }
          for (const clip of result.clips) {
            const previous = timelineClips.find((candidate) => candidate.id === clip.id);
            if (previous) {
              await updateClipMutation.mutateAsync({
                id: clip.id,
                sourceStart: clip.sourceStart,
                duration: clip.duration,
                timelineStart: clip.timelineStart,
                sortIndex: clip.sortIndex,
                trackId: clip.trackId,
                locked: clip.locked,
                visible: clip.visible,
                muted: clip.muted,
              });
            } else {
              await createClipMutation.mutateAsync({
                projectId: projId,
                assetId: clip.assetId,
                trackId: clip.trackId,
                trackType: clip.trackType,
                sourceStart: clip.sourceStart,
                duration: clip.duration,
                timelineStart: clip.timelineStart,
                sortIndex: clip.sortIndex,
                locked: clip.locked,
                visible: clip.visible,
                muted: clip.muted,
              } as any);
            }
          }
          await refetchClips();
        }

        // Apply side-effect ops (captions, markers, audio filters).
        for (const sideEffect of result.sideEffects) {
          if (sideEffect.type === "addCaptions") {
            const next = sideEffect.replaceExisting
              ? sideEffect.cues
              : [...captions, ...sideEffect.cues];
            setCaptions(next);
            if (projId > 0)
              localStorage.setItem(`reelio-captions-${projId}`, JSON.stringify(next));
          }
        }

        const summaryText = describePlan({ summary: "", operations: result.applied });
        toast.success(`Applied ${result.applied.length} edit(s)`);

        setAiMessages((messages) => [
          ...messages,
          {
            role: "assistant",
            content: `Applied changes:\n${summaryText}${result.skipped.length ? `\n\nSkipped: ${result.skipped.map((item) => item.reason).join(", ")}` : ""}`,
          },
        ]);

        // Clear review mode state
        setPendingPlan(null);
        setSelectedOpIndices([]);
        setReviewInstruction("");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Execution failed";
        toast.error(`Could not apply edit: ${msg}`);
      }
    },
    [
      assets,
      captions,
      createClipMutation,
      deleteClipMutation,
      pendingPlan,
      projId,
      recordHistory,
      refetchAssets,
      refetchClips,
      reviewInstruction,
      selectedOpIndices,
      timelineClips,
      updateClipMutation,
    ],
  );

  const handleRejectPlan = useCallback(() => {
    setPendingPlan(null);
    setSelectedOpIndices([]);
    setReviewInstruction("");
    toast.info("AI edits dismissed");
    setAiMessages((messages) => [
      ...messages,
      {
        role: "assistant",
        content: "Edit proposal dismissed. No changes were made to the timeline.",
      },
    ]);
  }, []);

  const handleAISendMessage = async (content: string) => {
    setAiMessages((messages) => [...messages, { role: "user", content }]);
    setAiLoading(true);
    try {
      const lower = content.trim().toLowerCase();

      // Conversational Undo / Redo / Export shortcuts
      if (lower === "undo" || lower === "revert" || lower === "ctrl+z" || lower === "undo that" || lower === "undo last edit") {
        const label = await performUndo();
        setAiMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content: label ? `Undone: ${label}. Timeline restored to previous state.` : "Nothing to undo in timeline history.",
          },
        ]);
        return;
      }

      if (lower === "redo" || lower === "ctrl+y" || lower === "redo that" || lower === "redo last edit") {
        const label = await performRedo();
        setAiMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content: label ? `Redone: ${label}. Timeline restored.` : "Nothing to redo in timeline history.",
          },
        ]);
        return;
      }

      if (lower.includes("clear") && (lower.includes("caption") || lower.includes("subtitle"))) {
        setCaptions([]);
        if (projId > 0) localStorage.removeItem(`reelio-captions-${projId}`);
        toast.info("Cleared caption cues");
        setAiMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content: "Cleared all caption cues from the Captions track.",
          },
        ]);
        return;
      }

      if (lower === "export" || lower === "export video" || lower === "render video") {
        void handleExport();
        setAiMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content: "Started browser video export for the current timeline composition.",
          },
        ]);
        return;
      }

      const latestAssets = (await refetchAssets()).data ?? assets ?? [];

      // Caption generation is handled client-side if requested
      if (/^(generate|add) captions?\.?$/i.test(content.trim())) {
        const cues = generateDemoCaptions(timelineClips);
        setCaptions(cues);
        if (projId > 0) localStorage.setItem(`reelio-captions-${projId}`, JSON.stringify(cues));
        setAiMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content:
              cues.length > 0
                ? `Generated ${cues.length} caption cue${cues.length === 1 ? "" : "s"} across the timeline. They are now visible on the Captions track.`
                : "No clips on the timeline to generate captions for.",
          },
        ]);
        return;
      }

      // Gather Media Intelligence Evidence across the assets
      let allSilenceRanges: { start: number; end: number }[] = [];
      let allTranscriptSegments: { id: number; text: string; start: number; end: number }[] = [];
      let allFillerWords: { text: string; start: number; end: number; duration: number }[] = [];

      for (const asset of latestAssets) {
        if (asset.duration > 0) {
          const evidence = await extractMediaEvidence(asset, { scanAudio: true });
          allSilenceRanges.push(...evidence.silenceRanges);
          allTranscriptSegments.push(
            ...evidence.transcriptSegments.map((s) => ({
              id: s.id,
              text: s.text,
              start: s.start,
              end: s.end,
            })),
          );
          allFillerWords.push(...evidence.fillerWords);
        }
      }

      // Check for target duration constraint (e.g. "30 second short", "make this a 30s short")
      let targetDuration: number | undefined;
      const durationMatch = content.match(/(\d+)\s*(?:second|sec|s)\s*(?:short|highlight|summary)/i);
      if (durationMatch) {
        targetDuration = parseInt(durationMatch[1], 10);
      }

      // Build the compact context the server needs — no binary data, no secrets
      const clipsContext = timelineClips.map((c) => ({
        id: c.id,
        assetId: c.assetId,
        assetName: c.assetName,
        trackType: c.trackType,
        trackId: c.trackId,
        timelineStart: c.timelineStart,
        duration: c.duration,
        sourceStart: c.sourceStart,
        sortIndex: c.sortIndex,
      }));

      const assetsContext = latestAssets.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        duration: a.duration,
        width: a.width,
        height: a.height,
        fps: a.fps ?? 30,
        hasAudio: a.hasAudio ?? false,
      }));

      // Call NVIDIA NIM through the server — key never leaves the server
      const { plan } = await aiEditMutation.mutateAsync({
        instruction: content,
        clips: clipsContext,
        assets: assetsContext,
        silenceRanges: allSilenceRanges,
        transcriptSegments: allTranscriptSegments,
        fillerWords: allFillerWords,
        targetDuration,
        playhead: currentTime,
      });

      if (plan.operations.length === 0) {
        setAiMessages((messages) => [
          ...messages,
          {
            role: "assistant",
            content: `I reviewed the timeline and media intelligence evidence (${allSilenceRanges.length} silence intervals, ${allFillerWords.length} filler words, ${allTranscriptSegments.length} transcript segments), but found no operations required for: "${content}".`,
          },
        ]);
        return;
      }

      // Open AI Review Mode
      setPendingPlan(plan);
      setSelectedOpIndices(plan.operations.map((_, i) => i));
      setReviewInstruction(content);

      setAiMessages((messages) => [
        ...messages,
        {
          role: "assistant",
          content: `🎯 **AI Edit Plan Proposed**\n\n${plan.summary}\n\n• **Itemized Operations**: ${plan.operations.length} change${plan.operations.length === 1 ? "" : "s"}\n• **Evidence Grounded**: Analyzed ${allSilenceRanges.length} silence intervals and ${allFillerWords.length} filler words.\n\nReview the visual highlights on your timeline and click **Apply Selected** or **Apply All** to commit.`,
        },
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      setAiMessages((messages) => [
        ...messages,
        {
          role: "assistant",
          content: `I could not generate an edit plan: ${msg}`,
        },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  const handleExecuteQuickAction = (actionType: string) => {
    if (actionType === "captions") {
      const cues = generateDemoCaptions(timelineClips);
      setCaptions(cues);
      if (projId > 0) localStorage.setItem(`reelio-captions-${projId}`, JSON.stringify(cues));
      toast.success(`Generated ${cues.length} caption cues on timeline`);
      setAiMessages((msgs) => [
        ...msgs,
        {
          role: "assistant",
          content: `Generated ${cues.length} caption cue${cues.length === 1 ? "" : "s"} across the timeline. They are now placed on the Captions track.`,
        },
      ]);
    } else if (actionType === "silence") {
      handleAISendMessage("Remove silence from the video.");
    } else if (actionType === "restarts") {
      handleAISendMessage("Detect and remove restart phrases and repeated takes.");
    } else if (actionType === "fillers") {
      handleAISendMessage("Remove filler words.");
    } else if (actionType === "firsttakes") {
      handleAISendMessage("Remove first takes and warmup intro.");
    }
  };


  /**
   * Split targets the selection, falling back to whatever sits under the
   * playhead so the action still works before anything is selected.
   */
  const splitTargets = selectedClips.length ? selectedClips : activeClip ? [activeClip] : [];
  const canSplit = splitTargets.some((c) => splitOffset(c, currentTime) !== null);

  const handleAddAssetToTimeline = useCallback(async (asset: any) => {
    if (!asset || asset.duration <= 0) {
      toast.error("This asset has no usable duration");
      return;
    }
    try {
      await createClipMutation.mutateAsync({
        projectId: projId,
        assetId: asset.id,
        trackType: asset.mimeType.startsWith("audio/") ? "audio" : "video",
        sourceStart: 0,
        duration: asset.duration,
        timelineStart: timelineContentEnd(timelineClips),
        sortIndex: timelineClips.length,
      });
      await refetchClips();
      toast.success(`Added "${asset.name}" to timeline`);
    } catch (err) {
      toast.error("Could not add asset: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  }, [createClipMutation, projId, refetchClips, timelineClips, timelineClips.length]);

  const handleRemoveAsset = useCallback(async (asset: any) => {
    try {
      await deleteAssetMutation.mutateAsync({ id: asset.id });
      await Promise.all([refetchAssets(), refetchClips()]);
      toast.success(`Removed "${asset.name}"`);
    } catch (err) {
      toast.error("Could not remove asset: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  }, [deleteAssetMutation, refetchAssets, refetchClips]);

  /* Upload handler */
  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!isSupportedMedia(file)) {
        toast.error("Please select a supported video, image, or audio file");
        return;
      }
      const isImage = file.type.startsWith("image/");
      const isAudio = file.type.startsWith("audio/");
      const isVideo = file.type.startsWith("video/") || !isImage && !isAudio;
      setUploading(true);
      setUploadProgress(0);
      let progressInterval: ReturnType<typeof setInterval> | undefined;
      try {
        let metadata = { duration: 0, width: 0, height: 0, fps: 0, hasAudio: isAudio };
        if (isVideo) metadata = await probeMedia(file);
        else if (isImage) {
          const image = await probeImage(file);
          metadata = { ...metadata, ...image, duration: 5 };
        } else {
          metadata = { ...metadata, ...(await probeAudio(file)) };
        }
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const base64 = btoa(Array.from(bytes).map((b) => String.fromCharCode(b)).join(""));
        progressInterval = setInterval(() => setUploadProgress((p) => Math.min(p + Math.random() * 15, 90)), 200);
        await uploadMutation.mutateAsync({
          projectId: projId,
          base64Data: base64,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          hasAudio: metadata.hasAudio,
        });
        if (progressInterval) clearInterval(progressInterval);
        setUploadProgress(100);
        const newAssets = await refetchAssets();
        const newAsset = newAssets.data?.find((asset) => asset.name === file.name && asset.sizeBytes === file.size) ?? newAssets.data?.[newAssets.data.length - 1];
        if (newAsset && newAsset.duration > 0) {
          await handleAddAssetToTimeline(newAsset);
        } else {
          toast.success(`Imported "${file.name}"`);
        }
        setTimeout(() => { setUploading(false); setUploadProgress(0); }, 500);
      } catch (err) {
        if (progressInterval) clearInterval(progressInterval);
        setUploading(false);
        setUploadProgress(0);
        toast.error("Upload failed: " + (err instanceof Error ? err.message : "Unknown error"));
      }
    },
    [handleAddAssetToTimeline, projId, refetchAssets, timelineClips, timelineClips.length, uploadMutation]
  );

  /* Video preview sync - when active clip changes, switch the video source */
  useEffect(() => {
    if (activeClip && previewVideoRef.current) {
      const video = previewVideoRef.current;
      const sourceTime = Math.max(
        activeClip.sourceStart,
        currentTime - activeClip.timelineStart + activeClip.sourceStart
      );
      if (Math.abs(video.currentTime - sourceTime) > 0.05) {
        video.currentTime = sourceTime;
      }
      // If playback was already running, resume after the new source loads.
      if (isPlaying && video.paused) {
        void video.play().catch(() => setIsPlaying(false));
      }
    }
  }, [activeClip?.id, currentTime, isPlaying]);

  /* Video time sync from preview video */
  const handlePreviewTimeUpdate = () => {
    if (!activeClip || !previewVideoRef.current) return;
    const sourceTime = previewVideoRef.current.currentTime;
    const timelineTime = activeClip.timelineStart + (sourceTime - activeClip.sourceStart);
    setCurrentTime(timelineTime);
  };

  const handlePreviewLoadedMetadata = () => {
    if (!activeClip || !previewVideoRef.current) return;
    previewVideoRef.current.currentTime =
      Math.max(activeClip.sourceStart, currentTime - activeClip.timelineStart + activeClip.sourceStart);
    if (autoplayNextRef.current) {
      autoplayNextRef.current = false;
      void previewVideoRef.current.play().catch(() => setIsPlaying(false));
    }
  };

  const togglePlay = () => {
    if (!previewVideoRef.current) return;
    if (isPlaying) {
      previewVideoRef.current.pause();
    } else {
      previewVideoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handlePlaybackSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (previewVideoRef.current) {
      previewVideoRef.current.playbackRate = speed;
    }
  };

  /* Timeline navigation */
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, x / zoomLevel);
    setCurrentTime(time);
    // Sync video to the new position
    if (previewVideoRef.current) {
      const active = getActiveClip(timelineClips, time);
      if (active) {
        previewVideoRef.current.src = active.assetUrl;
        previewVideoRef.current.currentTime =
          time - active.timelineStart + active.sourceStart;
      }
    }
  };

  const handleSkipBack = () => {
    const newTime = Math.max(0, currentTime - 5);
    setCurrentTime(newTime);
    if (previewVideoRef.current) {
      const active = getActiveClip(timelineClips, newTime);
      if (active) {
        previewVideoRef.current.src = active.assetUrl;
        previewVideoRef.current.currentTime =
          newTime - active.timelineStart + active.sourceStart;
      }
    }
  };

  const handleSkipForward = () => {
    const newTime = Math.min(totalDuration, currentTime + 5);
    setCurrentTime(newTime);
    if (previewVideoRef.current) {
      const active = getActiveClip(timelineClips, newTime);
      if (active) {
        previewVideoRef.current.src = active.assetUrl;
        previewVideoRef.current.currentTime =
          newTime - active.timelineStart + active.sourceStart;
      }
    }
  };

  const handleGoToStart = () => {
    setCurrentTime(0);
    if (previewVideoRef.current) {
      const active = getActiveClip(timelineClips, 0);
      if (active) {
        previewVideoRef.current.src = active.assetUrl;
        previewVideoRef.current.currentTime = active.sourceStart;
      }
    }
  };

  /* Timeline clip operations */

  /**
   * Commits a move. `newTimelineStart` is already delta-derived and snapped by
   * the drag controller, so this only persists it and repairs track ordering.
   */
  const handleClipMove = async (clip: TimelineClip, newTimelineStart: number) => {
    const newStart = Math.max(0, newTimelineStart);
    if (Math.abs(newStart - clip.timelineStart) < 1e-6) return; // nothing moved

    recordHistory("Move clip");
    await updateClipMutation.mutateAsync({ id: clip.id, timelineStart: newStart });

    // sortIndex must follow left-to-right position, not an arbitrary increment.
    const track = timelineClips
      .filter((c) => c.trackType === clip.trackType)
      .map((c) => (c.id === clip.id ? { ...c, timelineStart: newStart } : c));
    for (const patch of reindexTrack(track)) {
      await updateClipMutation.mutateAsync({ id: patch.id, sortIndex: patch.sortIndex });
    }

    await refetchClips();
    toast.success("Clip moved");
  };

  /**
   * Pointer-driven clip drag.
   *
   * Anchored on the pointer position at mousedown so the clip follows the
   * cursor's delta. The previous version moved the clip's left edge to the
   * cursor on mouseup, which teleported the clip on a plain click.
   */
  const beginClipDrag = (clip: TimelineClip, event: ReactMouseEvent) => {
    const track = event.currentTarget.parentElement as HTMLDivElement | null;
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const origin: DragOrigin = {
      clipId: clip.id,
      startAt: clip.timelineStart,
      pointerX: event.clientX - trackRect.left,
    };
    const candidates = snapCandidates(timelineClips, [clip.id], currentTime);
    let latestStart = clip.timelineStart;
    let moved = false;

    const onMove = (e: MouseEvent) => {
      const pointerX = e.clientX - trackRect.left;
      if (!moved && !isDrag(origin, pointerX)) return;
      moved = true;
      setDraggingClip(clip.id);
      const proposed = dragToStart(origin, pointerX, zoomLevel);
      const snapped = applySnap(proposed, clip.duration, candidates, zoomLevel);
      latestStart = snapped.start;
      setSnapGuide(snapped.snappedTo);
      setDragPreview({ id: clip.id, start: snapped.start });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingClip(null);
      setSnapGuide(null);
      setDragPreview(null);
      if (moved) void handleClipMove(clip, latestStart);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** Edge drag for trimming. Mirrors beginClipDrag but adjusts one edge. */
  const beginTrimDrag = (clip: TimelineClip, edge: "start" | "end", event: ReactMouseEvent) => {
    event.stopPropagation();
    const startX = event.clientX;
    const assetDuration = assetDurationOf(clip.assetId);
    let result = { sourceStart: clip.sourceStart, duration: clip.duration, timelineStart: clip.timelineStart };
    let moved = false;

    const onMove = (e: MouseEvent) => {
      const delta = (e.clientX - startX) / zoomLevel;
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      result = resolveTrim(clip, edge, delta, assetDuration);
      setTrimPreview({ id: clip.id, start: result.timelineStart, duration: result.duration });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setTrimPreview(null);
      if (moved) void handleTrimClip(clip, result);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** Duplicates every selected clip, placing copies after their originals. */
  const handleDuplicateClips = async (targets: TimelineClip[]) => {
    if (targets.length === 0) return;
    try {
      recordHistory(targets.length > 1 ? `Duplicate ${targets.length} clips` : "Duplicate clip");
      const newIds: number[] = [];
      for (const clip of targets) {
        const track = timelineClips.filter((c) => c.trackType === clip.trackType);
        const created: any = await createClipMutation.mutateAsync({
          projectId: projId,
          assetId: clip.assetId,
          trackId: clip.trackId,
          trackType: clip.trackType,
          sourceStart: clip.sourceStart,
          duration: clip.duration,
          timelineStart: duplicateStart(clip, track),
          sortIndex: track.length,
        } as any);
        if (created?.id) newIds.push(created.id);
      }
      await refetchClips();
      if (newIds.length) setSelectedClipIds(newIds); // select the copies
      toast.success(targets.length > 1 ? `${targets.length} clips duplicated` : "Clip duplicated");
    } catch (err) {
      toast.error("Failed to duplicate: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  /** Splits the given clips at the playhead. */
  const handleSplitAtPlayhead = async (targets: TimelineClip[]) => {
    const splittable = targets
      .map((clip) => ({ clip, offset: splitOffset(clip, currentTime) }))
      .filter((c): c is { clip: TimelineClip; offset: number } => c.offset !== null);

    if (splittable.length === 0) {
      toast.error("Move the playhead inside a clip to split it");
      return;
    }
    recordHistory(splittable.length > 1 ? `Split ${splittable.length} clips` : "Split clip");
    try {
      for (const { clip, offset } of splittable) {
        await splitClipMutation.mutateAsync({ id: clip.id, splitAt: offset, projectId: projId });
      }
      await refetchClips();
      toast.success(splittable.length > 1 ? `${splittable.length} clips split` : "Clip split");
    } catch (err) {
      toast.error("Failed to split clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleDeleteClips = async (clipIds: number[]) => {
    if (clipIds.length === 0) return;
    try {
      // A snapshot captures the whole row, so undo can re-create it verbatim.
      // The old inverse-based history only stored timelineStart and could never
      // bring a deleted clip back.
      recordHistory(clipIds.length > 1 ? `Delete ${clipIds.length} clips` : "Delete clip");
      for (const id of clipIds) await deleteClipMutation.mutateAsync({ id });
      await refetchClips();
      setSelectedClipIds([]);
      toast.success(clipIds.length > 1 ? `${clipIds.length} clips deleted` : "Clip deleted");
    } catch (err) {
      toast.error("Failed to delete clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleDeleteClip = (clipId: number) => handleDeleteClips([clipId]);

  const handleToggleMute = async (clip: TimelineClip) => {
    try {
      recordHistory(clip.muted ? "Unmute clip" : "Mute clip");
      await updateClipMutation.mutateAsync({ id: clip.id, muted: !clip.muted });
      await refetchClips();
    } catch (err) {
      toast.error("Failed to update clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleToggleVisibility = async (clip: TimelineClip) => {
    try {
      recordHistory(clip.visible ? "Hide clip" : "Show clip");
      await updateClipMutation.mutateAsync({ id: clip.id, visible: !clip.visible });
      await refetchClips();
    } catch (err) {
      toast.error("Failed to update clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };



  const handleTrimClip = async (
    clip: TimelineClip,
    next: { sourceStart: number; duration: number; timelineStart: number },
  ) => {
    if (
      Math.abs(next.sourceStart - clip.sourceStart) < 1e-6 &&
      Math.abs(next.duration - clip.duration) < 1e-6 &&
      Math.abs(next.timelineStart - clip.timelineStart) < 1e-6
    ) {
      return;
    }
    if (next.duration < MIN_CLIP_DURATION) return;
    try {
      recordHistory("Trim clip");
      await trimClipMutation.mutateAsync({
        id: clip.id,
        sourceStart: next.sourceStart,
        duration: next.duration,
      });
      // A left trim also shifts the clip on the timeline; clip.trim only covers
      // the source window, so the position needs a separate write.
      if (Math.abs(next.timelineStart - clip.timelineStart) > 1e-6) {
        await updateClipMutation.mutateAsync({ id: clip.id, timelineStart: next.timelineStart });
      }
      await refetchClips();
      toast.success("Clip trimmed");
    } catch (err) {
      toast.error("Failed to trim clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  /* Keyboard shortcuts */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "KeyJ") {
        handlePlaybackSpeedChange(0.5);
      } else if (e.code === "KeyK") {
        handlePlaybackSpeedChange(1);
      } else if (e.code === "KeyL") {
        handlePlaybackSpeedChange(2);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        handleSkipBack();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handleSkipForward();
      } else if (e.code === "Home") {
        handleGoToStart();
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        void performUndo().then((label) => {
          if (label) toast.info(`Undone: ${label}`);
        });
      } else if (
        (e.metaKey || e.ctrlKey) &&
        ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY")
      ) {
        e.preventDefault();
        void performRedo().then((label) => {
          if (label) toast.info(`Redone: ${label}`);
        });
      } else if (e.code === "KeyS" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void handleSplitAtPlayhead(selectedClips.length ? selectedClips : activeClip ? [activeClip] : []);
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyD") {
        e.preventDefault();
        void handleDuplicateClips(selectedClips);
      } else if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        void handleDeleteClips(selectedClipIds);
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyA") {
        e.preventDefault();
        setSelectedClipIds(timelineClips.map((c) => c.id));
      } else if (e.code === "Escape") {
        setSelectedClipIds([]);
        setClipMenu(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // selectedClipIds and canUndo/canRedo must be in here: without them the
    // handler closes over an empty selection and the shortcuts silently no-op.
  }, [
    isPlaying,
    currentTime,
    timelineClips,
    totalDuration,
    zoomLevel,
    selectedClipIds,
    activeClip?.id,
    canUndo,
    canRedo,
  ]);

  /* Drag-and-drop on sidebar */
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = Array.from(e.dataTransfer.files).find(isSupportedMedia);
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <Scissors className="w-16 h-16 text-brand-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-white mb-4">Sign in to edit</h1>
          <Link href="/">
            <Button className="bg-brand-500 hover:bg-brand-600 text-white h-11">
              Go to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0a0a0f] flex flex-col overflow-hidden text-white font-sans select-none">
      {/* Top Header Bar */}
      <header className="h-11 bg-[#0c0c12] border-b border-white/[0.07] flex items-center justify-between px-4 flex-shrink-0 z-30">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white gap-1.5 h-7 px-2 text-xs">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-xs tracking-wide">{project?.name || "Video Project 8.mp4"}</span>
            <span className="text-sky-400 text-[10px] font-mono px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded-full">
              {project?.status || "editing"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white h-7 text-xs font-semibold px-4 rounded-md shadow-md shadow-sky-500/20 min-w-[80px]"
          >
            {exporting ? `Exporting ${Math.round(exportProgress)}%` : "Export"}
          </Button>
        </div>
      </header>

      {/* Main Workspace 3-Column Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Column: Category Navigation + Media Library / Effects */}
        <div className="w-80 min-w-[320px] max-w-[360px] flex flex-col h-full bg-[#111116] border-r border-white/[0.07] flex-shrink-0">
          <LeftCategoryNav
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
            activeSubTab={activeSubTab}
            onSelectSubTab={setActiveSubTab}
          />
          {activeCategory === "media" ? (
            <MediaGrid
              assets={assets ?? []}
              onUpload={handleFileUpload}
              onAddAssetToTimeline={handleAddAssetToTimeline}
              onDeleteAsset={handleRemoveAsset}
              uploading={uploading}
              uploadProgress={uploadProgress}
            />
          ) : activeCategory === "videofx" ? (
            <div className="p-3 grid grid-cols-2 gap-2 overflow-y-auto no-scrollbar">
              {["Cinematic LUT", "Vibrant HDR", "Film Grain", "Vignette Blur", "Glow Accent", "Sharpen"].map((fx, i) => {
                const isActive = activeClip?.videoFx === fx;
                return (
                  <div
                    key={i}
                    onClick={() => handleApplyVideoFx(fx)}
                    className={`p-3 rounded-lg border cursor-pointer text-center transition-all ${
                      isActive
                        ? "bg-sky-500/20 border-sky-400 text-sky-200 shadow-md shadow-sky-500/20"
                        : "bg-[#181822] border-white/[0.08] hover:border-sky-400 text-gray-200"
                    }`}
                  >
                    <Sparkles className={`w-5 h-5 mx-auto mb-1.5 ${isActive ? "text-sky-300" : "text-sky-400"}`} />
                    <span className="text-xs font-medium">{fx}</span>
                    {isActive && <div className="text-[9px] text-sky-300 font-mono mt-0.5">Applied</div>}
                  </div>
                );
              })}
            </div>
          ) : activeCategory === "audiofx" ? (
            <div className="p-3 space-y-2 overflow-y-auto no-scrollbar">
              {["Vocal Clarity Enhance", "Noise Suppression", "Bass Punch", "Reverb Hall", "Limiter & Gate"].map((fx, i) => (
                <div
                  key={i}
                  onClick={() => toast.success(`Applied ${fx} audio filter`)}
                  className="p-2.5 rounded-lg bg-[#181822] border border-white/[0.08] hover:border-purple-400 cursor-pointer flex items-center justify-between transition-all"
                >
                  <span className="text-xs font-medium text-gray-200">{fx}</span>
                  <Volume2 className="w-4 h-4 text-purple-400" />
                </div>
              ))}
            </div>
          ) : activeCategory === "transitions" ? (
            <div className="p-3 grid grid-cols-2 gap-2 overflow-y-auto no-scrollbar">
              {["Cross Dissolve", "Dip to Black", "Zoom Wipe", "Glitch Pulse", "Push Left", "Slide Down"].map((tr, i) => {
                const isActive = activeClip?.transition === tr;
                return (
                  <div
                    key={i}
                    onClick={() => handleApplyTransition(tr)}
                    className={`p-3 rounded-lg border cursor-pointer text-center transition-all ${
                      isActive
                        ? "bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-md shadow-emerald-500/20"
                        : "bg-[#181822] border-white/[0.08] hover:border-emerald-400 text-gray-200"
                    }`}
                  >
                    <Sparkles className={`w-5 h-5 mx-auto mb-1.5 ${isActive ? "text-emerald-300" : "text-emerald-400"}`} />
                    <span className="text-xs font-medium">{tr}</span>
                    {isActive && <div className="text-[9px] text-emerald-300 font-mono mt-0.5">Applied</div>}
                  </div>
                );
              })}
            </div>
          ) : activeCategory === "transcript" ? (
            <div className="p-3 space-y-2 overflow-y-auto no-scrollbar text-xs">
              <div className="text-[11px] text-gray-400 mb-1">Click any timestamp to seek playhead:</div>
              {captions.length > 0 ? (
                captions.map((cue, idx) => (
                  <div
                    key={idx}
                    onClick={() => setCurrentTime(cue.startTime)}
                    className="p-2 rounded bg-[#181822] border border-white/[0.06] hover:border-sky-400 cursor-pointer flex items-start gap-2"
                  >
                    <span className="text-[10px] font-mono text-sky-400 shrink-0">{formatTime(cue.startTime)}</span>
                    <span className="text-gray-300">{cue.text}</span>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-gray-500">
                  <FileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  No transcript generated yet. Click "Auto Captions" in the AI Agent.
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 space-y-3 overflow-y-auto no-scrollbar text-xs">
              <div className="font-semibold text-gray-300">Clip Inspector</div>
              {activeClip ? (
                <div className="space-y-3">
                  <div className="p-2.5 rounded bg-[#181822] border border-white/[0.08]">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Clip Name</div>
                    <input
                      type="text"
                      value={activeClip.assetName}
                      onChange={(e) => {
                        recordHistory("Rename clip");
                        void updateClipMutation.mutateAsync({ id: activeClip.id, assetName: e.target.value } as any).then(() => refetchClips());
                      }}
                      className="w-full bg-[#101016] border border-white/[0.1] rounded px-2 py-1 text-xs text-sky-300 font-medium focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded bg-[#181822] border border-white/[0.08]">
                      <div className="text-[10px] text-gray-400 mb-0.5">Timeline Start</div>
                      <div className="font-mono text-xs text-gray-200">{activeClip.timelineStart.toFixed(2)}s</div>
                    </div>
                    <div className="p-2 rounded bg-[#181822] border border-white/[0.08]">
                      <div className="text-[10px] text-gray-400 mb-0.5">Duration</div>
                      <div className="font-mono text-xs text-gray-200">{activeClip.duration.toFixed(2)}s</div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-[#181822] border border-white/[0.08] space-y-2">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">Clip Controls</div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300">Mute Audio</span>
                      <button
                        onClick={() => handleToggleMute(activeClip)}
                        className={`px-2 py-1 rounded text-xs border ${
                          activeClip.muted
                            ? "bg-red-500/20 text-red-300 border-red-500/40"
                            : "bg-white/[0.04] text-gray-400 border-white/[0.08]"
                        }`}
                      >
                        {activeClip.muted ? "Muted" : "Active"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300">Visibility</span>
                      <button
                        onClick={() => handleToggleVisibility(activeClip)}
                        className={`px-2 py-1 rounded text-xs border ${
                          activeClip.visible !== false
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-white/[0.04] text-gray-400 border-white/[0.08]"
                        }`}
                      >
                        {activeClip.visible !== false ? "Visible" : "Hidden"}
                      </button>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDeleteClip(activeClip.id)}
                    className="w-full border-red-500/30 text-red-400 hover:bg-red-500/15 h-8 text-xs font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete Clip
                  </Button>
                </div>
              ) : (
                <div className="text-gray-500 text-center py-6">Select a clip on the timeline to inspect and edit properties</div>
              )}
            </div>
          )}
        </div>

        {/* Center Column: Video Preview Viewport & Floating Player Bar */}
        <div className="flex-1 flex flex-col min-w-0 bg-black relative items-center justify-between p-4 overflow-hidden">
          {/* Video Preview Canvas Viewport */}
          <div className="w-full flex-1 flex items-center justify-center relative overflow-hidden rounded-lg bg-[#050508] border border-white/[0.05]">
            {activeClip?.assetUrl ? (
              <video
                ref={previewVideoRef}
                src={activeClip.assetUrl}
                  muted={activeClip.muted || isMuted || trackStates.video0?.muted === true || !((assets ?? []).find((asset) => asset.id === activeClip.assetId)?.hasAudio)}
                playsInline
                style={{
                  filter:
                    activeClip.videoFx === "Cinematic LUT"
                      ? "contrast(1.2) saturate(1.2) brightness(0.95)"
                      : activeClip.videoFx === "Vibrant HDR"
                      ? "saturate(1.45) contrast(1.1) brightness(1.05)"
                      : activeClip.videoFx === "Film Grain"
                      ? "contrast(1.1) sepia(0.15)"
                      : activeClip.videoFx === "Vignette Blur"
                      ? "contrast(1.25)"
                      : activeClip.videoFx === "Glow Accent"
                      ? "brightness(1.15) saturate(1.25)"
                      : activeClip.videoFx === "Sharpen"
                      ? "contrast(1.35)"
                      : "none",
                }}
                className="max-w-full max-h-full object-contain transition-all"
                onTimeUpdate={handlePreviewTimeUpdate}
                onLoadedMetadata={handlePreviewLoadedMetadata}
                onPlay={() => setIsPlaying(true)}
                onEnded={() => {
                  const nextClip = [...timelineClips]
                    .filter((clip) => clip.timelineStart > activeClip.timelineStart)
                    .sort((a, b) => a.timelineStart - b.timelineStart)[0];
                  if (nextClip?.assetUrl) {
                    const nextVideo = previewVideoRef.current;
                    autoplayNextRef.current = true;
                    setCurrentTime(nextClip.timelineStart);
                    if (nextVideo) {
                      nextVideo.src = nextClip.assetUrl;
                      nextVideo.currentTime = nextClip.sourceStart;
                      nextVideo.addEventListener("loadedmetadata", () => void nextVideo.play().catch(() => setIsPlaying(false)), { once: true });
                      nextVideo.load();
                    }
                  } else {
                    setCurrentTime(totalDuration);
                  }
                }}
              />
            ) : (
              <div className="text-center p-6">
                <FileVideo className="w-16 h-16 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 font-medium text-sm">Upload or select a video to preview</p>
                <p className="text-gray-600 text-xs mt-1">Full-stack multi-track timeline editing</p>
              </div>
            )}

            {/* Audio elements for multi-track audio playback */}
            {timelineClips
              .filter((clip) => clip.trackType === "audio" && clip.assetUrl && clip.visible !== false)
              .map((clip) => (
                <audio
                  key={clip.id}
                  ref={(node) => {
                    if (node) audioRefs.current.set(clip.id, node);
                    else audioRefs.current.delete(clip.id);
                  }}
                  src={clip.assetUrl}
                  preload="auto"
                  aria-hidden="true"
                />
              ))}

            {/* Subtitle Caption Overlay */}
            {activeCue && trackStates.captions?.visible !== false && (
              <div className="absolute bottom-6 left-0 right-0 flex justify-center px-6 pointer-events-none z-20">
                <div
                  className="bg-black/85 backdrop-blur-md text-white text-sm font-semibold px-5 py-2 rounded-lg max-w-2xl text-center leading-relaxed shadow-2xl border border-white/10"
                  style={{ textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
                >
                  {activeCue.text}
                </div>
              </div>
            )}
          </div>

          {/* Floating Modern Player Controls Bar */}
          <div className="pt-3 flex items-center justify-center w-full">
            <FloatingPlayerControls
              isPlaying={isPlaying}
              onTogglePlay={togglePlay}
              onGoToStart={handleGoToStart}
              onSkipForward={handleSkipForward}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(!isMuted)}
              onZoomIn={() => setZoomLevel(Math.min(200, zoomLevel + 10))}
              onZoomOut={() => setZoomLevel(Math.max(20, zoomLevel - 10))}
            />
          </div>
        </div>

        {/* Right Column: AI Agent Panel */}
        <AIAgentPanel
          userEmail={user.email || "shubhamkumar92240@gmail.com"}
          onExecuteQuickAction={handleExecuteQuickAction}
          onSendMessage={handleAISendMessage}
          aiLoading={aiLoading}
          pendingPlan={pendingPlan}
          selectedOpIndices={selectedOpIndices}
          onToggleOpSelection={toggleOpSelection}
          onApplyPlan={handleApplyPlan}
          onRejectPlan={handleRejectPlan}
          aiMessages={aiMessages}
        />
      </div>

      {/* Mid Toolbar (Between Preview & Timeline) */}
      <TimelineToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => {
          void performUndo().then((label) => {
            if (label) toast.info(`Undone: ${label}`);
          });
        }}
        onRedo={() => {
          void performRedo().then((label) => {
            if (label) toast.info(`Redone: ${label}`);
          });
        }}
        canSplit={canSplit}
        onSplit={() => handleSplitAtPlayhead(selectedClips.length ? selectedClips : activeClip ? [activeClip] : [])}
        canDelete={selectedClipIds.length > 0}
        onDelete={() => handleDeleteClips(selectedClipIds)}
        onAddMarker={() => toast.success("Marker added at playhead")}
        snapping={snapping}
        onToggleSnapping={() => setSnapping(!snapping)}
        currentTime={currentTime}
        zoomLevel={zoomLevel}
        onZoomIn={() => setZoomLevel(Math.min(200, zoomLevel + 10))}
        onZoomOut={() => setZoomLevel(Math.max(20, zoomLevel - 10))}
        isRippleActive={isRippleActive}
        onToggleRipple={() => setIsRippleActive(!isRippleActive)}
      />

      {/* Bottom Multi-Track Timeline (Captions, Video 1, Audio 1, Audio 2) */}
      <div className="h-72 bg-[#0c0c14] flex flex-col flex-shrink-0">
        <MultiTrackTimeline
          clips={timelineClips}
          captions={captions}
          currentTime={currentTime}
          totalDuration={totalDuration}
          zoomLevel={zoomLevel}
          selectedClipIds={selectedClipIds}
          onSelectClip={(id, multi) => {
            setSelectedClipIds((prev) => (multi ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]));
          }}
          onSeek={(time) => {
            setCurrentTime(time);
            if (previewVideoRef.current) {
              const active = timelineClips.find(
                (c) => c.timelineStart <= time && c.timelineStart + c.duration > time
              );
              if (active) {
                previewVideoRef.current.currentTime = active.sourceStart + (time - active.timelineStart);
              }
            }
          }}
          onClipDragStart={beginClipDrag}
          onClipTrimStart={beginTrimDrag}
          onClipDoubleClick={(clip) => handleSplitAtPlayhead([clip])}
          onClipContextMenu={(clip, e) => {
            setSelectedClipIds([clip.id]);
            setClipMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
          }}
          dragPreview={dragPreview}
          trimPreview={trimPreview}
          snapGuide={snapGuide}
          reviewHighlights={reviewHighlights}
          trackStates={trackStates}
          onToggleTrackMute={handleToggleTrackMute}
          onToggleTrackLock={handleToggleTrackLock}
          onToggleTrackVisible={handleToggleTrackVisible}
          getWaveformData={getWaveform}
        />
      </div>

      {/* Right-click actions for the clip under the cursor. */}
      {clipMenu && (
        <>
          <div className="fixed inset-0 z-[90]" onMouseDown={() => setClipMenu(null)} />
          <div
            data-testid="clip-context-menu"
            className="fixed z-[100] min-w-[176px] rounded-lg border border-white/10 bg-[#141420] py-1 shadow-xl text-xs"
            style={{ left: clipMenu.x, top: clipMenu.y }}
          >
            {(() => {
              const clip = timelineClips.find((c) => c.id === clipMenu.clipId);
              if (!clip) return null;
              const targets = selectedClipIds.includes(clip.id) ? selectedClips : [clip];
              const splittable = splitOffset(clip, currentTime) !== null;
              const item =
                "w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-2 disabled:text-gray-600 disabled:hover:bg-transparent";
              return (
                <>
                  <button
                    data-testid="menu-split"
                    className={item}
                    disabled={!splittable}
                    title={splittable ? "" : "Move the playhead inside this clip first"}
                    onClick={() => {
                      setClipMenu(null);
                      void handleSplitAtPlayhead(targets);
                    }}
                  >
                    <Scissors className="w-3 h-3" /> Split at playhead
                  </button>
                  <button
                    data-testid="menu-duplicate"
                    className={item}
                    onClick={() => {
                      setClipMenu(null);
                      void handleDuplicateClips(targets);
                    }}
                  >
                    <Copy className="w-3 h-3" /> Duplicate
                  </button>
                  <button
                    className={item}
                    onClick={() => {
                      setClipMenu(null);
                      void handleToggleMute(clip);
                    }}
                  >
                    {clip.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                    {clip.muted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    className={item}
                    onClick={() => {
                      setClipMenu(null);
                      void handleToggleVisibility(clip);
                    }}
                  >
                    {clip.visible ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {clip.visible ? "Hide" : "Show"}
                  </button>
                  <div className="my-1 h-px bg-white/10" />
                  <button
                    data-testid="menu-delete"
                    className={`${item} hover:text-red-400`}
                    onClick={() => {
                      setClipMenu(null);
                      void handleDeleteClips(targets.map((c) => c.id));
                    }}
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

