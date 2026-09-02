import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileVideo,
  Loader2,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
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
  type CSSProperties,
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
  rippleDeletePatches,
  rippleTrimPatches,
  snapCandidates,
  splitOffset,
} from "@/editor/interaction";
import { useWaveform } from "@/hooks/useWaveform";
import { isSupportedMedia, probeMedia } from "@/editor/media";
import { type Message } from "@/components/AIChatBox";
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
import {
  detectSilenceRanges,
  normalizeReviewableSilenceRanges,
} from "@/editor/silence";
import { extractMediaEvidence } from "@/editor/mediaIntelligence";
import { getActiveCue } from "@/editor/captions";
import { planEditorRequest } from "@/editor/ai";
import { currentMode, onModeResolved, type ReelioMode } from "@/guest/link";
import { MediaGrid } from "@/components/editor/MediaGrid";
import { AIAgentPanel } from "@/components/editor/AIAgentPanel";
import { ClipInspectorPanel } from "@/components/editor/ClipInspectorPanel";
import { FloatingPlayerControls } from "@/components/editor/FloatingPlayerControls";
import { TimelineToolbar } from "@/components/editor/TimelineToolbar";
import { MultiTrackTimeline } from "@/components/editor/MultiTrackTimeline";
import { exportTimeline } from "@/editor/export";
import { PlaybackClock } from "@/editor/playbackClock";
import { ReelioLogo } from "@/components/brand/ReelioLogo";

/* ─── Types ─── */
interface TimelineClip {
  id: number;
  assetId: number;
  assetUrl: string;
  assetName: string;
  assetMimeType: string;
  trackId: number;
  trackType: "video" | "audio";
  sourceStart: number;
  duration: number;
  timelineStart: number;
  sortIndex: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  zIndex?: number;
  volume?: number;
  trackVolume?: number;
  positionX?: number;
  positionY?: number;
  scale?: number;
  cropLeft?: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  transition?: string | null;
  videoFx?: string | null;
}

