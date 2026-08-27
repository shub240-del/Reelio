/**
 * Server-side AI edit service.
 *
 * Flow:
 *   1. Receive instruction + timeline context from frontend
 *   2. Construct a compact prompt (no secrets, no raw media)
 *   3. Call NVIDIA NIM via getAIProvider()
 *   4. Parse and Zod-validate the structured EditPlan
 *   5. Return the validated plan — the server does NOT apply it
 *
 * The frontend then applies the plan through the existing applyEditOps engine,
 * which runs the same code path as manual edits and keeps undo/redo intact.
 *
 * SECURITY:
 *   - NVIDIA_API_KEY never leaves the server
 *   - The constructed prompt never echoes API keys or credentials
 *   - Invalid model output is rejected before it reaches the frontend
 */

import { z } from "zod";
import { editPlanSchema, type EditPlan } from "../shared/editOps";
import { getAIProvider } from "./_core/nvidia";

// ─── Input schema ──────────────────────────────────────────────────────────

export const aiEditRequestSchema = z.object({
  /** Natural-language instruction from the user. */
  instruction: z.string().min(1).max(2000),

  /** Current clips on the timeline (compact representation). */
  clips: z.array(
    z.object({
      id: z.number().int(),
      assetId: z.number().int(),
      assetName: z.string().max(256),
      trackType: z.enum(["video", "audio"]),
      trackId: z.number().int().min(0).max(32),
      timelineStart: z.number().min(0),
      duration: z.number().min(0),
      sourceStart: z.number().min(0),
      sortIndex: z.number().int().min(0),
    }),
  ),

  /** Assets referenced by the clips (durations are required for validation). */
  assets: z.array(
    z.object({
      id: z.number().int(),
      name: z.string().max(256),
      mimeType: z.string().max(128),
      duration: z.number().min(0),
      width: z.number().int().min(0),
      height: z.number().int().min(0),
      fps: z.number().min(0),
      hasAudio: z.boolean(),
    }),
  ),

  /** Detected silence ranges (empty if none detected or silence detection skipped). */
  silenceRanges: z
    .array(z.object({ start: z.number().min(0), end: z.number().min(0) }))
    .max(2000)
    .default([]),

  /** Optional transcript segments with timestamps. */
  transcriptSegments: z
    .array(
      z.object({
        id: z.number().int().optional(),
        text: z.string(),
        start: z.number().min(0),
        end: z.number().min(0),
      }),
    )
    .max(500)
    .default([]),

  /** Optional detected filler words. */
  fillerWords: z
    .array(
      z.object({
        text: z.string(),
        start: z.number().min(0),
        end: z.number().min(0),
        duration: z.number().min(0),
      }),
    )
    .max(1000)
    .default([]),

  /** Target duration constraint for highlight / short-form creation (in seconds). */
  targetDuration: z.number().min(1).max(3600).optional(),

  /** Optional: current playhead position. */
  playhead: z.number().min(0).default(0),
});

export type AIEditRequest = z.infer<typeof aiEditRequestSchema>;

// ─── Prompt construction ───────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are Reelio's AI video-editing assistant powered by NVIDIA NIM reasoning.
You receive real media intelligence evidence (timeline clips, transcript segments, detected silence intervals, filler-word timestamps, playhead time) and a user editing instruction.
You must reason strictly over the provided evidence and return a validated JSON edit plan.

RESPONSE FORMAT — you must return valid JSON only, no prose, no markdown fences:
{
  "summary": "<clear, honest, concise description of all changes and exact time saved>",
  "operations": [ ... ]
}

OPERATION TYPES (use only these):

1. removeRanges — cut timestamp ranges from the timeline and ripple-close the gap:
   {"type":"removeRanges","ranges":[{"start":<sec>,"end":<sec>}],"reason":"<why>"}
   Use for:
   - "Remove long pauses / silence": use the exact DETECTED SILENCE RANGES provided.
   - "Remove filler words": use the exact DETECTED FILLER WORDS ranges provided.
   - "Remove first X seconds / Cut intro": {"type":"removeRanges","ranges":[{"start":0,"end":X}],"reason":"Remove initial segment"}
   - "Remove last X seconds / Cut outro": {"type":"removeRanges","ranges":[{"start":<totalDuration - X>,"end":<totalDuration>}],"reason":"Remove ending segment"}
   - "Detect and remove restart phrases / false takes": identify earlier failed attempts in transcript and remove them.

2. keepRanges — keep only specified key highlight spans (inverse cut, for short-form summaries):
   {"type":"keepRanges","ranges":[{"start":<sec>,"end":<sec>}],"reason":"<why>"}
   Use for:
   - "Make this a 30 second short" / highlight reel: select the most coherent, speech-dense ranges whose sum of durations is <= target duration (e.g. <= 30.0s).

3. trimClip — trim one edge of a clip:
   {"type":"trimClip","clipId":<int>,"edge":"start"|"end","toTime":<sec>,"ripple":false}

4. moveClip — reposition a clip on the timeline:
   {"type":"moveClip","clipId":<int>,"timelineStart":<sec>,"ripple":false}

