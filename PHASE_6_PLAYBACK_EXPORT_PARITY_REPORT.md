# Phase 6 — Playback / Export Parity Slice

**Date:** 2026-08-30  
**Scope:** Track mute/visibility behavior and guest persistence. This is a focused slice of P0, not completion of the full playback/export matrix.

## Files changed

| File | Change |
|---|---|
| `client/src/pages/Editor.tsx` | Track mute and visibility now influence audio preview, video preview muting, and browser export filtering. Track control state is restored from and persisted to guest-project localStorage. |
| `PHASE_6_PLAYBACK_EXPORT_PARITY_REPORT.md` | Records the implementation and evidence. |

## Functionality implemented

The existing track controls now have consequences beyond their visual state. Audio track visibility and mute state are applied to the shared preview synchronization path. The video track mute state mutes the active video element’s embedded audio, while video track visibility excludes the track from export. Export audio collection now filters clip mute, clip visibility, track mute, and track visibility consistently for video-embedded audio and standalone audio clips.

Track controls are persisted per project in `localStorage` under `reelio-track-states-{projectId}` and restored when the editor mounts. This preserves the existing local guest workflow and does not replace the canonical clip/timeline architecture.

## Existing functionality preserved

The Reelio branding, three-column editor layout, timeline component, clip-level state, AI EditOps, history utilities, media engine, and export architecture were preserved. No reference-site assets or styling were copied. No unrelated subsystem was redesigned.

## Validation performed

| Check | Result |
|---|---|
| `pnpm check` | **PASS** |
| `pnpm test` | **PASS** — 238 tests across 14 suites |
| `pnpm build` | **PASS** |
| Local landing page | **PASS** — loaded at `http://localhost:3000/` |
| Local projects route | **PASS** — guest projects loaded at `/projects` |
| Local editor route | **PASS** — editor loaded at `/editor/1` with track controls visible |

## Browser verification status

The local editor route was smoke-tested after the change and loaded without a visible runtime failure. A real-media browser acceptance run for toggling each track state, observing audible/visible preview consequences, reloading, exporting, and inspecting the downloaded file has **not** been completed in this slice. Therefore the feature remains **PARTIAL** rather than VERIFIED under the supplied operating rule.

## Known limitations

Track state is currently persisted in guest localStorage rather than the server/database canonical timeline schema, so authenticated cross-device persistence is not covered. The full P0 matrix remains open for trim, split, gaps, multiple clips, captions, transitions, exact duration, and downloaded-file inspection. Audio FX cards remain intentionally unchanged and are still mock behavior; they are a separate P1 subsystem.

## Before / after audit status

| Capability | Before | After |
|---|---|---|
| Track mute preview consequence | **UNKNOWN / PARTIAL** | **PARTIAL** — connected to audio preview logic; real browser audio verification remains open. |
| Track visibility preview consequence | **PARTIAL** | **PARTIAL** — connected to active audio/video preview selection; real browser verification remains open. |
| Track mute export consequence | **UNKNOWN** | **PARTIAL** — filtered during export audio collection; downloaded-file inspection remains open. |
| Track visibility export consequence | **PARTIAL** | **PARTIAL** — video/audio tracks are filtered during export; downloaded-file inspection remains open. |
| Guest persistence of track controls | **MISSING / UNKNOWN** | **PARTIAL** — localStorage restore/save added; reload browser proof remains open. |

## Next subsystem gate

Do not move to Audio FX until a real-media browser acceptance matrix proves the track controls through preview, persistence, undo/redo where applicable, and exported-file consequences. The next P0 work should complete that matrix and verify exact duration with `ffprobe` and a native browser player.
