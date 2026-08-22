import { editPlanSchema, type EditPlan } from "../../../shared/editOps";
import type { TimelineClip } from "../../../shared/timeline";

/**
 * Deterministic first-step planner for the editor AI path.
 * The operation remains a real validated EditPlan, so a model can replace this
 * parser later without changing execution, history, or persistence semantics.
 */
export function planEditorRequest(request: string, clips: TimelineClip[], silenceRanges: { start: number; end: number }[] = []): EditPlan {
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
      summary: silenceRanges.length > 0
        ? `Remove ${silenceRanges.length} detected silent span${silenceRanges.length === 1 ? "" : "s"}.`
        : "No decodable silent spans were detected in the timeline audio.",
      operations: silenceRanges.length > 0 ? [{ type: "removeRanges", ranges: silenceRanges, reason: "Detected low-amplitude audio spans." }] : [],
    });
  }

  return editPlanSchema.parse({
    summary: `I can currently execute “Remove the first 5 seconds” on ${clips.length} timeline clip${clips.length === 1 ? "" : "s"}.`,
    operations: [],
  });
}
