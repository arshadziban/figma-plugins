figma.showUI(__html__, { width: 560, height: 720, title: "Type Maker" });

var BREAKPOINT_LABELS = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

var cachedFonts = null;

async function getAvailableFonts() {
  if (!cachedFonts) cachedFonts = await figma.listAvailableFontsAsync();
  return cachedFonts;
}

var WEIGHT_KEYWORDS = [
  ["extrablack", 950], ["ultrablack", 950], ["black", 900], ["heavy", 900],
  ["extrabold", 800], ["ultrabold", 800], ["semibold", 600], ["demibold", 600], ["demi", 600],
  ["bold", 700], ["medium", 500], ["regular", 400], ["normal", 400], ["book", 400], ["roman", 400],
  ["extralight", 200], ["ultralight", 200], ["light", 300], ["thin", 100], ["hairline", 100],
];

function normalizeStyle(style) {
  return String(style || "").toLowerCase().replace(/[\s_-]/g, "");
}

function styleWeight(style) {
  var s = normalizeStyle(style);
  for (var i = 0; i < WEIGHT_KEYWORDS.length; i++) {
    if (s.indexOf(WEIGHT_KEYWORDS[i][0]) !== -1) return WEIGHT_KEYWORDS[i][1];
  }
  return 400;
}

function isItalic(style) {
  var s = normalizeStyle(style);
  return s.indexOf("italic") !== -1 || s.indexOf("oblique") !== -1;
}

function styleWidth(style) {
  var m = normalizeStyle(style).match(/condensed|compressed|narrow|expanded|extended|wide/);
  return m ? m[0] : "";
}

// Map a requested style (e.g. "Semibold") to one the family actually has
// (e.g. "SemiBold", "Semi Bold", or the nearest weight like "Medium").
async function resolveFontStyle(family, requested) {
  var fonts = await getAvailableFonts();
  var styles = [];
  for (var i = 0; i < fonts.length; i++) {
    if (fonts[i].fontName.family === family) styles.push(fonts[i].fontName.style);
  }
  if (!styles.length) throw new Error('Font "' + family + '" is not available.');
  if (styles.indexOf(requested) !== -1) return requested;

  var target = normalizeStyle(requested);
  for (var i = 0; i < styles.length; i++) {
    if (normalizeStyle(styles[i]) === target) return styles[i];
  }

  var wantWeight = styleWeight(requested);
  var wantItalic = isItalic(requested);
  var wantWidth = styleWidth(requested);
  var best = styles[0];
  var bestScore = Infinity;
  for (var i = 0; i < styles.length; i++) {
    var score = Math.abs(styleWeight(styles[i]) - wantWeight);
    if (isItalic(styles[i]) !== wantItalic) score += 1000;
    if (styleWidth(styles[i]) !== wantWidth) score += 500;
    if (score < bestScore) { bestScore = score; best = styles[i]; }
  }
  return best;
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
  async function ensureFontLoaded(family, requestedStyle) {
    var key = family + "|" + requestedStyle;
    if (loadedFonts[key]) return loadedFonts[key];
    var style = await resolveFontStyle(family, requestedStyle);
    try {
      await figma.loadFontAsync({ family: family, style: style });
    } catch (e) {
      throw new Error('Could not load "' + family + " " + style + '".');
    }
    loadedFonts[key] = style;
    return style;
  }

  var created = { styles: 0 };

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.enabled) continue;
    var baseName = row.name.trim();
    if (!baseName) continue;

    var rowFontFamily = row.fontFamily || defaultFontFamily;
    var rowFontStyle = await ensureFontLoaded(rowFontFamily, row.style || row.fontStyle || defaultFontWeight);

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
          style: fontStyle || "Regular",
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
        var stylesByFamily = {};
        for (var i = 0; i < fonts.length; i++) {
          var fam = fonts[i].fontName.family;
          var sty = fonts[i].fontName.style;
          if (!seen[fam]) { seen[fam] = true; families.push(fam); }
          if (!stylesByFamily[fam]) stylesByFamily[fam] = [];
          if (stylesByFamily[fam].indexOf(sty) === -1) stylesByFamily[fam].push(sty);
        }
        families.sort();
        figma.ui.postMessage({ type: "fonts-list", families: families, stylesByFamily: stylesByFamily });
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
    figma.ui.postMessage({ type: "generate-error", error: (err && err.message) || String(err) });
  }
};
