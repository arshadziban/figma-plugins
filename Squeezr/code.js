figma.showUI(__html__, { width: 400, height: 560, title: "Squeezr" });

async function getSelectionInfo() {
  const selection = figma.currentPage.selection;
  const validTypes = ["FRAME", "GROUP", "COMPONENT", "INSTANCE", "RECTANGLE", "ELLIPSE", "VECTOR", "TEXT", "SECTION"];
  const filtered = selection.filter(n => validTypes.includes(n.type));

  const nodes = [];
  for (const node of filtered) {
    let thumbnail = null;
    try {
      const maxDim = Math.max(node.width, node.height, 1);
      const scale = Math.min(1, 128 / maxDim);
      const bytes = await node.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: Math.max(scale, 0.01) },
      });
      thumbnail = figma.base64Encode(bytes);
    } catch (err) {
      thumbnail = null;
    }
    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      width: Math.round(node.width),
      height: Math.round(node.height),
      thumbnail,
    });
  }

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
        nodeId,
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
