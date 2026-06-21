figma.showUI(__html__, { width: 480, height: 640, title: "Gradify" });

figma.ui.onmessage = async function (msg) {
  if (msg.type === "insert") {
    const bytes  = new Uint8Array(msg.bytes);
    const width  = msg.width  || 800;
    const height = msg.height || 800;

    const image = figma.createImage(bytes);
    const rect  = figma.createRectangle();
    rect.resize(width, height);
    rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
    rect.name  = "Grainy Gradient";

    const cx = figma.viewport.center.x - width  / 2;
    const cy = figma.viewport.center.y - height / 2;
    rect.x = cx;
    rect.y = cy;

    figma.currentPage.appendChild(rect);
    figma.currentPage.selection = [rect];
    figma.viewport.scrollAndZoomIntoView([rect]);
    figma.notify("Grainy gradient inserted ✦");
  }

  if (msg.type === "cancel") {
    figma.closePlugin();
  }
};
