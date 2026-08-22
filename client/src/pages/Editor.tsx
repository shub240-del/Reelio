import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileVideo,
  FileAudio,
  FileImage,
  Loader2,
  Pause,
  Play,
  Copy,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
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
import { AlertTriangle } from "lucide-react";

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
  const selectedClips = timelineClips.filter((c) => selectedClipIds.includes(c.id));
  const assetDurationOf = (assetId: number) =>
    (assets ?? []).find((a) => a.id === assetId)?.duration ?? 0;

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
  const activeClip = getActiveClip(timelineClips, currentTime);
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
        let metadata = { duration: 0, width: 0, height: 0, fps: 0, hasAudio: false };
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
    <div className="h-screen bg-[#0a0a0f] flex flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 bg-[#0c0c14] border-b border-white/[0.06] flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white gap-2 h-8 px-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </Link>
          <span className="text-white/80 font-medium text-sm">{project?.name || "Project"}</span>
          <span className="text-brand-500 text-xs font-medium px-2 py-0.5 bg-brand-500/10 rounded-full">
            {project?.status || "draft"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                void performUndo().then((label) => {
                  if (label) toast.info(`Undone: ${label}`);
                });
              }}
              disabled={!canUndo}
              className={`px-2 py-1 rounded text-xs border ${
                canUndo ? "border-white/10 text-gray-300 hover:text-white hover:border-white/20" : "border-white/5 text-gray-600 cursor-not-allowed"
              }`}
              title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
            >
              ↩ Undo
            </button>
            <button
              onClick={() => {
                void performRedo().then((label) => {
                  if (label) toast.info(`Redone: ${label}`);
                });
              }}
              disabled={!canRedo}
              className={`px-2 py-1 rounded text-xs border ${
                canRedo ? "border-white/10 text-gray-300 hover:text-white hover:border-white/20" : "border-white/5 text-gray-600 cursor-not-allowed"
              }`}
              title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : "Redo (Ctrl+Shift+Z)"}
            >
              ↪ Redo
            </button>
          </div>

          {/*
            Split and duplicate previously had no UI at all: split was hidden on
            double-click and trim on right-click, both undiscoverable. They are
            now first-class toolbar actions that report why they are unavailable.
          */}
          <div className="flex items-center gap-1">
            <button
              data-testid="split-clip"
              onClick={() =>
                handleSplitAtPlayhead(selectedClips.length ? selectedClips : activeClip ? [activeClip] : [])
              }
              disabled={!canSplit}
              className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
                canSplit
                  ? "border-white/10 text-gray-300 hover:text-white hover:border-white/20"
                  : "border-white/5 text-gray-600 cursor-not-allowed"
              }`}
              title={
                canSplit
                  ? "Split at playhead (S)"
                  : "Move the playhead inside a clip to split it"
              }
            >
              <Scissors className="w-3 h-3" /> Split
            </button>
            <button
              data-testid="duplicate-clip"
              onClick={() => handleDuplicateClips(selectedClips)}
              disabled={selectedClips.length === 0}
              className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
                selectedClips.length
                  ? "border-white/10 text-gray-300 hover:text-white hover:border-white/20"
                  : "border-white/5 text-gray-600 cursor-not-allowed"
              }`}
              title={selectedClips.length ? "Duplicate (Ctrl+D)" : "Select a clip to duplicate"}
            >
              <Copy className="w-3 h-3" /> Duplicate
            </button>
            <button
              data-testid="delete-clip"
              onClick={() => handleDeleteClips(selectedClipIds)}
              disabled={selectedClipIds.length === 0}
              className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
                selectedClipIds.length
                  ? "border-white/10 text-gray-300 hover:text-red-400 hover:border-red-400/30"
                  : "border-white/5 text-gray-600 cursor-not-allowed"
              }`}
              title={selectedClipIds.length ? "Delete (Del)" : "Select a clip to delete"}
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
          <select
            value={playbackSpeed}
            onChange={(e) => handlePlaybackSpeedChange(parseFloat(e.target.value))}
            className="bg-[#141420] text-gray-300 text-xs border border-white/10 rounded px-2 py-1 h-7"
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
          <Button size="sm" className="bg-brand-500 hover:bg-brand-600 text-white h-8 text-xs">
            Export
          </Button>
        </div>
      </header>

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Assets */}
        <div
          className="w-64 bg-[#0c0c14] border-r border-white/[0.06] flex flex-col flex-shrink-0"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="h-10 flex items-center justify-between px-3 border-b border-white/[0.04]">
            <button
              onClick={() => setShowAssets(!showAssets)}
              className="flex items-center gap-2 text-xs font-medium text-gray-300"
            >
              {showAssets ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Assets
            </button>
          </div>

          {showAssets && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={`w-full h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 transition-colors ${
                  isDragOver
                    ? "border-brand-500/50 bg-brand-500/5 text-brand-400"
                    : "border-white/10 text-gray-500 hover:border-brand-500/30 hover:text-brand-400"
                }`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
                    <span className="text-xs">Uploading {uploadProgress.toFixed(0)}%</span>
                    <div className="w-20 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    <span className="text-xs">Drop media or choose a file</span>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,audio/*,image/*,.mkv,.mov,.mp4,.webm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />

              {(assets ?? []).map((asset) => {
                const isImage = asset.mimeType.startsWith("image/");
                const isAudio = asset.mimeType.startsWith("audio/");
                return (
                  <div key={asset.id} className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.04] hover:border-white/10 transition-colors group">
                    <div className="flex items-center gap-2 mb-1">
                      {isImage ? <FileImage className="w-4 h-4 text-brand-500 flex-shrink-0" /> : isAudio ? <FileAudio className="w-4 h-4 text-brand-500 flex-shrink-0" /> : <FileVideo className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                      <span className="text-xs text-white truncate" title={asset.name}>{asset.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500">
                      <span>{asset.duration > 0 ? formatTime(asset.duration) : "Still"}</span>
                      <span>{asset.width > 0 && asset.height > 0 ? `${asset.width}x${asset.height}` : "Audio"}</span>
                      <span>{formatFileSize(asset.sizeBytes)}</span>
                    </div>
                    {asset.url ? (isImage ? <img src={asset.url} alt={asset.name} className="w-full mt-2 rounded max-h-20 object-cover" /> : isAudio ? <audio src={asset.url} controls className="w-full mt-2 h-8" /> : <video src={asset.url} className="w-full mt-2 rounded max-h-20 object-cover" muted poster={`${asset.url}#t=1`} preload="metadata" controls />) : <div className="mt-2 h-12 rounded bg-white/5 animate-pulse" aria-label="Loading preview" />}
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" onClick={() => handleAddAssetToTimeline(asset)} disabled={asset.duration <= 0 || createClipMutation.isPending} className="h-7 flex-1 bg-brand-500/15 hover:bg-brand-500/25 text-brand-300 text-[10px]">Add to timeline</Button>
                      <Button size="sm" variant="outline" onClick={() => handleRemoveAsset(asset)} disabled={deleteAssetMutation.isPending} className="h-7 border-white/10 text-gray-400 hover:text-red-300 text-[10px]" aria-label={`Remove ${asset.name}`}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Center - Preview */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Video Preview - Assembled timeline playback */}
          <div className="flex-1 flex items-center justify-center bg-black relative">
            {activeClip?.assetUrl ? (
              <video
                ref={previewVideoRef}
                src={activeClip.assetUrl}
                muted={!((assets ?? []).find((asset) => asset.id === activeClip.assetId)?.hasAudio)}
                playsInline
                className="max-w-full max-h-full object-contain"
                onTimeUpdate={handlePreviewTimeUpdate}
                onLoadedMetadata={handlePreviewLoadedMetadata}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  // Move to the next clip in timeline order, skipping any gap.
                  // Looking up the next start rather than querying the exact boundary
                  // prevents a gap from being mistaken for end-of-timeline.
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
                      nextVideo.addEventListener(
                        "loadedmetadata",
                        () => void nextVideo.play().catch(() => setIsPlaying(false)),
                        { once: true }
                      );
                      nextVideo.load();
                    }
                  } else {
                    // End of timeline
                    setCurrentTime(totalDuration);
                  }
                }}

              />
            ) : (
              <div className="text-center">
                <FileVideo className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-500">Upload a video to get started</p>
                <p className="text-gray-600 text-sm mt-1">Supports MP4, MOV, WebM</p>
              </div>
            )}

            {/* Playback Controls Overlay */}
            {activeClip && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleGoToStart}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                    title="Go to start (Home)"
                  >
                    <SkipBack className="w-3.5 h-3.5 text-white" />
                  </button>
                  <button
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4 text-white" />
                    ) : (
                      <Play className="w-4 h-4 text-white ml-0.5" />
                    )}
                  </button>
                  <button
                    onClick={handleSkipForward}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                    title="Skip forward 5s (Right arrow)"
                  >
                    <SkipForward className="w-3.5 h-3.5 text-white" />
                  </button>
                  <span className="text-xs text-white/80 font-mono">
                    {formatTime(currentTime)} / {formatTime(totalDuration)}
                  </span>
                  <span className="text-[10px] text-brand-400 px-2 py-0.5 bg-brand-500/10 rounded-full">
                    {playbackSpeed}x
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="h-64 bg-[#0c0c14] border-t border-white/[0.06] flex flex-col flex-shrink-0">
        {/* Timeline Header */}
        <div className="h-8 flex items-center justify-between px-3 border-b border-white/[0.04]">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 font-medium">Timeline</span>
            <span className="text-[10px] text-gray-500">{formatTime(totalDuration)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoomLevel(Math.max(20, zoomLevel - 10))}
              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(Math.min(200, zoomLevel + 10))}
              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Time Ruler */}
        <div
          className="h-6 bg-[#0a0a12] border-b border-white/[0.04] relative cursor-pointer"
          onClick={handleTimelineClick}
        >
          {/* Playhead indicator */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-brand-500 z-20"
            style={{ left: `${currentTime * zoomLevel}px` }}
          />
          {/* Time markers */}
          {Array.from(
            { length: Math.ceil(totalDuration / 5) + 1 },
            (_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-white/[0.06]"
                style={{ left: `${i * 5 * zoomLevel}px` }}
              >
                <span className="text-[9px] text-gray-500 ml-1">{formatTime(i * 5)}</span>
              </div>
            )
          )}
        </div>

        {/* Tracks */}
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <div
            className="min-w-full relative"
            style={{ width: `${Math.max(totalDuration * zoomLevel, 800)}px` }}
          >
            {/* Playhead line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-brand-500 z-20 pointer-events-none"
              style={{ left: `${currentTime * zoomLevel}px` }}
            />

            {/* Video Track */}
            <div className="h-16 border-b border-white/[0.04] relative flex items-center px-2">
              <span className="text-[10px] text-gray-500 w-12 flex-shrink-0 absolute left-0 z-10 bg-[#0c0c14]">
                Video
              </span>
              <div className="pl-14 w-full">
                {timelineClips
                  .filter((c) => c.trackType === "video")
                  .map((clip) => (
                    <div
                      key={clip.id}
                      data-testid={`clip-${clip.id}`}
                      data-selected={selectedClipIds.includes(clip.id)}
                      // Timeline state is mirrored onto the element so an
                      // observer can assert the model (start/duration in
                      // seconds) instead of inferring it from pixel offsets,
                      // which silently change with zoom.
                      data-clip-id={clip.id}
                      data-clip-start={clip.timelineStart}
                      data-clip-duration={clip.duration}
                      data-clip-source-start={clip.sourceStart}
                      className="absolute h-12 rounded-md overflow-hidden cursor-grab active:cursor-grabbing group transition-opacity"
                      style={{
                        // While dragging or trimming, follow the live preview so
                        // the clip tracks the cursor instead of jumping on release.
                        left: `${
                          (trimPreview?.id === clip.id
                            ? trimPreview.start
                            : dragPreview?.id === clip.id
                            ? dragPreview.start
                            : clip.timelineStart) * zoomLevel
                        }px`,
                        width: `${
                          (trimPreview?.id === clip.id ? trimPreview.duration : clip.duration) *
                          zoomLevel
                        }px`,
                        opacity: clip.visible ? 1 : 0.3,
                        zIndex: draggingClip === clip.id ? 50 : 10,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        // Selecting must never mutate the timeline, so selection
                        // happens on mousedown and movement is what starts a drag.
                        setSelectedClipIds((current) =>
                          nextSelection(current, clip.id, {
                            ctrl: e.ctrlKey,
                            meta: e.metaKey,
                            shift: e.shiftKey,
                          }),
                        );
                        beginClipDrag(clip, e);
                      }}
                      onDoubleClick={() => handleSplitAtPlayhead([clip])}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Right-click used to destructively trim with no warning
                        // and no way back. It now opens a menu of real actions.
                        if (!selectedClipIds.includes(clip.id)) setSelectedClipIds([clip.id]);
                        setClipMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
                      }}
                    >
                      {/* Trim handles: the only discoverable way to trim. */}
                      <div
                        data-testid={`trim-start-${clip.id}`}
                        onMouseDown={(e) => beginTrimDrag(clip, "start", e)}
                        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize z-20 bg-brand-400/0 hover:bg-brand-400/60"
                        title="Drag to trim the start"
                      />
                      <div
                        data-testid={`trim-end-${clip.id}`}
                        onMouseDown={(e) => beginTrimDrag(clip, "end", e)}
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize z-20 bg-brand-400/0 hover:bg-brand-400/60"
                        title="Drag to trim the end"
                      />
                      <div
                        className={`w-full h-full rounded-md border transition-all ${
                          selectedClipIds.includes(clip.id)
                            ? "bg-brand-500/25 border-brand-400 ring-1 ring-brand-400 shadow-[0_0_12px_rgba(124,92,255,0.25)]"
                            : activeClip?.id === clip.id
                            ? "bg-brand-500/20 border-brand-500/40"
                            : clip.locked
                            ? "bg-blue-500/10 border-blue-500/30"
                            : "bg-brand-500/10 border-brand-500/20 hover:border-brand-500/40"
                        }`}
                      >
                        <div className="p-1.5 flex items-center justify-between">
                          <span className="text-[10px] text-white/80 truncate">
                            {clip.assetName}
                          </span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleMute(clip);
                              }}
                              className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white"
                            >
                              {clip.muted ? (
                                <VolumeX className="w-3 h-3" />
                              ) : (
                                <Volume2 className="w-3 h-3" />
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleVisibility(clip);
                              }}
                              className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white"
                            >
                              {clip.visible ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronUp className="w-3 h-3" />
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClip(clip.id);
                              }}
                              className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-red-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {/* Waveform */}
                        <div className="mx-1.5 mb-1.5 h-4 flex items-end gap-px">
                          {isGenerating(clip.assetId) ? (
                            <div className="flex-1 h-2 bg-brand-500/20 animate-pulse rounded" />
                          ) : getWaveform(clip.assetId).length > 0 ? (
                            getWaveform(clip.assetId).map((val, i) => (
                              <div
                                key={i}
                                className="flex-1 bg-brand-400/30 rounded-sm"
                                style={{ height: `${(val || 0.2) * 100}%` }}
                              />
                            ))
                          ) : (
                            <div className="flex items-center gap-1 h-full text-[9px] text-gray-600">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              <span>No audio track</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Audio Track */}
            <div className="h-16 border-b border-white/[0.04] relative flex items-center px-2">
              <span className="text-[10px] text-gray-500 w-12 flex-shrink-0 absolute left-0 z-10 bg-[#0c0c14]">
                Audio
              </span>
              <div className="pl-14 w-full">
                {timelineClips
                  .filter((c) => c.trackType === "audio")
                  .map((clip) => (
                    <div
                      key={clip.id}
                      className="absolute h-12 rounded-md overflow-hidden cursor-pointer group transition-opacity"
                      style={{
                        left: `${clip.timelineStart * zoomLevel}px`,
                        width: `${clip.duration * zoomLevel}px`,
                        opacity: clip.muted ? 0.3 : 1,
                      }}
                    >
                      <div className="w-full h-full rounded-md border bg-green-500/10 border-green-500/20 hover:border-green-500/40 transition-all">
                        <div className="p-1.5 flex items-center justify-between">
                          <span className="text-[10px] text-white/80 truncate">
                            {clip.assetName}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClip(clip.id);
                            }}
                            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="mx-1.5 mb-1.5 h-4 flex items-end gap-px">
                          {Array.from(
                            {
                              length: Math.min(
                                Math.floor((clip.duration * zoomLevel) / 3),
                                80
                              ),
                            },
                            (_, i) => (
                              <div
                                key={i}
                                className="flex-1 bg-green-400/30 rounded-sm"
                                style={{
                                  height: `${15 + Math.random() * 85}%`,
                                }}
                              />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right-click actions for the clip under the cursor. */}
      {clipMenu && (
        <>
          <div className="fixed inset-0 z-[90]" onMouseDown={() => setClipMenu(null)} />
          <div
            data-testid="clip-context-menu"
            className="fixed z-[100] min-w-[176px] rounded-lg border border-white/10 bg-[#141420] py-1 shadow-xl"
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
