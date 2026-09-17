figma.showUI(__html__, { width: 560, height: 720, title: "Type Maker" });

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

async function getOrCreateCollection(name) {
  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (var i = 0; i < collections.length; i++) {
    if (collections[i].name === name) return collections[i];
  }
  return figma.variables.createVariableCollection(name);
}

async function getExistingVariableMap(collectionId) {
  var map = {};
  var vars = await figma.variables.getLocalVariablesAsync("FLOAT");
  for (var i = 0; i < vars.length; i++) {
    if (vars[i].variableCollectionId === collectionId) map[vars[i].name] = vars[i];
  }
  return map;
}

async function createOrUpdateVariable(collection, modeId, existingMap, name, value) {
  var v = existingMap[name];
  if (!v) {
    v = figma.variables.createVariable(name, collection, "FLOAT");
    existingMap[name] = v;
  }
  v.setValueForMode(modeId, value);
  return v;
}

function parseLetterSpacing(raw) {
  if (typeof raw === "number") return { value: raw, unit: "PERCENT" };
  var s = String(raw).trim();
  if (s.indexOf("%") !== -1) {
    return { value: parseFloat(s) || 0, unit: "PERCENT" };
  }
  return { value: parseFloat(s) || 0, unit: "PIXELS" };
}

async function generateVariablesAndStyles(rows, opts) {
  var collectionName = opts.collectionName || "Typography";
  var makeFontSizeVar = !!opts.varFontSize;
  var makeLineHeightVar = !!opts.varLineHeight;
  var makeLetterSpacingVar = !!opts.varLetterSpacing;
  var alsoCreateStyles = !!opts.createStyles;
  var defaultFontFamily = opts.fontFamily || "Inter";
  var defaultFontWeight = opts.fontWeight || "Regular";

  var collection = await getOrCreateCollection(collectionName);
  var modeId = collection.modes[0].modeId;
  var existingVars = await getExistingVariableMap(collection.id);
  var existingStyles = await getExistingStyleMap();

  var loadedFonts = {};
  async function ensureFontLoaded(family, style) {
    var key = family + "|" + style;
    if (loadedFonts[key]) return;
    await figma.loadFontAsync({ family: family, style: style });
    loadedFonts[key] = true;
  }

  if (alsoCreateStyles) {
    var hasPerRowFont = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].fontFamily) hasPerRowFont = true;
    }
    if (!hasPerRowFont) await ensureFontLoaded(defaultFontFamily, defaultFontWeight);
  }

  var created = { variables: 0, styles: 0 };

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.enabled) continue;
    var baseName = row.name.trim();
    if (!baseName) continue;

    var sizeVal = row.size;
    var lineHeightVal = row.lineHeight;
    var ls = parseLetterSpacing(row.letterSpacing);

    if (makeFontSizeVar) {
      await createOrUpdateVariable(collection, modeId, existingVars, baseName + "/size", sizeVal);
      created.variables++;
    }
    if (makeLineHeightVar) {
      await createOrUpdateVariable(collection, modeId, existingVars, baseName + "/line-height", lineHeightVal);
      created.variables++;
    }
    if (makeLetterSpacingVar) {
      await createOrUpdateVariable(collection, modeId, existingVars, baseName + "/letter-spacing", ls.value);
      created.variables++;
    }

    if (alsoCreateStyles) {
      var rowFontFamily = row.fontFamily || defaultFontFamily;
      var rowFontStyle = row.fontStyle || defaultFontWeight;
      await ensureFontLoaded(rowFontFamily, rowFontStyle);

      var style = existingStyles[baseName] || figma.createTextStyle();
      style.name = baseName;
      style.fontName = { family: rowFontFamily, style: rowFontStyle };
      style.fontSize = row.size;
      style.lineHeight = { value: row.lineHeight, unit: "PIXELS" };
      style.letterSpacing = { value: ls.value, unit: ls.unit };
      existingStyles[baseName] = style;
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
  rows.sort(function (a, b) { return b.size - a.size; });
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
        rows.push({
          name: "",
          fontFamily: fontFamily,
          fontStyle: fontStyle,
          size: size,
          lineHeight: lineHeightPx || Math.round(size * 1.4),
          letterSpacing: letterSpacing,
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
        var result = await generateVariablesAndStyles(msg.rows, msg.options);
        figma.ui.postMessage({
          type: "generate-complete",
          variables: result.variables,
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
