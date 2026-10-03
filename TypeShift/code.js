figma.showUI(__html__, { width: 400, height: 720, title: "TypeShift", themeColors: true });

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

async function getFamilyStyles(family) {
  var fonts = await getAvailableFonts();
  var styles = [];
  for (var i = 0; i < fonts.length; i++) {
    if (fonts[i].fontName.family === family) styles.push(fonts[i].fontName.style);
  }
  return styles;
}

// Map a style (e.g. "Semibold") to one the target family actually has
// (e.g. "SemiBold", "Semi Bold", or the nearest weight like "Medium").
function resolveFontStyle(styles, requested) {
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

function formatLineHeight(lh) {
  if (lh.unit === "AUTO") return "Auto";
  return round(lh.value) + (lh.unit === "PERCENT" ? "%" : "px");
}

function formatLetterSpacing(ls) {
  return round(ls.value) + (ls.unit === "PERCENT" ? "%" : "px");
}

function round(n) {
  return Math.round(n * 100) / 100;
}

async function getTextStyleList() {
  var styles = await figma.getLocalTextStylesAsync();
  var list = [];
  for (var i = 0; i < styles.length; i++) {
    var s = styles[i];
    list.push({
      id: s.id,
      name: s.name,
      family: s.fontName.family,
      style: s.fontName.style,
      size: s.fontSize,
      lineHeight: formatLineHeight(s.lineHeight),
      letterSpacing: formatLetterSpacing(s.letterSpacing),
    });
  }
  return list;
}

async function sendTextStyles() {
  figma.ui.postMessage({ type: "text-styles", styles: await getTextStyleList() });
}

// opts: { family, style, lineHeight, letterSpacing }; any of them may be null to keep the style's value.
async function updateTextStyles(styleIds, opts) {
  var family = opts.family || null;
  var forcedStyle = opts.style || null;
  var familyStyles = null;
  if (family) {
    familyStyles = await getFamilyStyles(family);
    if (!familyStyles.length) throw new Error('Font "' + family + '" is not available.');
    if (forcedStyle && familyStyles.indexOf(forcedStyle) === -1) {
      throw new Error('"' + family + '" has no "' + forcedStyle + '" style.');
    }
  }

  var loaded = {};
  var results = [];
  var updated = 0;

  for (var i = 0; i < styleIds.length; i++) {
    var textStyle = await figma.getStyleByIdAsync(styleIds[i]);
    if (!textStyle || textStyle.type !== "TEXT") continue;

    var from = textStyle.fontName;
    var fontName = from;
    if (family) {
      fontName = { family: family, style: forcedStyle || resolveFontStyle(familyStyles, from.style) };
    }
    var key = fontName.family + "|" + fontName.style;

    try {
      // Text style properties can only be set once the style's font is loaded.
      if (!loaded[key]) {
        await figma.loadFontAsync(fontName);
        loaded[key] = true;
      }
    } catch (e) {
      results.push({ id: textStyle.id, ok: false, error: 'Could not load "' + fontName.family + " " + fontName.style + '".' });
      continue;
    }

    if (family) textStyle.fontName = fontName;
    if (opts.lineHeight) textStyle.lineHeight = opts.lineHeight;
    if (opts.letterSpacing) textStyle.letterSpacing = opts.letterSpacing;
    updated++;
    results.push({
      id: textStyle.id,
      ok: true,
      fallback: !!family && !forcedStyle && normalizeStyle(fontName.style) !== normalizeStyle(from.style),
      from: from.style,
      to: fontName.style,
    });
  }

  return { updated: updated, results: results };
}

// Keep the list in sync when styles are added, renamed, edited or deleted, in the plugin or elsewhere.
var refreshTimer = null;
figma.on("stylechange", function () {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(sendTextStyles, 150);
});

figma.ui.onmessage = async function (msg) {
  try {
    switch (msg.type) {

      case "init": {
        var fonts = await getAvailableFonts();
        var seen = {};
        var families = [];
        var stylesByFamily = {};
        for (var i = 0; i < fonts.length; i++) {
          var fam = fonts[i].fontName.family;
          var sty = fonts[i].fontName.style;
          if (!seen[fam]) { seen[fam] = true; families.push(fam); stylesByFamily[fam] = []; }
          if (stylesByFamily[fam].indexOf(sty) === -1) stylesByFamily[fam].push(sty);
        }
        families.sort();
        figma.ui.postMessage({ type: "fonts-list", families: families, stylesByFamily: stylesByFamily });
        await sendTextStyles();
        break;
      }

      case "refresh":
        await sendTextStyles();
        break;

      case "apply": {
        var result = await updateTextStyles(msg.styleIds, msg.options);
        figma.ui.postMessage({ type: "apply-complete", updated: result.updated, results: result.results });
        await sendTextStyles();
        if (result.updated) {
          figma.notify("Updated " + result.updated + " text style" + (result.updated === 1 ? "" : "s"));
        }
        break;
      }

      case "close":
        figma.closePlugin();
        break;
    }
  } catch (err) {
    figma.ui.postMessage({ type: "apply-error", error: (err && err.message) || String(err) });
  }
};
