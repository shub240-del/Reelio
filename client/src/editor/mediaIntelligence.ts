/**
 * Reelio Media Intelligence Evidence Extractor
 *
 * Gathers objective, timestamped evidence from raw media files:
 * 1. Silence / pause detection via Web Audio API peak analysis
 * 2. Transcript and filler-word evidence supplied by a real transcription
 *    provider when one is connected
 *
 * CORE PRINCIPLE: NVIDIA NIM reasons over this evidence.
 * We never ask the AI to hallucinate timestamps.
 */

import { detectSilenceRanges, type SilenceRange } from "./silence";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptSegment {
  id: number;
  text: string;
  start: number;
  end: number;
  words: WordTimestamp[];
  speaker?: string;
}

export interface FillerWordOccurrence {
  text: string;
  start: number;
  end: number;
  duration: number;
}

export interface SceneBoundary {
  time: number;
  confidence: number;
}

export interface MediaEvidence {
  mediaId: string | number;
  duration: number;
  silenceRanges: SilenceRange[];
  transcriptSegments: TranscriptSegment[];
  fillerWords: FillerWordOccurrence[];
  sceneBoundaries: SceneBoundary[];
  hasAudio: boolean;
}

/** Standard hesitation markers and filler tokens in speech editing */
export const FILLER_TOKENS = new Set([
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "err",
  "ah",
  "ahh",
  "like",
  "you know",
  "sort of",
  "kind of",
  "basically",
  "actually",
]);

/**
 * Scans timestamped words and identifies filler-word occurrences.
 */
export function detectFillerWords(words: WordTimestamp[]): FillerWordOccurrence[] {
  const fillers: FillerWordOccurrence[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const rawWord = w.word || (w as any).text || "";
    const cleaned = rawWord.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Single-word fillers (e.g. "um", "uh", "like")
    if (FILLER_TOKENS.has(cleaned)) {
      fillers.push({
        text: rawWord,
        start: w.start,
        end: w.end,
        duration: Math.max(0.05, Math.round((w.end - w.start) * 1000) / 1000),
      });
      continue;
    }

    // Two-word fillers (e.g. "you know", "sort of", "kind of")
    if (i < words.length - 1) {
      const next = words[i + 1];
      const nextRaw = next.word || (next as any).text || "";
      const twoWord = `${cleaned} ${nextRaw.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      if (FILLER_TOKENS.has(twoWord)) {
        fillers.push({
          text: `${rawWord} ${nextRaw}`,
          start: w.start,
          end: next.end,
          duration: Math.max(0.1, Math.round((next.end - w.start) * 1000) / 1000),
        });
        i++; // skip next word
      }
    }
  }

  return fillers;
}

/**
 * Extracts complete media intelligence evidence for a media asset.
 */
export async function extractMediaEvidence(
  asset: { id: number | string; name: string; url?: string; duration: number; hasAudio?: boolean },
  options: { scanAudio?: boolean } = { scanAudio: true },
): Promise<MediaEvidence> {
  let silenceRanges: SilenceRange[] = [];

  if (options.scanAudio && asset.url && asset.hasAudio) {
    try {
      silenceRanges = await detectSilenceRanges(asset.url);
    } catch {
      silenceRanges = [];
    }
  }

  // Do not manufacture speech, filler words, or scene cuts. Until a real
  // transcription/vision provider supplies timestamped evidence these remain
  // empty and the AI layer must state that limitation.
  const transcriptSegments: TranscriptSegment[] = [];
  const fillerWords: FillerWordOccurrence[] = [];
  const sceneBoundaries: SceneBoundary[] = [];

  return {
    mediaId: asset.id,
    duration: asset.duration,
    silenceRanges,
    transcriptSegments,
    fillerWords,
    sceneBoundaries,
    hasAudio: asset.hasAudio ?? false,
  };
}
