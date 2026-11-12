import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import type { FrameInfo, LinkInfo, MainToUi, UiToMain } from './messages';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const post = (msg: UiToMain): void => parent.postMessage({ pluginMessage: msg }, '*');

interface Row extends FrameInfo {
  checked: boolean;
  thumb?: string;
}

let rows: Row[] = [];
let pages: Uint8Array[] = [];
let pageLinks: LinkInfo[][] = [];
let working = false;

const listEl = $<HTMLUListElement>('list');
const nameEl = $<HTMLInputElement>('filename');
const mergeBtn = $<HTMLButtonElement>('merge');
const mergeLabel = $('merge-label');
const statusEl = $('status');
const statusText = $('status-text');
const countEl = $('count');
const emptyEl = $('empty');
const toolsEl = $('tools');
const allBtn = $<HTMLButtonElement>('toggle-all');
const progressEl = $('progress');
const progressBar = $('progress-bar');
const previewEl = $('preview-name');

/** File name without illegal characters; always ends in .pdf. */
function fileName(): string {
  const base = nameEl.value.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  return (base || 'merged') + '.pdf';
}

type Kind = 'info' | 'error' | 'success';

function setStatus(text: string, kind: Kind | boolean = 'info'): void {
  const k: Kind = kind === true ? 'error' : kind === false ? 'info' : kind;
  statusText.textContent = text;
  statusEl.dataset.kind = k;
  statusEl.hidden = !text;
}

function setProgress(done: number, total: number): void {
  progressEl.hidden = total === 0;
  progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

const ICON = {
  grip: '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="2.5" r="1"/><circle cx="8" cy="2.5" r="1"/><circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/><circle cx="4" cy="9.5" r="1"/><circle cx="8" cy="9.5" r="1"/></svg>',
  up: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5 6 4.5l3 3"/></svg>',
  down: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5l3-3"/></svg>',
};

let dragFrom = -1;

function move(from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || to >= rows.length) return;
  const [item] = rows.splice(from, 1);
  rows.splice(to, 0, item!);
  render();
}

function render(): void {
  listEl.textContent = '';
  let page = 0;
  rows.forEach((r, i) => {
    const li = document.createElement('li');
    li.className = r.checked ? '' : 'off';
    li.draggable = !working;
    li.ondragstart = (e) => {
      dragFrom = i;
      li.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', String(i));
    };
    li.ondragend = () => {
      dragFrom = -1;
      li.classList.remove('dragging');
      listEl.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
    };
    li.ondragover = (e) => {
      e.preventDefault();
      li.classList.add('over');
    };
    li.ondragleave = () => li.classList.remove('over');
    li.ondrop = (e) => {
      e.preventDefault();
      move(dragFrom, i);
    };

    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.innerHTML = ICON.grip;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.checked;
    cb.disabled = working;
    cb.setAttribute('aria-label', `Include ${r.name}`);
    cb.onchange = () => {
      r.checked = cb.checked;
      render();
    };

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (r.thumb) thumb.style.backgroundImage = `url(${r.thumb})`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const n = document.createElement('div');
    n.className = 'name';
    n.textContent = r.name;
    n.title = r.name;
    const sz = document.createElement('div');
    sz.className = 'size';
    sz.textContent = `${r.width} × ${r.height}`;
    meta.append(n, sz);

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = r.checked ? String(++page) : '–';

    const mk = (icon: string, title: string, delta: number): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'icon';
      b.innerHTML = icon;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = working || i + delta < 0 || i + delta >= rows.length;
      b.onclick = () => move(i, i + delta);
      return b;
    };
    const arrows = document.createElement('div');
    arrows.className = 'arrows';
    arrows.append(mk(ICON.up, 'Move up', -1), mk(ICON.down, 'Move down', 1));

    li.append(grip, cb, thumb, meta, arrows, badge);
    listEl.append(li);
  });
  update();
}

function update(): void {
  const n = rows.filter((r) => r.checked).length;
  const has = rows.length > 0;
  countEl.textContent = has ? `${n} of ${rows.length} included` : '';
  emptyEl.hidden = has;
  listEl.hidden = !has;
  toolsEl.hidden = !has;
  allBtn.textContent = n === rows.length ? 'Deselect all' : 'Select all';
  allBtn.disabled = working;
  previewEl.textContent = fileName();
  mergeBtn.disabled = working || n === 0;
  mergeLabel.textContent = working ? 'Merging…' : n > 0 ? `Merge ${n} page${n === 1 ? '' : 's'}` : 'Merge to PDF';
}

