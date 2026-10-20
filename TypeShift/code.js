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

// ── Selection ──────────────────────────────────

var SEGMENT_FIELDS = ["fontName", "fontSize", "lineHeight", "letterSpacing"];

function hasSelection() {
  return figma.currentPage.selection.length > 0;
}

// Text layers in the selection: selected text layers plus every text layer inside selected frames, groups, etc.
function collectSelectedText() {
  var nodes = [];
  var seen = {};
  var selection = figma.currentPage.selection;
  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    var found = node.type === "TEXT" ? [node]
      : "findAllWithCriteria" in node ? node.findAllWithCriteria({ types: ["TEXT"] }) : [];
    for (var j = 0; j < found.length; j++) {
      if (!seen[found[j].id]) { seen[found[j].id] = true; nodes.push(found[j]); }
    }
  }
  return nodes;
}

// Text ranges with the same font, size, line height and letter spacing are listed and edited together.
function segmentKey(fontName, fontSize, lineHeight, letterSpacing) {
  return [fontName.family, fontName.style, round(fontSize), formatLineHeight(lineHeight), formatLetterSpacing(letterSpacing)].join("|");
}

function getSelectionGroups(nodes) {
  var groups = {};
  var list = [];
  for (var i = 0; i < nodes.length; i++) {
    var segments = nodes[i].getStyledTextSegments(SEGMENT_FIELDS);
    var counted = {};
    for (var j = 0; j < segments.length; j++) {
      var seg = segments[j];
      var key = segmentKey(seg.fontName, seg.fontSize, seg.lineHeight, seg.letterSpacing);
      var group = groups[key];
      if (!group) {
        group = groups[key] = {
          id: key,
          name: seg.fontName.family + " " + seg.fontName.style,
          family: seg.fontName.family,
          style: seg.fontName.style,
          size: round(seg.fontSize),
          lineHeight: formatLineHeight(seg.lineHeight),
          letterSpacing: formatLetterSpacing(seg.letterSpacing),
          layers: 0,
        };
        list.push(group);
      }
      if (!counted[key]) { counted[key] = true; group.layers++; }
    }
  }
  list.sort(function (a, b) { return b.size - a.size || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  return list;
}

// Sends the selection's text when something is selected, otherwise the local text styles.
async function sendList() {
  if (hasSelection()) {
    var nodes = collectSelectedText();
    figma.ui.postMessage({
      type: "text-styles",
      mode: "selection",
      selectionKey: figma.currentPage.selection.map(function (n) { return n.id; }).join(","),
      layers: nodes.length,
      styles: getSelectionGroups(nodes),
    });
  } else {
    figma.ui.postMessage({ type: "text-styles", mode: "styles", styles: await getTextStyleList() });
  }
}

async function getTargetFamilyStyles(family, forcedStyle) {
  if (!family) return null;
  var familyStyles = await getFamilyStyles(family);
  if (!familyStyles.length) throw new Error('Font "' + family + '" is not available.');
  if (forcedStyle && familyStyles.indexOf(forcedStyle) === -1) {
    throw new Error('"' + family + '" has no "' + forcedStyle + '" style.');
  }
  return familyStyles;
}

// Same options as updateTextStyles, applied to the selected text ranges whose group key is in keys.
async function updateSelectionText(keys, opts) {
  var family = opts.family || null;
  var forcedStyle = opts.style || null;
  var familyStyles = await getTargetFamilyStyles(family, forcedStyle);

  var wanted = {};
  for (var i = 0; i < keys.length; i++) wanted[keys[i]] = true;

  var loaded = {};
  var results = {};
  var updated = 0;
  var nodes = collectSelectedText();

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var segments = node.getStyledTextSegments(SEGMENT_FIELDS);
    var changed = false;

    for (var j = 0; j < segments.length; j++) {
      var seg = segments[j];
      var key = segmentKey(seg.fontName, seg.fontSize, seg.lineHeight, seg.letterSpacing);
      if (!wanted[key]) continue;

      var from = seg.fontName;
      var fontName = family ? { family: family, style: forcedStyle || resolveFontStyle(familyStyles, from.style) } : from;
      var fontKey = fontName.family + "|" + fontName.style;

      try {
        // The font is set first, so line height and letter spacing only need the new font loaded.
        if (!loaded[fontKey]) {
          await figma.loadFontAsync(fontName);
          loaded[fontKey] = true;
        }
      } catch (e) {
        results[key] = { id: key, ok: false, error: 'Could not load "' + fontName.family + " " + fontName.style + '".' };
        continue;
      }

      try {
        if (family) node.setRangeFontName(seg.start, seg.end, fontName);
        if (opts.fontSize) node.setRangeFontSize(seg.start, seg.end, opts.fontSize);
        if (opts.lineHeight) node.setRangeLineHeight(seg.start, seg.end, opts.lineHeight);
        if (opts.letterSpacing) node.setRangeLetterSpacing(seg.start, seg.end, opts.letterSpacing);
      } catch (e) {
        results[key] = { id: key, ok: false, error: 'Could not edit "' + node.name + '": ' + ((e && e.message) || e) };
        continue;
      }

      changed = true;
      if (!results[key] || results[key].ok) {
        results[key] = {
          id: key,
          // The group's key after the edit, so the UI can keep it ticked.
          newId: segmentKey(fontName, opts.fontSize || seg.fontSize, opts.lineHeight || seg.lineHeight, opts.letterSpacing || seg.letterSpacing),
          ok: true,
          fallback: !!family && !forcedStyle && normalizeStyle(fontName.style) !== normalizeStyle(from.style),
          from: from.style,
          to: fontName.style,
        };
      }
    }
    if (changed) updated++;
  }

  return { updated: updated, results: Object.keys(results).map(function (k) { return results[k]; }) };
}

// ── Text styles ────────────────────────────────

// opts: { family, style, fontSize, lineHeight, letterSpacing }; any of them may be null to keep the style's value.
async function updateTextStyles(styleIds, opts) {
  var family = opts.family || null;
  var forcedStyle = opts.style || null;
  var familyStyles = await getTargetFamilyStyles(family, forcedStyle);

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
    if (opts.fontSize) textStyle.fontSize = opts.fontSize;
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
  refreshTimer = setTimeout(sendList, 150);
});

figma.on("selectionchange", function () {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(sendList, 150);
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
        await sendList();
        break;
      }

      case "refresh":
        await sendList();
        break;

      case "apply": {
        var inSelection = msg.mode === "selection";
        var result = inSelection
          ? await updateSelectionText(msg.styleIds, msg.options)
          : await updateTextStyles(msg.styleIds, msg.options);
        figma.ui.postMessage({ type: "apply-complete", mode: msg.mode, updated: result.updated, results: result.results });
        await sendList();
        if (result.updated) {
          var noun = inSelection ? " text layer" : " text style";
          figma.notify("Updated " + result.updated + noun + (result.updated === 1 ? "" : "s"));
        }
        break;
      }
    }
  } catch (err) {
    figma.ui.postMessage({ type: "apply-error", error: (err && err.message) || String(err) });
  }
};
