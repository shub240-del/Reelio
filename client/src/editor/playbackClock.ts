/**
 * Reelio Playback Clock
 *
 * High-precision, decoupled playback engine driven by requestAnimationFrame.
 * Removes 60fps tick re-renders from React component trees while keeping
 * audio tracks, preview videos, and timeline playhead needles perfectly in sync.
 */

const safeRaf = (cb: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  return setTimeout(() => cb(performance.now()), 16) as unknown as number;
};

const safeCaf = (id: number): void => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
};

export class PlaybackClock {
  private _currentTime: number = 0;
  private _isPlaying: boolean = false;
  private _playbackSpeed: number = 1;
  private _totalDuration: number = 60;
  private _lastRafTimestamp: number = 0;
  private _rafId: number | null = null;
  private _subscribers: Set<(time: number, isPlaying: boolean) => void> = new Set();

  constructor(initialDuration: number = 60) {
    this._totalDuration = Math.max(initialDuration, 0);
  }

  public get currentTime(): number {
    return this._currentTime;
  }

  public get isPlaying(): boolean {
    return this._isPlaying;
  }

  public get playbackSpeed(): number {
    return this._playbackSpeed;
  }

  public set playbackSpeed(speed: number) {
    this._playbackSpeed = Math.max(0.1, Math.min(16, speed));
  }

  public set totalDuration(duration: number) {
    this._totalDuration = Math.max(duration, 0);
    if (this._currentTime > this._totalDuration) {
      this.seek(this._totalDuration);
    }
  }

  public subscribe(fn: (time: number, isPlaying: boolean) => void): () => void {
    this._subscribers.add(fn);
    fn(this._currentTime, this._isPlaying);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  private notify() {
    for (const sub of this._subscribers) {
      sub(this._currentTime, this._isPlaying);
    }
  }

  public play() {
    if (this._isPlaying) return;
    if (this._currentTime >= this._totalDuration) {
      this._currentTime = 0;
    }
    this._isPlaying = true;
    this._lastRafTimestamp = performance.now();
    this._loop();
    this.notify();
  }

  public pause() {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    if (this._rafId !== null) {
      safeCaf(this._rafId);
      this._rafId = null;
    }
    this.notify();
  }

  public togglePlay() {
    if (this._isPlaying) this.pause();
    else this.play();
  }

  public seek(targetTime: number) {
    this._currentTime = Math.max(0, Math.min(this._totalDuration, targetTime));
    this.notify();
  }

  public skipForward(seconds: number = 5) {
    this.seek(this._currentTime + seconds);
  }

  public skipBackward(seconds: number = 5) {
    this.seek(this._currentTime - seconds);
  }

  public goToStart() {
    this.seek(0);
  }

  private _loop = () => {
    if (!this._isPlaying) return;
    const now = performance.now();
    const deltaSeconds = ((now - this._lastRafTimestamp) / 1000) * this._playbackSpeed;
    this._lastRafTimestamp = now;

    this._currentTime += deltaSeconds;
    if (this._currentTime >= this._totalDuration) {
      this._currentTime = this._totalDuration;
      this.pause();
      return;
    }

    this.notify();
    this._rafId = safeRaf(this._loop);
  };

  public destroy() {
    this.pause();
    this._subscribers.clear();
  }
}
