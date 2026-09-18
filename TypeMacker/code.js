figma.showUI(__html__, { width: 560, height: 720, title: "Type Maker" });

var BREAKPOINT_LABELS = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

var cachedFonts = null;

async function getAvailableFonts() {
  if (!cachedFonts) cachedFonts = await figma.listAvailableFontsAsync();
  return cachedFonts;
}

async function getExistingStyleMap() {
  var map = {};
  var styles = await figma.getLocalTextStylesAsync();
  for (var i = 0; i < styles.length; i++) map[styles[i].name] = styles[i];
  return map;
}

function parseLetterSpacing(raw) {
  if (typeof raw === "number") return { value: raw, unit: "PERCENT" };
  var s = String(raw).trim();
  if (s.indexOf("%") !== -1) {
    return { value: parseFloat(s) || 0, unit: "PERCENT" };
  }
  return { value: parseFloat(s) || 0, unit: "PIXELS" };
}

async function generateTextStyles(rows, opts) {
  var defaultFontFamily = opts.fontFamily || "Inter";
  var defaultFontWeight = opts.fontWeight || "Regular";
  var breakpoints = (opts.breakpoints && opts.breakpoints.length) ? opts.breakpoints : ["desktop"];

  var existingStyles = await getExistingStyleMap();

  var loadedFonts = {};
  async function ensureFontLoaded(family, style) {
    var key = family + "|" + style;
    if (loadedFonts[key]) return;
    await figma.loadFontAsync({ family: family, style: style });
    loadedFonts[key] = true;
  }

  var hasPerRowFont = false;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].fontFamily) hasPerRowFont = true;
  }
  if (!hasPerRowFont) await ensureFontLoaded(defaultFontFamily, defaultFontWeight);

  var created = { styles: 0 };

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.enabled) continue;
    var baseName = row.name.trim();
    if (!baseName) continue;

    var rowFontFamily = row.fontFamily || defaultFontFamily;
    var rowFontStyle = row.fontStyle || defaultFontWeight;
    await ensureFontLoaded(rowFontFamily, rowFontStyle);

    for (var b = 0; b < breakpoints.length; b++) {
      var bpKey = breakpoints[b];
      var bpData = row[bpKey];
      if (!bpData || !bpData.size) continue;
      var ls = parseLetterSpacing(bpData.letterSpacing);
      var styleName = BREAKPOINT_LABELS[bpKey] + "/" + baseName;

      var style = existingStyles[styleName] || figma.createTextStyle();
      style.name = styleName;
      style.fontName = { family: rowFontFamily, style: rowFontStyle };
      style.fontSize = bpData.size;
      style.lineHeight = { value: bpData.lineHeight, unit: "PIXELS" };
      style.letterSpacing = { value: ls.value, unit: ls.unit };
      existingStyles[styleName] = style;
      created.styles++;
    }
  }

  return created;
}

figma.on("selectionchange", async function () {
  var info = await getSelectionTypography();
  figma.ui.postMessage({ type: "selection-typography", rows: info.rows, layerNames: info.layerNames });
});

function collectFontFamilies(node, seenFamilies, families) {
  if (node.type === "TEXT") {
    if (node.fontName && typeof node.fontName !== "symbol") {
      var family = node.fontName.family;
      if (!seenFamilies[family]) {
        seenFamilies[family] = true;
        families.push(family);
      }
    }
  }
  if ("children" in node) {
    for (var i = 0; i < node.children.length; i++) {
      collectFontFamilies(node.children[i], seenFamilies, families);
    }
  }
}

async function getSelectionTypography() {
  var selection = figma.currentPage.selection;
  var seen = {};
  var rows = [];
  var seenFamilies = {};
  var layerNames = [];
  for (var i = 0; i < selection.length; i++) {
    collectTextNodes(selection[i], seen, rows);
    collectFontFamilies(selection[i], seenFamilies, layerNames);
  }
  rows.sort(function (a, b) { return b.desktop.size - a.desktop.size; });
  var STYLE_NAMES = ["Display", "H1", "H2", "H3", "H4", "H5", "Body Large", "Body", "Body Small", "Caption", "Overline"];
  for (var i = 0; i < rows.length; i++) {
    rows[i].name = STYLE_NAMES[i] || ("Style " + (i + 1));
  }
  return { rows: rows, layerNames: layerNames };
}

function collectTextNodes(node, seen, rows) {
  if (node.type === "TEXT") {
    var size = typeof node.fontSize === "symbol" ? null : node.fontSize;
    var lh = node.lineHeight;
    var lineHeightPx = null;
    if (lh && lh.unit === "PIXELS") lineHeightPx = lh.value;
    else if (size) lineHeightPx = Math.round(size * 1.4);
    var ls = node.letterSpacing;
    var letterSpacing = "0%";
    if (ls && typeof ls !== "symbol") {
      letterSpacing = ls.unit === "PERCENT" ? (ls.value + "%") : ls.value;
    }
    var fontFamily = null;
    var fontStyle = null;
    if (node.fontName && typeof node.fontName !== "symbol") {
      fontFamily = node.fontName.family;
      fontStyle = node.fontName.style;
    }
    if (size) {
      var key = String(size);
      if (!seen[key]) {
        seen[key] = true;
        var bpValue = {
          size: size,
          lineHeight: lineHeightPx || Math.round(size * 1.4),
          letterSpacing: letterSpacing,
        };
        rows.push({
          name: "",
          fontFamily: fontFamily,
          fontStyle: fontStyle,
          desktop: bpValue,
          tablet: { size: bpValue.size, lineHeight: bpValue.lineHeight, letterSpacing: bpValue.letterSpacing },
          mobile: { size: bpValue.size, lineHeight: bpValue.lineHeight, letterSpacing: bpValue.letterSpacing },
          enabled: true,
        });
      }
    }
  }
  if ("children" in node) {
    for (var i = 0; i < node.children.length; i++) {
      collectTextNodes(node.children[i], seen, rows);
    }
  }
}

figma.ui.onmessage = async function (msg) {
  try {
    switch (msg.type) {

      case "get-fonts": {
        var fonts = await getAvailableFonts();
        var seen = {};
        var families = [];
        for (var i = 0; i < fonts.length; i++) {
          var fam = fonts[i].fontName.family;
          if (!seen[fam]) { seen[fam] = true; families.push(fam); }
        }
        families.sort();
        figma.ui.postMessage({ type: "fonts-list", families: families });
        break;
      }

      case "get-selection-typography": {
        var info = await getSelectionTypography();
        figma.ui.postMessage({ type: "selection-typography", rows: info.rows, layerNames: info.layerNames });
        break;
      }

      case "generate": {
        var result = await generateTextStyles(msg.rows, msg.options);
        figma.ui.postMessage({
          type: "generate-complete",
          styles: result.styles,
        });
        break;
      }

      case "close":
        figma.closePlugin();
        break;
    }
  } catch (err) {
    figma.ui.postMessage({ type: "generate-error", error: err.message });
  }
};
