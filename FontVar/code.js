figma.showUI(__html__, { width: 360, height: 480, title: "FontVar" });

var cachedFonts = null;

async function getAvailableFonts() {
  if (!cachedFonts) cachedFonts = await figma.listAvailableFontsAsync();
  return cachedFonts;
}

async function getExistingStyleMap() {
  const map = {};
  const styles = await figma.getLocalTextStylesAsync();
  for (var i = 0; i < styles.length; i++) map[styles[i].name] = styles[i];
  return map;
}

figma.ui.onmessage = async (msg) => {
  try {
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

      case "save-style": {
        const fontFamily = msg.fontFamily;
        const fontWeight = msg.fontWeight || "Regular";
        const fontSize = msg.fontSize;
        const styleName = msg.styleName;

        await figma.loadFontAsync({ family: fontFamily, style: fontWeight });

        const existingMap = await getExistingStyleMap();
        const existing = existingMap[styleName];
        const style = existing || figma.createTextStyle();

        style.name = styleName;
        style.fontName = { family: fontFamily, style: fontWeight };
        style.fontSize = fontSize;

        figma.ui.postMessage({
          type: "save-complete",
          fontFamily: fontFamily,
          fontSize: fontSize,
          styleName: style.name,
          created: !existing,
        });
        break;
      }

      case "close":
        figma.closePlugin();
        break;
    }
  } catch (err) {
    figma.ui.postMessage({ type: "save-error", error: err.message });
  }
};
