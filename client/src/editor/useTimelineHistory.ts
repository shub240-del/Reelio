import { useCallback, useMemo, useRef, useState } from "react";
import {
  ClipSnapshot,
  TimelineHistory,
  TimelineSnapshot,
  TrackStatesSnapshot,
  diffSnapshots,
  planIsEmpty,
  snapshotClips,
} from "./history";

export interface TimelineHistoryPorts {
  /** Live clip list, read at call time so we never trust a stale mirror. */
  getClips: () => ClipSnapshot[];
  getSelection: () => number[];
  setSelection: (ids: number[]) => void;
  getTrackStates?: () => TrackStatesSnapshot;
  setTrackStates?: (states: TrackStatesSnapshot) => void;
  createClip: (clip: ClipSnapshot) => Promise<unknown>;
  updateClip: (patch: Partial<ClipSnapshot> & { id: number }) => Promise<unknown>;
  deleteClip: (id: number) => Promise<unknown>;
  refetch: () => Promise<unknown>;
}

/**
 * Wires the snapshot history to the clip store.
 *
 * Callers record the state *before* mutating and never describe the inverse of
 * their own operation, so a new edit operation is undoable the moment it is
 * written — no history code has to learn about it.
 */
export function useTimelineHistory(ports: TimelineHistoryPorts) {
  const portsRef = useRef(ports);
  portsRef.current = ports;

  const history = useMemo(() => new TimelineHistory(), []);
  // Stacks live outside React state; this counter republishes canUndo/canRedo.
  const [version, setVersion] = useState(0);
  const applying = useRef(false);

  const capture = useCallback(
    (label: string): TimelineSnapshot => ({
      label,
      clips: snapshotClips(portsRef.current.getClips()),
      selection: [...portsRef.current.getSelection()],
      trackStates: portsRef.current.getTrackStates?.(),
    }),
    [],
  );

  /** Call immediately before applying an edit. */
  const record = useCallback(
    (label: string) => {
      if (applying.current) return; // undo/redo must not record its own writes
      history.record(capture(label));
      setVersion((v) => v + 1);
    },
    [capture, history],
  );

  const apply = useCallback(
    async (target: TimelineSnapshot) => {
      const p = portsRef.current;
      const plan = diffSnapshots(snapshotClips(p.getClips()), target.clips);
      if (planIsEmpty(plan)) {
        if (target.trackStates) p.setTrackStates?.(target.trackStates);
        p.setSelection(target.selection);
        return;
      }
      applying.current = true;
      try {
        for (const id of plan.delete) await p.deleteClip(id);
        for (const patch of plan.update) await p.updateClip(patch);
        for (const clip of plan.create) await p.createClip(clip);
        await p.refetch();
        if (target.trackStates) p.setTrackStates?.(target.trackStates);
        p.setSelection(target.selection);
      } finally {
        applying.current = false;
      }
    },
    [],
  );

  const undo = useCallback(async (): Promise<string | null> => {
    if (applying.current) return null;
    const label = history.undoLabel;
    const target = history.undo(capture(label ?? "edit"));
    setVersion((v) => v + 1);
    if (!target) return null;
    await apply(target);
    return label;
  }, [apply, capture, history]);

  const redo = useCallback(async (): Promise<string | null> => {
    if (applying.current) return null;
    const label = history.redoLabel;
    const target = history.redo(capture(label ?? "edit"));
    setVersion((v) => v + 1);
    if (!target) return null;
    await apply(target);
    return label;
  }, [apply, capture, history]);

  const clear = useCallback(() => {
    history.clear();
    setVersion((v) => v + 1);
  }, [history]);

  return {
    record,
    undo,
    redo,
    clear,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
    depth: history.depth,
    // referenced so lint keeps the subscription honest
    _version: version,
  };
}
