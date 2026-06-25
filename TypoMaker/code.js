figma.showUI(__html__, { width: 1000, height: 680, title: "TypoMaker" });

// ── Font cache ────────────────────────────────────────────────────────────────

var cachedFonts = null;

async function getAvailableFonts() {
  if (!cachedFonts) cachedFonts = await figma.listAvailableFontsAsync();
  return cachedFonts;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadFonts(styles) {
  const pairs = new Set();
  for (const s of styles) pairs.add(JSON.stringify({ family: s.fontFamily, style: s.fontWeight }));
  const pairArr = Array.from(pairs);
  await Promise.all(pairArr.map(function(p) {
    const parsed = JSON.parse(p);
    return figma.loadFontAsync({ family: parsed.family, style: parsed.style });
  }));
}

function nameToKey(name) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

async function getExistingStyleMap() {
  const map = {};
  for (const s of figma.getLocalTextStyles()) map[s.name] = s;
  return map;
}

async function createOrUpdateStyle(typoDef, existingMap, conflictAction) {
  const styleName = typoDef.figmaName;
  const existing = existingMap[styleName];

  if (existing) {
    if (conflictAction === "skip") return { action: "skipped", name: styleName };
    if (conflictAction === "duplicate") {
      typoDef = Object.assign({}, typoDef, { figmaName: styleName + " Copy" });
    }
    // "replace" falls through and modifies existing
  }

  await figma.loadFontAsync({ family: typoDef.fontFamily, style: typoDef.fontWeight });

  let style;
  if (existing && conflictAction === "replace") {
    style = existing;
  } else {
    style = figma.createTextStyle();
  }

  style.name = typoDef.figmaName;
  style.fontName = { family: typoDef.fontFamily, style: typoDef.fontWeight };
  style.fontSize = typoDef.fontSize;

  if (typoDef.lineHeightUnit === "PERCENT") {
    style.lineHeight = { value: typoDef.lineHeight, unit: "PERCENT" };
  } else if (typoDef.lineHeightUnit === "PIXELS") {
    style.lineHeight = { value: typoDef.lineHeight, unit: "PIXELS" };
  } else {
    style.lineHeight = { unit: "AUTO" };
  }

  style.letterSpacing = { value: typoDef.letterSpacing, unit: "PERCENT" };
  style.paragraphSpacing = typoDef.paragraphSpacing;
  style.textCase = typoDef.textCase;
  style.textDecoration = typoDef.textDecoration;

  return { action: existing && conflictAction === "replace" ? "replaced" : "created", name: style.name };
}

// ── Message handler ───────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {

    case "get-fonts": {
      const fonts = await getAvailableFonts();
      const seen = {};
      const families = [];
      for (var i = 0; i < fonts.length; i++) {
        const fam = fonts[i].fontName.family;
        if (!seen[fam]) { seen[fam] = true; families.push(fam); }
      }
      families.sort();
      figma.ui.postMessage({ type: "fonts-list", families });
      break;
    }

    case "get-font-weights": {
      const fonts = await getAvailableFonts();
      const weights = [];
      for (var i = 0; i < fonts.length; i++) {
        if (fonts[i].fontName.family === msg.family) weights.push(fonts[i].fontName.style);
      }
      figma.ui.postMessage({ type: "font-weights", weights, family: msg.family });
      break;
    }

    case "check-conflicts": {
      const existingMap = await getExistingStyleMap();
      const conflicts = msg.styles
        .filter(s => s.enabled && existingMap[s.figmaName])
        .map(s => s.figmaName);
      figma.ui.postMessage({ type: "conflict-check-result", conflicts });
      break;
    }

    case "import-styles": {
      const { styles, conflictAction } = msg;
      const existingMap = await getExistingStyleMap();
      const results = { created: 0, replaced: 0, skipped: 0, duplicated: 0, errors: [] };

      for (const style of styles) {
        if (!style.enabled) continue;
        try {
          const res = await createOrUpdateStyle(style, existingMap, conflictAction);
          if (res.action === "created") results.created++;
          else if (res.action === "replaced") results.replaced++;
          else if (res.action === "skipped") results.skipped++;
          else if (res.action === "duplicated") results.duplicated++;
        } catch (err) {
          results.errors.push({ name: style.figmaName, error: err.message });
        }
      }

      figma.ui.postMessage({ type: "import-complete", results });
      break;
    }

    case "export-json": {
      figma.ui.postMessage({ type: "export-data", data: msg.data });
      break;
    }

    case "close":
      figma.closePlugin();
      break;
  }
};
