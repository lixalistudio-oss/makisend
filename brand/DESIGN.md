# MakiSend

Brand kit for the MakiSend logo and brand materials. The interface system (every token, component and screen rule) lives in [`../DESIGN.md`](../DESIGN.md); the hex values below are copied from it, never invented here.

**When you use a design skill** (logo-design, impeccable, design-taste-frontend or any other): follow this file where it conflicts with the skill's own choices. For the interface, the root `DESIGN.md` wins.

MakiSend sends transactional email (password resets, receipts, invitations, alerts) from Cloudflare Workers, for developers and small product teams. The brand reads as **mail, quietly handled**: calm, exact, trustworthy. Not fast, loud, playful or "AI".

## Colors

| Role | Hex | Use |
|------|-----|-----|
| Primary, brand green | `#0f6b4f` | Logo tile on light surfaces. In materials: links, the active or selected state, one highlight per surface. |
| Primary foreground | `#ffffff` | Symbol drawn inside the green tile. Text on green. |
| Neutral, ink | `#151515` | Wordmark on light, body text, mono black logo, primary buttons (never green). |
| Neutral, background | `#ffffff` | Default surface behind the logo. |
| Neutral, surface muted | `#f5f5f5` | Second light surface; the Horizontal logo also works here. |
| Dark primary | `#53dca6` | Logo tile on dark surfaces only. Disappears on light. |
| Dark primary foreground | `#0b1f17` | Symbol inside the dark-primary tile. |
| Dark background | `#1b1b1b` | Dark surface and test background for every inverse logo. |
| Dark foreground | `#f3f3f3` | Text on dark surfaces. The inverse wordmark is pure `#ffffff`. |

No other colors in the logo. Status colors (success `#0f7a3f`, warning `#946200`, danger `#c4282e`) belong to the interface, never to the brand.

## Typography

| Font | Usage | Weight |
|------|-------|--------|
| Geist | Wordmark (outlined, tracking `-0.03em`), headlines 30px and up | 500 for the wordmark; 400 or 500 for headlines |
| Inter | Body, labels, captions, headlines under 30px | 400 or 500 |
| Geist Mono | Code, API keys, commands, SMTP hosts | 400 |

All three are open source (SIL Open Font License). Fallback for Geist: Inter, then `system-ui`. Never 600 or bold, never uppercase, no wide tracking.

## Logos

Masters are SVG, transparent, text outlined, in [`../frontend/public/brand/`](../frontend/public/brand/). Named the way you would ask for them:

- **Horizontal**, on white or `#f5f5f5`: [`makisend-horizontal.svg`](../frontend/public/brand/makisend-horizontal.svg). The default.
- **Horizontal, on dark** (`#1b1b1b` or darker): [`makisend-horizontal-inverse.svg`](../frontend/public/brand/makisend-horizontal-inverse.svg)
- **Horizontal, white** (photos, video, green or busy backgrounds): [`makisend-horizontal-mono-white.svg`](../frontend/public/brand/makisend-horizontal-mono-white.svg)
- **Horizontal, black** (one-color print, forms): [`makisend-horizontal-mono-black.svg`](../frontend/public/brand/makisend-horizontal-mono-black.svg)
- **Stacked**, on white (hero, social profile): [`makisend-stacked.svg`](../frontend/public/brand/makisend-stacked.svg)
- **Stacked, on dark**: [`makisend-stacked-inverse.svg`](../frontend/public/brand/makisend-stacked-inverse.svg)
- **Symbol** (favicon, avatar, app icon): [`makisend-symbol.svg`](../frontend/public/brand/makisend-symbol.svg)
- **Symbol, one color** (print, embossing): [`makisend-symbol-mono.svg`](../frontend/public/brand/makisend-symbol-mono.svg)
- **Wordmark only** (next to a symbol already on the page): [`makisend-wordmark.svg`](../frontend/public/brand/makisend-wordmark.svg)

On dark backgrounds use **Horizontal, on dark** or **Stacked, on dark**; on photos use **Horizontal, white**.

Web exports, made from the Symbol: `favicon.svg`, `favicon.ico` (16, 32, 48), `apple-touch-icon.png` (180, opaque, square corners), `icon-192.png`, `icon-512.png`, `site.webmanifest`, `makisend-og.png` (1200x630, Horizontal on white), all in `frontend/public/`. In the app: `frontend/src/components/makisend-mark.tsx` and `makisend-wordmark.tsx`.

**The symbol** is one white stroke inside the green tile that draws an envelope and, where its flap folds in, the letter M. It is the approved mark; the files above are the masters.

## Layout values

| Value | Logo | Brand materials and interface |
|-------|------|------|
| Grid | Symbol on a 32-unit grid (256 when drawing) | 4px: 4, 8, 12, 16, 24, 32, 48, 64, 96, 120 |
| Corner radius | Tile 8 of 32 (25%), equal corners | Controls 18px, panels 26px, cards 34px, pills 9999px |
| Stroke | 2 of 32 (6.25%), round joins | 1px borders |
| Spacing | Symbol to wordmark: 0.25x the tile. Wordmark cap height 0.47x the tile, optically centered on it | 16px inside a group, 24px between regions |
| Clear space | Half the tile on every side | |
| Max width | | Content container 1200px; forms 640 to 720px |
| Minimum size | Symbol 16px; Horizontal 96px wide (mono 120px); Stacked 64px; Wordmark 80px | Controls 44px high |

## Rules

1. The logo uses only the Colors table. Green is the tile, never the wordmark, a heading or a page background.
2. The symbol is the envelope-M stroke inside the rounded green tile: flat, one color, no gradient, shadow, glow, outline or 3D. Use the master files; never redraw it.
3. At 16px the symbol still reads as an envelope and an M. Check it at 16, 24, 32, 48 and 96px, on `#ffffff` and on `#1b1b1b`, before shipping.
4. Never add to the symbol: no @ sign, paper plane, speed trail, shield, network nodes or rocket.
5. The name is written **MakiSend**: one word, capital M and S, never uppercase, never with a space or a hyphen.
6. The wordmark is drawn once in outlined Geist Medium and reused; no asset retypes "MakiSend" as live text. No tagline, URL or version in the lock-up.
7. Master SVGs contain no live text, no font references, no embedded raster and no filters. One-color variations use real holes (`fill-rule="evenodd"`), not masks.
8. Scale the whole file; never stretch, rotate, recolor or rearrange the parts. Below a variation's minimum size, switch to the Symbol.
9. The wordmark has 4.5:1 contrast with its background; the symbol has 3:1 at the tile edge.
10. A logo next to the text "MakiSend" is `aria-hidden="true"`. A logo alone in a link gets `aria-label="MakiSend"`.
