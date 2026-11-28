---
version: alpha
name: MakiSend
description: Calm, neutral surfaces in the Arc UI system, one MakiSend green for what is active or selected, type and spacing carrying the hierarchy. Shared by the dashboard and the website.
colors:
  primary: "#151515"
  background: "#ffffff"
  surface: "#ffffff"
  surface-muted: "#f5f5f5"
  foreground: "#151515"
  text-secondary: "#5e5e5e"
  text-muted: "#6e6e6e"
  border: "#ebebeb"
  border-subtle: "#f4f4f4"
  border-strong: "#c7c7c7"
  accent: "#0f6b4f"
  accent-strong: "#0b5640"
  accent-subtle: "#e3efe9"
  accent-foreground: "#ffffff"
  success: "#0f7a3f"
  warning: "#946200"
  danger: "#c4282e"
  dark-background: "#1b1b1b"
  dark-surface: "#222222"
  dark-surface-muted: "#2c2c2c"
  dark-foreground: "#f3f3f3"
  dark-text-secondary: "#b9b9b9"
  dark-border: "#333333"
  dark-accent: "#53dca6"
  dark-accent-foreground: "#0b1f17"
typography:
  display-xl:
    fontFamily: Geist
    fontSize: 4.5rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  display-lg:
    fontFamily: Geist
    fontSize: 3.25rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  display-md:
    fontFamily: Geist
    fontSize: 2.25rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  heading:
    fontFamily: Inter
    fontSize: 1.375rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body-lg:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  label:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  caption:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.4
  code:
    fontFamily: Geist Mono
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: 18px
  panel: 26px
  surface: 34px
  pill: 9999px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "6": 24px
  "8": 32px
  "12": 48px
  "16": 64px
  "24": 96px
  "30": 120px
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.control}"
    height: 44px
    padding: 0 16px
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: 44px
    padding: 0 16px
  button-ghost:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: 44px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.surface}"
    padding: 24px
  panel:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.panel}"
  nav-item-active:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.control}"
  link:
    backgroundColor: "{colors.background}"
    textColor: "{colors.accent}"
  badge-accent:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.pill}"
  badge-success:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
  badge-warning:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
  badge-danger:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
  selected-control:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.pill}"
  caption-text:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text-muted}"
  divider:
    backgroundColor: "{colors.border}"
  divider-subtle:
    backgroundColor: "{colors.border-subtle}"
  input-border:
    backgroundColor: "{colors.border-strong}"
  dark-page:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-foreground}"
  dark-card:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text-secondary}"
  dark-panel:
    backgroundColor: "{colors.dark-surface-muted}"
    textColor: "{colors.dark-foreground}"
  dark-divider:
    backgroundColor: "{colors.dark-border}"
  dark-selected-control:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-accent-foreground}"
---

## Overview

MakiSend is a tool people run for themselves: a dashboard they open to check that mail went out, and a website that convinces a developer to install it. Both follow **Arc UI** (uiarc.dev): a calm, neutral interface where type, spacing, and one considered interaction carry the character. The only brand color is **MakiSend green**, and it is spent sparingly.

This file is the single source of truth for both surfaces:

- the **dashboard** (`frontend/` in this repository, shadcn/ui on Tailwind 4) maps these tokens onto its shadcn variables in `frontend/src/styles/global.css`;
- the **website** (`lixalistudio-oss/makisend-website`, Arc components) loads Arc's `foundation.css` and overrides its accent with these values.

Change a token here first, then in both places. Arc's own rules (`https://uiarc.dev/r/skills/arc/SKILL.md`) apply everywhere this file is silent.

The logo has its own brief, variations and usage rules in [`brand/DESIGN.md`](brand/DESIGN.md).

## Colors

Neutral surfaces, meaningful color. Most of every screen is white, near-black text and hairline grey borders.

