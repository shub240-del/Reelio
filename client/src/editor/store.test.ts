import { describe, expect, it, beforeEach } from "vitest";
import { useEditorStore } from "./store";

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.getState().resetEditorState();
  });

  it("manages selection and zoom", () => {
    const store = useEditorStore.getState();
    expect(store.selectedClipIds).toEqual([]);
    expect(store.zoomLevel).toBe(60);

    store.setSelectedClipIds([1, 2]);
    expect(useEditorStore.getState().selectedClipIds).toEqual([1, 2]);

    store.setZoomLevel(120);
    expect(useEditorStore.getState().zoomLevel).toBe(120);

    // Zoom clamps between 20 and 200
    store.setZoomLevel(500);
    expect(useEditorStore.getState().zoomLevel).toBe(200);

    store.setZoomLevel(5);
    expect(useEditorStore.getState().zoomLevel).toBe(20);
  });

  it("updates track visibility, mute, and lock", () => {
    const store = useEditorStore.getState();
    expect(store.trackStates.video0.muted).toBe(false);

    store.setTrackStates((prev) => ({
      ...prev,
      video0: { ...prev.video0, muted: true },
    }));

    expect(useEditorStore.getState().trackStates.video0.muted).toBe(true);
  });
});
