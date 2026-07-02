figma.showUI(__html__, { width: 340, height: 320, title: "Slugify" });

figma.ui.onmessage = function (msg) {
  if (msg.type === "slugify") {
    var slug = msg.text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s_-]/g, "")
      .replace(/[\s-]+/g, "_");

    figma.ui.postMessage({ type: "result", slug: slug });
  }

  if (msg.type === "apply") {
    var nodes = figma.currentPage.selection;
    var slug = msg.slug;

    if (nodes.length === 0) {
      figma.ui.postMessage({ type: "error", text: "Select a layer first." });
      return;
    }

    var textNodes = [];
    var visitedCount = 0;

    function collect(node) {
      visitedCount++;
      if (node.type === "TEXT") {
        textNodes.push(node);
        return;
      }
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          collect(node.children[i]);
        }
      }
    }

    for (var i = 0; i < nodes.length; i++) {
      collect(nodes[i]);
    }

    // No text nodes found — rename the selected layers instead
    if (textNodes.length === 0) {
      var seenTypes = {};
      var typeList = [];
      for (var i = 0; i < nodes.length; i++) {
        if (!seenTypes[nodes[i].type]) { seenTypes[nodes[i].type] = true; typeList.push(nodes[i].type); }
        nodes[i].name = slug;
      }
      figma.ui.postMessage({
        type: "success",
        text: "No text layers found inside [" + typeList.join(", ") + "] (" + visitedCount + " nodes scanned). Renamed " + nodes.length + " layer" + (nodes.length > 1 ? "s" : "") + " to \"" + slug + "\"."
      });
      return;
    }

    function getFontsForNode(node) {
      var seen = {};
      var fonts = [];
      if (typeof node.fontName === "symbol") {
        for (var j = 0; j < node.characters.length; j++) {
          var f = node.getRangeFontName(j, j + 1);
          if (typeof f !== "symbol") {
            var key = f.family + "|" + f.style;
            if (!seen[key]) { seen[key] = true; fonts.push(f); }
          }
        }
      } else {
        fonts.push(node.fontName);
      }
      return fonts;
    }

    var promises = textNodes.map(function (node) {
      var fonts = getFontsForNode(node);
      return Promise.all(fonts.map(function (f) {
        return figma.loadFontAsync(f);
      })).then(function () {
        node.characters = slug;
      });
    });

    Promise.all(promises).then(function () {
      figma.ui.postMessage({
        type: "success",
        text: "Applied to " + textNodes.length + " text layer" + (textNodes.length > 1 ? "s" : "") + "."
      });
    }).catch(function (err) {
      figma.ui.postMessage({ type: "error", text: "Failed: " + err.message });
    });
  }

  if (msg.type === "cancel") {
    figma.closePlugin();
  }
};