- **Primary (#151515):** near-black. Body text and the fill of the one primary button per surface. A primary button is not green.
- **Text secondary (#5e5e5e) and muted (#6e6e6e):** descriptions, metadata, captions. Both pass 4.5:1 on white and on surface-muted.
- **Border (#ebebeb), subtle (#f4f4f4), strong (#c7c7c7):** default lines, dividers inside a surface, input outlines.
- **Accent, MakiSend green (#0f6b4f):** the active navigation item, a selected option or row, progress, links, the one chart series that matters. Tint with **accent-subtle (#e3efe9)** behind accent text. White on green is 6.5:1. Never color a heading, a card background or every icon with it.
- **Status (success #0f7a3f, warning #946200, danger #c4282e):** only when something succeeded, needs attention or failed, always with a text label ("Sent", "Retrying", "Failed"). Never green for "nice" or red for "important".
- **Dark theme:** background #1b1b1b, surfaces #222222 and #2c2c2c, text #f3f3f3 and #b9b9b9, border #333333, accent #53dca6 with dark text on it. Every screen is checked in both themes.

## Typography

- **Geist** (display) for headings 30px and up, weight 400 or 500, tracking -0.03em, line height 1.1.
- **Inter** (body) for body, labels, controls, table text and headings under 30px, weight 400 or 500, tracking -0.01em, line height 1.4.
- **Geist Mono** for code, API keys, ids, commands, SMTP hosts.
- Sizes from the scale only: 12, 14, 16, 18, 22, 28, 36, 52, 72px.
- **Weights 400 and 500 only.** Never 600 or bold: hierarchy comes from size, color and spacing.
- Numbers that change or align in columns (counts, rates, durations) use `font-variant-numeric: tabular-nums`.
- No uppercase, no wide letter-spacing on small labels, no eyebrow line above a heading.

## Layout

- A 4px grid: 4, 8, 12, 16, 24, 32, then 48, 64, 96, 120 for sections.
- **Dashboard:** one page container (max width 1200px), page padding 24 to 32px (16px on phones), 16px inside a group, 24px between regions, 32 to 48px between sections of a long form. Forms and settings read at 640 to 720px; tables and charts use the full width.
- **Website:** sections breathe with 64 to 120px of vertical padding (64px on phones), one idea per section, the same container and gutters on every section.
- Controls are 44px high by default (36px small, 50px large); touch targets never go under 44px.
- Grid and flex children get `min-width: 0`; wide tables scroll inside their card, never the page.

## Elevation & Depth

- Group with proximity first, a 1px border second, a card only for a real boundary.
- **Cards rest on a border with no shadow.** Shadows belong to layers that float: menus, popovers, dialogs, sheets, toasts.
- No glows, colored shadows or decorative gradients inside the product. The website may use one soft mesh behind its hero, nothing else.

## Shapes

Generous, concentric corners:

- **18px** controls (buttons, inputs, selects), **26px** panels (menus, nested panels), **34px** surfaces (cards, dialogs), **pill** for badges and status marks.
- A nested corner is the outer radius minus the padding between them, so the curves stay parallel (a 34px card with 8px padding holds 26px panels). Clamp at 6px.
- Sibling cards share edges: same top, same height, a real 16 to 24px gap or one bordered group with hairline dividers.

## Components

- **Buttons.** One primary (near-black) per surface; every other action is secondary (bordered), ghost or danger. Labels are a verb plus an object: "Save changes", "Create API key", "Send test email", "Copy prompt".
- **Navigation.** The active item takes the accent-subtle fill and the accent-strong label; the rest stay neutral.
- **Status badges.** A pill with a faint tint and colored text, always with its word: Sent, Queued, Retrying, Failed, Test.
- **Tables.** Inter 14px, tabular numbers, `border-subtle` row dividers, the header in text-secondary at the same size (not uppercase).
- **Code and secrets.** Geist Mono on surface-muted in a panel, with a copy button that confirms in place ("Copied").
- **Feedback.** Confirm a foreground action in place (the button label, the row, the value); a toast only reports background work. Empty states say why and offer one next step. Errors say what happened and how to fix it, next to the cause.
- **Motion.** Transform and opacity only, Arc's motion tokens (snappy for presses, smooth for panels), one movement per interaction, a reduced-motion branch for every animation.

## Do's and Don'ts

- Do write sentence case everywhere, buttons and table headers included.
- Do spend the green on what is active, selected or in progress, and on links.
- Do check light and dark themes, and widths 390, 768, 1024 and 1440.
- Do confirm in place and keep claims true (no invented numbers, users or logos).
- Don't put an eyebrow or kicker above a heading, or use uppercase.
- Don't use em dashes in copy: a period, comma, colon or parentheses instead.
- Don't use weights 600 or 700, raw hex in components, or Tailwind palette classes.
- Don't add a shadow to a resting card, an icon inside a rounded tile, or a nested card.
- Don't make a primary button green, or a second primary button on the same surface.