/** Existing link annotations of a page, with the URI they open (if any). */
function readAnnots(page: PDFPage): Array<{ dict: PDFDict; uri?: string; internal: boolean; rect: number[] }> {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const result: Array<{ dict: PDFDict; uri?: string; internal: boolean; rect: number[] }> = [];
  if (!annots) return result;
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookupMaybe(i, PDFDict);
    if (!dict || dict.lookup(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
    const action = dict.lookupMaybe(PDFName.of('A'), PDFDict);
    const uriObj = action?.lookup(PDFName.of('URI'));
    const uri = uriObj instanceof PDFString ? uriObj.decodeText() : undefined;
    const internal = !uri && (dict.has(PDFName.of('Dest')) || action !== undefined);
    const rect = (dict.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray() ?? []).map((n) => Number(n.toString()));
    result.push({ dict, uri, internal, rect });
  }
  return result;
}

function addLinkAnnot(out: PDFDocument, page: PDFPage, rect: number[], action: Record<string, unknown>): void {
  const ref = out.context.register(
    out.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4, P: page.ref, A: action } as never),
  );
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of('Annots'), out.context.obj([ref]));
}

async function merge(): Promise<void> {
  const out = await PDFDocument.create();
  for (const bytes of pages) {
    const src = await PDFDocument.load(bytes);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  const outPages = out.getPages();
  outPages.forEach((page, i) => {
    const { height } = page.getSize();
    // Internal jumps inside a single-frame export point at pages that no longer exist: drop them
    // (rebuilt below from the prototype connections). Re-point everything else at the merged page.
    const kept = new Set<string>();
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    const existing = readAnnots(page);
    if (annots) {
      const keep = existing.filter((a) => !a.internal);
      const refs = keep.map((a) => out.context.getObjectRef(a.dict)).filter((r) => r !== undefined);
      page.node.set(PDFName.of('Annots'), out.context.obj(refs));
      for (const a of keep) {
        a.dict.set(PDFName.of('P'), page.ref);
        if (a.uri) kept.add(a.uri);
      }
    }
    for (const l of pageLinks[i] ?? []) {
      const rect = [l.x, height - (l.y + l.h), l.x + l.w, height - l.y];
      if (l.url) {
        // Figma already exported this one; don't add a second, overlapping link.
        if (kept.has(l.url)) continue;
        addLinkAnnot(out, page, rect, { Type: 'Action', S: 'URI', URI: PDFString.of(l.url) });
      } else if (l.destIndex !== undefined && outPages[l.destIndex]) {
        const dest = out.context.obj([outPages[l.destIndex]!.ref, 'Fit']);
        addLinkAnnot(out, page, rect, { Type: 'Action', S: 'GoTo', D: dest });
      }
    }
  });
  const data = await out.save();
  const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setStatus(`Saved ${a.download} · ${out.getPageCount()} pages`, 'success');
}

mergeBtn.onclick = () => {
  const ids = rows.filter((r) => r.checked).map((r) => r.id);
  if (!ids.length) return;
  pages = [];
  pageLinks = [];
  working = true;
  setStatus('Exporting pages…');
  setProgress(0, ids.length);
  render();
  post({ type: 'export', ids });
};

allBtn.onclick = () => {
  const all = rows.some((r) => !r.checked);
  rows.forEach((r) => (r.checked = all));
  render();
};
nameEl.oninput = () => (previewEl.textContent = fileName());
nameEl.onkeydown = (e) => {
  if (e.key === 'Enter' && !mergeBtn.disabled) mergeBtn.click();
};

onmessage = async (event) => {
  const msg = event.data.pluginMessage as MainToUi | undefined;
  if (!msg) return;
  if (msg.type === 'selection') {
    const old = new Map(rows.map((r) => [r.id, r]));
    // Keep the user's manual order for frames that stay selected; new ones follow in canvas order.
    const kept = rows.filter((r) => msg.frames.some((f) => f.id === r.id)).map((r) => r.id);
    const byId = new Map(msg.frames.map((f) => [f.id, f]));
    const order = [...kept, ...msg.frames.map((f) => f.id).filter((id) => !kept.includes(id))];
    rows = order.map((id) => {
      const f = byId.get(id)!;
      const prev = old.get(id);
      return { ...f, checked: prev ? prev.checked : true, thumb: prev?.thumb };
    });
    if (!working && statusEl.dataset.kind !== 'error') setStatus('');
    render();
  } else if (msg.type === 'thumb') {
    const row = rows.find((r) => r.id === msg.id);
    if (row) {
      row.thumb = URL.createObjectURL(new Blob([msg.bytes.slice().buffer as ArrayBuffer], { type: 'image/png' }));
      if (!working) render();
    }
  } else if (msg.type === 'page') {
    pages.push(msg.bytes);
    pageLinks.push(msg.links);
    setStatus(`Exporting pages… ${msg.index + 1} of ${msg.total}`);
    setProgress(msg.index + 1, msg.total);
    if (pages.length === msg.total) {
      setStatus('Merging…');
      try {
        await merge();
      } catch (e) {
        setStatus(`Merge failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
      working = false;
      setProgress(0, 0);
      render();
    }
  } else if (msg.type === 'error') {
    working = false;
    setProgress(0, 0);
    setStatus(msg.message, true);
    render();
  }
};

render();
