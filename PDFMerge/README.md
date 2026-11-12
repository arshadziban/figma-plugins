# PDFMerge

Merge selected Figma frames into **one multi-page PDF**, with a file name you choose.

## How it works

1. Import or design your pages as frames, then select the ones you want on the canvas.
2. Open the plugin. The selected frames are listed as pages (canvas order: top to bottom, left to right).
3. Untick frames to leave them out, and use ↑ / ↓ to reorder pages.
4. Type the **file name** (`.pdf` is added for you).
5. Click **Merge to PDF**. Each frame is exported as a vector PDF page, combined, and downloaded.

## Links

Clickable links are kept in the merged PDF:

- URL links (text and layer hyperlinks) stay clickable.
- Prototype connections between the merged frames become jumps to the right page.
- Prototype links to frames that are not part of the merge are left out.

## Notes

- Frames, components, instances, groups and sections can be merged.
- Page size follows each frame's size, so mixed sizes are fine.
- Everything runs locally; the plugin makes no network requests and never edits your file.

## Build

```
npm install
npm run build
```

Then in Figma: **Plugins → Development → Import plugin from manifest** and pick `manifest.json`.
