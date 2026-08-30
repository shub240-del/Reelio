import React from "react";
import {
  Film,
  Sparkles,
  Volume2,
  GitCommit,
  FileText,
  Sliders,
  FolderOpen,
  Palette,
  Shapes,
  Smile,
  Type,
  Music,
  Headphones,
} from "lucide-react";

export type CategoryTab = "media" | "videofx" | "audiofx" | "transitions" | "transcript" | "inspector";
export type MediaSubTab = "your-media" | "colors" | "shapes" | "emojis" | "text" | "music" | "sounds";

interface LeftCategoryNavProps {
  activeCategory: CategoryTab;
  onSelectCategory: (tab: CategoryTab) => void;
  activeSubTab: MediaSubTab;
  onSelectSubTab: (sub: MediaSubTab) => void;
}

export const LeftCategoryNav: React.FC<LeftCategoryNavProps> = ({
  activeCategory,
  onSelectCategory,
  activeSubTab,
  onSelectSubTab,
}) => {
  const categories = [
    { id: "media" as CategoryTab, label: "Media", icon: FolderOpen },
    { id: "videofx" as CategoryTab, label: "Video FX", icon: Sparkles },
    { id: "audiofx" as CategoryTab, label: "Audio FX", icon: Volume2 },
    { id: "transitions" as CategoryTab, label: "Transitions", icon: GitCommit },
    { id: "transcript" as CategoryTab, label: "Transcript", icon: FileText },
    { id: "inspector" as CategoryTab, label: "Inspector", icon: Sliders },
  ];

  const subTabs = [
    { id: "your-media" as MediaSubTab, label: "Your Media", icon: FolderOpen },
    { id: "colors" as MediaSubTab, label: "Colors", icon: Palette },
    { id: "shapes" as MediaSubTab, label: "Shapes", icon: Shapes },
    { id: "emojis" as MediaSubTab, label: "Emojis", icon: Smile },
    { id: "text" as MediaSubTab, label: "Text", icon: Type },
    { id: "music" as MediaSubTab, label: "Music", icon: Music },
    { id: "sounds" as MediaSubTab, label: "Sounds", icon: Headphones },
  ];

  return (
    <div className="flex flex-col w-full flex-shrink-0 bg-[#0e0e13] border-b border-white/[0.08] select-none">
      {/* Top Main Category Tabs */}
      <div className="flex items-center px-1.5 bg-[#0e0e13] overflow-x-auto no-scrollbar scroll-smooth">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelectCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors relative whitespace-nowrap flex-shrink-0 cursor-pointer ${
                isActive
                  ? "text-sky-400 font-semibold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-sky-400" : "text-zinc-400"}`} />
              <span className="whitespace-nowrap">{cat.label}</span>
              {isActive && (
                <div className="absolute bottom-0 left-1.5 right-1.5 h-[2px] bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.7)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Sub Tab Navigation Pills (For Media tab) */}
      {activeCategory === "media" && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#131319] border-t border-white/[0.05] overflow-x-auto no-scrollbar scroll-smooth">
          {subTabs.map((sub) => {
            const isActive = activeSubTab === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => onSelectSubTab(sub.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap flex-shrink-0 cursor-pointer ${
                  isActive
                    ? "bg-sky-500/15 text-sky-300 border border-sky-500/35 shadow-xs font-medium"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent"
                }`}
              >
                {sub.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
