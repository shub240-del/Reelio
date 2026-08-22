export interface SilenceRange {
  start: number;
  end: number;
}

/**
 * Decode a real audio-bearing media URL and return contiguous silent ranges.
 * Peak amplitude is used so short transients are not averaged away. The caller
 * decides whether the source contains audio; decode failure returns no ranges.
 */
export async function detectSilenceRanges(
  sourceUrl: string,
  options: { buckets?: number; threshold?: number; minDuration?: number } = {},
): Promise<SilenceRange[]> {
  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return [];
  const ctx = new AudioCtor();
  try {
    const response = await fetch(sourceUrl);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    if (buffer.numberOfChannels === 0 || buffer.duration <= 0) return [];
    const channel = buffer.getChannelData(0);
    const buckets = Math.max(1, options.buckets ?? Math.ceil(buffer.duration * 20));
    const threshold = options.threshold ?? 0.02;
    const minDuration = options.minDuration ?? 0.25;
    const ranges: SilenceRange[] = [];
    let start: number | null = null;
    for (let i = 0; i < buckets; i++) {
      const left = Math.floor((i * channel.length) / buckets);
      const right = Math.max(left + 1, Math.floor(((i + 1) * channel.length) / buckets));
      let peak = 0;
      for (let j = left; j < Math.min(right, channel.length); j++) peak = Math.max(peak, Math.abs(channel[j]));
      if (peak <= threshold && start === null) start = (i * buffer.duration) / buckets;
      if (peak > threshold && start !== null) {
        const end = (i * buffer.duration) / buckets;
        if (end - start >= minDuration) ranges.push({ start, end });
        start = null;
      }
    }
    if (start !== null && buffer.duration - start >= minDuration) ranges.push({ start, end: buffer.duration });
    return ranges;
  } catch {
    return [];
  } finally {
    void ctx.close();
  }
}
