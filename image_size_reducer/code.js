figma.showUI(__html__, { width: 400, height: 420, title: "Image Size Reducer" });

function getSelectionInfo() {
  const selection = figma.currentPage.selection;
  const validTypes = ["FRAME", "GROUP", "COMPONENT", "INSTANCE", "RECTANGLE", "ELLIPSE", "VECTOR", "TEXT", "SECTION"];

  const nodes = selection
    .filter(n => validTypes.includes(n.type) || n.type === "FRAME")
    .map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
      width: Math.round(node.width),
      height: Math.round(node.height),
    }));

  figma.ui.postMessage({ type: "selection", nodes });
}

figma.on("selectionchange", getSelectionInfo);
getSelectionInfo();

figma.ui.onmessage = async (msg) => {
  if (msg.type === "export") {
    const { nodeId, format, scale } = msg;
    const node = figma.getNodeById(nodeId);

    if (!node) {
      figma.ui.postMessage({ type: "error", message: "Node not found. Please re-select it." });
      return;
    }

    try {
      figma.ui.postMessage({ type: "progress", message: "Exporting from Figma..." });

      const bytes = await node.exportAsync({
        format: "PNG",  // UI handles JPEG/WebP re-encoding with quality binary search
        constraint: { type: "SCALE", value: scale },
      });

      figma.ui.postMessage({
        type: "exported",
        bytes: Array.from(bytes),
        name: node.name,
        format,
        width: Math.round(node.width * scale),
        height: Math.round(node.height * scale),
      });
    } catch (err) {
      figma.ui.postMessage({ type: "error", message: err.message || "Export failed." });
    }
  }

  if (msg.type === "resize") {
    figma.ui.resize(400, Math.min(Math.max(msg.height, 200), 700));
  }

  if (msg.type === "close") {
    figma.closePlugin();
  }
};
