# CardGlow

CardGlow is a Figma plugin that turns frames into glossy gradient cards, like the "AI Consulting" and "AI Development" cards in the Vivasoft reference file. You pick one colour, then flip through 24 card styles with the **◀ ▶** buttons. Apply a style to existing cards, or create new cards with optional sample content.

Built with React, TypeScript and esbuild, the same setup as Gradify.

## What a card is made of

Measured from the reference cards (527 × 516 and 549 × 538):

| Part | Reference | CardGlow |
| --- | --- | --- |
| Corners | 53.8 px | 10.4% of the short side |
| Base fill | Linear gradient, light top left → colour at 55% → deep bottom right | Your colour's 35 / 50 / 68 scale steps |
| Accent | Radial glow at the bottom right (cyan on the blue card) | A lighter, hue-shifted shade of your colour |
| Highlight | White radial at the top left, 42% → 0% | Same |
| Border | 1.1 px inside, deeper shade | Same, scaled to the card width |
| Shadow | Soft coloured drop shadow | Same, scaled to the card width |
| Glows | Blurred white ellipse at the bottom, blurred light ellipse at the top | Same positions and blur, in a locked `CardGlow layers` group |
| Sparkle | Blurred white light ray at the top right | A blurred 8-point star |
| Glass elements | Icon tile and step pills: white 18–20% fill, 40–45% white border | **Make selection glass** |

## Features

- **Two-column window (820 × 640).** The left side shows a large live preview with the ◀ ▶ arrows on its edges, the style name and a grid of all 24 styles. The right side holds the colour, looks, colours, adjustments and the actions.
- **24 styles from one colour.** There are 8 looks, each with 3 light directions (left, right, top). The ◀ ▶ buttons or the ← → keys step through them, and **🎲** (or R) picks one at random.
- **Looks:** Glossy (the blue card), Velvet (the purple card), Frost (the tilted card: flat fill, bright glass border, deep shadow), Deep, Aurora (hue-shifted accents), Pastel, Neon and Satin.
- **Colour:** a built-in picker, a hex field, quick swatches (both reference cards and the file's colour scales), and **Use selection** to take the fill of a selected layer.
- **Change every colour.** The **Colours** panel lists every colour the current card uses, in three groups:
  - **Card:** gradient start, middle and end (or the fill), border and shadow.
  - **Glows:** accent glow, highlight, core glow and its edge (Velvet), second accent (Aurora), bottom glow, top glow and sparkle.
  - **Content** (when Sample content is on): text, glass, badge and badge number.

  Click a colour and its palette opens right under it: a **Shades** row (white, your colour's scale from light to dark, black), an **In this card** row with the colours the card already uses, and the full picker with a hex field. Edited colours are marked with a dot and have their own **×** to go back to the style's colour, and **Reset all** clears every edit. Your picks are kept by role, so a custom border or glass colour stays when you switch styles. They are saved with your other settings, and **Make selection glass** uses your glass colour.
- **Adjust:** **Corners** (0–30%), **Shine** (40–160%, scales the glows, sparkle and radial highlights), and on/off switches for **Glows**, **Sparkle**, **Border** and **Shadow**.
- **Apply to selection** styles selected frames, components and rectangles. Frames get the full card with glow layers. Rectangles get the fills, border, shadow and corners. Applying again replaces the earlier style.
- **Create card** makes a new card at one of five sizes. With **Sample content** on, it also adds a glass icon tile, a "Lorem Ipsum" title, a lorem ipsum description and three glass step pills with numbered badges and lorem labels (Inter, scaled from the reference card). The text lives in `src/sample.ts`.
- **Make selection glass** turns any selected layers, such as pills or icon tiles, into glass: white 18% fill and a 40% white inside border.
- **Remove card style** takes the style off cards made with CardGlow.
- **Remembers your choice.** The colour, style, size, sample content setting and adjustments are restored next time.

## Install for development

```bash
cd CardGlow
npm install
npm run build        # dist/code.js + dist/ui.html (use `npm run watch` while editing)
```

In the Figma desktop app: **Plugins > Development > Import plugin from manifest** and pick `CardGlow/manifest.json`.

Scripts: `build`, `watch`, `typecheck`. `dist/` is not committed, so build before importing.

## How styles are built

A style is a **look × direction**, defined in [`src/looks.ts`](src/looks.ts). Looks use steps of your colour's ShadesMaker scale (5–100, 50 = your colour), plus a few accents rotated around the colour wheel. Pressing ▶ changes the direction first, then the look.

- **Left light** is the reference layout.
- **Right light** mirrors the gradient, highlights, glows and sparkle.
- **Top light** runs the gradient top to bottom and centres the highlights and glows.

All positions, sizes, blur, border and shadow values are stored as fractions of the card, so a style looks the same on a 420 × 560 card and a 1200 × 400 banner.

## Project structure

```
CardGlow/
  manifest.json       Plugin manifest (loads dist/)
  esbuild.config.mjs  Bundles code.ts, and bundles ui.tsx inline into dist/ui.html
  src/
    code.ts           Main thread: painting cards, glow layers, sample content, glass, settings
    ui.tsx            React UI: left = big preview, ◀ ▶ and style grid; right = colour, looks, colours, adjust, actions
    ui.html           UI template and styles; the bundle replaces <!-- SCRIPT -->
    looks.ts          The 8 looks, 3 directions, cardStyle(), tweak(), colour slots and recolor()
    sample.ts         Lorem ipsum text for sample content
    spec.ts           Card types and colour helpers (ShadesMaker scale, hue shift)
    ColorPicker.tsx   Custom colour picker (same as Gradify)
    Logo.tsx          The CardGlow mark, drawn from the current colour
    messages.ts       Typed UI ↔ main messages
```

## Message protocol

| Direction  | Type        | Purpose |
| ---------- | ----------- | ------- |
| UI to main | `ready`     | The UI has loaded; asks for the selection and saved settings. |
| UI to main | `apply`     | Paint `spec` onto the selected frames, components and rectangles. |
| UI to main | `create`    | Create a card of `size`, with sample content when `content` is true, in the content `colors` (text, glass, badge, number). |
| UI to main | `glass`     | Turn the selected layers into glass in `color`. |
| UI to main | `remove`    | Remove the card style from selected CardGlow cards. |
| UI to main | `save`      | Store the current settings. |
| Main to UI | `selection` | Card target count and names, whether any is a CardGlow card, how many layers can become glass, and the selected layer's fill colour. |
| Main to UI | `settings`  | The saved settings (or `null`). |
| Main to UI | `success` / `error` | Status line text. |

## Limitations

- Instances are skipped because their children can't be changed. Rectangles can't hold glow layers, so they get the fills, border, shadow and corners only.
- Applying replaces the card's existing fills, strokes and effects.
- Sample content uses Inter. The reference cards use Metropolis, which may not be installed.
- The panel preview uses CSS gradients and blur, which are close to Figma's rendering but not identical. Check the result on the canvas.
