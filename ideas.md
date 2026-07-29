# Reelio — Design System

Reelio is an AI-first video editor. The product promise is that raw footage becomes a
clean first cut in minutes, and that the AI is an *editor* — it makes real edits to a
real timeline — not a chatbot that describes edits.

This document is the source of truth for how Reelio looks and behaves. It is original
work. Reelio does not replicate any other product's identity, illustrations or copy.

## Design principles

1. **Show, don't tell.** Every feature claim is demonstrated with a live, code-drawn
   visualization — a real before/after, a real waveform, a real timeline. Never a
   screenshot, never stock imagery.
2. **The dark room.** Editors work in dark rooms so footage reads true. The UI recedes;
   the video and the waveform are the only saturated things on screen.
3. **Earn every pixel.** No decoration that does not carry information. Motion exists to
   explain state change, never to entertain.
4. **Fast beats fancy.** Perceived speed is a feature. Nothing blocks on the network that
   could be computed locally.

## Color system

Defined once in `client/src/index.css` as CSS custom properties. Change
`--reelio-violet` / `--reelio-cyan` and the entire product rethemes.

| Token | Value | Use |
| --- | --- | --- |
| `--reelio-violet` | `oklch(0.62 0.22 285)` ≈ `#7c5cff` | Primary actions, focus rings, active states |
| `--reelio-violet-hi` | `oklch(0.68 0.21 285)` | Hover |
| `--reelio-cyan` | `oklch(0.78 0.14 195)` ≈ `#22d3ee` | Secondary accent, data, waveforms, step numerals |
| `--reelio-ink` | `oklch(0.1 0.012 275)` | Page background |
| `--reelio-surface` | `oklch(0.145 0.012 275)` | Cards |
| `--reelio-surface-hi` | `oklch(0.19 0.012 275)` | Elevated / hover surfaces |
| `--reelio-hairline` | `oklch(1 0 0 / 8%)` | Borders and dividers |

The violet→cyan gradient is Reelio's signature. It appears in the logo mark, on primary
CTAs and along the active playhead. Used sparingly — a gradient everywhere is a gradient
nowhere.

Semantic colors stay conventional so they read instantly in an editing context:
green for accepted/clean audio, amber for suggestions awaiting review, red for
destructive and for problem regions (filler words, dead air).

## Typography

Font stack: `Inter`, then system sans. Weights 400/500/600/800.

| Role | Size | Weight | Tracking |
| --- | --- | --- | --- |
| Display (hero) | `clamp(2.75rem, 6vw, 4.5rem)` | 800 | `-0.03em` |
| Section heading | `clamp(1.75rem, 3vw, 2.5rem)` | 800 | `-0.02em` |
| Card title | `1.0625rem` | 600 | `-0.01em` |
| Body | `0.9375–1rem` | 400 | normal |
| Eyebrow / label | `0.6875rem` | 600 | `0.08em`, uppercase |

Tight negative tracking on large text is what makes the type feel engineered rather than
default. Body copy stays at normal tracking for legibility.

## Layout and spacing

- Content column: `max-width: 1200px`, gutter `1.5rem` (mobile) → `2rem`.
- Vertical rhythm between sections: `5rem` mobile → `7rem` desktop.
- Spacing scale is Tailwind's 4px base. Prefer 4 / 6 / 8 / 12 / 16 / 24.
- Card radius `1rem`; control radius `0.5rem`; pill radius `full`.
- Borders are 1px `--reelio-hairline`. Elevation comes from surface lightness and a
  soft ambient shadow, never from heavy strokes.

## Motion

- Durations: 150ms (control feedback), 250ms (surface/hover), 400–600ms (entrance).
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` for entrances; `ease-out` for hovers.
- Scroll entrances translate 12–16px and fade; stagger siblings by 60ms.
- **Every animation must be gated behind `prefers-reduced-motion`.** Looping demo
  animations must stop entirely, not merely shorten.

## Component patterns

- **Feature card** — eyebrow label, title, one-line description, then a live
  visualization occupying the majority of the card. The visualization is the point.
- **Step card** — oversized cyan numeral, icon tile, title, description; connected by
  arrows on desktop, stacked on mobile.
- **Primary CTA** — violet fill, white text, 6px radius, `font-weight: 600`.
- **Secondary CTA** — transparent fill, hairline border, text `zinc-200`.

## Accessibility floor

Non-negotiable, verified per milestone:

- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries (WCAG AA).
- Every interactive element reachable and operable by keyboard, with a visible
  `:focus-visible` ring in `--reelio-violet`.
- A skip link to `#main` as the first focusable element.
- Decorative visuals `aria-hidden`; informative ones carry a text equivalent.
- Timeline and player expose ARIA roles and keyboard controls, not just mouse affordances.
