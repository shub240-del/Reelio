import { useCallback, useState } from "react";

/**
 * Generate a waveform data array from an audio/video element.
 * Uses the Web Audio API to decode the audio data and compute peak samples.
 * Returns an array of normalized values (0-1) for rendering.
 */
export function useWaveform() {
  const [waveformData, setWaveformData] = useState<Record<number, number[]>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<Record<number, string>>({});

  const generateWaveform = useCallback(
    async (assetId: number, assetUrl: string, numBars = 64) => {
      setLoading((prev) => ({ ...prev, [assetId]: true }));
      setError((prev) => {
        const next = { ...prev };
        delete next[assetId];
        return next;
      });

      try {
        const response = await fetch(assetUrl);
        const arrayBuffer = await response.arrayBuffer();

        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        audioContext.close();

        const channelData = audioBuffer.getChannelData(0);
        const samplesPerBar = Math.floor(channelData.length / numBars);
        const bars: number[] = [];

        for (let i = 0; i < numBars; i++) {
          let peak = 0;
          const start = i * samplesPerBar;
          const end = start + samplesPerBar;
          for (let j = start; j < end && j < channelData.length; j++) {
            const val = Math.abs(channelData[j]);
            if (val > peak) peak = val;
          }
          bars.push(Math.min(1, peak * 2));
        }

        setWaveformData((prev) => ({ ...prev, [assetId]: bars }));
      } catch (err) {
        setError((prev) => ({
          ...prev,
          [assetId]: err instanceof Error ? err.message : "Failed to decode audio",
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [assetId]: false }));
      }
    },
    []
  );

  const getWaveform = useCallback(
    (assetId: number): number[] => {
      return waveformData[assetId] || [];
    },
    [waveformData]
  );

  const isGenerating = useCallback(
    (assetId: number): boolean => {
      return loading[assetId] || false;
    },
    [loading]
  );

  return { generateWaveform, getWaveform, isGenerating, loading, error };
}
