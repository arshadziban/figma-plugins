# Gradify

Gradify is a Figma plugin that adds a soft, blurred-blob gradient behind the content of a frame: a base fill plus a few large ellipses with a heavy layer blur. You pick one colour, then flip through 128 styles made only from shades of that colour with the **◀ ▶** buttons. The style is based on the Vivasoft reference slides and works on any frame size.

Built with React, TypeScript and esbuild.

## Features

- **One colour in, 128 styles out.** Every style uses only tints and shades of your colour on a light base, with no other hues.
- **◀ ▶ buttons** on either side of the preview step through the styles. The ← and → keys do the same. The counter shows where you are (for example `12 / 128`).
- **Mood chips** jump straight to one of the 8 moods (Light, Airy, Soft, Vivid, Pastel, Glass, Bold, Tone).
- **Style strip**: small thumbnails of all 16 layouts in the current mood. Click one to pick it.
- **🎲 Random** (or the R key) jumps to a random style.
- **Adjust**: **Intensity** (40–160%) scales the blob opacity, **Softness** (50–150%) scales the blur, and **Flip ↔ / ↕** mirror the layout. **Reset** puts them back.
- **Remembers your choice.** The colour, style, frame size and adjustments are saved with `figma.clientStorage` and restored the next time you open the plugin.
- Pick the colour with the built-in picker (click the swatch), by typing a hex value, from 9 quick swatches (the colour scales in the reference file), or with **Use selection**, which takes the fill of a selected layer such as a colour swatch.
- **Apply to selection** paints one or more selected frames. Running it again replaces the earlier Gradify background.
- **Create frame** makes a new frame at one of six sizes.

## Install for development

```bash
cd Gradify
npm install
npm run build        # dist/code.js + dist/ui.html (use `npm run watch` while editing)
```

In the Figma desktop app: **Plugins > Development > Import plugin from manifest** and pick `Gradify/manifest.json`.

Scripts: `build`, `watch`, `typecheck`. `dist/` is not committed, so build before importing.

## The 128 styles

A style is a **mood × layout**, defined in [`src/styles.ts`](src/styles.ts). The mood decides which steps of your colour's scale are used, and the layout decides where the blobs go. Pressing ▶ changes the layout. Every 16 styles, the mood changes.

The scale uses the same formula as ShadesMaker. Steps run from 5 to 100, and 50 is your colour. Steps below 50 are mixed toward white. Every style uses your colour or lighter steps, so all of them sit on a white or lightly tinted base.

| # | Mood | Base | Blobs |
| --- | --- | --- | --- |
| 1–16 | Light | White | 30, 40, 20 steps |
| 17–32 | Airy | White, with a 5-step wash at 25% | 30, 45, 10 steps |
| 33–48 | Soft | 5 step | 25, 45, 10 steps |
| 49–64 | Vivid | White | 50 (your colour), 35, 20 steps |
| 65–80 | Pastel | 10 step | 20, 30, 15 steps, low opacity |
| 81–96 | Glass | White, with a 10-step wash at 40% | 20, 35, 10 steps |
| 97–112 | Bold | White | 45, 50, 30 steps, high opacity |
| 113–128 | Tone | 15 step | 35, 50, 25 steps |

Layouts, in order: Glow, Mist, Diagonal, Dawn, Rise, Drift, Orb, Ribbon, Halo, Split, Corner, Wave, Spotlight, Frame, Scatter, Twin. Glow and Mist are measured from the two reference slides. Frame keeps the centre clear for content, and Scatter uses six smaller blobs.

Adjustments are applied on top of the chosen style (`tweak()` in `styles.ts`), so a style can be made stronger, softer or mirrored without leaving it.

The reference slides fit this model. The Blue slide's colours are exact steps of the `#0059DD` scale, and with `#0059DD` the **Airy Mist** style (18 / 128) uses the same colours (`#CFDFF9` wash, `#5C95E9` blobs). The Violet slide's `#9C82F5` blobs are about the 30 step of `#6B43F0`, which matches **Light Glow** (1 / 128).

## What gets created

Inside each target frame, Gradify:

- sets the frame fill to the base colour and turns on **Clip content**,
- adds a locked group named `Gradify background` as the bottom-most layer, containing:
  - `Wash`: a frame-sized rectangle (Airy styles only),
  - `Blob 1` … `Blob N`: ellipses with a solid fill and a layer blur.

All positions, sizes and the blur radius are stored as fractions of the frame, so a style looks the same on a 1280 × 720 slide and on a 1080 × 1920 story. Blur is a percentage of the frame width. The reference slides use 500 px on 1280 px, about 39%. In auto layout frames, the group is set to absolute position, so the layout doesn't change.

## Project structure

```
Gradify/
  manifest.json       Plugin manifest (loads dist/)
  esbuild.config.mjs  Bundles code.ts, and bundles ui.tsx inline into dist/ui.html
  src/
    code.ts           Main thread: painting, selection colour, messages
    ui.tsx            React UI: preview with ◀ ▶, moods, style strip, adjust, actions
    ColorPicker.tsx   Custom colour picker (colour area, hue slider, hex field)
    ui.html           UI template and styles; the bundle replaces <!-- SCRIPT -->
    styles.ts         Moods, layouts, style(color, index) and tweak()
    spec.ts           Shared types and colour helpers (ShadesMaker scale formula)
    messages.ts       Typed UI ↔ main messages
```

## Message protocol

| Direction  | Type        | Purpose |
| ---------- | ----------- | ------- |
| UI to main | `ready`     | The UI has loaded; asks for the current selection. |
| UI to main | `apply`     | Paint `spec` into every selected frame. |
| UI to main | `create`    | Create a new frame of `size` with `spec`. |
| UI to main | `remove`    | Delete the Gradify group from the selected frames. |
| UI to main | `save`      | Store the current colour, style, size and adjustments. |
| Main to UI | `selection` | Selected frame count and names, whether any has a Gradify background, and the fill of the first selected non-frame layer (`color`). |
| Main to UI | `settings`  | The saved settings (or `null`), sent after `ready`. |
| Main to UI | `success` / `error` | Status line text. |

## Limitations

- Only frames and components are valid targets. Instances are skipped because their children can't be changed.
- Applying replaces the frame's existing fills with the base colour.
- Very light colours give low-contrast styles, because every step is your colour mixed toward white.
- The panel preview uses CSS blur, which is close to Figma's layer blur but not identical. Check the result on the canvas.
- Large blur values on many big frames can make Figma slow to render.
