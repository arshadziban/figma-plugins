# SlideSync

Export selected Figma frames to one editable `.pptx` (one slide per frame). Text stays text, layers keep their
names, and the slide should look like the frame. Open the result in Google Slides or PowerPoint.

No backend, no network (`allowedDomains: ["none"]`). The plugin only reads your file.

## Install for development

```bash
cd SlideSync
npm install
npm run build        # dist/code.js + dist/ui.html (use `npm run watch` while hacking)
```

In Figma desktop: **Plugins → Development → Import plugin from manifest…** and pick `SlideSync/manifest.json`.

Scripts: `build`, `watch`, `typecheck`.

## How it works

- `src/code.ts` (main thread) walks each frame bottom → top, classifies layers, exports PNGs with `exportAsync`
  and streams a plain-JSON slide model per frame to the UI.
- `src/ui.ts` + `src/ui.html` (iframe) show frames/options/progress/warnings, build the deck with PptxGenJS
  (bundled) and trigger the download.
- Pure, Figma-free modules: `geometry`, `color`, `text`, `naming`, `classify`, `fonts`, `pptx`,
  shared types in `slideModel`.

Scale: `inches = px × (10 / frameWidth)`. A 1920×1080 frame → `px / 192` inches and `pt = px × 0.375`
(80px → 30pt). Non-16:9 frames are letterboxed with a warning, unless **all** frames share one non-16:9
ratio, in which case the deck gets a matching custom slide size.

## Classification

| Layer | Output |
|---|---|
| Text | Native editable text box (mixed styles preserved) |
| Rectangle/ellipse, single solid fill, optional solid uniform stroke, no effects, normal blend | Native shape (rounded rect if it has a uniform radius) |
| Vector, boolean, star, polygon, line, anything unknown | PNG |
| Gradient/image fill, blur, shadow, blend mode, mask, dashed stroke, partial arc, mixed radii, flipped | PNG |
| Text with gradient fill, effects, blend mode, or (option on) non-Google font | PNG + warning |
| Group/frame/component/instance **without** text | One PNG of the container |
| Container **with** text | Recurse; own background emitted first |
| Mask group (even with text) | One PNG + warning |

Container background: a single solid fill (+ optional solid stroke, uniform radius) becomes a native shape.
Anything else is exported by cloning the container, removing the clone's children, exporting it, and removing
the clone, all in `try/finally`, on the current page far offscreen. Each clone logs
`[SlideSync] background clone for <id>: page children N -> N` to the console and raises a warning if the page
child count changed. This clone (plus the opt-in opacity probe below) is the only write the plugin ever makes.

Slide background: solid frame fill → slide background colour; otherwise the frame's background is exported as a
full-size image at the bottom of the stack.

## Decisions worth knowing

- **Render bounds.** PNGs are placed by `absoluteRenderBounds` (they include blur/shadow overflow), falling back
  to `absoluteBoundingBox`.
- **Insets.** Text boxes get zero insets; PowerPoint/Slides pad by default, Figma doesn't.
- **Rotation.** Figma is counter-clockwise, PowerPoint clockwise. Position comes from `absoluteTransform`; the box
  is rebuilt around the rotated centre as an unrotated box plus angle. Rotated/flipped images need no rotation:
  the PNG already contains it.
- **Auto-resize text.** `WIDTH_AND_HEIGHT`/`HEIGHT` boxes are widened ~2% in the anchored direction.
- **Weights.** 600/700 → bold flag; 100/200/300/500/800/900 → family name suffix ("Inter Light").
- **Opacity** is baked into PNG alpha (PPTX image transparency doesn't survive Google Slides). See below.

### Opacity: does `exportAsync` already apply a node's own opacity?

**Not yet verified in a live Figma file.** This repo was built without access to a Figma session, so I could not
run the proof. The plugin is written to work either way:

- Ancestors' opacity is never part of a child's export, so it is always baked by the UI canvas pass.
- The node's own opacity is baked by the UI only if the stored probe result says export did *not* apply it.
- Until you run the probe, it **assumes export does apply it**.

To settle it: open the plugin → **Advanced → Check whether export bakes layer opacity**. It creates one 16px white
rectangle at 50% opacity offscreen, exports it, removes it, and reads the centre alpha in the UI
(≈128 = applied, 255 = not applied). The result is saved in `figma.clientStorage` and used from then on.
Record the result here: `Result: ______ (Figma version ______, date ______)`.

## Known limitations

- Selecting a frame that directly contains a mask child exports it as-is with a warning (masked layers may render unmasked).
- Group-level effects can't be exported without their children; they're dropped with a warning.
- Nested clipping (`clipsContent` on inner frames) is not reproduced; only the root frame's clip culls layers.
- Small caps, per-paragraph styles beyond line height/spacing, lists, and text on a path are not mapped.
- Link colour comes from the presentation theme, not the Figma text fill.
- The Google Fonts list is bundled and not exhaustive; a miss only warns.
- Auto-layout-driven, rotated roots and per-corner radii fall back to images.
- Automated tests were removed from this repo. Verify real behaviour inside Figma and in Google Slides/PowerPoint
  with the checklist below.

## Manual QA checklist

1. Build a 1920×1080 sample frame with a #15103F background, a blurred glow, a grid, icons, cards, an 80px
   headline, stats and a logo. Add one layer at 50% opacity and one inside a 50%-opacity group.
2. Run **Advanced → opacity probe** once and record the result above.
3. Export; open in **Google Slides** and **PowerPoint**.
4. Compare side by side with the frame: positions, glow/shadow placement (not shifted/squashed), colours, opacity.
5. Click into text: editable, headline is 30pt, no extra padding, no new line breaks.
6. Open the Selection Pane (PowerPoint) / Alt text (Slides): layer names match Figma.
7. Check slide notes (layer report) and the warnings panel; click a warning and confirm the layer is selected.
8. In Figma: no extra nodes on the page (clone check), and Edit → Undo history shows no layer edits from the plugin.
9. Select a 4:3 frame alone (custom size) and mixed with a 16:9 frame (letterbox warning).
10. Cancel mid-export and confirm the file is unchanged.
