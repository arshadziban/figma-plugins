figma.showUI(__html__, { width: 320, height: 420, title: "TextFlow" });

figma.ui.onmessage = function (msg) {
  if (msg.type === "apply-color") {
    var hex = msg.color;
    var nodes = figma.currentPage.selection;

    if (nodes.length === 0) {
      figma.ui.postMessage({ type: "error", text: "Select at least one text layer first." });
      return;
    }

    var changed = 0;

    function applyToNode(node) {
      if (node.type === "TEXT") {
        var rgb = hexToRgb(hex);
        if (rgb) {
          figma.loadFontAsync(node.fontName).then(function () {
            node.fills = [{ type: "SOLID", color: rgb }];
          });
          changed++;
        }
      }
      if ("children" in node) {
        node.children.forEach(applyToNode);
      }
    }

    nodes.forEach(applyToNode);

    if (changed === 0) {
      figma.ui.postMessage({ type: "error", text: "No text layers found in the selection." });
    } else {
      figma.ui.postMessage({ type: "success", text: "Color applied to " + changed + " text layer(s)." });
    }
  }

  if (msg.type === "cancel") {
    figma.closePlugin();
  }
};

function hexToRgb(hex) {
  var clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  var r = parseInt(clean.substring(0, 2), 16) / 255;
  var g = parseInt(clean.substring(2, 4), 16) / 255;
  var b = parseInt(clean.substring(4, 6), 16) / 255;
  return { r: r, g: g, b: b };
}
