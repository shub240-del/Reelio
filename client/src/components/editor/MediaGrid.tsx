import React, { useRef, useState } from "react";
import { Search, Upload, Plus, Film, Music, Trash2, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
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

  return (
    <div className="flex flex-col flex-1 h-full bg-[#0f0f14] overflow-hidden p-3">
      {/* Search Bar */}
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search media..."
          className="w-full bg-[#181822] border border-white/[0.08] rounded-md pl-9 pr-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-sky-500/50 transition-colors"
        />
      </div>

      {/* Section Header */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-semibold text-gray-200">Your Media</span>
        <span className="text-[11px] text-gray-500">{assets.length} items</span>
      </div>

      {/* Grid of Cards */}
      <div
        className="flex-1 overflow-y-auto no-scrollbar grid grid-cols-2 gap-2.5 content-start pb-4"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onUpload(file);
        }}
      >
        {/* Add Media Upload Card */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label={uploading ? "Importing media" : "Add media"}
          className={`aspect-[4/3] rounded-lg border-2 border-dashed flex flex-col items-center justify-center p-3 cursor-pointer transition-all ${
            isDragOver
              ? "border-sky-400 bg-sky-500/10 text-sky-300"
              : "border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.25] text-gray-400"
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-1.5 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
              <span className="text-[11px] text-sky-300 font-medium">{Math.round(uploadProgress)}%</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-gray-300">
                <Upload className="w-4 h-4" />
              </div>
              <span className="text-xs font-medium text-gray-300">Add media</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
        </button>

        {/* Existing Assets Grid */}
        {filteredAssets.map((asset) => {
          const isVideo = asset.mimeType.startsWith("video/");
          const isAudio = asset.mimeType.startsWith("audio/");

          return (
            <article
              key={asset.id}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-white/[0.08] bg-[#181822] transition-all hover:border-sky-500/50 hover:shadow-lg hover:shadow-sky-500/5 focus-within:border-sky-500/60"
            >
              <button type="button" onClick={() => onAddAssetToTimeline(asset)} aria-label={`Add ${asset.name} to timeline`} className="absolute inset-0 z-10 cursor-pointer focus:outline-none"><span className="sr-only">Add {asset.name} to timeline</span></button>
              {/* Media Thumbnail View */}
              <div className="absolute inset-0 bg-[#12121a] flex items-center justify-center overflow-hidden">
                {asset.url && isVideo ? (
                  <video src={asset.url} className="w-full h-full object-cover pointer-events-none" muted />
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
              <div className="relative z-10 p-1.5 flex items-end justify-between">
                <span className="text-[11px] font-medium text-white truncate max-w-[90px] drop-shadow-md" title={asset.name}>
                  {asset.name}
                </span>
                {asset.duration > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-black/70 text-gray-200">
                    {formatDuration(asset.duration)}
                  </span>
                )}
              </div>

              {/* Hover Overlay Action (Add + Delete) */}
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
    </div>
  );
};
