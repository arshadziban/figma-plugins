// Main thread: reports the selected frames, exports each one as a PDF and streams the bytes to the UI,
// which merges them into a single document. Read-only on the user's file.
import type { FrameInfo, LinkInfo, MainToUi, UiToMain } from './messages';

const EXPORTABLE = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP', 'SECTION']);

let cancelled = false;
let busy = false;

figma.showUI(__html__, { width: 400, height: 560, themeColors: true });

function send(msg: MainToUi): void {
  figma.ui.postMessage(msg);
}

/** Selected nodes in canvas reading order (top to bottom, then left to right). */
function selectedNodes(): SceneNode[] {
  const nodes = figma.currentPage.selection.filter((n) => EXPORTABLE.has(n.type));
  return nodes.sort((a, b) => {
    const dy = a.absoluteTransform[1][2] - b.absoluteTransform[1][2];
    return Math.abs(dy) > 1 ? dy : a.absoluteTransform[0][2] - b.absoluteTransform[0][2];
  });
}

const thumbed = new Set<string>();

async function publishSelection(): Promise<void> {
  const nodes = selectedNodes();
  const frames: FrameInfo[] = nodes.map((n) => ({ id: n.id, name: n.name, width: Math.round(n.width), height: Math.round(n.height) }));
  send({ type: 'selection', frames });
  for (const n of nodes) {
    if (thumbed.has(n.id)) continue;
    try {
      const bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 96 } });
      thumbed.add(n.id);
      send({ type: 'thumb', id: n.id, bytes });
    } catch {
      /* thumbnails are optional */
    }
  }
}

figma.on('selectionchange', () => void publishSelection());
figma.on('currentpagechange', () => {
  thumbed.clear();
  void publishSelection();
});

/** Top-level exported node that contains (or is) the node with this id, as an index into `ids`. */
async function pageIndexOf(destId: string, ids: string[]): Promise<number | undefined> {
  let n: BaseNode | null = await figma.getNodeByIdAsync(destId);
  while (n) {
    const i = ids.indexOf(n.id);
    if (i >= 0) return i;
    n = n.parent;
  }
  return undefined;
}

/** Prototype links and URL links on the node and its descendants, relative to the node's top-left. */
async function collectLinks(root: SceneNode, ids: string[]): Promise<LinkInfo[]> {
  const base = root.absoluteBoundingBox;
  if (!base) return [];
  const withReactions = (n: SceneNode): boolean => 'reactions' in n && n.reactions.length > 0;
  const nodes: SceneNode[] = [];
  if (withReactions(root)) nodes.push(root);
  if ('findAll' in root) nodes.push(...root.findAll(withReactions));
  const links: LinkInfo[] = [];
  for (const n of nodes) {
    const box = n.absoluteBoundingBox;
    if (!box || !('reactions' in n)) continue;
    const rect = { x: box.x - base.x, y: box.y - base.y, w: box.width, h: box.height };
    for (const r of n.reactions) {
      const actions = r.actions ?? (r.action ? [r.action] : []);
      for (const a of actions) {
        if (a.type === 'URL') links.push({ ...rect, url: a.url });
        else if (a.type === 'NODE' && a.destinationId && a.navigation !== 'OVERLAY' && a.navigation !== 'SWAP') {
          const destIndex = await pageIndexOf(a.destinationId, ids);
          if (destIndex !== undefined) links.push({ ...rect, destIndex });
        }
      }
    }
  }
  return links;
}

async function exportPages(ids: string[]): Promise<void> {
  if (busy) return;
  busy = true;
  cancelled = false;
  try {
    for (let i = 0; i < ids.length; i++) {
      if (cancelled) return;
      const node = await figma.getNodeByIdAsync(ids[i]!);
      if (!node || !EXPORTABLE.has(node.type)) throw new Error('A selected frame no longer exists.');
      const bytes = await (node as SceneNode).exportAsync({ format: 'PDF' });
      const links = await collectLinks(node as SceneNode, ids);
      send({ type: 'page', index: i, total: ids.length, bytes, links });
    }
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
  }
}

figma.ui.onmessage = (msg: UiToMain) => {
  if (msg.type === 'export') void exportPages(msg.ids);
  else if (msg.type === 'cancel') cancelled = true;
  else if (msg.type === 'close') figma.closePlugin();
};

void publishSelection();
