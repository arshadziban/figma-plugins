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

    var CONTAINERS = {
      FRAME: true, GROUP: true, COMPONENT: true,
      COMPONENT_SET: true, INSTANCE: true, SECTION: true,
      BOOLEAN_OPERATION: true
    };

    var textNodes = [];

    function collect(node) {
      if (node.type === "TEXT") {
        textNodes.push(node);
        return;
      }
      if (CONTAINERS[node.type] && node.children) {
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
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].name = slug;
      }
      figma.ui.postMessage({
        type: "success",
        text: "Renamed " + nodes.length + " layer" + (nodes.length > 1 ? "s" : "") + " to \"" + slug + "\"."
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
