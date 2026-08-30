import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PlaybackClock } from "./playbackClock";

describe("PlaybackClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with default duration and position", () => {
    const clock = new PlaybackClock(120);
    expect(clock.currentTime).toBe(0);
    expect(clock.isPlaying).toBe(false);
    expect(clock.playbackSpeed).toBe(1);
  });

  it("seeks within bounds", () => {
    const clock = new PlaybackClock(60);
    clock.seek(30);
    expect(clock.currentTime).toBe(30);

    clock.seek(-10);
    expect(clock.currentTime).toBe(0);

    clock.seek(200);
    expect(clock.currentTime).toBe(60);
  });

  it("subscribes and notifies on position change", () => {
    const clock = new PlaybackClock(60);
    const subscriber = vi.fn();
    const unsubscribe = clock.subscribe(subscriber);

    expect(subscriber).toHaveBeenCalledWith(0, false);

    clock.seek(15);
    expect(subscriber).toHaveBeenCalledWith(15, false);

    unsubscribe();
    clock.seek(20);
    expect(subscriber).toHaveBeenCalledTimes(2);
  });

  it("toggles play/pause correctly", () => {
    const clock = new PlaybackClock(60);
    clock.togglePlay();
    expect(clock.isPlaying).toBe(true);

    clock.togglePlay();
    expect(clock.isPlaying).toBe(false);
  });
});
