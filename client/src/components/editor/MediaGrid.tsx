import React, { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  Loader2,
  Music,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface MediaAssetItem {
  id: number;
  name: string;
  url: string;
  mimeType: string;
  duration: number;
  sizeBytes: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  thumbnailUrl?: string | null;
}

interface MediaGridProps {
  assets: MediaAssetItem[];
  onUpload: (file: File) => void;
  onAddAssetToTimeline: (asset: MediaAssetItem) => void;
  onDeleteAsset: (asset: MediaAssetItem) => void;
  uploading?: boolean;
  uploadProgress?: number;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "Still";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const MediaGrid: React.FC<MediaGridProps> = ({
  assets,
  onUpload,
  onAddAssetToTimeline,
  onDeleteAsset,
  uploading = false,
  uploadProgress = 0,
}) => {
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MediaAssetItem | null>(null);

  const filteredAssets = assets.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onUpload(file);
  };

  return (
    <section
      aria-labelledby="media-library-title"
      className="flex h-full flex-1 flex-col overflow-hidden bg-[#111116]"
    >
      <div className="border-b border-white/[0.07] px-4 py-3.5 lg:px-3 lg:py-2">
        <div className="mb-3 flex items-center justify-between lg:mb-2">
          <div>
            <h2 id="media-library-title" className="text-sm font-semibold text-white">
              Media
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-500 lg:hidden">
              Import clips for this project
            </p>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] text-gray-400">
            {assets.length} {assets.length === 1 ? "item" : "items"}
          </span>
        </div>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDragOver(false);
            }
          }}
          onDrop={handleDrop}
          className={`rounded-xl border border-dashed px-4 py-4 text-center transition-colors lg:px-3 lg:py-1 ${
            isDragOver
              ? "border-sky-400 bg-sky-500/10"
              : "border-white/[0.14] bg-white/[0.025]"
          }`}
        >
          {uploading ? (
            <div className="flex min-h-24 flex-col items-center justify-center gap-2 lg:min-h-10 lg:flex-row" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
              <span className="text-xs font-medium text-sky-200">
                Importing media… {Math.round(uploadProgress)}%
              </span>
              <div className="h-1.5 w-full max-w-44 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-400 transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-24 flex-col items-center justify-center lg:min-h-10 lg:flex-row lg:justify-between lg:gap-3">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/10 text-sky-300 lg:mb-0 lg:h-8 lg:w-8 lg:flex-none">
                <Upload className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-gray-200 lg:mr-auto">Drag & drop media here</p>
              <p className="my-1 text-[10px] text-gray-600 lg:hidden">or</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm shadow-sky-500/20 transition-colors hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                Upload Media
              </button>
              <p className="mt-2 text-[9px] text-gray-600 lg:hidden">
                MP4, MOV, WebM, MP3, WAV, JPG, PNG, WebP
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Choose a video, audio, or image file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-3 lg:px-3 lg:py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-200">Your Media</h3>
          {assets.length > 0 ? (
            <span className="text-[10px] text-gray-600">Click + to add</span>
          ) : null}
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search media"
            aria-label="Search media"
            className="w-full rounded-md border border-white/[0.08] bg-[#19191f] py-2 pl-9 pr-3 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-sky-500/50"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4 no-scrollbar">
          {filteredAssets.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.015] px-4 text-center">
              <Film className="mb-2 h-5 w-5 text-gray-600" />
              <p className="text-xs text-gray-400">
                {assets.length === 0 ? "No media imported yet" : "No matching media"}
              </p>
              <p className="mt-1 text-[10px] text-gray-600">
                {assets.length === 0
                  ? "Upload a clip to add it to the timeline."
                  : "Try a different search."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 content-start gap-2.5 sm:grid-cols-3">
        {filteredAssets.map((asset) => {
          const isVideo = asset.mimeType.startsWith("video/");
          const isAudio = asset.mimeType.startsWith("audio/");
          const isImage = asset.mimeType.startsWith("image/");

          return (
            <article
              key={asset.id}
              className="group relative aspect-video overflow-hidden rounded-lg border border-white/[0.08] bg-[#181822] transition-all hover:border-sky-500/50 hover:shadow-lg hover:shadow-sky-500/5 focus-within:border-sky-500/60"
            >
              <button
                type="button"
                onClick={() => onAddAssetToTimeline(asset)}
                aria-label={`Add ${asset.name} to timeline`}
                className="absolute inset-0 z-10 cursor-pointer focus:outline-none"
              >
                <span className="sr-only">Add {asset.name} to timeline</span>
              </button>
              {/* Media Thumbnail View */}
              <div className="absolute inset-0 bg-[#12121a] flex items-center justify-center overflow-hidden">
                {asset.url && isVideo ? (
                  <video
                    src={asset.url}
                    className="pointer-events-none h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : asset.url && isImage ? (
                  <img
                    src={asset.url}
                    alt=""
                    className="pointer-events-none h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-500">
                    {isAudio ? <Music className="w-6 h-6 text-purple-400" /> : <Film className="w-6 h-6 text-sky-400" />}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />
              </div>

              {/* Top Badges */}
              <div className="relative z-10 flex items-center justify-between p-1.5">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/80 text-white shadow-sm flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  {asset.duration > 0 ? "Ready" : "Needs metadata"}
                </span>
              </div>

              {/* Bottom Info & Duration */}
              <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between p-1.5">
                <span className="text-[11px] font-medium text-white truncate max-w-[90px] drop-shadow-md" title={asset.name}>
                  {asset.name}
                </span>
                {asset.duration > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-black/70 text-gray-200">
                    {formatDuration(asset.duration)}
                  </span>
                )}
              </div>

              {/* Explicit card actions remain keyboard accessible. */}
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddAssetToTimeline(asset);
                  }}
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-white shadow-md hover:bg-sky-400"
                  title="Add to timeline"
                  aria-label={`Add ${asset.name} to timeline`}
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(asset);
                  }}
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-red-500/80 text-white shadow-md hover:bg-red-500"
                  title="Delete media"
                  aria-label={`Delete ${asset.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </article>
          );
        })}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        {deleteTarget ? (
          <AlertDialogContent className="max-w-sm border-red-500/25 bg-[#17171f] text-white shadow-2xl">
            <AlertTriangle className="mb-3 h-6 w-6 text-red-400" />
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this media?</AlertDialogTitle>
              <AlertDialogDescription className="leading-relaxed text-gray-400">This removes “{deleteTarget.name}” and every timeline clip that uses it. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5 hover:text-white">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDeleteAsset(deleteTarget)} className="bg-red-600 text-white hover:bg-red-500">Delete media</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </section>
  );
};
