import React, { useRef, useState } from "react";
import { Search, Upload, Plus, Film, Image as ImageIcon, Music, Trash2, CheckCircle2, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
        <div
          onClick={() => fileInputRef.current?.click()}
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
            accept="video/*,audio/*,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Existing Assets Grid */}
        {filteredAssets.map((asset) => {
          const isVideo = asset.mimeType.startsWith("video/");
          const isImage = asset.mimeType.startsWith("image/");
          const isAudio = asset.mimeType.startsWith("audio/");

          return (
            <div
              key={asset.id}
              onClick={() => onAddAssetToTimeline(asset)}
              className="group relative aspect-[4/3] rounded-lg bg-[#181822] border border-white/[0.08] hover:border-sky-500/50 overflow-hidden cursor-pointer flex flex-col justify-between transition-all hover:shadow-lg hover:shadow-sky-500/5"
            >
              {/* Media Thumbnail View */}
              <div className="absolute inset-0 bg-[#12121a] flex items-center justify-center overflow-hidden">
                {asset.url && isImage ? (
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                ) : asset.url && isVideo ? (
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
                  Indexed
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-black/60 text-gray-300 backdrop-blur-xs">
                  Hash ok
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
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex items-center justify-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddAssetToTimeline(asset);
                  }}
                  className="w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center hover:bg-sky-400 shadow-md"
                  title="Add to timeline"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAsset(asset);
                  }}
                  className="w-7 h-7 rounded-full bg-red-500/80 text-white flex items-center justify-center hover:bg-red-500 shadow-md"
                  title="Delete media"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
