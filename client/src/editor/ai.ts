import {
  SUPPORTED_VIDEO_EFFECTS,
  editPlanSchema,
  type EditPlan,
} from "../../../shared/editOps";
import type { TimelineClip } from "../../../shared/timeline";

/**
 * Deterministic first-step planner for the editor AI path.
 * The operation remains a real validated EditPlan, so a model can replace this
 * parser later without changing execution, history, or persistence semantics.
 */
export function planEditorRequest(
  request: string,
  clips: TimelineClip[],
  silenceRanges: { start: number; end: number }[] = [],
  options: { playhead?: number; selectedClipIds?: number[] } = {}
): EditPlan {
  const normalized = request.trim().toLowerCase();
  if (/^remove the first 5 seconds?\.?$/.test(normalized)) {
    return editPlanSchema.parse({
      summary: "Remove the first 5 seconds from the timeline.",
      operations: [
        {
          type: "removeRanges",
          ranges: [{ start: 0, end: 5 }],
          reason: "User requested removal of the first five seconds.",
        },
      ],
    });
  }

  if (normalized === "remove silence" || normalized === "remove silence.") {
    return editPlanSchema.parse({
      summary:
        silenceRanges.length > 0
          ? `Remove ${silenceRanges.length} detected silent span${silenceRanges.length === 1 ? "" : "s"}.`
          : "No decodable silent spans were detected in the timeline audio.",
      operations:
        silenceRanges.length > 0
          ? [
              {
                type: "removeRanges",
                ranges: silenceRanges,
                reason: "Detected low-amplitude audio spans.",
              },
            ]
          : [],
    });
  }

  if (
    /^split (?:the )?(?:selected )?clip at (?:the )?playhead\.?$/.test(
      normalized
    )
  ) {
    const selected = new Set(options.selectedClipIds ?? []);
    const playhead = options.playhead ?? 0;
    const target =
      clips.find(clip => selected.has(clip.id)) ??
      clips.find(
        clip =>
          playhead > clip.timelineStart &&
          playhead < clip.timelineStart + clip.duration
      );
    return editPlanSchema.parse({
      summary: target
        ? `Split clip ${target.id} at ${playhead.toFixed(2)} seconds.`
        : "No editable clip intersects the playhead.",
      operations: target
        ? [{ type: "splitClip", clipId: target.id, atTime: playhead }]
        : [],
    });
  }

  const propertyRequest = normalized.match(
    /^(mute|unmute|remove|delete) (?:the )?selected clips?\.?$/
  );
  if (propertyRequest) {
    const selected = new Set(options.selectedClipIds ?? []);
    const targets = clips.filter(clip => selected.has(clip.id));
    const action = propertyRequest[1];
    return editPlanSchema.parse({
      summary: targets.length
        ? `${action} ${targets.length} selected clip${targets.length === 1 ? "" : "s"}.`
        : "No clips are selected.",
      operations:
        action === "remove" || action === "delete"
          ? targets.length
            ? [
                {
                  type: "removeClips",
                  clipIds: targets.map(clip => clip.id),
                  ripple: true,
                },
              ]
            : []
          : targets.map(clip => ({
              type: "setClipProps" as const,
              clipId: clip.id,
              muted: action === "mute",
            })),
    });
  }

  const effect = SUPPORTED_VIDEO_EFFECTS.find(candidate =>
    normalized.includes(candidate.toLowerCase())
  );
  if (effect && /(?:apply|add|use)/.test(normalized)) {
    const selected = new Set(options.selectedClipIds ?? []);
    const target = clips.find(
      clip => selected.has(clip.id) && clip.trackType === "video"
    );
    return editPlanSchema.parse({
      summary: target
        ? `Apply ${effect} to selected video clip ${target.id}.`
        : "No video clip is selected.",
      operations: target
        ? [{ type: "setVideoEffect", clipId: target.id, effect }]
        : [],
    });
  }

  return editPlanSchema.parse({
    summary: `This request is not in the verified guest command set. The timeline contains ${clips.length} clip${clips.length === 1 ? "" : "s"}.`,
    operations: [],
  });
}
