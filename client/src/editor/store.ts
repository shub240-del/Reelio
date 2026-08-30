import { create } from "zustand";
import type { CaptionCue, EditPlan, ReviewRangeHighlight } from "@shared/editOps";

export interface EditorClip {
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

export interface TrackState {
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

export interface EditorStoreState {
  // Timeline Model
  clips: EditorClip[];
  selectedClipIds: number[];
  captions: CaptionCue[];
  zoomLevel: number;
  snapping: boolean;
  isMuted: boolean;
  playbackSpeed: number;
  isRippleActive: boolean;

  // Track Settings
  trackStates: Record<string, TrackState>;

  // Interaction Previews
  dragPreview: { id: number; start: number } | null;
  trimPreview: { id: number; start: number; duration: number } | null;
  snapGuide: number | null;

  // AI Review Mode
  pendingPlan: EditPlan | null;
  selectedOpIndices: number[];
  reviewInstruction: string;
  reviewHighlights: ReviewRangeHighlight[];

  // Mutators
  setClips: (clips: EditorClip[]) => void;
  setSelectedClipIds: (ids: number[] | ((prev: number[]) => number[])) => void;
  setCaptions: (captions: CaptionCue[] | ((prev: CaptionCue[]) => CaptionCue[])) => void;
  setZoomLevel: (zoom: number | ((prev: number) => number)) => void;
  setSnapping: (snapping: boolean) => void;
  setIsMuted: (isMuted: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setIsRippleActive: (ripple: boolean) => void;
  setTrackStates: (updater: (prev: Record<string, TrackState>) => Record<string, TrackState>) => void;
  setDragPreview: (preview: { id: number; start: number } | null) => void;
  setTrimPreview: (preview: { id: number; start: number; duration: number } | null) => void;
  setSnapGuide: (guide: number | null) => void;
  setPendingPlan: (plan: EditPlan | null) => void;
  setSelectedOpIndices: (indices: number[] | ((prev: number[]) => number[])) => void;
  setReviewInstruction: (inst: string) => void;
  setReviewHighlights: (hl: ReviewRangeHighlight[]) => void;
  resetEditorState: () => void;
}

const initialTrackStates: Record<string, TrackState> = {
  captions: { muted: false, locked: false, visible: true },
  video0: { muted: false, locked: false, visible: true },
  audio0: { muted: false, locked: false, visible: true },
  audio1: { muted: false, locked: false, visible: true },
};

export const useEditorStore = create<EditorStoreState>((set) => ({
  clips: [],
  selectedClipIds: [],
  captions: [],
  zoomLevel: 60,
  snapping: true,
  isMuted: false,
  playbackSpeed: 1,
  isRippleActive: false,
  trackStates: initialTrackStates,
  dragPreview: null,
  trimPreview: null,
  snapGuide: null,
  pendingPlan: null,
  selectedOpIndices: [],
  reviewInstruction: "",
  reviewHighlights: [],

  setClips: (clips) => set({ clips }),
  setSelectedClipIds: (arg) =>
    set((state) => ({
      selectedClipIds: typeof arg === "function" ? arg(state.selectedClipIds) : arg,
    })),
  setCaptions: (arg) =>
    set((state) => ({
      captions: typeof arg === "function" ? arg(state.captions) : arg,
    })),
  setZoomLevel: (arg) =>
    set((state) => ({
      zoomLevel: typeof arg === "function" ? Math.max(20, Math.min(200, arg(state.zoomLevel))) : Math.max(20, Math.min(200, arg)),
    })),
  setSnapping: (snapping) => set({ snapping }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setIsRippleActive: (isRippleActive) => set({ isRippleActive }),
  setTrackStates: (updater) =>
    set((state) => ({
      trackStates: updater(state.trackStates),
    })),
  setDragPreview: (dragPreview) => set({ dragPreview }),
  setTrimPreview: (trimPreview) => set({ trimPreview }),
  setSnapGuide: (snapGuide) => set({ snapGuide }),
  setPendingPlan: (pendingPlan) => set({ pendingPlan }),
  setSelectedOpIndices: (arg) =>
    set((state) => ({
      selectedOpIndices: typeof arg === "function" ? arg(state.selectedOpIndices) : arg,
    })),
  setReviewInstruction: (reviewInstruction) => set({ reviewInstruction }),
  setReviewHighlights: (reviewHighlights) => set({ reviewHighlights }),
  resetEditorState: () =>
    set({
      clips: [],
      selectedClipIds: [],
      captions: [],
      zoomLevel: 60,
      snapping: true,
      isMuted: false,
      playbackSpeed: 1,
      isRippleActive: false,
      trackStates: initialTrackStates,
      dragPreview: null,
      trimPreview: null,
      snapGuide: null,
      pendingPlan: null,
      selectedOpIndices: [],
      reviewInstruction: "",
      reviewHighlights: [],
    }),
}));
