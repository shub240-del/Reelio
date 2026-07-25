import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileVideo,
  Loader2,
  Pause,
  Play,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { toast } from "sonner";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useWaveform } from "@/hooks/useWaveform";

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
function computeTotalDuration(clips: TimelineClip[]): number {
  if (clips.length === 0) return 60;
  return Math.max(
    ...clips.map((c) => c.timelineStart + c.duration),
    60
  );
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
  const createClipMutation = trpc.clip.create.useMutation();
  const updateClipMutation = trpc.clip.update.useMutation();
  const deleteClipMutation = trpc.clip.delete.useMutation();
  const trimClipMutation = trpc.clip.trim.useMutation();
  const splitClipMutation = trpc.clip.split.useMutation();

  /* Undo/Redo */
  const { push: pushUndo, undo: performUndo, redo: performRedo, canUndo, canRedo, clear: clearUndoHistory } = useUndoRedo(50);
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

  const totalDuration = computeTotalDuration(timelineClips);

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

  /* Upload handler */
  const handleFileUpload = useCallback(
    async (file: File) => {
      const validTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
      const isVideo = file.type.startsWith("video/") || validTypes.includes(file.type);
      if (!isVideo) {
        toast.error("Please select a video file (MP4, MOV, or WebM)");
        return;
      }

      setUploading(true);
      setUploadProgress(0);

      let progressInterval: ReturnType<typeof setInterval> | undefined;

      try {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64 = btoa(
          Array.from(uint8Array)
            .map((b) => String.fromCharCode(b))
            .join("")
        );

        progressInterval = setInterval(() => {
          setUploadProgress((p) => Math.min(p + Math.random() * 15, 90));
        }, 200);

        await uploadMutation.mutateAsync({
          projectId: projId,
          base64Data: base64,
          fileName: file.name,
          mimeType: file.type || "video/mp4",
          sizeBytes: file.size,
        });

        clearInterval(progressInterval);
        setUploadProgress(100);

        // Auto-add clip to timeline
        const newAssets = await refetchAssets();
        const newAsset = newAssets.data?.[newAssets.data.length - 1];
        if (newAsset) {
          await createClipMutation.mutateAsync({
            projectId: projId,
            assetId: newAsset.id,
            sourceStart: 0,
            duration: newAsset.duration || 30,
            timelineStart: totalDuration,
            sortIndex: timelineClips.length,
          });
          await refetchClips();
          toast.success(`Added "${file.name}" to timeline`);
        }

        setTimeout(() => {
          setUploading(false);
          setUploadProgress(0);
        }, 500);
      } catch (err) {
        if (progressInterval) clearInterval(progressInterval);
        setUploading(false);
        setUploadProgress(0);
        toast.error("Upload failed: " + (err instanceof Error ? err.message : "Unknown error"));
      }
    },
    [projId, totalDuration, timelineClips.length]
  );

  /* Video preview sync - when active clip changes, switch the video source */
  useEffect(() => {
    if (activeClip && previewVideoRef.current) {
      const video = previewVideoRef.current;
      const sourceTime = currentTime - activeClip.timelineStart + activeClip.sourceStart;
      if (Math.abs(video.currentTime - sourceTime) > 0.5) {
        video.currentTime = sourceTime;
      }
    }
  }, [activeClip?.id, currentTime]);

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
      currentTime - activeClip.timelineStart + activeClip.sourceStart;
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
  const handleClipDragEnd = async (clip: TimelineClip, newTimelineStart: number) => {
    if (!draggingClip) return;
    const oldStart = clip.timelineStart;
    pushUndo({
      type: "move",
      clipId: clip.id,
      data: { timelineStart: Math.max(0, newTimelineStart) },
      undo: { timelineStart: oldStart },
      description: `Move clip`,
    });
    await updateClipMutation.mutateAsync({
      id: clip.id,
      timelineStart: Math.max(0, newTimelineStart),
    });
    setDraggingClip(null);
    await refetchClips();
    toast.success("Clip moved");
  };

  const handleDeleteClip = async (clipId: number) => {
    try {
      const clip = timelineClips.find((c) => c.id === clipId);
      pushUndo({
        type: "delete",
        clipId,
        data: {},
        undo: { timelineStart: clip?.timelineStart ?? 0 },
        description: `Delete clip`,
      });
      await deleteClipMutation.mutateAsync({ id: clipId });
      await refetchClips();
      toast.success("Clip deleted");
    } catch (err) {
      toast.error("Failed to delete clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleToggleMute = async (clip: TimelineClip) => {
    try {
      await updateClipMutation.mutateAsync({ id: clip.id, muted: !clip.muted });
      await refetchClips();
    } catch (err) {
      toast.error("Failed to update clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleToggleVisibility = async (clip: TimelineClip) => {
    try {
      await updateClipMutation.mutateAsync({ id: clip.id, visible: !clip.visible });
      await refetchClips();
    } catch (err) {
      toast.error("Failed to update clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleSplitClip = async (clip: TimelineClip, splitAt: number) => {
    if (splitAt <= 0 || splitAt >= clip.duration) return;
    try {
      pushUndo({
        type: "split",
        clipId: clip.id,
        data: { splitAt },
        undo: { sourceStart: clip.sourceStart, duration: clip.duration },
        description: `Split clip`,
      });
      await splitClipMutation.mutateAsync({
        id: clip.id,
        splitAt,
        projectId: projId,
      });
      await refetchClips();
      toast.success("Clip split");
    } catch (err) {
      toast.error("Failed to split clip: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleTrimClip = async (clip: TimelineClip, newSourceStart: number, newDuration: number) => {
    try {
      pushUndo({
        type: "trim",
        clipId: clip.id,
        data: { sourceStart: newSourceStart, duration: newDuration },
        undo: { sourceStart: clip.sourceStart, duration: clip.duration },
        description: `Trim clip`,
      });
      await trimClipMutation.mutateAsync({
        id: clip.id,
        sourceStart: newSourceStart,
        duration: newDuration,
      });
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
        const action = performUndo();
        if (action && action.clipId) {
          // Apply the undo by reverting the clip to its previous state
          updateClipMutation.mutateAsync({ id: action.clipId, ...action.undo } as any)
            .then(() => { refetchClips(); toast.info(`Undone: ${action.description}`); })
            .catch(() => { toast.error("Failed to undo"); });
        } else {
          toast.info(`Undone: ${action?.description || "unknown"}`);
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.code === "KeyZ" && e.shiftKey || e.code === "KeyY")) {
        e.preventDefault();
        const action = performRedo();
        if (action && action.clipId) {
          // Apply the redo by reapplying the action
          if (action.type === "move") {
            updateClipMutation.mutateAsync({ id: action.clipId, timelineStart: action.data.timelineStart as number })
              .then(() => { refetchClips(); toast.info(`Redone: ${action.description}`); })
              .catch(() => { toast.error("Failed to redo"); });
          } else if (action.type === "trim") {
            trimClipMutation.mutateAsync({ id: action.clipId, sourceStart: action.data.sourceStart as number, duration: action.data.duration as number })
              .then(() => { refetchClips(); toast.info(`Redone: ${action.description}`); })
              .catch(() => { toast.error("Failed to redo"); });
          }
        } else {
          toast.info(`Redone: ${action?.description || "unknown"}`);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, currentTime, timelineClips, totalDuration, zoomLevel]);

  /* Drag-and-drop on sidebar */
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      const videoFile = files.find((f) => f.type.startsWith("video/"));
      if (videoFile) handleFileUpload(videoFile);
    },
    [handleFileUpload]
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <Scissors className="w-16 h-16 text-orange-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-white mb-4">Sign in to edit</h1>
          <Link href="/">
            <Button className="bg-orange-500 hover:bg-orange-600 text-white h-11">
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
          <span className="text-orange-500 text-xs font-medium px-2 py-0.5 bg-orange-500/10 rounded-full">
            {project?.status || "draft"}
          </span>
        </div>
        <div className="flex items-center gap-3">
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
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white h-8 text-xs">
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
                    ? "border-orange-500/50 bg-orange-500/5 text-orange-400"
                    : "border-white/10 text-gray-500 hover:border-orange-500/30 hover:text-orange-400"
                }`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                    <span className="text-xs">Uploading {uploadProgress.toFixed(0)}%</span>
                    <div className="w-20 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    <span className="text-xs">Drop video here</span>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />

              {(assets ?? []).map((asset) => (
                <div
                  key={asset.id}
                  className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.04] hover:border-white/10 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileVideo className="w-4 h-4 text-orange-500 flex-shrink-0" />
                    <span className="text-xs text-white truncate">{asset.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span>{formatTime(asset.duration)}</span>
                    <span>{asset.width}x{asset.height}</span>
                    <span>{formatFileSize(asset.sizeBytes)}</span>
                  </div>
                  <video
                    src={asset.url}
                    className="w-full mt-2 rounded max-h-20 object-cover"
                    muted
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center - Preview */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Video Preview - Assembled timeline playback */}
          <div className="flex-1 flex items-center justify-center bg-black relative">
            {activeClip ? (
              <video
                ref={previewVideoRef}
                key={activeClip.id}
                src={activeClip.assetUrl}
                className="max-w-full max-h-full object-contain"
                onTimeUpdate={handlePreviewTimeUpdate}
                onLoadedMetadata={handlePreviewLoadedMetadata}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  setIsPlaying(false);
                  // Move to next clip in timeline
                  const nextClip = getActiveClip(
                    timelineClips,
                    activeClip.timelineStart + activeClip.duration
                  );
                  if (nextClip) {
                    setCurrentTime(nextClip.timelineStart);
                    previewVideoRef.current!.src = nextClip.assetUrl;
                    previewVideoRef.current!.currentTime = nextClip.sourceStart;
                    previewVideoRef.current!.play();
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
                  <span className="text-[10px] text-orange-400 px-2 py-0.5 bg-orange-500/10 rounded-full">
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
            className="absolute top-0 bottom-0 w-0.5 bg-orange-500 z-20"
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
              className="absolute top-0 bottom-0 w-0.5 bg-orange-500 z-20 pointer-events-none"
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
                      className="absolute h-12 rounded-md overflow-hidden cursor-pointer group transition-opacity"
                      style={{
                        left: `${clip.timelineStart * zoomLevel}px`,
                        width: `${clip.duration * zoomLevel}px`,
                        opacity: clip.visible ? 1 : 0.3,
                        zIndex: draggingClip === clip.id ? 50 : 10,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setDraggingClip(clip.id);
                      }}
                      onMouseUp={(e) => {
                        if (draggingClip) {
                          const rect = (
                            e.currentTarget.parentElement as HTMLDivElement
                          ).getBoundingClientRect();
                          const x = e.clientX - rect.left;
                          handleClipDragEnd(clip, x / zoomLevel);
                        }
                      }}
                      onDoubleClick={() => {
                        // Split at playhead position
                        const playheadOffset =
                          currentTime - clip.timelineStart;
                        if (
                          playheadOffset > 0 &&
                          playheadOffset < clip.duration
                        ) {
                          handleSplitClip(clip, playheadOffset);
                        }
                      }}
                    >
                      <div
                        className={`w-full h-full rounded-md border transition-all ${
                          activeClip?.id === clip.id
                            ? "bg-orange-500/20 border-orange-500/40 shadow-[0_0_12px_rgba(249,115,22,0.15)]"
                            : clip.locked
                            ? "bg-blue-500/10 border-blue-500/30"
                            : "bg-orange-500/10 border-orange-500/20 hover:border-orange-500/40"
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
                            <div className="flex-1 h-2 bg-orange-500/20 animate-pulse rounded" />
                          ) : getWaveform(clip.assetId).length > 0 ? (
                            getWaveform(clip.assetId).map((val, i) => (
                              <div
                                key={i}
                                className="flex-1 bg-orange-400/30 rounded-sm"
                                style={{ height: `${(val || 0.2) * 100}%` }}
                              />
                            ))
                          ) : (
                            Array.from({ length: Math.min(Math.floor(clip.duration * 10), 80) }, () => 0.3).map((val, i) => (
                              <div
                                key={i}
                                className="flex-1 bg-gray-600/20 rounded-sm"
                                style={{ height: `${val * 100}%` }}
                              />
                            ))
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
    </div>
  );
}
