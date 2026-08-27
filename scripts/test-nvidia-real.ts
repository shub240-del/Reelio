import "dotenv/config";
import { requestAIEdit } from "../server/aiEdit";
import { getAIProvider } from "../server/_core/nvidia";
import { applyEditOps, editPlanSchema } from "../shared/editOps";

async function main() {
  console.log("=== Testing Real NVIDIA NIM Integration ===");
  const provider = getAIProvider();
  console.log("Provider isAvailable:", provider.isAvailable());
  if (!provider.isAvailable()) {
    console.error("NVIDIA_API_KEY is not configured!");
    process.exit(1);
  }

  const sampleClips = [
    {
      id: 1,
      assetId: 1,
      trackType: "video" as const,
      trackId: 0,
      timelineStart: 0,
      duration: 30,
      sourceStart: 0,
      sortIndex: 0,
      locked: false,
      visible: true,
      muted: false,
    },
    {
      id: 2,
      assetId: 2,
      trackType: "video" as const,
      trackId: 1,
      timelineStart: 10,
      duration: 15,
      sourceStart: 0,
      sortIndex: 1,
      locked: false,
      visible: true,
      muted: false,
    },
  ];

  const sampleClipsWithNames = [
    { ...sampleClips[0], assetName: "interview-take-1.mp4" },
    { ...sampleClips[1], assetName: "b-roll-nature.mp4" },
  ];

  const sampleAssets = [
    {
      id: 1,
      name: "interview-take-1.mp4",
      mimeType: "video/mp4",
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
    },
    {
      id: 2,
      name: "b-roll-nature.mp4",
      mimeType: "video/mp4",
      duration: 40,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
    },
  ];

  const assetMap = new Map<number, { duration: number; hasAudio: boolean }>();
  assetMap.set(1, { duration: 60, hasAudio: true });
  assetMap.set(2, { duration: 40, hasAudio: false });

  const silenceRanges = [
    { start: 4.2, end: 7.8 },
    { start: 18.5, end: 22.1 },
  ];

  const fillerWords = [
    { text: "um", start: 2.1, end: 2.6, duration: 0.5 },
    { text: "like", start: 11.2, end: 11.7, duration: 0.5 },
  ];

  const transcriptSegments = [
    { start: 0.0, end: 4.2, text: "Welcome back everyone to our weekly show." },
    { start: 7.8, end: 18.5, text: "Today we are diving into generative AI workflows for modern video creators." },
    { start: 22.1, end: 30.0, text: "Let's inspect the timeline and assemble our final highlight cut." },
  ];

  const testPrompts = [
    { title: "1. Remove the first 5 seconds", prompt: "Remove the first 5 seconds." },
    { title: "2. Remove silence from the video", prompt: "Remove silence from the video." },
    { title: "3. Remove filler words", prompt: "Remove filler words." },
    { title: "4. Split the clip at 10 seconds", prompt: "Split the clip at 10 seconds." },
    { title: "5. Move this clip 5 seconds later", prompt: "Move clip 1 to start at 5 seconds." },
    { title: "6. Generate captions", prompt: "Generate captions for the video." },
    { title: "7. Make a short-form version", prompt: "Make a 15-second short-form highlight version of this video.", targetDuration: 15 },
  ];

  for (const t of testPrompts) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Testing: ${t.title}`);
    console.log(`Prompt: "${t.prompt}"`);

    const result = await requestAIEdit({
      instruction: t.prompt,
      clips: sampleClipsWithNames,
      assets: sampleAssets,
      silenceRanges,
      fillerWords,
      transcriptSegments,
      targetDuration: t.targetDuration,
      playhead: 10.0,
    });

    console.log(`Model used: ${result.model}`);
    console.log(`Tokens used: prompt=${result.usage.promptTokens}, completion=${result.usage.completionTokens}`);
    console.log(`Plan summary: ${result.plan.summary}`);
    console.log(`Operations count: ${result.plan.operations.length}`);
    console.log(`Operations:`, JSON.stringify(result.plan.operations, null, 2));

    // Validate with Zod
    editPlanSchema.parse(result.plan);

    // Apply plan through deterministic timeline engine
    const applyResult = applyEditOps(
      sampleClips,
      assetMap,
      result.plan.operations,
    );

    console.log(`applyEditOps success!`);
    console.log(`- Resulting clips count: ${applyResult.clips.length}`);
    console.log(`- Applied ops count: ${applyResult.applied.length}`);
    console.log(`- Side effects count: ${applyResult.sideEffects.length}`);
    console.log(`- Skipped ops: ${applyResult.skipped.length}`);
  }

  console.log(`\n==================================================`);
  console.log(`ALL 7 REAL NVIDIA NIM PROMPTS TESTED & PASSED SUCCESSFULLY!`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
