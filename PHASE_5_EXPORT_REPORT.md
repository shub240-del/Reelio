# Reelio Export Verification Report

## Scope

The editor Export button now runs a real browser-side renderer using `HTMLCanvasElement.captureStream()` and `MediaRecorder`. It consumes the current visible video clips, source offsets, timeline positions, clip order, and gaps. Gaps are rendered as black frames. The output is a newly encoded WebM file; it is not the original source download or a placeholder.

## Browser verification

| Capability | Classification | Evidence |
|---|---|---|
| Export action | **REAL / VERIFIED** | Clicking Export changed the button to `Exporting…`, then displayed `Exported 24 KB WebM`. |
| Actual download | **REAL / VERIFIED** | Chrome Downloads showed `Guest Verification Project.webm` from the local editor. |
| Non-empty output | **REAL / VERIFIED** | The downloaded file was 24 KB. `ffprobe` identified a VP9 video stream at 320x180. |
| Browser decoding | **REAL / VERIFIED** | Opening the downloaded WebM produced a native video element with readyState 4 and 320x180 dimensions. |
| Output playback | **REAL / VERIFIED** | Calling the native video element’s play method advanced currentTime to approximately 0.70s with `paused=false`. |
| Timeline source consumption | **REAL / VERIFIED** | The renderer selected the real persisted MP4 clip, sought source time according to the clip’s sourceStart and timeline position, drew decoded frames to the canvas, and recorded the canvas stream. |
| Audio in output | **PARTIAL** | The current renderer records the video canvas stream and does not mix timeline audio into the output. |
| Trim/split/mute/visibility output matrix | **PARTIAL** | The renderer has geometry and visibility inputs, but this browser run verified a real MP4 export rather than the complete trim/split/mute matrix. |
| Output duration metadata | **PARTIAL** | The browser played the output, but the container reported duration N/A under ffprobe, so exact duration conformance remains unverified. |

## Regression checks

`pnpm check`, the focused editor/shared suite (**186/186**), and the production build all pass.

## Exact next milestone

Verify export against a deliberately trimmed and split real video timeline, including a gap and hidden/muted states, then add audio mixing if launch-level output requires audio. Do not classify full export parity as complete until the downloaded output’s duration and edits are independently verified.

**Prepared 2026-08-22.**
