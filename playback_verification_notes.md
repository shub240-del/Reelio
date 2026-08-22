# Playback verification notes

- Editor loaded persisted project `/editor/1` with two real 3-second MP4 assets and timeline clips.
- Browser transport interaction advanced the displayed playhead and the preview rendered the real blue fixture media.
- Controlled browser inspection found the main preview video advanced from 0 to approximately 0.50 seconds while playing, with `paused: false`, `duration: 3`, and a blob URL source.
- The same preview later reached `currentTime: 3`, `ended: false`, and `paused: true` after the controlled run.
- The timeline displayed persisted clips and a one-minute display ruler; no media substitution was observed.
- Gap/next-clip auto-advance still requires a targeted browser check; the preview did not visibly advance to a second clip during the first controlled run, so playback phase is not yet classified as fully verified.

Next diagnostic: inspect persisted timeline clip start/duration ordering and exercise playback at a known clip boundary and gap.

Recorded 2026-08-22.

Additional browser result: after visible play from the start, the displayed playhead reached `00:03.00`; the main preview source changed to a different blob-backed video with `currentTime: 0` and `duration: 3`, proving the next clip mounted, but it was paused. This exposes an autoplay handoff race still to fix; multi-clip playback is currently PARTIAL, not fully verified.
