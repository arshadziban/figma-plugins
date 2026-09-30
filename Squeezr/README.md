# Squeezr

Squeezr is a Figma plugin that exports selected layers as JPEG or WebP images compressed to a target file size. It keeps the original dimensions and searches for the highest quality setting that fits within the size you set. All processing happens locally inside the plugin, and no image data leaves your machine.

## Features

- Exports frames, groups, components, instances, sections, shapes and text layers.
- Compresses to a target file size in KB or MB, with presets for common limits.
- Finds the highest quality that fits the target, instead of using a fixed quality value.
- Keeps the original layer dimensions. Images are exported at 1x.
- Processes several layers in one batch and shows thumbnails, before and after sizes, and savings for each.
- Downloads images one at a time or all together as a ZIP file.
- Runs offline. The manifest blocks all network access.

## Installation

The plugin is loaded as a development plugin from this repository.

1. Open the Figma desktop app.
2. Go to **Plugins > Development > Import plugin from manifest**.
3. Select `Squeezr/manifest.json`.
4. Run it from **Plugins > Development > Squeezr**.

There is no build step. `code.js` and `ui.html` are loaded by Figma as they are.

## Usage

The panel is organized in three steps.

### 1. Select Layers

Select one or more layers on the canvas. Each supported layer appears in the list with a thumbnail, its type and its size in pixels. The list updates whenever the selection changes.

Click a layer in the list to include or exclude it from the export. Use **Select all** or **Deselect all** to change every layer at once. When only one layer is selected on the canvas, it is included automatically.

### 2. Output Settings

| Setting          | Options | Default |
| ---------------- | ------- | ------- |
| Format           | JPEG, WebP | JPEG |
| Target File Size | Any positive number, in KB or MB | 200 KB |
| Presets          | 50 KB, 100 KB, 150 KB, 200 KB, 500 KB | 200 KB |

The target applies to each image, not to the batch as a whole. 1 KB is 1,024 bytes and 1 MB is 1,048,576 bytes.

Use WebP when a layer has transparent areas. JPEG has no transparency, so transparent pixels are filled with white.

### 3. Compress and Export

Click **Compress Selected Layers**. The label changes to **Compress N Layers** when more than one layer is included. Layers are processed one at a time, and the status line shows the progress of each.

When the batch finishes, the **Results** section lists every image with:

- A thumbnail and the layer name.
- The size before compression, which is the size of the PNG exported by Figma, and the size after.
- The percentage saved.
- A button to download that image.

**Download All (ZIP)** saves every image in the batch as `compressed_images.zip`. **Clear all** removes the results.

## How Compression Works

1. The main thread exports the layer from Figma as a PNG at 1x scale.
2. The UI draws the PNG onto a canvas at its original size. For JPEG, the canvas is filled with white first.
3. The canvas is encoded at quality 1.0. If that result already fits the target, it is used as is.
4. Otherwise, the canvas is encoded at quality 0.01. If even that result is larger than the target, it is used as the smallest possible output.
5. Otherwise, a binary search runs between 0.01 and 1.0 for up to 14 steps, or until the range is narrower than 0.001. The largest quality whose output fits the target is kept.

Encoding uses the browser's built-in `canvas.toBlob`, so no external libraries are loaded.

### File Names

Each file is named after its layer. Characters other than letters, digits, spaces, `_`, `-` and `.` are replaced with `_`. The extension is `.jpg` for JPEG and `.webp` for WebP. A layer with an empty name is saved as `export`.

## Project Structure

```
Squeezr/
  manifest.json   Plugin manifest, with network access disabled
  code.js         Main thread: selection scanning, thumbnails and PNG export
  ui.html         Plugin UI: markup, styles, compression, and ZIP creation in one file
```

The ZIP file is built in `ui.html` without any dependency. Files are stored without additional compression, because JPEG and WebP data is already compressed.

### Message Protocol

The UI and the main thread communicate through `postMessage`.

| Direction  | Type        | Purpose |
| ---------- | ----------- | ------- |
| UI to main | `export`    | Export one layer by `nodeId` as PNG at the given `scale`. The requested `format` is passed back unchanged. |
| UI to main | `resize`    | Resize the plugin window to fit its content, between 200 and 700 px high. |
| UI to main | `close`     | Close the plugin. |
| Main to UI | `selection` | Supported layers in the current selection, with id, name, type, size and a PNG thumbnail of up to 128 px. Sent on launch and whenever the selection changes. |
| Main to UI | `progress`  | Status text while Figma is exporting. |
| Main to UI | `exported`  | PNG bytes of one layer, with its name, format and size. |
| Main to UI | `error`     | The layer could not be found or exported. |

## Limitations

- Supported layer types are frames, groups, components, instances, sections, rectangles, ellipses, vectors and text. Other types, such as lines, polygons, stars, boolean groups and component sets, are not listed.
- Images are always exported at 1x. There is no option for 2x or 3x output.
- If the target cannot be reached even at the lowest quality, the image is still saved at that quality and will be larger than the target. The results list does not flag this case.
- If one layer fails to export during a batch, the batch stops and the images already processed are not shown.
- Layers with the same name produce files with the same name. Inside the ZIP, these files can overwrite each other when extracted.
- JPEG output replaces transparency with white. There is no option to choose another background color.
- Settings are not saved between sessions.
