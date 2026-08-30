# Third-Party Licenses & Attribution

## Reelio

Reelio is an original product built and owned by its author.
Reelio's AI editing copilot, Reelio design system, Reelio branding, and
product-level identity are original works.

The Reelio editing engine adapts open-source editor infrastructure as
described below.

---

## OpenCut

Reelio's editor architecture was developed with reference to, and partially
adapted from, the **OpenCut** open-source project.

- Upstream repository: https://github.com/OpenCut-app/OpenCut
- License: **MIT**

### MIT License Notice (OpenCut)

```
Copyright 2026 OpenCut

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Components & Classification

Reelio's relationship to OpenCut code is documented below.

| Reelio Module | Relationship to OpenCut | Notes |
|---|---|---|
| `shared/timeline.ts` | Original Reelio implementation | Pure deterministic timeline math written for Reelio |
| `shared/editOps.ts` | Original Reelio implementation | AI↔timeline EditOps contract written for Reelio |
| `client/src/editor/interaction.ts` | Original Reelio implementation | Delta-based drag/snap geometry written for Reelio |
| `client/src/editor/media.ts` | Original Reelio implementation | Browser media probing written for Reelio |
| `client/src/editor/history.ts` | Original Reelio implementation | Snapshot-based undo/redo written for Reelio |
| `client/src/editor/mediaIntelligence.ts` | Original Reelio implementation | AI grounding layer written for Reelio |
| `client/src/editor/silence.ts` | Original Reelio implementation | PCM Web Audio silence detection |
| `client/src/editor/captions.ts` | Original Reelio implementation | Caption cue generation written for Reelio |
| `client/src/editor/export.ts` | Original Reelio implementation | Canvas + MediaRecorder export pipeline |
| `server/_core/nvidia.ts` | Original Reelio implementation | NVIDIA NIM AIProvider abstraction |
| `server/aiEdit.ts` | Original Reelio implementation | Server-side AI edit orchestration |
| `client/src/components/editor/*` | Original Reelio implementation | All editor UI panels |
| `client/src/pages/Editor.tsx` | Original Reelio implementation | Editor orchestration shell |

No OpenCut source files were copied verbatim into Reelio. The OpenCut project
served as an architectural reference and engineering foundation for editor
design patterns. All Reelio code was written independently.

---

## Other Notable Open-Source Dependencies

All other third-party packages used by Reelio are listed in `package.json`
and governed by their own respective licenses (MIT, Apache 2.0, etc.).
Key dependencies include:

- **React** (MIT) — https://github.com/facebook/react
- **Vite** (MIT) — https://github.com/vitejs/vite
- **tRPC** (MIT) — https://github.com/trpc/trpc
- **Drizzle ORM** (Apache 2.0) — https://github.com/drizzle-team/drizzle-orm
- **Zod** (MIT) — https://github.com/colinhacks/zod
- **Tailwind CSS** (MIT) — https://github.com/tailwindlabs/tailwindcss
- **Lucide React** (ISC) — https://github.com/lucide-icons/lucide
- **Sonner** (MIT) — https://github.com/emilkowalski/sonner
- **Wouter** (MIT) — https://github.com/molefrog/wouter
- **nanoid** (MIT) — https://github.com/ai/nanoid

---

*This file was last updated: 2026-08-28*