5. removeClips — delete entire clips:
   {"type":"removeClips","clipIds":[<int>...],"ripple":true}

6. splitClip — split one clip into two:
   {"type":"splitClip","clipId":<int>,"atTime":<sec>}
   Use for: "Split this clip at playhead" -> split at the provided playhead time if it intersects a clip. Or at specific timestamp.

7. setClipProps — change clip visibility/mute/lock:
   {"type":"setClipProps","clipId":<int>,"visible":<bool>,"muted":<bool>}

8. addCaptions — add timestamped subtitle cues:
   {"type":"addCaptions","cues":[{"text":"<caption text>","startTime":<sec>,"endTime":<sec>}],"replaceExisting":true}

CRITICAL RULES:
- All times are in seconds (floating point numbers).
- clipId must be an integer that exists in the provided clip list.
- For removeRanges and keepRanges, start must be < end and both >= 0.
- For "summary", state clearly the exact timestamps affected and time saved.
- Return ONLY the raw JSON object — no explanation text outside the JSON.`;
}

function buildUserPrompt(req: AIEditRequest): string {
  const totalDuration = req.clips.reduce(
    (max, c) => Math.max(max, c.timelineStart + c.duration),
    0,
  );

  const clipsSummary = req.clips
    .map(
      (c) =>
        `  clip ${c.id}: "${c.assetName}" track=${c.trackType}${c.trackId} ` +
        `start=${c.timelineStart.toFixed(3)}s duration=${c.duration.toFixed(3)}s ` +
        `sourceStart=${c.sourceStart.toFixed(3)}s`,
    )
    .join("\n");

  const assetsSummary = req.assets
    .map(
      (a) =>
        `  asset ${a.id}: "${a.name}" type=${a.mimeType} duration=${a.duration.toFixed(3)}s ` +
        `${a.width}x${a.height} fps=${a.fps} hasAudio=${a.hasAudio}`,
    )
    .join("\n");

  const silenceRanges = req.silenceRanges ?? [];
  const fillerWords = req.fillerWords ?? [];
  const transcriptSegments = req.transcriptSegments ?? [];

  const silenceSummary =
    silenceRanges.length > 0
      ? silenceRanges.map((r) => `  ${r.start.toFixed(3)}s–${r.end.toFixed(3)}s (${(r.end - r.start).toFixed(2)}s)`).join("\n")
      : "  (none detected)";

  const fillerSummary =
    fillerWords.length > 0
      ? fillerWords.map((f) => `  "${f.text}": ${f.start.toFixed(3)}s–${f.end.toFixed(3)}s (${f.duration.toFixed(2)}s)`).join("\n")
      : "  (none detected)";

  const transcriptSummary =
    transcriptSegments.length > 0
      ? transcriptSegments.map((t) => `  [${t.start.toFixed(2)}s–${t.end.toFixed(2)}s] ${t.text}`).join("\n")
      : "  (no transcript available)";

  return `TIMELINE (total duration: ${totalDuration.toFixed(3)}s, playhead: ${req.playhead.toFixed(3)}s):
${clipsSummary || "  (no clips)"}

ASSETS:
${assetsSummary || "  (none)"}

MEDIA INTELLIGENCE EVIDENCE:
Detected Silence Ranges:
${silenceSummary}

Detected Filler Words:
${fillerSummary}

Transcript Segments:
${transcriptSummary}
${req.targetDuration ? `Target Duration Constraint: <= ${req.targetDuration} seconds` : ""}

USER INSTRUCTION: ${req.instruction}

Respond with a JSON edit plan only.`;
}

// ─── Main entry point ──────────────────────────────────────────────────────

export interface AIEditResult {
  plan: EditPlan;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * Calls NVIDIA NIM and returns a validated EditPlan.
 * Throws if the provider is unavailable, the network fails, or the model
 * output fails schema validation.
 */
export async function requestAIEdit(req: AIEditRequest): Promise<AIEditResult> {
  const provider = getAIProvider();

  if (!provider.isAvailable()) {
    throw new Error(
      "AI editing is not available: NVIDIA_API_KEY is not configured on this server.",
    );
  }

  const parsedReq = aiEditRequestSchema.parse(req);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(parsedReq);

  const result = await provider.complete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    {
      responseFormat: "json",
      maxTokens: 2048,
      temperature: 0.1,
    },
  );

  // Parse raw JSON
  let raw: unknown;
  try {
    raw = JSON.parse(result.content);
  } catch {
    // Try to extract JSON from response if model added prose
    const match = result.content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `NVIDIA NIM returned non-JSON content: ${result.content.slice(0, 200)}`,
      );
    }
    try {
      raw = JSON.parse(match[0]);
    } catch {
      throw new Error(`Could not parse JSON from NVIDIA NIM response`);
    }
  }

  // Validate with Zod — rejects invalid operation types, out-of-bound clips, etc.
  const plan = editPlanSchema.parse(raw);

  return {
    plan,
    model: result.model,
    usage: result.usage,
  };
}
