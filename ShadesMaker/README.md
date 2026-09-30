# Shades Maker

Shades Maker is a Figma plugin that generates a 20-step color scale from the solid fill of a selected layer. The scale can be placed on the canvas as an Auto Layout reference frame, saved as local color styles, or both.

## Features

- Generates 20 steps in 5% increments, from a light tint (5%) through the exact base color (50%) to a deep shade (100%).
- Builds a ready-to-share Auto Layout frame with the hex value and step label on every row.
- Creates one local color style per step, grouped under a prefix you choose (for example, `primary/5%`, `primary/BASE`).
- Running the plugin again with the same prefix updates existing styles instead of creating duplicates.
- A live preview in the plugin panel updates whenever the selection changes.
- Text on each row switches between black and white automatically to stay readable.

## Installation

The plugin is loaded as a development plugin from this repository.

1. Open the Figma desktop app.
2. Go to **Plugins > Development > Import plugin from manifest**.
3. Select `ShadesMaker/manifest.json`.
4. Run it from **Plugins > Development > Shades Maker**.

The compiled `code.js` is committed, so the plugin runs without a build step. See [Development](#development) if you change `code.ts`.

## Usage

1. Select a single layer with one visible solid fill, such as a rectangle.
2. The panel shows the selected color and a preview of five sample steps: 5%, 45%, BASE, 55% and 100%.
3. Choose an action:
   - **Generate 5% Scale Frame** places the full scale on the canvas.
   - **Create Color Styles** saves the full scale as local color styles. Enter a style prefix first, such as `green`, `primary` or `brand`.

Both actions can be run on the same color. Each action reports success or an error at the bottom of the panel.

### Scale Frame

The frame is named `Shades Maker – #HEX` after the base color and is placed 100 px to the right of the selected layer, at the same vertical position. It is added to the top level of the current page, even when the source layer is nested inside another frame or group. After it is created, the frame is selected and scrolled into view.

Layout details:

| Property        | Value |
| --------------- | ----- |
| Layout          | Vertical Auto Layout, no spacing between rows, 12 px corner radius |
| Row width       | 320 px |
| Row padding     | 16 px horizontal, 14 px vertical (64 px vertical on the BASE row) |
| Row content     | Hex value on the left, step label on the right |
| Typography      | Inter Medium, 13 px |

### Color Styles

One local color style is created for each of the 20 steps. The name is the prefix followed by the step label:

```
primary/5%
primary/10%
...
primary/45%
primary/BASE
primary/55%
...
primary/100%
```

Figma groups these into a folder named after the prefix in the style picker. Styles are matched by their full name. If a style with the same name already exists, only its fill is replaced and its other properties stay the same.

## Color Scale

Step 50 is the exact base color. Steps below it are tints, mixed toward white. Steps above it are shades, mixed toward black. The mix is a linear RGB interpolation:

```
tint  = base + (white - base) * amount
shade = base * (1 - amount)
```

The mix amount is capped at 90%. At a full 100% mix, both formulas would produce pure white or pure black and lose the hue of the base color. Scaling the range to 0-90% keeps a trace of the original hue in the lightest and darkest steps, and keeps every step distinct.

| Step | Direction | Amount | | Step | Direction | Amount |
| ---- | --------- | ------ | - | ---- | --------- | ------ |
| 5%   | White     | 81%    | | 55%  | Black     | 9%     |
| 10%  | White     | 72%    | | 60%  | Black     | 18%    |
| 15%  | White     | 63%    | | 65%  | Black     | 27%    |
| 20%  | White     | 54%    | | 70%  | Black     | 36%    |
| 25%  | White     | 45%    | | 75%  | Black     | 45%    |
| 30%  | White     | 36%    | | 80%  | Black     | 54%    |
| 35%  | White     | 27%    | | 85%  | Black     | 63%    |
| 40%  | White     | 18%    | | 90%  | Black     | 72%    |
| 45%  | White     | 9%     | | 95%  | Black     | 81%    |
| 50%  | Base      | 0%     | | 100% | Black     | 90%    |

Row text color is chosen from the perceived brightness of each step (ITU-R BT.601 weights: `0.299 R + 0.587 G + 0.114 B`). Steps brighter than 0.6 use black text, and all others use white text.

## Development

The main thread is written in TypeScript and compiled to `code.js`.

```
cd ShadesMaker
npm install
npm run build
```

Commit the rebuilt `code.js` together with any change to `code.ts`, since Figma loads the compiled file.

### Project Structure

```
ShadesMaker/
  manifest.json   Plugin manifest
  code.ts         Main thread source: color math, selection handling, frame and style creation
  code.js         Compiled output of code.ts, loaded by Figma
  ui.html         Plugin UI: markup, styles and scripts in one file
  package.json    Build script and dev dependencies
  tsconfig.json   TypeScript configuration
```

### Message Protocol

The UI and the main thread communicate through `postMessage`.

| Direction  | Type               | Purpose |
| ---------- | ------------------ | ------- |
| UI to main | `generate-scale`   | Build the scale frame from the current selection. |
| UI to main | `create-variables` | Create or update color styles. Carries `prefix`. |
| UI to main | `cancel`           | Close the plugin. |
| Main to UI | `preview`          | Five sample steps for the current selection, or `null` when the selection is not valid. Sent on launch and whenever the selection changes. |
| Main to UI | `success-scale`    | The scale frame was created. |
| Main to UI | `error-scale`      | The scale frame could not be created. |
| Main to UI | `success-vars`     | Number of color styles created or updated, and the prefix used. |
| Main to UI | `error-vars`       | The color styles could not be created, or the prefix was empty. |

The `create-variables` message and the `*-vars` responses create local paint styles, not Figma variables. The names are kept for compatibility with the UI.

## Limitations

- Exactly one layer must be selected. It must have exactly one fill, and that fill must be solid and visible. Gradients, images and layers with multiple fills are not supported.
- Fill opacity is ignored. The scale is generated from the RGB value only.
- The scale frame uses Inter Medium, which must be available in Figma.
- The scale always has 20 steps at 5% increments. The step count and the 90% intensity cap are not configurable from the UI.
- Styles are only created or updated. The plugin never deletes existing styles, so styles created under an earlier prefix stay in the file until they are removed manually.
