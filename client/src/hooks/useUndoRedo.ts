import { useCallback, useRef, useState } from "react";

export interface UndoAction {
  type: string;
  clipId?: number;
  data: Record<string, unknown>;
  undo: Record<string, unknown>;
  description: string;
}

export function useUndoRedo(maxHistory = 50) {
  const [history, setHistory] = useState<UndoAction[]>([]);
  const [future, setFuture] = useState<UndoAction[]>([]);
  const historyRef = useRef<UndoAction[]>([]);
  const futureRef = useRef<UndoAction[]>([]);

  const push = useCallback((action: UndoAction) => {
    const newHistory = [...historyRef.current, action].slice(-maxHistory);
    historyRef.current = newHistory;
    futureRef.current = [];
    setHistory([...newHistory]);
    setFuture([]);
  }, [maxHistory]);

  const undo = useCallback((): UndoAction | null => {
    const current = historyRef.current;
    if (current.length === 0) return null;
    const action = current[current.length - 1];
    historyRef.current = current.slice(0, -1);
    futureRef.current = [action, ...futureRef.current];
    setHistory([...historyRef.current]);
    setFuture([...futureRef.current]);
    return action;
  }, []);

  const redo = useCallback((): UndoAction | null => {
    if (futureRef.current.length === 0) return null;
    const action = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    historyRef.current = [...historyRef.current, action];
    setHistory([...historyRef.current]);
    setFuture([...futureRef.current]);
    return action;
  }, []);

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  const clear = useCallback(() => {
    historyRef.current = [];
    futureRef.current = [];
    setHistory([]);
    setFuture([]);
  }, []);

  return { push, undo, redo, canUndo, canRedo, clear, historyCount: history.length };
}
