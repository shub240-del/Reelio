import React from "react";
import {
  Film,
  Sparkles,
  FileText,
  Sliders,
  FolderOpen,
} from "lucide-react";

export type CategoryTab = "media" | "videofx" | "transcript" | "inspector";
export type MediaSubTab = "your-media";

interface LeftCategoryNavProps {
  activeCategory: CategoryTab;
  onSelectCategory: (tab: CategoryTab) => void;
  activeSubTab: MediaSubTab;
  onSelectSubTab: (sub: MediaSubTab) => void;
}

export const LeftCategoryNav: React.FC<LeftCategoryNavProps> = ({
  activeCategory,
  onSelectCategory,
  activeSubTab: _activeSubTab,
  onSelectSubTab: _onSelectSubTab,
}) => {
  const categories = [
    { id: "media" as CategoryTab, label: "Media", icon: FolderOpen },
    { id: "videofx" as CategoryTab, label: "Video FX", icon: Sparkles },
    { id: "transcript" as CategoryTab, label: "Transcript", icon: FileText },
    { id: "inspector" as CategoryTab, label: "Inspector", icon: Sliders },
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

    </div>
  );
};
