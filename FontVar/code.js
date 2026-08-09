figma.showUI(__html__, { width: 360, height: 480, title: "FontVar" });

const COLLECTION_NAME = "FontVar";
const FAMILY_VAR_NAME = "Font/Family";
const SIZE_VAR_NAME = "Font/Size";

var cachedFonts = null;

async function getAvailableFonts() {
  if (!cachedFonts) cachedFonts = await figma.listAvailableFontsAsync();
  return cachedFonts;
}

async function getOrCreateCollection() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find(function (c) { return c.name === COLLECTION_NAME; });
  if (!collection) collection = figma.variables.createVariableCollection(COLLECTION_NAME);
  return collection;
}

async function getOrCreateVariable(collection, name, type) {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const existing = allVars.find(function (v) {
    return v.name === name && v.variableCollectionId === collection.id;
  });
  if (existing) return existing;
  return figma.variables.createVariable(name, collection, type);
}

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

    case "save-variable": {
      try {
        const collection = await getOrCreateCollection();
        const modeId = collection.modes[0].modeId;

        const familyVar = await getOrCreateVariable(collection, FAMILY_VAR_NAME, "STRING");
        familyVar.setValueForMode(modeId, msg.fontFamily);

        const sizeVar = await getOrCreateVariable(collection, SIZE_VAR_NAME, "FLOAT");
        sizeVar.setValueForMode(modeId, msg.fontSize);

        figma.ui.postMessage({
          type: "save-complete",
          fontFamily: msg.fontFamily,
          fontSize: msg.fontSize,
          collection: collection.name,
        });
      } catch (err) {
        figma.ui.postMessage({ type: "save-error", error: err.message });
      }
      break;
    }

    case "close":
      figma.closePlugin();
      break;
  }
};
