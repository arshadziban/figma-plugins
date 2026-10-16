# TypeShift

TypeShift is a Figma plugin that changes the font family, weight, line height and letter spacing of text in bulk. It works in two modes, picked by what is selected on the canvas:

- **Nothing selected:** it edits the file's local text styles. Every layer that uses a changed style updates with it.
- **Frames, groups or text layers selected:** it edits the text inside the selection directly, grouped by the fonts it uses.

When the font changes, each style or text keeps its weight where the new font has it, and falls back to the closest weight where it does not.

![TypeShift plugin UI](image.png)

## Features

- Lists every local text style in the file with its current font, weight, size, line height and letter spacing.
- Edits the text inside selected frames, groups, components, sections and text layers, listing each font used and how many layers use it.
- Switches between text styles and the selection automatically as the selection changes.
- Searchable list of every font available in Figma.
- Keeps each item's original weight, or sets one weight for everything ticked.
- Matches weight names across fonts, for example `SemiBold`, `Semi Bold` and `Semibold`.
- Falls back to the nearest weight, keeping italic and width (Condensed, Expanded) where possible.
- Sets line height in pixels, percent or Auto, and letter spacing in percent or pixels.
- Changes only the fields you fill in. Leave the font empty to change spacing only.
- Follows Figma's light and dark theme.
- Updates the list automatically when text styles change in the file.
- Filters the list by current font, so you can replace one font with another in a single step.
- Marks each item that used a fallback weight or failed to update.

## Installation

The plugin is loaded as a development plugin from this repository.

1. Open the Figma desktop app.
2. Go to **Plugins > Development > Import plugin from manifest**.
3. Select `TypeShift/manifest.json`.
4. Run it from **Plugins > Development > TypeShift**.

There is no build step. `code.js` and `ui.html` are loaded by Figma as they are.

## Usage

### Text styles

Run the plugin with nothing selected. The list shows the file's local text styles.

1. Type in **Font Family** and pick a font from the suggestions. The preview shows the font if it is installed on your computer. Leave it empty to keep each style's font.
2. Leave **Font Weight** on **Keep original**, or choose one weight to apply to every ticked style.
3. Optionally fill in **Line Height** and **Letter Spacing**. Empty fields keep each style's current value.
4. Tick the text styles to change. Use the search box or the font chips to narrow the list, and **Select all** to tick everything shown.
5. Click **Apply Changes**, or press **Cmd/Ctrl + Enter**.

A message shows how many styles were updated, and each style gets a badge: **Updated** in green, the fallback weight in yellow, or **Failed** in red. Hover a badge for details. Layers that use the changed styles update automatically.

### Selected text

Select one or more frames, groups, components, sections or text layers. The list changes to **Text in Selection** and shows each font used inside the selection, for example `Inter Bold · 16 px · 3 layers`. Text with the same font, weight, size, line height and letter spacing is listed once.

1. Choose the new values the same way as for text styles.
2. Every font in the selection starts ticked. Untick any you want to leave alone.
3. Click **Apply Changes**.

Only the matching text changes, so a layer that mixes fonts keeps the parts you did not tick. A message shows how many text layers were updated. Deselect everything to go back to text styles.

## Line Height and Letter Spacing

| Field          | Input            | Result      |
| -------------- | ---------------- | ----------- |
| Line height    | `24` or `24px`   | 24 px       |
| Line height    | `150%`           | 150%        |
| Line height    | `auto`           | Auto        |
| Letter spacing | `-2` or `-2%`    | -2%         |
| Letter spacing | `0.5px`          | 0.5 px      |

A number without a unit means pixels for line height and percent for letter spacing, the same as Figma's defaults. Invalid values are outlined in red and **Apply Changes** stays disabled.

## Weight Matching

With **Keep original** selected, each style's or text's weight is mapped to the new font in this order:

1. The exact same style name.
2. The same name ignoring case, spaces, hyphens and underscores.
3. The closest weight by number (Thin 100 to Black 900), preferring the same italic and width.

Examples when changing to a font that has only Light, Regular, Medium and Bold:

| Original style  | New style |
| --------------- | --------- |
| `Regular`       | `Regular` |
| `Semi Bold`     | `Medium`  |
| `ExtraBold`     | `Bold`    |
| `Thin`          | `Light`   |

## Limitations

- Only local text styles can be changed. Styles from a team library must be changed in the library file.
- Editing selected text that uses a text style detaches the edited text from that style, as any direct edit in Figma does. To change the style everywhere, deselect everything and edit the style instead.
- Text with a missing font cannot be edited until the font is installed or replaced.
- In selection mode, the list refreshes when the selection changes or after applying, not while text is edited elsewhere.