type EditorCaptionCue = CaptionCue & { id?: number; assetId?: number };

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
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileToBase64(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read file"));
    reader.onprogress = event => {
      if (event.lengthComputable)
        onProgress?.((event.loaded / event.total) * 70);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Find which clip is active at a given timeline time.
 * Returns the clip if currentTime falls within [timelineStart, timelineStart + duration].
 */
function getActiveClip(
  clips: TimelineClip[],
  time: number
): TimelineClip | null {
  const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
  for (const clip of sorted) {
    if (
      time >= clip.timelineStart &&
      time < clip.timelineStart + clip.duration
    ) {
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
  return Math.max(...clips.map(c => c.timelineStart + c.duration), 60);
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
  for (const clip of clips)
    end = Math.max(end, clip.timelineStart + clip.duration);
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
  const playbackClockRef = useRef<PlaybackClock | null>(null);
  if (!playbackClockRef.current) {
    playbackClockRef.current = new PlaybackClock(0);
  }
  const seekTimeline = useCallback((time: number) => {
    playbackClockRef.current?.seek(time);
  }, []);
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
  const [dragPreview, setDragPreview] = useState<{
    id: number;
    start: number;
  } | null>(null);
  const [trimPreview, setTrimPreview] = useState<{
    id: number;
    start: number;
    duration: number;
  } | null>(null);
  const [clipMenu, setClipMenu] = useState<{
    clipId: number;
    x: number;
    y: number;
  } | null>(null);
  const [aiMessages, setAiMessages] = useState<Message[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPhase, setAiPhase] = useState<
    "idle" | "analysing" | "requesting" | "applying" | "cancelling" | "error"
  >("idle");
  const [pendingPlan, setPendingPlan] = useState<EditPlan | null>(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(
    null
  );
  const [pendingProvenance, setPendingProvenance] = useState<{
    source: string;
    provider: string | null;
    observations: string[];
    inferences: string[];
    unsupported: string[];
  } | null>(null);
  const [selectedOpIndices, setSelectedOpIndices] = useState<number[]>([]);
  const [reviewInstruction, setReviewInstruction] = useState<string>("");
  const [lastAIInstruction, setLastAIInstruction] = useState<string>("");
  const [activeAIRequestId, setActiveAIRequestId] = useState<string | null>(
    null
  );
  const [reelioMode, setReelioMode] = useState<ReelioMode | null>(() =>
    currentMode()
  );
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [captions, setCaptions] = useState<EditorCaptionCue[]>([]);
  // The left workspace is intentionally fixed to media. Legacy editor logic
  // remains available while its controls move to contextual surfaces.
  const activeCategory: string = "media";
  const [snapping, setSnapping] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isRippleActive, setIsRippleActive] = useState<boolean>(false);
  const [trackStates, setTrackStates] = useState<
    Record<string, { muted: boolean; locked: boolean; visible: boolean }>
  >({
    captions: { muted: false, locked: false, visible: true },
    video0: { muted: false, locked: false, visible: true },
    audio0: { muted: false, locked: false, visible: true },
    audio1: { muted: false, locked: false, visible: true },
  });
  const trackStatesRef = useRef(trackStates);
  trackStatesRef.current = trackStates;
  const recordTrackHistoryRef = useRef<((label: string) => void) | null>(null);

  const handleToggleTrackMute = (trackKey: string) => {
    recordTrackHistoryRef.current?.(`Mute ${trackKey} track`);
    setTrackStates(prev => ({
      ...prev,
      [trackKey]: { ...prev[trackKey], muted: !prev[trackKey]?.muted },
    }));
    toast.info(
      `Track ${trackKey} ${!trackStates[trackKey]?.muted ? "muted" : "unmuted"}`
    );
  };

  const handleToggleTrackLock = (trackKey: string) => {
    recordTrackHistoryRef.current?.(`Lock ${trackKey} track`);
    setTrackStates(prev => ({
      ...prev,
      [trackKey]: { ...prev[trackKey], locked: !prev[trackKey]?.locked },
    }));
    toast.info(
      `Track ${trackKey} ${!trackStates[trackKey]?.locked ? "locked" : "unlocked"}`
    );
  };

  const handleToggleTrackVisible = (trackKey: string) => {
    recordTrackHistoryRef.current?.(
      `${trackStates[trackKey]?.visible === false ? "Show" : "Hide"} ${trackKey} track`
    );
    setTrackStates(prev => ({
      ...prev,
      [trackKey]: { ...prev[trackKey], visible: !prev[trackKey]?.visible },
    }));
    toast.info(
      `Track ${trackKey} ${!trackStates[trackKey]?.visible ? "visible" : "hidden"}`
    );
  };

  const handleApplyVideoFx = async (fxName: string | null) => {
    if (!activeClip) {
      toast.info("Select a video clip first to apply video effect");
      return;
    }
    try {
      recordHistory(fxName ? `Apply ${fxName} effect` : "Clear video effect");
      await updateClipMutation.mutateAsync({
        id: activeClip.id,
        videoFx: fxName,
      } as any);
      await refetchClips();
      toast.success(
        fxName
          ? `Applied ${fxName} to ${activeClip.assetName}`
          : `Cleared the video effect from ${activeClip.assetName}`
      );
    } catch (err) {
      toast.error(
        "Failed to apply effect: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    }
  };

  const updateActiveClipRenderSetting = async (
    patch: Partial<
      Pick<
        TimelineClip,
        | "volume"
        | "trackVolume"
        | "scale"
        | "positionX"
        | "positionY"
        | "zIndex"
        | "cropLeft"
        | "cropTop"
        | "cropRight"
        | "cropBottom"
      >
    >
  ) => {
    if (!activeClip) return;
    try {
      recordHistory("Adjust clip render settings");
      await updateClipMutation.mutateAsync({ id: activeClip.id, ...patch });
      await refetchClips();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update render settings"
      );
    }
  };

  const updateActiveTrackVolume = async (trackVolume: number) => {
    if (!activeClip) return;
    const trackClips = timelineClips.filter(
      clip =>
        clip.trackId === activeClip.trackId &&
        clip.trackType === activeClip.trackType
    );
    try {
      recordHistory("Adjust track volume");
      await Promise.all(
        trackClips.map(clip =>
          updateClipMutation.mutateAsync({ id: clip.id, trackVolume })
        )
      );
      await refetchClips();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update track volume"
      );
    }
  };

  /* Data fetching */
  const projectQuery = trpc.project.get.useQuery(
    { id: projId },
    { enabled: !!user && projId > 0, retry: false }
  );
  const project = projectQuery.data;
  const { data: assets, refetch: refetchAssets } = trpc.asset.list.useQuery(
    { projectId: projId },
    { enabled: !!user && projId > 0 }
  );
  const { data: clips, refetch: refetchClips } = trpc.clip.list.useQuery(
    { projectId: projId },
    { enabled: !!user && projId > 0 }
  );
  const { data: aiHealth } = trpc.ai.health.useQuery();
  const pendingAIQuery = trpc.ai.pending.useQuery(
    { projectId: projId },
    { enabled: reelioMode === "cloud" && !!user && projId > 0 }
  );
  const exportJobsQuery = trpc.export.list.useQuery(
    { projectId: projId },
    {
      enabled: reelioMode === "cloud" && !!user && projId > 0,
      refetchInterval: 2000,
    }
  );
  const cloudCaptionsQuery = trpc.caption.list.useQuery(
    { projectId: projId },
    { enabled: reelioMode === "cloud" && !!user && projId > 0 }
  );
  const analysisCapabilitiesQuery = trpc.analysis.capabilities.useQuery(
    undefined,
    { enabled: reelioMode === "cloud" }
  );
  const analysisJobsQuery = trpc.analysis.list.useQuery(
    { projectId: projId },
    {
      enabled: reelioMode === "cloud" && !!user && projId > 0,
      refetchInterval: 1500,
    }
  );

  /* Mutation hooks */
  const uploadMutation = trpc.asset.upload.useMutation();
  const deleteAssetMutation = trpc.asset.delete.useMutation();
  const createClipMutation = trpc.clip.create.useMutation();
  const updateClipMutation = trpc.clip.update.useMutation();
  const deleteClipMutation = trpc.clip.delete.useMutation();
  const trimClipMutation = trpc.clip.trim.useMutation();
  const splitClipMutation = trpc.clip.split.useMutation();
  const batchCommitMutation = trpc.clip.batchCommit.useMutation();
  const aiProposeMutation = trpc.ai.propose.useMutation();
  const aiApplyMutation = trpc.ai.commit.useMutation();
  const aiRejectMutation = trpc.ai.reject.useMutation();
  const aiCancelMutation = trpc.ai.cancel.useMutation();
  const serverExportMutation = trpc.export.create.useMutation();
  const cancelExportMutation = trpc.export.cancel.useMutation();
  const retryExportMutation = trpc.export.retry.useMutation();
  const startAnalysisMutation = trpc.analysis.start.useMutation();
  const cancelAnalysisMutation = trpc.analysis.cancel.useMutation();
  const proposeFillerRemovalMutation =
    trpc.analysis.proposeFillerRemoval.useMutation();
  const updateCaptionMutation = trpc.caption.update.useMutation();
  const deleteCaptionMutation = trpc.caption.delete.useMutation();

  /**
   * Undo/Redo.
   *
   * The history reads the clip list through a ref because the derived
   * timelineClips array below is rebuilt on every render; a snapshot taken from
   * a captured copy would go stale between the edit and the undo.
   */
  const clipsRef = useRef<TimelineClip[]>([]);
  const selectionRef = useRef<number[]>([]);
  const audioRefs = useRef(new Map<number, HTMLAudioElement>());
  const syncedTranscriptionRef = useRef<number | null>(null);
  const settledAIProposalIdsRef = useRef(new Set<string>());
  const restoredGuestProposalKeyRef = useRef<string | null>(null);
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
    getTrackStates: () => trackStatesRef.current,
    setTrackStates,
    createClip: clip =>
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
        videoFx: clip.videoFx,
        transition: clip.transition,
      } as any),
    updateClip: patch => updateClipMutation.mutateAsync(patch as any),
    deleteClip: id => deleteClipMutation.mutateAsync({ id }),
    refetch: () => refetchClips(),
  });
  recordTrackHistoryRef.current = recordHistory;
  const {
    generateWaveform,
    getWaveform,
    isGenerating,
    loading: waveformLoading,
    error: waveformErrors,
  } = useWaveform();

  /* Derived */
  const timelineClips: TimelineClip[] = (clips ?? []).map(c => {
    const asset = (assets ?? []).find(a => a.id === c.assetId);
    return {
      ...c,
      zIndex: c.zIndex ?? 0,
      volume: c.volume ?? 1,
      trackVolume: c.trackVolume ?? 1,
      positionX: c.positionX ?? 0,
      positionY: c.positionY ?? 0,
      scale: c.scale ?? 1,
      cropLeft: c.cropLeft ?? 0,
      cropTop: c.cropTop ?? 0,
      cropRight: c.cropRight ?? 0,
      cropBottom: c.cropBottom ?? 0,
      assetUrl: asset?.url ?? "",
      assetName: asset?.name ?? "Unknown",
      assetMimeType: asset?.mimeType ?? "",
    };
  });

  // Keep the history's view of the timeline current; see clipsRef above.
  clipsRef.current = timelineClips;

  const totalDuration = computeTotalDuration(timelineClips);
  const contentDuration = timelineContentEnd(timelineClips);
  const activeCue = getActiveCue(captions, currentTime);
  const selectedClips = timelineClips.filter(c =>
    selectedClipIds.includes(c.id)
  );
  const assetDurationOf = (assetId: number) =>
    (assets ?? []).find(a => a.id === assetId)?.duration ?? 0;

  const reviewHighlights = useMemo<ReviewRangeHighlight[]>(() => {
    if (!pendingPlan) return [];
    const highlights: ReviewRangeHighlight[] = [];
    selectedOpIndices.forEach(idx => {
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
        if (
          asset.hasAudio &&
          !isGenerating(asset.id) &&
          getWaveform(asset.id).length === 0
        ) {
          generateWaveform(asset.id, asset.url);
        }
      }
    }
  }, [assets]);

  /* Restore track controls from localStorage on mount */
  useEffect(() => {
    if (projId > 0 && reelioMode === "guest") {
      try {
        const stored = localStorage.getItem(`reelio-track-states-${projId}`);
        if (stored) setTrackStates(JSON.parse(stored) as typeof trackStates);
      } catch {
        /* corrupt storage — keep defaults */
      }
    }
  }, [projId, reelioMode]);

  useEffect(() => {
    if (reelioMode === "cloud" && cloudCaptionsQuery.data) {
      setCaptions(
        cloudCaptionsQuery.data.map(cue => ({
          id: cue.id,
          assetId: cue.assetId,
          text: cue.text,
          startTime: cue.startTime,
          endTime: cue.endTime,
        }))
      );
    }
  }, [cloudCaptionsQuery.data, reelioMode]);

  useEffect(() => onModeResolved(setReelioMode), []);

  useEffect(() => {
    const proposal = pendingAIQuery.data;
    if (
      !proposal ||
      pendingPlan ||
      settledAIProposalIdsRef.current.has(proposal.id)
    )
      return;
    setPendingPlan(proposal.plan);
    setPendingProposalId(proposal.id);
    setPendingProvenance(proposal.provenance);
    setSelectedOpIndices(proposal.plan.operations.map((_, index) => index));
    setAiMessages(messages => [
      ...messages,
      {
        role: "assistant",
        content:
          "Restored a pending server-validated edit proposal. The timeline has not been changed.",
      },
    ]);
  }, [pendingAIQuery.data, pendingPlan]);

  useEffect(() => {
    if (reelioMode !== "guest" || projId <= 0) return;
    const key = `reelio-ai-proposal-${projId}`;
    if (restoredGuestProposalKeyRef.current === key) return;
    restoredGuestProposalKeyRef.current = key;
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        plan: EditPlan;
        instruction?: string;
      };
      setPendingPlan(parsed.plan);
      setReviewInstruction(parsed.instruction ?? "Restored guest proposal");
      setSelectedOpIndices(parsed.plan.operations.map((_, index) => index));
    } catch {
      localStorage.removeItem(key);
    }
  }, [projId, reelioMode]);

  useEffect(() => {
    if (reelioMode !== "guest" || projId <= 0) return;
    const key = `reelio-ai-proposal-${projId}`;
    if (!pendingPlan) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(
      key,
      JSON.stringify({ plan: pendingPlan, instruction: reviewInstruction })
    );
  }, [pendingPlan, projId, reelioMode, reviewInstruction]);

  /* Persist track controls for guest projects. */
  useEffect(() => {
    if (projId > 0) {
      localStorage.setItem(
        `reelio-track-states-${projId}`,
        JSON.stringify(trackStates)
      );
    }
  }, [projId, trackStates]);

  /* Restore captions from localStorage on mount */
  useEffect(() => {
    if (projId > 0 && reelioMode === "guest") {
      try {
        const stored = localStorage.getItem(`reelio-captions-${projId}`);
        if (stored) setCaptions(JSON.parse(stored) as CaptionCue[]);
      } catch {
        /* corrupt storage — ignore */
      }
    }
  }, [projId, reelioMode]);

  useEffect(() => {
    const clock = playbackClockRef.current;
    if (!clock) return;
    return clock.subscribe((time, playing) => {
      setCurrentTime(time);
      setIsPlaying(playing);
    });
  }, []);

  useEffect(() => {
    if (!playbackClockRef.current) return;
    playbackClockRef.current.totalDuration = contentDuration;
  }, [contentDuration]);

  useEffect(() => {
    if (!playbackClockRef.current) return;
    playbackClockRef.current.playbackSpeed = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(
    () => () => {
      playbackClockRef.current?.destroy();
    },
    []
  );

  const playbackClip = getActiveClip(
    timelineClips.filter(
      clip =>
        clip.trackType === "video" &&
        clip.visible !== false &&
        trackStates.video0?.visible !== false
    ),
    currentTime
  );
  const activeClip = selectedClips[0] ?? playbackClip;
  const previewMediaStyle: CSSProperties = playbackClip
    ? {
        filter:
          playbackClip.videoFx === "Cinematic LUT"
            ? "contrast(1.2) saturate(1.2) brightness(0.95)"
            : playbackClip.videoFx === "Vibrant HDR"
              ? "saturate(1.45) contrast(1.1) brightness(1.05)"
              : playbackClip.videoFx === "Film Grain"
                ? "contrast(1.1) sepia(0.15)"
                : playbackClip.videoFx === "Vignette Blur"
                  ? "contrast(1.25)"
                  : playbackClip.videoFx === "Glow Accent"
                    ? "brightness(1.15) saturate(1.25)"
                    : playbackClip.videoFx === "Sharpen"
                      ? "contrast(1.35)"
                      : "none",
        transform: `translate(${(playbackClip.positionX ?? 0) * 50}%, ${(playbackClip.positionY ?? 0) * 50}%) scale(${playbackClip.scale ?? 1})`,
        transformOrigin: "center",
        clipPath: `inset(${(playbackClip.cropTop ?? 0) * 100}% ${(playbackClip.cropRight ?? 0) * 100}% ${(playbackClip.cropBottom ?? 0) * 100}% ${(playbackClip.cropLeft ?? 0) * 100}%)`,
      }
    : {};
  const activeAudioClips = timelineClips.filter(
    clip =>
      clip.trackType === "audio" &&
      clip.visible !== false &&
      trackStates[clip.trackId === 0 ? "audio0" : "audio1"]?.visible !==
        false &&
      !trackStates[clip.trackId === 0 ? "audio0" : "audio1"]?.muted &&
      clip.assetUrl &&
      currentTime >= clip.timelineStart &&
      currentTime < clip.timelineStart + clip.duration
  );

  /** Keep every audible audio-track clip aligned with the shared timeline clock. */
  useEffect(() => {
    const activeIds = new Set(activeAudioClips.map(clip => clip.id));
    for (const [id, audio] of audioRefs.current) {
      if (!activeIds.has(id)) audio.pause();
    }
    for (const clip of activeAudioClips) {
      const audio = audioRefs.current.get(clip.id);
      if (!audio) continue;
      const sourceTime = clip.sourceStart + currentTime - clip.timelineStart;
      if (Math.abs(audio.currentTime - sourceTime) > 0.08)
        audio.currentTime = sourceTime;
      const trackState = trackStates[clip.trackId === 0 ? "audio0" : "audio1"];
      audio.muted = clip.muted || trackState?.muted === true;
      audio.volume = audio.muted
        ? 0
        : Math.max(
            0,
            Math.min(1, (clip.volume ?? 1) * (clip.trackVolume ?? 1))
          );
      audio.playbackRate = playbackSpeed;
      if (isPlaying) {
        void audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    }
  }, [activeAudioClips, currentTime, isPlaying, playbackSpeed, trackStates]);

  const handleExport = useCallback(async (): Promise<boolean> => {
    if (exporting || timelineClips.length === 0) {
      toast.error("Add media to the timeline before exporting.");
      return false;
    }
    const exportClips = timelineClips.map(clip => {
      const trackKey =
        clip.trackType === "video"
          ? "video0"
          : clip.trackId === 0
            ? "audio0"
            : "audio1";
      const trackState = trackStates[trackKey];
      return {
        ...clip,
        visible: clip.visible !== false && trackState?.visible !== false,
        muted: clip.muted || trackState?.muted === true,
      };
    });
    const hasVideo = exportClips.some(
      clip =>
        clip.trackType === "video" &&
        clip.visible !== false &&
        clip.duration > 0
    );
    if (!hasVideo) {
      toast.error("Add at least one visible video clip to export.");
      return false;
    }
    try {
      setExporting(true);
      setExportProgress(0);
      toast.info("Rendering project to WebM...");
      const result = await exportTimeline(
        project?.name || "reelio-export",
        exportClips,
        (assets ?? []).map(a => ({
          id: a.id,
          url: a.url,
          mimeType: a.mimeType,
          width: a.width || 1280,
          height: a.height || 720,
          duration: a.duration,
          hasAudio: a.hasAudio ?? false,
          fps: a.fps ?? 30,
        })),
        captions,
        pct => setExportProgress(pct)
      );
      toast.success(`Export complete! (${result.sizeKb} KB)`);
      return true;
    } catch (err) {
      toast.error(
        "Export failed: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
      return false;
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }, [assets, captions, exporting, project?.name, timelineClips, trackStates]);

  const latestServerExport = exportJobsQuery.data?.[0];
  const handleServerExport = async () => {
    if (timelineClips.length === 0) {
      toast.error("Add media to the timeline before exporting.");
      return;
    }
    try {
      await serverExportMutation.mutateAsync({
        projectId: projId,
        requestId: crypto.randomUUID(),
        resolution: "720p",
        format: "mp4",
        includeCaptions: captions.length > 0,
      });
      await exportJobsQuery.refetch();
      toast.info(
        "Server MP4 render started. You can keep editing while it runs."
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start server export"
      );
    }
  };

  const handleCancelServerExport = async () => {
    if (!latestServerExport || latestServerExport.status !== "processing")
      return;
    try {
      const result = await cancelExportMutation.mutateAsync({
        id: latestServerExport.id,
      });
      toast.info(
        result.success
          ? "Server render cancellation requested"
          : "Render is no longer active"
      );
      await exportJobsQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not cancel server render"
      );
    }
  };

  const handleRetryServerExport = async () => {
    if (
      !latestServerExport ||
      !["failed", "cancelled"].includes(latestServerExport.status)
    )
      return;
    try {
      await retryExportMutation.mutateAsync({ id: latestServerExport.id });
      await exportJobsQuery.refetch();
      toast.info("Server MP4 render restarted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not retry server render"
      );
    }
  };

  const latestAnalysis = analysisJobsQuery.data?.[0];
  const sceneBoundaries = useMemo(() => {
    const sceneJob = analysisJobsQuery.data?.find(
      job => job.kind === "scene" && job.status === "done" && job.resultJson
    );
    if (!sceneJob?.resultJson)
      return [] as Array<{ time: number; confidence: number }>;
    try {
      const parsed = JSON.parse(sceneJob.resultJson) as {
        boundaries?: Array<{ time: number; confidence: number }>;
      };
      return parsed.boundaries ?? [];
    } catch {
      return [];
    }
  }, [analysisJobsQuery.data]);
  const transcriptionEvidence = useMemo(() => {
    const job = analysisJobsQuery.data?.find(
      candidate =>
        candidate.kind === "transcription" &&
        candidate.status === "done" &&
        candidate.resultJson
    );
    if (!job?.resultJson) return null;
    try {
      const result = JSON.parse(job.resultJson) as {
        text?: string;
        provider?: string;
        fillers?: Array<{ text: string; start: number; end: number }>;
      };
      if (!Array.isArray(result.fillers)) return null;
      return {
        id: job.id,
        assetId: job.assetId,
        provider: result.provider ?? job.provider,
        text: result.text ?? "",
        fillers: result.fillers.filter(
          filler =>
            typeof filler.text === "string" &&
            Number.isFinite(filler.start) &&
            Number.isFinite(filler.end) &&
            filler.start >= 0 &&
            filler.end > filler.start
        ),
      };
    } catch {
      return null;
    }
  }, [analysisJobsQuery.data]);

  const completedTranscriptionId = useMemo(
    () =>
      analysisJobsQuery.data?.find(
        job => job.kind === "transcription" && job.status === "done"
      )?.id ?? null,
    [analysisJobsQuery.data]
  );

  useEffect(() => {
    if (
      reelioMode !== "cloud" ||
      completedTranscriptionId === null ||
      syncedTranscriptionRef.current === completedTranscriptionId
    ) {
      return;
    }
    syncedTranscriptionRef.current = completedTranscriptionId;
    void cloudCaptionsQuery.refetch();
  }, [completedTranscriptionId, reelioMode]);

  const handleStartAnalysis = async (
    kind: "transcription" | "scene"
  ): Promise<boolean> => {
    const candidate =
      (assets ?? []).find(
        asset =>
          asset.id === activeClip?.assetId &&
          (kind !== "scene" || asset.mimeType.startsWith("video/"))
      ) ??
      (assets ?? []).find(asset =>
        kind === "scene" ? asset.mimeType.startsWith("video/") : asset.hasAudio
      );
    if (!candidate) {
      toast.error(
        kind === "scene"
          ? "Add or select a video asset before detecting scenes."
          : "Add or select media with audio before transcription."
      );
      return false;
    }
    try {
      const job = await startAnalysisMutation.mutateAsync({
        requestId: crypto.randomUUID(),
        projectId: projId,
        assetId: candidate.id,
        kind,
      });
      await analysisJobsQuery.refetch();
      if (job.status === "failed") {
        toast.error(job.errorMessage ?? "Analysis is unavailable.");
        return false;
      } else {
        toast.info(
          kind === "scene"
            ? "Measured scene detection started."
            : "Timestamped transcription started."
        );
        return true;
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start analysis"
      );
      return false;
    }
  };

  const handleCancelAnalysis = async () => {
    if (
      !latestAnalysis ||
      !["queued", "processing"].includes(latestAnalysis.status)
    )
      return;
    await cancelAnalysisMutation.mutateAsync({ id: latestAnalysis.id });
    await analysisJobsQuery.refetch();
    toast.info("Analysis cancellation requested.");
  };

  const seekToTranscriptTime = (assetId: number, sourceTime: number) => {
    const clip = timelineClips.find(
      candidate =>
        candidate.assetId === assetId &&
        sourceTime >= candidate.sourceStart &&
        sourceTime < candidate.sourceStart + candidate.duration
    );
    if (clip)
      seekTimeline(clip.timelineStart + sourceTime - clip.sourceStart);
  };

  const handleProposeFillerRemoval = async (occurrenceIndices: number[]) => {
    if (!transcriptionEvidence) return;
    try {
      const proposal = await proposeFillerRemovalMutation.mutateAsync({
        requestId: crypto.randomUUID(),
        analysisId: transcriptionEvidence.id,
        occurrenceIndices,
      });
      setPendingPlan(proposal.plan);
      setPendingProposalId(proposal.id);
      setPendingProvenance(proposal.provenance);
      setSelectedOpIndices(proposal.plan.operations.map((_, index) => index));
      setReviewInstruction("Remove timestamped filler words");
      setAiMessages(messages => [
        ...messages,
        {
          role: "assistant",
          content: `${proposal.plan.summary} Review the measured ranges before applying; nothing has changed yet.`,
        },
      ]);
      toast.info("Filler removal proposal is ready for review.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create a filler removal proposal"
      );
    }
  };

  const persistCaption = async (cue: EditorCaptionCue) => {
    if (reelioMode === "cloud" && cue.id) {
      await updateCaptionMutation.mutateAsync({
        id: cue.id,
        text: cue.text,
        startTime: cue.startTime,
        endTime: cue.endTime,
      });
      await cloudCaptionsQuery.refetch();
    } else {
      localStorage.setItem(
        `reelio-captions-${projId}`,
        JSON.stringify(captions)
      );
    }
  };

  const removeCaption = async (cue: EditorCaptionCue, index: number) => {
    if (reelioMode === "cloud" && cue.id) {
      await deleteCaptionMutation.mutateAsync({ id: cue.id });
      await cloudCaptionsQuery.refetch();
      return;
    }
    const next = captions.filter((_, cueIndex) => cueIndex !== index);
    setCaptions(next);
    localStorage.setItem(`reelio-captions-${projId}`, JSON.stringify(next));
  };

  const toggleOpSelection = useCallback((index: number) => {
    setSelectedOpIndices(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index].sort((a, b) => a - b)
    );
  }, []);

  const handleApplyPlan = useCallback(
    async (opsToApply?: EditOp[]) => {
      if (!pendingPlan) return;
      const targetOps =
        opsToApply ??
        selectedOpIndices.map(i => pendingPlan.operations[i]).filter(Boolean);

      if (targetOps.length === 0) {
        toast.error("No operations selected to apply");
        return;
      }

      try {
        if (reelioMode === "cloud" && pendingProposalId) {
          setAiLoading(true);
          setAiPhase("applying");
          const selectedOperationIndices = opsToApply
            ? pendingPlan.operations.map((_, index) => index)
            : selectedOpIndices;
          const result = await aiApplyMutation.mutateAsync({
            id: pendingProposalId,
            selectedOperationIndices,
          });
          if (!result.alreadyApplied) {
            // The mutation has committed, while clipsRef still contains the pre-edit
            // state needed by undo. Record it before refetching the new timeline.
            recordHistory(`AI: ${reviewInstruction.slice(0, 60)}`);
          }
          await refetchClips();
          const summaryText = describePlan({
            summary: "",
            operations: targetOps,
          });
          setAiMessages(messages => [
            ...messages,
            {
              role: "assistant",
              content: result.alreadyApplied
                ? "This proposal had already been applied; no duplicate edits were created."
                : `Applied ${result.appliedCount} validated change${result.appliedCount === 1 ? "" : "s"}: ${summaryText}`,
            },
          ]);
          toast.success(
            result.alreadyApplied
              ? "Proposal was already applied"
              : `Applied ${result.appliedCount} edit${result.appliedCount === 1 ? "" : "s"}`
          );
          settledAIProposalIdsRef.current.add(pendingProposalId);
          setPendingPlan(null);
          setPendingProposalId(null);
          setPendingProvenance(null);
          setSelectedOpIndices([]);
          setReviewInstruction("");
          await pendingAIQuery.refetch();
          return;
        }

        const latestAssets = (await refetchAssets()).data ?? assets ?? [];
        const assetMap = new Map(
          latestAssets.map(asset => [
            asset.id,
            {
              id: asset.id,
              duration: asset.duration,
              hasAudio: asset.hasAudio ?? false,
              width: asset.width,
              height: asset.height,
              fps: asset.fps ?? 30,
            },
          ])
        );

        const result = applyEditOps(timelineClips, assetMap, targetOps);

        if (
          result.applied.some(op =>
            [
              "removeRanges",
              "removeClips",
              "trimClip",
              "moveClip",
              "setClipProps",
              "keepRanges",
              "splitClip",
              "setVideoEffect",
            ].includes(op.type)
          )
        ) {
          // Snapshot history BEFORE persistence so undo restores correctly
          recordHistory(`AI: ${reviewInstruction.slice(0, 60)}`);

          // Persist the new timeline state through a single atomic database transaction
          const creates: any[] = [];
          const updates: any[] = [];
          const deletes: number[] = [];
          const nextIds = new Set(result.clips.map(clip => clip.id));

          for (const clip of timelineClips) {
            if (!nextIds.has(clip.id)) deletes.push(clip.id);
          }
          for (const clip of result.clips) {
            const previous = timelineClips.find(
              candidate => candidate.id === clip.id
            );
            if (previous) {
              updates.push({
                id: clip.id,
                patch: {
                  sourceStart: clip.sourceStart,
                  duration: clip.duration,
                  timelineStart: clip.timelineStart,
                  sortIndex: clip.sortIndex,
                  trackId: clip.trackId,
                  locked: clip.locked,
                  visible: clip.visible,
                  muted: clip.muted,
                  videoFx: clip.videoFx,
                  transition: clip.transition,
                },
              });
            } else {
              creates.push({
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
                videoFx: clip.videoFx,
                transition: clip.transition,
              });
            }
          }

          await batchCommitMutation.mutateAsync({
            projectId: projId,
            creates,
            updates,
            deletes,
          });
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
              localStorage.setItem(
                `reelio-captions-${projId}`,
                JSON.stringify(next)
              );
          }
        }

        const summaryText = describePlan({
          summary: "",
          operations: result.applied,
        });
        toast.success(`Applied ${result.applied.length} edit(s)`);

        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: `Applied changes:\n${summaryText}${result.skipped.length ? `\n\nSkipped: ${result.skipped.map(item => item.reason).join(", ")}` : ""}`,
          },
        ]);

        // Clear review mode state
        setPendingPlan(null);
        setPendingProposalId(null);
        setPendingProvenance(null);
        setSelectedOpIndices([]);
        setReviewInstruction("");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Execution failed";
        toast.error(`Could not apply edit: ${msg}`);
        setAiPhase("error");
        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: `The proposal was not applied: ${msg}`,
          },
        ]);
      } finally {
        setAiLoading(false);
        setAiPhase(phase => (phase === "error" ? "error" : "idle"));
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
      aiApplyMutation,
      pendingAIQuery,
      pendingProposalId,
      reelioMode,
    ]
  );

  const handleRejectPlan = useCallback(async () => {
    try {
      if (reelioMode === "cloud" && pendingProposalId) {
        await aiRejectMutation.mutateAsync({ id: pendingProposalId });
        settledAIProposalIdsRef.current.add(pendingProposalId);
      }
      setPendingPlan(null);
      setPendingProposalId(null);
      setPendingProvenance(null);
      setSelectedOpIndices([]);
      setReviewInstruction("");
      toast.info("AI proposal dismissed");
      setAiMessages(messages => [
        ...messages,
        {
          role: "assistant",
          content:
            "Edit proposal dismissed. No changes were made to the timeline.",
        },
      ]);
      if (reelioMode === "cloud") await pendingAIQuery.refetch();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not dismiss proposal";
      toast.error(message);
    }
  }, [aiRejectMutation, pendingAIQuery, pendingProposalId, reelioMode]);

  const handleAISendMessage = async (content: string) => {
    const instruction = content.trim();
    if (!instruction || aiLoading) return;
    if (pendingPlan) {
      setAiMessages(messages => [
        ...messages,
        {
          role: "assistant",
          content:
            "Apply or dismiss the current proposal before requesting another one.",
        },
      ]);
      return;
    }
    setLastAIInstruction(instruction);
    setAiMessages(messages => [
      ...messages,
      { role: "user", content: instruction },
    ]);
    setAiLoading(true);
    setAiPhase("analysing");
    try {
      const lower = instruction.toLowerCase();
      if (
        ["undo", "revert", "ctrl+z", "undo that", "undo last edit"].includes(
          lower
        )
      ) {
        const label = await performUndo();
        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: label
              ? `Undone: ${label}.`
              : "Nothing is available to undo.",
          },
        ]);
        return;
      }
      if (["redo", "ctrl+y", "redo that", "redo last edit"].includes(lower)) {
        const label = await performRedo();
        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: label
              ? `Redone: ${label}.`
              : "Nothing is available to redo.",
          },
        ]);
        return;
      }
      if (
        lower === "export" ||
        lower === "export video" ||
        lower === "render video"
      ) {
        const completed = await handleExport();
        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: completed
              ? "The browser WebM export completed and a download was created."
              : "The browser export did not complete. No export was recorded as successful.",
          },
        ]);
        return;
      }
      if (
        /(?:generate|add).*(?:caption|subtitle)|transcri(?:be|ption)/i.test(
          instruction
        )
      ) {
        const configured =
          reelioMode === "cloud" &&
          analysisCapabilitiesQuery.data?.transcription.available;
        const started = configured
          ? await handleStartAnalysis("transcription")
          : false;
        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: started
              ? "Timestamped transcription started. Captions will appear on the timeline after the configured speech provider returns measured cues."
              : "Timestamped transcription is not configured. Reelio cannot truthfully generate captions without real transcript text.",
          },
        ]);
        return;
      }

      const latestAssets = (await refetchAssets()).data ?? assets ?? [];
      const silenceEvidence: Array<{
        assetId: number;
        source: "browser-audio-decoder";
        ranges: Array<{ start: number; end: number }>;
      }> = [];
      const timelineSilenceRanges: Array<{ start: number; end: number }> = [];
      if (/silence|silent|dead air|pause/i.test(instruction)) {
        for (const asset of latestAssets) {
          if (asset.duration <= 0 || !asset.hasAudio) continue;
          const evidence = await extractMediaEvidence(asset, {
            scanAudio: true,
          });
          silenceEvidence.push({
            assetId: asset.id,
            source: "browser-audio-decoder",
            ranges: evidence.silenceRanges,
          });
          for (const clip of timelineClips.filter(
            candidate => candidate.assetId === asset.id
          )) {
            for (const range of evidence.silenceRanges) {
              const start = Math.max(range.start, clip.sourceStart);
              const end = Math.min(range.end, clip.sourceStart + clip.duration);
              if (end > start) {
                timelineSilenceRanges.push({
                  start: clip.timelineStart + (start - clip.sourceStart),
                  end: clip.timelineStart + (end - clip.sourceStart),
                });
              }
            }
          }
        }
      }
      const reviewableSilenceRanges = normalizeReviewableSilenceRanges(
        timelineSilenceRanges,
      );

      if (reelioMode === "guest") {
        const normalized =
          /^remove (?:the )?(?:silence|silent parts|dead air)\.?$/i.test(
            instruction
          )
            ? "Remove silence."
            : instruction;
        const plan = planEditorRequest(
          normalized,
          timelineClips,
          reviewableSilenceRanges,
          {
            playhead: currentTime,
            selectedClipIds,
          }
        );
        if (plan.operations.length === 0) {
          setAiMessages(messages => [
            ...messages,
            { role: "assistant", content: plan.summary },
          ]);
          return;
        }
        setPendingPlan(plan);
        setPendingProposalId(null);
        setPendingProvenance({
          source: reviewableSilenceRanges.length
            ? "browser-audio-evidence"
            : "deterministic",
          provider: null,
          observations: [
            `Guest timeline contains ${timelineClips.length} clips.`,
          ],
          inferences: [],
          unsupported: [],
        });
        setSelectedOpIndices(plan.operations.map((_, index) => index));
        setReviewInstruction(instruction);
        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: `${plan.summary} Review it before applying; no timeline change has occurred.`,
          },
        ]);
        return;
      }

      const requestId = crypto.randomUUID();
      setActiveAIRequestId(requestId);
      setAiPhase("requesting");
      const proposal = await aiProposeMutation.mutateAsync({
        projectId: projId,
        requestId,
        instruction,
        playhead: currentTime,
        selectedClipIds,
        silenceEvidence,
      });
      if (proposal.plan.operations.length === 0) {
        setAiMessages(messages => [
          ...messages,
          {
            role: "assistant",
            content: `${proposal.plan.summary}\nSource: ${proposal.provenance.source}. No timeline change was proposed or applied.`,
          },
        ]);
        return;
      }
      setPendingPlan(proposal.plan);
      setPendingProposalId(proposal.id);
      setPendingProvenance(proposal.provenance);
      setSelectedOpIndices(proposal.plan.operations.map((_, index) => index));
      setReviewInstruction(instruction);
      setAiMessages(messages => [
        ...messages,
        {
          role: "assistant",
          content: `${proposal.plan.summary}\nSource: ${proposal.provenance.source}. ${proposal.plan.operations.length} validated operation${proposal.plan.operations.length === 1 ? "" : "s"} await review; nothing has been applied.`,
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown AI request failure";
      setAiPhase("error");
      setAiMessages(messages => [
        ...messages,
        {
          role: "assistant",
          content: `No edit proposal was created: ${message}`,
        },
      ]);
    } finally {
      setActiveAIRequestId(null);
      setAiLoading(false);
      setAiPhase(phase => (phase === "error" ? "error" : "idle"));
    }
  };

  const handleAICancel = async () => {
    if (!activeAIRequestId) return;
    setAiPhase("cancelling");
    try {
      await aiCancelMutation.mutateAsync({ requestId: activeAIRequestId });
      setAiMessages(messages => [
        ...messages,
        {
          role: "assistant",
          content:
            "Cancellation requested. No proposal will be applied automatically.",
        },
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel AI request"
      );
    }
  };

  const handleAIRetry = () => {
    if (lastAIInstruction && !aiLoading)
      void handleAISendMessage(lastAIInstruction);
  };

  const handleExecuteQuickAction = (actionType: string) => {
    if (actionType === "auto-captions")
      void handleAISendMessage("Generate timestamped captions.");
    if (actionType === "silence") void handleAISendMessage("Remove silence.");
    if (actionType === "restart-phrases")
      void handleAISendMessage("Detect and remove restart phrases.");
    if (actionType === "filler-words") {
      if (transcriptionEvidence?.fillers.length) {
        void handleProposeFillerRemoval(
          transcriptionEvidence.fillers.map((_, index) => index)
        );
      } else {
        toast.info(
          "Generate a timestamped transcript before reviewing filler-word removals. Use Auto Captions in the AI Agent."
        );
      }
    }
    if (actionType === "first-takes")
      void handleAISendMessage(
        "Detect abandoned first takes and propose cuts."
      );
    if (actionType === "sync-music")
      void handleAISendMessage("Sync the selected clips to the music track.");
    if (actionType === "create-short")
      void handleAISendMessage(
        "Create a concise short edit from the selected clips and current timeline."
      );
  };

  const handleNewAIChat = () => {
    if (pendingPlan) {
      toast.info("Apply or dismiss the current edit proposal first.");
      return;
    }
    setAiMessages([]);
    setLastAIInstruction("");
    setAiPhase("idle");
  };

  /**
   * Split targets the selection, falling back to whatever sits under the
   * playhead so the action still works before anything is selected.
   */
  const splitTargets = selectedClips.length
    ? selectedClips
    : activeClip
      ? [activeClip]
      : [];
  const canSplit = splitTargets.some(c => splitOffset(c, currentTime) !== null);

  const handleAddAssetToTimeline = useCallback(
    async (asset: any) => {
      if (!asset || asset.duration <= 0) {
        toast.error("This asset has no usable duration");
        return;
      }
      const timelineStart = timelineContentEnd(timelineClips);
      try {
        recordHistory(`Add ${asset.name || "media"} to timeline`);
        await createClipMutation.mutateAsync({
          projectId: projId,
          assetId: asset.id,
          trackType: asset.mimeType.startsWith("audio/") ? "audio" : "video",
          sourceStart: 0,
          duration: asset.duration,
          timelineStart,
          sortIndex: timelineClips.length,
        });
        await refetchClips();
        // Import/add should immediately show the new composition in preview.
        // Selection remains independent so the inspector does not cover it.
        seekTimeline(timelineStart);
        toast.success(`Added "${asset.name}" to timeline`);
      } catch (err) {
        toast.error(
          "Could not add asset: " +
            (err instanceof Error ? err.message : "Unknown error")
        );
      }
    },
    [
      createClipMutation,
      projId,
      recordHistory,
      refetchClips,
      seekTimeline,
      timelineClips,
      timelineClips.length,
    ]
  );

  const handleRemoveAsset = useCallback(
    async (asset: any) => {
      try {
        await deleteAssetMutation.mutateAsync({ id: asset.id });
        await Promise.all([refetchAssets(), refetchClips()]);
        toast.success(`Removed "${asset.name}"`);
      } catch (err) {
        toast.error(
          "Could not remove asset: " +
            (err instanceof Error ? err.message : "Unknown error")
        );
      }
    },
    [deleteAssetMutation, refetchAssets, refetchClips]
  );

  /* Upload handler */
  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!isSupportedMedia(file)) {
        toast.error("Please select a supported video, audio, or image file");
        return;
      }
      const mode = currentMode();
      if (mode !== "guest" && file.size > 50 * 1024 * 1024) {
        toast.error("Cloud uploads are limited to 50 MB in this build.");
        return;
      }
      setUploading(true);
      setUploadProgress(0);
      try {
        const metadata = await probeMedia(file);
        setUploadProgress(10);
        const mimeType =
          file.type ||
          metadata.mimeType;
        const commonPayload = {
          projectId: projId,
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          hasAudio: metadata.hasAudio,
        };
        if (mode === "guest") {
          setUploadProgress(70);
          await uploadMutation.mutateAsync({
            ...commonPayload,
            blob: file,
          } as any);
        } else {
          const base64 = await fileToBase64(file, setUploadProgress);
          setUploadProgress(75);
          await uploadMutation.mutateAsync({
            ...commonPayload,
            base64Data: base64,
          });
        }
        setUploadProgress(100);
        const newAssets = await refetchAssets();
        const newAsset = [...(newAssets.data ?? [])]
          .filter(
            asset => asset.name === file.name && asset.sizeBytes === file.size
          )
          .sort((a, b) => b.id - a.id)[0];
        if (newAsset && newAsset.duration > 0) {
          await handleAddAssetToTimeline(newAsset);
        } else {
          toast.success(`Imported "${file.name}"`);
        }
        setTimeout(() => {
          setUploading(false);
          setUploadProgress(0);
        }, 500);
      } catch (err) {
        setUploading(false);
        setUploadProgress(0);
        toast.error(
          "Upload failed: " +
            (err instanceof Error ? err.message : "Unknown error")
        );
      }
    },
    [
      handleAddAssetToTimeline,
      projId,
      refetchAssets,
      timelineClips,
      timelineClips.length,
      uploadMutation,
    ]
  );

  /* Video preview follows the playhead, independently of inspector selection. */
  useEffect(() => {
    if (playbackClip && previewVideoRef.current) {
      const video = previewVideoRef.current;
      video.playbackRate = playbackSpeed;
      const sourceTime = Math.max(
        playbackClip.sourceStart,
        currentTime - playbackClip.timelineStart + playbackClip.sourceStart
      );
      if (Math.abs(video.currentTime - sourceTime) > 0.1) {
        video.currentTime = sourceTime;
      }
      if (isPlaying && video.paused) {
        void video.play().catch(() => playbackClockRef.current?.pause());
      } else if (!isPlaying && !video.paused) {
        video.pause();
      }
    }
  }, [playbackClip?.id, currentTime, isPlaying, playbackSpeed]);

  const handlePreviewLoadedMetadata = () => {
    if (!playbackClip || !previewVideoRef.current) return;
    previewVideoRef.current.currentTime = Math.max(
      playbackClip.sourceStart,
      currentTime - playbackClip.timelineStart + playbackClip.sourceStart
    );
    previewVideoRef.current.playbackRate = playbackSpeed;
    if (isPlaying) {
      void previewVideoRef.current
        .play()
        .catch(() => playbackClockRef.current?.pause());
    }
  };

  const togglePlay = () => {
    const clock = playbackClockRef.current;
    if (!clock || contentDuration <= 0) {
      toast.info("Add media to the timeline before playing.");
      return;
    }
    if (clock.isPlaying) {
      clock.pause();
    } else {
      clock.play();
    }
  };

  const handlePlaybackSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (playbackClockRef.current) playbackClockRef.current.playbackSpeed = speed;
  };

  /* Timeline navigation */
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, x / zoomLevel);
    seekTimeline(time);
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
    seekTimeline(newTime);
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
    seekTimeline(newTime);
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
    seekTimeline(0);
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
  const handleClipMove = async (
    clip: TimelineClip,
    newTimelineStart: number
  ) => {
    const newStart = Math.max(0, newTimelineStart);
    if (Math.abs(newStart - clip.timelineStart) < 1e-6) return; // nothing moved

    recordHistory("Move clip");
    await updateClipMutation.mutateAsync({
      id: clip.id,
      timelineStart: newStart,
    });

    // sortIndex must follow left-to-right position, not an arbitrary increment.
    const track = timelineClips
      .filter(c => c.trackType === clip.trackType && c.trackId === clip.trackId)
      .map(c => (c.id === clip.id ? { ...c, timelineStart: newStart } : c));
    for (const patch of reindexTrack(track)) {
      await updateClipMutation.mutateAsync({
        id: patch.id,
        sortIndex: patch.sortIndex,
      });
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
  const beginTrimDrag = (
    clip: TimelineClip,
    edge: "start" | "end",
    event: ReactMouseEvent
  ) => {
    event.stopPropagation();
    const startX = event.clientX;
    const assetDuration = assetDurationOf(clip.assetId);
    let result = {
      sourceStart: clip.sourceStart,
      duration: clip.duration,
      timelineStart: clip.timelineStart,
    };
    let moved = false;

    const onMove = (e: MouseEvent) => {
      const delta = (e.clientX - startX) / zoomLevel;
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      result = resolveTrim(clip, edge, delta, assetDuration);
      setTrimPreview({
        id: clip.id,
        start: result.timelineStart,
        duration: result.duration,
      });
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
      recordHistory(
        targets.length > 1
          ? `Duplicate ${targets.length} clips`
          : "Duplicate clip"
      );
      const newIds: number[] = [];
      for (const clip of targets) {
        const track = timelineClips.filter(
          c => c.trackType === clip.trackType && c.trackId === clip.trackId
        );
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
      toast.success(
        targets.length > 1
          ? `${targets.length} clips duplicated`
          : "Clip duplicated"
      );
    } catch (err) {
      toast.error(
        "Failed to duplicate: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    }
  };

  /** Splits the given clips at the playhead. */
  const handleSplitAtPlayhead = async (targets: TimelineClip[]) => {
    const splittable = targets
      .map(clip => ({ clip, offset: splitOffset(clip, currentTime) }))
      .filter(
        (c): c is { clip: TimelineClip; offset: number } => c.offset !== null
      );

    if (splittable.length === 0) {
      toast.error("Move the playhead inside a clip to split it");
      return;
    }
    recordHistory(
      splittable.length > 1 ? `Split ${splittable.length} clips` : "Split clip"
    );
    try {
      for (const { clip, offset } of splittable) {
        await splitClipMutation.mutateAsync({
          id: clip.id,
          splitAt: offset,
          projectId: projId,
        });
      }
      await refetchClips();
      toast.success(
        splittable.length > 1
          ? `${splittable.length} clips split`
          : "Clip split"
      );
    } catch (err) {
      toast.error(
        "Failed to split clip: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    }
  };

  const handleDeleteClips = async (clipIds: number[]) => {
    if (clipIds.length === 0) return;
    try {
      // A snapshot captures the whole row, so undo can re-create it verbatim.
      // The old inverse-based history only stored timelineStart and could never
      // bring a deleted clip back.
      recordHistory(
        clipIds.length > 1 ? `Delete ${clipIds.length} clips` : "Delete clip"
      );
      const ripplePatches = isRippleActive
        ? rippleDeletePatches(timelineClips, clipIds)
        : [];
      for (const id of clipIds) await deleteClipMutation.mutateAsync({ id });
      for (const patch of ripplePatches) {
        await updateClipMutation.mutateAsync(patch);
      }
      await refetchClips();
      setSelectedClipIds([]);
      toast.success(
        clipIds.length > 1 ? `${clipIds.length} clips deleted` : "Clip deleted"
      );
    } catch (err) {
      toast.error(
        "Failed to delete clip: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    }
  };

  const handleDeleteClip = (clipId: number) => handleDeleteClips([clipId]);

  const handleToggleMute = async (clip: TimelineClip) => {
    try {
      recordHistory(clip.muted ? "Unmute clip" : "Mute clip");
      await updateClipMutation.mutateAsync({ id: clip.id, muted: !clip.muted });
      await refetchClips();
    } catch (err) {
      toast.error(
        "Failed to update clip: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    }
  };

  const handleToggleVisibility = async (clip: TimelineClip) => {
    try {
      recordHistory(clip.visible ? "Hide clip" : "Show clip");
      await updateClipMutation.mutateAsync({
        id: clip.id,
        visible: !clip.visible,
      });
      await refetchClips();
    } catch (err) {
      toast.error(
        "Failed to update clip: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    }
  };

  const handleTrimClip = async (
    clip: TimelineClip,
    next: { sourceStart: number; duration: number; timelineStart: number }
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
        await updateClipMutation.mutateAsync({
          id: clip.id,
          timelineStart: next.timelineStart,
        });
      }
      if (isRippleActive) {
        const oldEnd = clip.timelineStart + clip.duration;
        const newEnd = next.timelineStart + next.duration;
        for (const patch of rippleTrimPatches(
          timelineClips,
          clip.id,
          oldEnd,
          newEnd
        )) {
          await updateClipMutation.mutateAsync(patch);
        }
      }
      await refetchClips();
      toast.success("Clip trimmed");
    } catch (err) {
      toast.error(
        "Failed to trim clip: " +
          (err instanceof Error ? err.message : "Unknown error")
      );
    }
  };

  /* Keyboard shortcuts */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
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
        void performUndo().then(label => {
          if (label) toast.info(`Undone: ${label}`);
        });
      } else if (
        (e.metaKey || e.ctrlKey) &&
        ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY")
      ) {
        e.preventDefault();
        void performRedo().then(label => {
          if (label) toast.info(`Redone: ${label}`);
        });
      } else if (e.code === "KeyS" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void handleSplitAtPlayhead(
          selectedClips.length ? selectedClips : activeClip ? [activeClip] : []
        );
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyD") {
        e.preventDefault();
        void handleDuplicateClips(selectedClips);
      } else if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        void handleDeleteClips(selectedClipIds);
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyA") {
        e.preventDefault();
        setSelectedClipIds(timelineClips.map(c => c.id));
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
          <h1 className="text-3xl font-bold text-white mb-4">
            Sign in to edit
          </h1>
          <Link href="/">
            <Button className="bg-brand-500 hover:bg-brand-600 text-white h-11">
              Go to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!Number.isInteger(projId) || projId <= 0 || projectQuery.isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-sm text-gray-300">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading project…
      </div>
    );
  }

  if (projectQuery.error || !project) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6 text-white">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          <h1 className="text-xl font-semibold">Project unavailable</h1>
          <p className="mt-2 text-sm text-gray-400">
            It may have been deleted, or you may not have access to it.
          </p>
          <Link href="/projects">
            <Button className="mt-5">Back to projects</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col overflow-y-auto bg-[#0a0a0f] font-sans text-white select-none lg:h-screen lg:overflow-hidden">
      {/* Top Header Bar */}
      <header className="z-30 flex h-16 min-h-16 flex-shrink-0 items-center justify-between gap-2 border-b border-white/[0.09] bg-[#0c0c0f] px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-1 sm:gap-4">
          <Link href="/projects">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 gap-2 px-1 text-gray-200 hover:bg-transparent hover:text-white sm:px-2"
              aria-label="Back to projects"
            >
              <ReelioLogo size={29} withWordmark={false} />
              <span className="hidden text-xl font-bold tracking-tight sm:inline">Reelio</span>
            </Button>
          </Link>
          <div className="hidden h-8 w-px bg-white/10 sm:block" />
          <div className="flex items-center gap-3">
            <span className="max-w-[120px] truncate text-sm font-semibold tracking-wide text-white sm:max-w-xs sm:text-base">
              {project.name}
            </span>
            <span className="hidden text-xs text-gray-500 sm:inline">
              {createClipMutation.isPending ||
              updateClipMutation.isPending ||
              trimClipMutation.isPending ||
              splitClipMutation.isPending ||
              deleteClipMutation.isPending
                ? "Saving…"
                : "Saved"}
            </span>
          </div>
        </div>

        <div className="relative flex items-center">
          <Button
            size="sm"
            onClick={() => setShowExportMenu(open => !open)}
            className="h-10 min-w-[116px] rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-5 text-sm font-bold uppercase tracking-wide text-white shadow-md shadow-sky-500/20 hover:from-sky-400 hover:to-blue-500"
            aria-haspopup="menu"
            aria-expanded={showExportMenu}
          >
            {exporting ? `${Math.round(exportProgress)}%` : "Export"}
            <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
          </Button>

          {showExportMenu ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setShowExportMenu(false)}
                aria-label="Close export menu"
              />
              <div
                role="menu"
                aria-label="Export formats"
                className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#17171f] p-2 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={exporting}
                  onClick={() => {
                    setShowExportMenu(false);
                    void handleExport();
                  }}
                  className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="block text-xs font-semibold text-white">
                    Browser WebM
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">
                    Renders locally with visible video, mixed audio, transforms,
                    effects, and burned-in captions. Maximum 2 hours / 500 MB.
                  </span>
                </button>

                {reelioMode === "cloud" ? (
                  <div className="mt-1 border-t border-white/[0.07] pt-1">
                    {latestServerExport?.status === "done" &&
                    latestServerExport.url ? (
                      <a
                        href={latestServerExport.url}
                        download
                        role="menuitem"
                        onClick={() => setShowExportMenu(false)}
                        className="block rounded-lg px-3 py-2.5 text-left hover:bg-white/5"
                      >
                        <span className="block text-xs font-semibold text-emerald-300">
                          Download server MP4
                        </span>
                        <span className="mt-0.5 block text-[10px] text-gray-500">
                          The latest 720p FFmpeg render completed successfully.
                        </span>
                      </a>
                    ) : latestServerExport?.status === "processing" ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowExportMenu(false);
                          void handleCancelServerExport();
                        }}
                        className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-white/5"
                      >
                        <span className="block text-xs font-semibold text-amber-300">
                          Server MP4 · {latestServerExport.progress}%
                        </span>
                        <span className="mt-0.5 block text-[10px] text-gray-500">
                          Rendering in the background. Select to request cancellation.
                        </span>
                      </button>
                    ) : latestServerExport?.status === "failed" ||
                      latestServerExport?.status === "cancelled" ? (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={retryExportMutation.isPending}
                        title={latestServerExport.errorMessage ?? undefined}
                        onClick={() => {
                          setShowExportMenu(false);
                          void handleRetryServerExport();
                        }}
                        className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-white/5 disabled:opacity-50"
                      >
                        <span className="block text-xs font-semibold text-rose-300">
                          Retry server MP4
                        </span>
                        <span className="mt-0.5 block text-[10px] text-gray-500">
                          Last render {latestServerExport.status}. Select to retry 720p MP4.
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={serverExportMutation.isPending}
                        onClick={() => {
                          setShowExportMenu(false);
                          void handleServerExport();
                        }}
                        className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-white/5 disabled:opacity-50"
                      >
                        <span className="block text-xs font-semibold text-white">
                          Server MP4 · 720p
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">
                          Uses FFmpeg in cloud mode and keeps rendering while you edit.
                        </span>
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 border-t border-white/[0.07] px-3 pt-2 text-[10px] leading-4 text-gray-600">
                    MP4 rendering is available after saving this local project to cloud mode.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {/* Main Workspace 3-Column Area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-visible lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,3fr)_minmax(0,2fr)] lg:overflow-hidden">
        {/* Left Column: Category Navigation + Media Library / Effects */}
        <div className="flex h-[420px] w-full min-w-0 max-w-none flex-shrink-0 flex-col border-b border-white/[0.07] bg-[#111116] lg:h-full lg:border-b-0 lg:border-r">
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
              {[
                "Cinematic LUT",
                "Vibrant HDR",
                "Film Grain",
                "Vignette Blur",
                "Glow Accent",
                "Sharpen",
              ].map((fx, i) => {
                const isActive = activeClip?.videoFx === fx;
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => handleApplyVideoFx(fx)}
                    className={`p-3 rounded-lg border cursor-pointer text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                      isActive
                        ? "bg-sky-500/20 border-sky-400 text-sky-200 shadow-md shadow-sky-500/20"
                        : "bg-[#181822] border-white/[0.08] hover:border-sky-400 text-gray-200"
                    }`}
                  >
                    <Sparkles
                      className={`w-5 h-5 mx-auto mb-1.5 ${isActive ? "text-sky-300" : "text-sky-400"}`}
                    />
                    <span className="text-xs font-medium">{fx}</span>
                    {isActive && (
                      <div className="text-[9px] text-sky-300 font-mono mt-0.5">
                        Applied
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : activeCategory === "transcript" ? (
            <div className="p-3 space-y-2 overflow-y-auto no-scrollbar text-xs">
              <div
                className="flex flex-wrap gap-2"
                aria-label="Media analysis controls"
              >
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleStartAnalysis("scene")}
                  disabled={
                    reelioMode !== "cloud" || startAnalysisMutation.isPending
                  }
                  className="h-7 text-[10px]"
                >
                  Detect scenes
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleStartAnalysis("transcription")}
                  disabled={
                    reelioMode !== "cloud" ||
                    startAnalysisMutation.isPending ||
                    !analysisCapabilitiesQuery.data?.transcription.available
                  }
                  title={
                    analysisCapabilitiesQuery.data?.transcription.available
                      ? "Generate timestamped transcript and editable captions"
                      : "Forge speech credentials are not configured"
                  }
                  className="h-7 text-[10px]"
                >
                  Transcribe media
                </Button>
                {latestAnalysis &&
                ["queued", "processing"].includes(latestAnalysis.status) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCancelAnalysis}
                    className="h-7 text-[10px] text-amber-200"
                  >
                    Cancel {latestAnalysis.progress}%
                  </Button>
                ) : null}
              </div>
              <div className="text-[11px] text-gray-400" role="status">
                Scene detection is measured locally with FFmpeg. Timestamped
                transcription is{" "}
                {analysisCapabilitiesQuery.data?.transcription.available
                  ? "configured but not yet verified in this environment"
                  : "unavailable until Forge speech credentials are configured"}
                .
              </div>
              {latestAnalysis?.status === "failed" &&
              latestAnalysis.errorMessage ? (
                <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-200">
                  {latestAnalysis.errorMessage}
                </div>
              ) : null}
              {sceneBoundaries.length > 0 ? (
                <div className="rounded border border-white/[0.08] p-2">
                  <div className="mb-1 font-medium text-gray-300">
                    Measured scene boundaries
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {sceneBoundaries.map((boundary, index) => (
                      <button
                        type="button"
                        key={`${boundary.time}-${index}`}
                        onClick={() => seekTimeline(boundary.time)}
                        className="rounded bg-sky-500/10 px-2 py-1 font-mono text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                        aria-label={`Seek to scene boundary at ${formatTime(boundary.time)}, confidence ${boundary.confidence.toFixed(2)}`}
                      >
                        {formatTime(boundary.time)} ·{" "}
                        {boundary.confidence.toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {transcriptionEvidence ? (
                <div className="rounded border border-white/[0.08] p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-gray-300">
                        Timestamped filler evidence
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Provider: {transcriptionEvidence.provider}
                      </div>
                    </div>
                    {transcriptionEvidence.fillers.length > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleProposeFillerRemoval(
                            transcriptionEvidence.fillers.map(
                              (_, index) => index
                            )
                          )
                        }
                        disabled={
                          proposeFillerRemovalMutation.isPending ||
                          !!pendingPlan
                        }
                        className="h-7 text-[10px]"
                      >
                        Review all removals
                      </Button>
                    ) : null}
                  </div>
                  {transcriptionEvidence.text ? (
                    <p className="max-h-20 overflow-y-auto text-[11px] text-gray-400">
                      {transcriptionEvidence.text}
                    </p>
                  ) : null}
                  {transcriptionEvidence.fillers.length > 0 ? (
                    <ul
                      className="space-y-1"
                      aria-label="Detected filler words"
                    >
                      {transcriptionEvidence.fillers.map((filler, index) => (
                        <li
                          key={`${filler.start}-${filler.end}-${index}`}
                          className="flex items-center gap-2 rounded bg-amber-500/[0.06] px-2 py-1"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              seekToTranscriptTime(
                                transcriptionEvidence.assetId,
                                filler.start
                              )
                            }
                            className="font-mono text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                            aria-label={`Seek to filler ${filler.text} at ${formatTime(filler.start)}`}
                          >
                            “{filler.text}” {formatTime(filler.start)}–
                            {formatTime(filler.end)}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleProposeFillerRemoval([index])}
                            disabled={
                              proposeFillerRemovalMutation.isPending ||
                              !!pendingPlan
                            }
                            className="ml-auto text-[10px] text-sky-300 disabled:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                            aria-label={`Review removal of filler ${filler.text}`}
                          >
                            Review removal
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[11px] text-gray-500">
                      No filler words were detected in this transcript.
                    </div>
                  )}
                </div>
              ) : null}
              <div className="text-[11px] text-gray-400 mb-1">
                Captions are editable; activate a timestamp to seek.
              </div>
              {captions.length > 0 ? (
                captions.map((cue, idx) => (
                  <div
                    key={cue.id ?? idx}
                    className="p-2 rounded bg-[#181822] border border-white/[0.06] focus-within:border-sky-400 flex items-start gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => seekTimeline(cue.startTime)}
                      className="text-[10px] font-mono text-sky-400 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      aria-label={`Seek to caption at ${formatTime(cue.startTime)}`}
                    >
                      {formatTime(cue.startTime)}
                    </button>
                    <input
                      value={cue.text}
                      onChange={event =>
                        setCaptions(current =>
                          current.map((candidate, cueIndex) =>
                            cueIndex === idx
                              ? { ...candidate, text: event.target.value }
                              : candidate
                          )
                        )
                      }
                      onBlur={() => void persistCaption(cue)}
                      aria-label={`Edit caption ${idx + 1}`}
                      className="min-w-0 flex-1 bg-transparent text-gray-200 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void removeCaption(cue, idx)}
                      aria-label={`Delete caption ${idx + 1}`}
                      className="text-gray-500 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-gray-500">
                  <FileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  No transcript is available. Connect a speech-to-text provider
                  before generating captions.
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 space-y-3 overflow-y-auto no-scrollbar text-xs">
              <div className="font-semibold text-gray-300">Clip Inspector</div>
              {activeClip ? (
                <div className="space-y-3">
                  <div className="p-2.5 rounded bg-[#181822] border border-white/[0.08]">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                      Clip Name
                    </div>
                    <div
                      className="truncate text-xs font-medium text-sky-300"
                      title={activeClip.assetName}
                    >
                      {activeClip.assetName}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded bg-[#181822] border border-white/[0.08]">
                      <div className="text-[10px] text-gray-400 mb-0.5">
                        Timeline Start
                      </div>
                      <div className="font-mono text-xs text-gray-200">
                        {activeClip.timelineStart.toFixed(2)}s
                      </div>
                    </div>
                    <div className="p-2 rounded bg-[#181822] border border-white/[0.08]">
                      <div className="text-[10px] text-gray-400 mb-0.5">
                        Duration
                      </div>
                      <div className="font-mono text-xs text-gray-200">
                        {activeClip.duration.toFixed(2)}s
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-[#181822] border border-white/[0.08] space-y-2">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                      Clip Controls
                    </div>
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
                    <label className="block text-gray-300">
                      Clip volume ({(activeClip.volume ?? 1).toFixed(2)})
                      <input
                        key={`clip-volume-${activeClip.id}-${activeClip.volume}`}
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        defaultValue={activeClip.volume ?? 1}
                        onBlur={event =>
                          void updateActiveClipRenderSetting({
                            volume: Number(event.currentTarget.value),
                          })
                        }
                        className="mt-1 w-full accent-sky-500"
                      />
                    </label>
                    <label className="block text-gray-300">
                      Track volume ({(activeClip.trackVolume ?? 1).toFixed(2)})
                      <input
                        key={`track-volume-${activeClip.id}-${activeClip.trackVolume}`}
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        defaultValue={activeClip.trackVolume ?? 1}
                        onBlur={event =>
                          void updateActiveTrackVolume(
                            Number(event.currentTarget.value)
                          )
                        }
                        className="mt-1 w-full accent-sky-500"
                      />
                    </label>
                    {activeClip.trackType === "video" ? (
                      <div className="space-y-2 border-t border-white/[0.08] pt-2">
                        <label className="block text-gray-300">
                          Scale ({(activeClip.scale ?? 1).toFixed(2)}×)
                          <input
                            key={`clip-scale-${activeClip.id}-${activeClip.scale}`}
                            type="range"
                            min="0.1"
                            max="2"
                            step="0.05"
                            defaultValue={activeClip.scale ?? 1}
                            onBlur={event =>
                              void updateActiveClipRenderSetting({
                                scale: Number(event.currentTarget.value),
                              })
                            }
                            className="mt-1 w-full accent-sky-500"
                          />
                        </label>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void updateActiveClipRenderSetting({
                                scale: 0.35,
                                positionX: 0.6,
                                positionY: -0.6,
                                zIndex: 2,
                              })
                            }
                            className="h-7 flex-1 text-[10px]"
                          >
                            Picture in picture
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void updateActiveClipRenderSetting({
                                scale: 1,
                                positionX: 0,
                                positionY: 0,
                                zIndex: 0,
                              })
                            }
                            className="h-7 text-[10px]"
                          >
                            Reset
                          </Button>
                        </div>
                      </div>
                    ) : null}
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
                <div className="text-gray-500 text-center py-6">
                  Select a clip on the timeline to inspect and edit properties
                </div>
              )}
            </div>
          )}
        </div>

        {/* Center Column: Video Preview Viewport & Floating Player Bar */}
        <div className="relative flex min-h-[420px] min-w-0 flex-col items-center justify-between overflow-hidden bg-black p-2 sm:p-3 lg:min-h-0">
          {selectedClips[0] ? (
            <ClipInspectorPanel
              clip={selectedClips[0]}
              onClose={() => setSelectedClipIds([])}
              onToggleMute={() => void handleToggleMute(selectedClips[0])}
              onToggleVisibility={() =>
                void handleToggleVisibility(selectedClips[0])
              }
              onDelete={() => void handleDeleteClip(selectedClips[0].id)}
              onUpdate={patch =>
                void updateActiveClipRenderSetting(patch)
              }
              onUpdateTrackVolume={volume =>
                void updateActiveTrackVolume(volume)
              }
              onApplyVideoFx={effect => void handleApplyVideoFx(effect)}
            />
          ) : null}

          {/* Video Preview Canvas Viewport */}
          <div className="w-full flex-1 flex items-center justify-center relative overflow-hidden rounded-lg bg-[#050508] border border-white/[0.05]">
            {playbackClip?.assetUrl &&
            playbackClip.trackType === "video" &&
            trackStates.video0?.visible !== false ? (
              playbackClip.assetMimeType.startsWith("image/") ? (
                <img
                  src={playbackClip.assetUrl}
                  alt={playbackClip.assetName}
                  style={previewMediaStyle}
                  className="max-h-full max-w-full object-contain transition-all"
                  decoding="async"
                />
              ) : (
                <video
                  ref={previewVideoRef}
                  src={playbackClip.assetUrl}
                  muted={
                    playbackClip.muted ||
                    isMuted ||
                    trackStates.video0?.muted === true ||
                    !(assets ?? []).find(
                      asset => asset.id === playbackClip.assetId
                    )?.hasAudio
                  }
                  playsInline
                  style={previewMediaStyle}
                  className="max-h-full max-w-full object-contain transition-all"
                  onLoadedMetadata={handlePreviewLoadedMetadata}
                />
              )
            ) : (
              <div className="text-center p-6">
                <FileVideo className="w-16 h-16 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 font-medium text-sm">
                  {contentDuration > 0
                    ? "No visible video at this playhead"
                    : "Upload media to preview"}
                </p>
                <p className="text-gray-600 text-xs mt-1">
                  {contentDuration > 0
                    ? "Playback continues across timeline gaps and audio clips."
                    : "Imported media is added to the timeline automatically."}
                </p>
              </div>
            )}

            {/* Audio elements for multi-track audio playback */}
            {timelineClips
              .filter(
                clip =>
                  clip.trackType === "audio" &&
                  clip.assetUrl &&
                  clip.visible !== false
              )
              .map(clip => (
                <audio
                  key={clip.id}
                  ref={node => {
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
              onZoomIn={() => setZoomLevel(Math.min(240, zoomLevel + 10))}
              onZoomOut={() => setZoomLevel(Math.max(4, zoomLevel - 10))}
            />
          </div>
        </div>

        {/* Right Column: AI Agent Panel */}
        <AIAgentPanel
          userEmail={user.email || user.name || "Local workspace"}
          aiAvailable={aiHealth?.available ?? false}
          assetCount={(assets ?? []).length}
          timelineDuration={timelineContentEnd(timelineClips)}
          onExecuteQuickAction={handleExecuteQuickAction}
          onSendMessage={handleAISendMessage}
          onNewChat={handleNewAIChat}
          aiLoading={aiLoading}
          aiPhase={aiPhase}
          pendingPlan={pendingPlan}
          proposalProvenance={pendingProvenance}
          selectedOpIndices={selectedOpIndices}
          onToggleOpSelection={toggleOpSelection}
          onPreviewOperation={index => {
            const operation = pendingPlan?.operations[index];
            if (!operation) return;
            const range = getAffectedRanges(operation, timelineClips)[0];
            if (range) seekTimeline(range.start);
          }}
          onApplyPlan={handleApplyPlan}
          onRejectPlan={handleRejectPlan}
          onCancel={handleAICancel}
          onRetry={handleAIRetry}
          canRetry={Boolean(lastAIInstruction)}
          aiMessages={aiMessages}
        />
      </div>

      {/* Mid Toolbar (Between Preview & Timeline) */}
      <TimelineToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => {
          void performUndo().then(label => {
            if (label) toast.info(`Undone: ${label}`);
          });
        }}
        onRedo={() => {
          void performRedo().then(label => {
            if (label) toast.info(`Redone: ${label}`);
          });
        }}
        canSplit={canSplit}
        onSplit={() =>
          handleSplitAtPlayhead(
            selectedClips.length
              ? selectedClips
              : activeClip
                ? [activeClip]
                : []
          )
        }
        canDelete={selectedClipIds.length > 0}
        onDelete={() => handleDeleteClips(selectedClipIds)}
        canDuplicate={selectedClips.length > 0}
        onDuplicate={() => void handleDuplicateClips(selectedClips)}
        snapping={snapping}
        onToggleSnapping={() => setSnapping(!snapping)}
        currentTime={currentTime}
        zoomLevel={zoomLevel}
        onZoomIn={() => setZoomLevel(Math.min(240, zoomLevel + 10))}
        onZoomOut={() => setZoomLevel(Math.max(4, zoomLevel - 10))}
        onZoomFit={() => {
          const availableWidth = Math.max(320, window.innerWidth - 224);
          const fittedZoom = availableWidth / Math.max(10, contentDuration);
          setZoomLevel(Math.max(4, Math.min(240, fittedZoom)));
        }}
        isRippleActive={isRippleActive}
        onToggleRipple={() => setIsRippleActive(!isRippleActive)}
      />

      {/* Bottom Multi-Track Timeline (Captions, Video 1, Audio 1, Audio 2) */}
      <div className="flex h-[268px] min-h-[268px] flex-shrink-0 flex-col bg-[#0c0c14]">
        <MultiTrackTimeline
          clips={timelineClips}
          captions={captions}
          currentTime={currentTime}
          totalDuration={totalDuration}
          zoomLevel={zoomLevel}
          selectedClipIds={selectedClipIds}
          onSelectClip={(id, multi) => {
            setSelectedClipIds(prev =>
              multi
                ? prev.includes(id)
                  ? prev.filter(x => x !== id)
                  : [...prev, id]
                : [id]
            );
          }}
          onSeek={time => {
            seekTimeline(time);
            if (previewVideoRef.current) {
              const active = timelineClips.find(
                c =>
                  c.timelineStart <= time && c.timelineStart + c.duration > time
              );
              if (active) {
                previewVideoRef.current.currentTime =
                  active.sourceStart + (time - active.timelineStart);
              }
            }
          }}
          onClipDragStart={beginClipDrag}
          onClipTrimStart={beginTrimDrag}
          onClipDoubleClick={clip => handleSplitAtPlayhead([clip])}
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
          getWaveformStatus={assetId =>
            waveformLoading[assetId]
              ? "loading"
              : waveformErrors[assetId]
                ? "error"
                : "ready"
          }
        />
      </div>

      {/* Right-click actions for the clip under the cursor. */}
      {clipMenu && (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onMouseDown={() => setClipMenu(null)}
          />
          <div
            data-testid="clip-context-menu"
            className="fixed z-[100] min-w-[176px] rounded-lg border border-white/10 bg-[#141420] py-1 shadow-xl text-xs"
            style={{ left: clipMenu.x, top: clipMenu.y }}
          >
            {(() => {
              const clip = timelineClips.find(c => c.id === clipMenu.clipId);
              if (!clip) return null;
              const targets = selectedClipIds.includes(clip.id)
                ? selectedClips
                : [clip];
              const splittable = splitOffset(clip, currentTime) !== null;
              const item =
                "w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-2 disabled:text-gray-600 disabled:hover:bg-transparent";
              return (
                <>
                  <button
                    data-testid="menu-split"
                    className={item}
                    disabled={!splittable}
                    title={
                      splittable
                        ? ""
                        : "Move the playhead inside this clip first"
                    }
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
                    {clip.muted ? (
                      <VolumeX className="w-3 h-3" />
                    ) : (
                      <Volume2 className="w-3 h-3" />
                    )}
                    {clip.muted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    className={item}
                    onClick={() => {
                      setClipMenu(null);
                      void handleToggleVisibility(clip);
                    }}
                  >
                    {clip.visible ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    {clip.visible ? "Hide" : "Show"}
                  </button>
                  <div className="my-1 h-px bg-white/10" />
                  <button
                    data-testid="menu-delete"
                    className={`${item} hover:text-red-400`}
                    onClick={() => {
                      setClipMenu(null);
                      void handleDeleteClips(targets.map(c => c.id));
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
