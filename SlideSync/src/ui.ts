// UI iframe: frame list, options, progress, warnings; builds the .pptx and triggers the download.
import { decideLayout } from './geometry';
import { buildPptx } from './pptx';
import type { DeckLayout, ExportOptions, FrameInfo, MainToUi, SlideModel, SlideWarning, UiToMain, WarningKind } from './slideModel';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const post = (msg: UiToMain): void => parent.postMessage({ pluginMessage: msg }, '*');

type View = 'idle' | 'exporting' | 'done' | 'error' | 'cancelled';

let frames: FrameInfo[] = [];
const excluded = new Set<string>();
const thumbs = new Map<string, string>();
let view: View = 'idle';
let layout: DeckLayout = { widthIn: 10, heightIn: 5.625 };
let slides: SlideModel[] = [];
let images: Record<string, Uint8Array> = {};
let dragId: string | null = null;
let openMenuId: string | null = null;
const userCollapsed = new Set<string>();

// ---- Custom dropdown ----------------------------------------------------------

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  badge?: string;
}

const CHECK = '<svg class="check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const selectValues = new Map<string, string>();
let closeOpenSelect: (() => void) | null = null;

/** Replaces a native <select> with a styled, keyboard-accessible menu. Value is read with selectValue(id). */
function createSelect(id: string, choices: SelectOption[], initial: string): void {
  const host = $(id);
  selectValues.set(id, initial);
  const trigger = el('button', 'select-trigger');
  trigger.type = 'button';
  trigger.id = `${id}Trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  host.append(trigger);
  let menu: HTMLElement | null = null;
  let active = 0;

  const current = (): SelectOption => choices.find((c) => c.value === selectValues.get(id)) ?? (choices[0] as SelectOption);
  const paint = (): void => {
    const c = current();
    trigger.textContent = '';
    trigger.append(el('span', 'value', c.label));
    if (c.badge) trigger.append(el('span', 'badge', c.badge));
    trigger.insertAdjacentHTML('beforeend', CHEVRON);
  };
  const close = (): void => {
    menu?.remove();
    menu = null;
    trigger.setAttribute('aria-expanded', 'false');
    closeOpenSelect = null;
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('resize', close);
  };
  const onOutside = (e: Event): void => {
    if (menu && !menu.contains(e.target as Node) && !trigger.contains(e.target as Node)) close();
  };
  const choose = (value: string): void => {
    selectValues.set(id, value);
    paint();
    close();
    trigger.focus();
  };
  const highlight = (): void => {
    menu?.querySelectorAll('.select-item').forEach((n, i) => n.classList.toggle('active', i === active));
    menu?.querySelectorAll('.select-item')[active]?.scrollIntoView({ block: 'nearest' });
  };
  const open = (): void => {
    closeOpenSelect?.();
    menu = el('div', 'select-menu');
    menu.setAttribute('role', 'listbox');
    choices.forEach((c, i) => {
      const item = el('button', 'select-item');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(c.value === selectValues.get(id)));
      item.insertAdjacentHTML('beforeend', CHECK);
      const txt = el('div', 'txt');
      txt.append(el('div', 'lbl', c.label));
      if (c.hint) txt.append(el('div', 'hint', c.hint));
      item.append(txt);
      item.addEventListener('click', () => choose(c.value));
      item.addEventListener('mousemove', () => {
        active = i;
        highlight();
      });
      menu?.append(item);
    });
    document.body.append(menu);
    // Fixed positioning so the menu is never clipped by the scrolling body; flip up if there is no room below.
    const r = trigger.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.width = `${r.width}px`;
    const below = window.innerHeight - r.bottom - 8;
    if (menu.offsetHeight > below && r.top > below) menu.style.bottom = `${window.innerHeight - r.top + 4}px`;
    else menu.style.top = `${r.bottom + 4}px`;
    active = Math.max(0, choices.findIndex((c) => c.value === selectValues.get(id)));
    highlight();
    trigger.setAttribute('aria-expanded', 'true');
    closeOpenSelect = close;
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', close);
  };

  trigger.addEventListener('click', () => (menu ? close() : open()));
  trigger.addEventListener('keydown', (e) => {
    if (!menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      open();
    } else if (menu) {
      if (e.key === 'ArrowDown') active = Math.min(choices.length - 1, active + 1);
      else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
      else if (e.key === 'Enter' || e.key === ' ') choose((choices[active] as SelectOption).value);
      else if (e.key === 'Escape' || e.key === 'Tab') close();
      else return;
      e.preventDefault();
      highlight();
    }
  });
  paint();
}

const selectValue = (id: string): string => selectValues.get(id) ?? '';

createSelect(
  'resolution',
  [
    { value: '1', label: '1x', hint: 'Smallest file, softer images' },
    { value: '2', label: '2x', hint: 'Sharp on most screens' },
    { value: '3', label: '3x', hint: 'Sharpest, largest file', badge: 'Recommended' },
  ],
  '3',
);
createSelect(
  'gradientText',
  [
    { value: 'solid', label: 'Keep editable', hint: 'Text stays text, in the gradient\'s average colour' },
    { value: 'image', label: 'Keep the look', hint: 'Exact gradient, but exported as a picture' },
  ],
  'solid',
);

// ---- Collapsible sections ---------------------------------------------------

function applyCollapse(): void {
  const forced = view === 'exporting' ? ['secFrames', 'secOptions'] : view === 'done' || view === 'error' || view === 'cancelled' ? ['secFrames', 'secOptions'] : [];
  for (const id of ['secFrames', 'secOptions', 'secWarnings']) {
    $(id).classList.toggle('collapsed', forced.includes(id) || userCollapsed.has(id));
  }
}

document.querySelectorAll<HTMLElement>('[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.toggle;
    if (!id) return;
    if (userCollapsed.has(id)) userCollapsed.delete(id);
    else userCollapsed.add(id);
    // A manual click wins over the automatic collapse for that section.
    if (view !== 'idle') $(id).classList.toggle('collapsed');
    else applyCollapse();
  });
});

// ---- Frame list ---------------------------------------------------------------

/** Keep the user's drag order for frames that stay selected; append new ones. */
function mergeFrames(incoming: FrameInfo[]): FrameInfo[] {
  const byId = new Map(incoming.map((f) => [f.id, f]));
  const kept = frames.filter((f) => byId.has(f.id)).map((f) => byId.get(f.id) as FrameInfo);
  const keptIds = new Set(kept.map((f) => f.id));
  return [...kept, ...incoming.filter((f) => !keptIds.has(f.id))];
}

function includedFrames(): FrameInfo[] {
  return frames.filter((f) => !excluded.has(f.id));
}

function move(id: string, to: 'top' | 'bottom'): void {
  const i = frames.findIndex((f) => f.id === id);
  const item = frames.splice(i, 1)[0];
  if (!item) return;
  if (to === 'top') frames.unshift(item);
  else frames.push(item);
  renderFrames();
}

function reorder(fromId: string | null, toId: string): void {
  if (!fromId || fromId === toId) return;
  const from = frames.findIndex((f) => f.id === fromId);
  const to = frames.findIndex((f) => f.id === toId);
  const moved = frames.splice(from, 1)[0];
  if (!moved) return;
  frames.splice(to, 0, moved);
  renderFrames();
}

function menuFor(f: FrameInfo): HTMLElement {
  const menu = el('div', 'menu');
  const items: Array<[string, () => void]> = [
    ['Select in Figma', () => post({ type: 'reveal', nodeId: f.id })],
    ['Move to top', () => move(f.id, 'top')],
    ['Move to bottom', () => move(f.id, 'bottom')],
    [
      excluded.has(f.id) ? 'Include in export' : 'Exclude from export',
      () => {
        if (excluded.has(f.id)) excluded.delete(f.id);
        else excluded.add(f.id);
        renderFrames();
      },
    ],
  ];
  for (const [label, action] of items) {
    const b = el('button', '', label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenuId = null;
      action();
      renderFrames();
    });
    menu.append(b);
  }
  return menu;
}

function frameRow(f: FrameInfo): HTMLLIElement {
  const li = el('li', `frame${excluded.has(f.id) ? ' excluded' : ''}`);
  li.draggable = true;
  const thumbUrl = thumbs.get(f.id);
  const thumb = el('img', 'thumb');
  if (thumbUrl) thumb.src = thumbUrl;
  else thumb.alt = '';
  const info = el('div', 'info');
  info.append(el('div', 'name', f.name), el('div', 'size', `${f.width} × ${f.height}`));
  const ratio = el('span', f.is16x9 ? 'ratio' : 'ratio off', f.is16x9 ? '16:9' : ratioLabel(f));
  const more = el('button', 'more', '⋯');
  more.title = 'More';
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenuId = openMenuId === f.id ? null : f.id;
    renderFrames();
  });
  li.append(el('span', 'grip', '⋮⋮'), thumb, info, ratio, more);
  if (openMenuId === f.id) li.append(menuFor(f));
  li.addEventListener('dragstart', () => {
    dragId = f.id;
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => {
    dragId = null;
    renderFrames();
  });
  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    li.classList.add('over');
  });
  li.addEventListener('dragleave', () => li.classList.remove('over'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    reorder(dragId, f.id);
  });
  return li;
}

/** Friendly ratio such as "3:2" or "4:3"; falls back to one decimal. */
function ratioLabel(f: FrameInfo): string {
  const r = f.width / f.height;
  for (const [w, h] of [[4, 3], [3, 2], [1, 1], [3, 4], [2, 3], [21, 9], [16, 10], [9, 16]] as const) {
    if (Math.abs(r - w / h) < 0.01) return `${w}:${h}`;
  }
  return `${r.toFixed(2)}:1`;
}

function renderFrames(): void {
  const list = $('frames');
  list.textContent = '';
  for (const f of frames) list.append(frameRow(f));
  $('count').textContent = String(frames.length);
  $('empty').classList.toggle('hidden', frames.length > 0);
  refreshButton();
}

document.addEventListener('click', () => {
  if (openMenuId !== null) {
    openMenuId = null;
    renderFrames();
  }
});

// ---- Primary button --------------------------------------------------------------

/** One line under the frame list: how many slides, and whether anything will be letterboxed. */
function refreshSummary(): void {
  const host = $('summary');
  const chosen = includedFrames();
  host.textContent = '';
  host.classList.remove('warn');
  if (chosen.length === 0 || view === 'exporting') {
    host.classList.add('hidden');
    return;
  }
  const slidesText = `${chosen.length} slide${chosen.length === 1 ? '' : 's'}`;
  const layoutInfo = decideLayout(chosen.map((f) => ({ w: f.width, h: f.height })));
  const letterboxed = layoutInfo.custom ? 0 : chosen.filter((f) => !f.is16x9).length;
  host.classList.remove('hidden');
  host.classList.toggle('warn', letterboxed > 0);
  host.append(el('span', 'dot'));
  host.append(
    document.createTextNode(
      letterboxed > 0
        ? `${slidesText} · ${letterboxed} not 16:9, will be letterboxed`
        : layoutInfo.custom
          ? `${slidesText} · custom slide size ${layoutInfo.widthIn} × ${layoutInfo.heightIn} in`
          : `${slidesText} · 16:9`,
    ),
  );
}

function refreshButton(): void {
  refreshSummary();
  const btn = $<HTMLButtonElement>('export');
  const n = includedFrames().length;
  btn.disabled = view === 'exporting' || n === 0;
  btn.textContent = n === 0 ? 'Select a frame to export' : 'Export to .pptx';
}

// ---- Status panel -----------------------------------------------------------------

function showStatus(node: HTMLElement | null): void {
  const host = $('status');
  host.textContent = '';
  if (node) host.append(node);
  host.classList.toggle('hidden', node === null);
}

function stateCard(kind: 'err' | 'cancel' | 'ok', glyph: string, title: string, message: string): HTMLElement {
  const card = el('div', 'state');
  card.append(el('div', `icon ${kind}`, glyph), el('h3', kind === 'err' ? 'err' : '', title), el('p', '', message));
  return card;
}

function progressView(): { root: HTMLElement; label: HTMLElement; percent: HTMLElement; fill: HTMLElement; sub: HTMLElement } {
  const root = el('div');
  const row = el('div', 'progress-row');
  const label = el('span', '', 'Starting…');
  const percent = el('span', 'muted', '0%');
  row.append(label, percent);
  const bar = el('div', 'bar');
  const fill = el('div');
  bar.append(fill);
  const sub = el('p', 'progress-sub', 'Exporting layers…');
  root.append(row, bar, sub);
  return { root, label, percent, fill, sub };
}

let progress: ReturnType<typeof progressView> | null = null;

function setView(next: View): void {
  view = next;
  applyCollapse();
  refreshButton();
  $('cancel').classList.toggle('hidden', next !== 'exporting');
}

// ---- Warnings -----------------------------------------------------------------------

const KIND_STYLE: Record<WarningKind, { color: string; glyph: string; label: string }> = {
  font: { color: 'amber', glyph: '!', label: 'font' },
  'missing-font': { color: 'amber', glyph: '!', label: 'missing-font' },
  'gradient-text': { color: 'orange', glyph: '!', label: 'gradient-text' },
  effects: { color: 'purple', glyph: 'i', label: 'effects' },
  blend: { color: 'purple', glyph: 'i', label: 'blend' },
  letterbox: { color: 'blue', glyph: 'i', label: 'letterbox' },
  size: { color: 'blue', glyph: 'i', label: 'size' },
  unsupported: { color: 'blue', glyph: 'i', label: 'unsupported' },
  mask: { color: 'red', glyph: '×', label: 'mask' },
  skipped: { color: 'red', glyph: '×', label: 'skipped' },
  clone: { color: 'red', glyph: '!', label: 'clone' },
};

function warningCard(w: SlideWarning, frameName: string): HTMLButtonElement {
  const style = KIND_STYLE[w.kind];
  const btn = el('button', `wcard ${style.color}`);
  const body = el('div', 'wbody');
  const top = el('div', 'wtop');
  const title = w.layerName ?? frameName;
  // Text layers are named after their content, which can be a whole paragraph.
  top.append(el('span', 'pill', style.label), el('span', 'wtitle', title.length > 40 ? `${title.slice(0, 40)}…` : title));
  body.append(top, el('div', 'wmsg', w.message));
  btn.append(el('span', 'wicon', style.glyph), body, el('span', 'wchev', '›'));
  const nodeId = w.nodeId;
  if (nodeId) btn.addEventListener('click', () => post({ type: 'reveal', nodeId }));
  return btn;
}

function renderWarnings(all: SlideModel[]): void {
  const host = $('warnings');
  host.textContent = '';
  let total = 0;
  for (const s of all) {
    if (s.warnings.length === 0) continue;
    total += s.warnings.length;
    const group = el('div', 'wgroup');
    group.append(el('h3', '', `${s.frameName} (${s.warnings.length})`));
    for (const w of s.warnings) group.append(warningCard(w, s.frameName));
    host.append(group);
  }
  $('warnCount').textContent = total ? String(total) : '';
  $('secWarnings').classList.toggle('hidden', total === 0);
  if (total > 0) userCollapsed.delete('secWarnings');
}

// ---- Opacity baking -----------------------------------------------------------------

/** Why a canvas pass: image transparency in PPTX doesn't survive Google Slides, so alpha lives in the PNG. */
async function bakeAlpha(bytes: Uint8Array, factor: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.globalAlpha = factor;
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Canvas export failed');
  return new Uint8Array(await blob.arrayBuffer());
}

async function bakeAll(all: SlideModel[]): Promise<void> {
  for (const s of all) {
    for (const obj of s.objects) {
      if (obj.kind !== 'image' || obj.bakeOpacity >= 0.999) continue;
      const bytes = images[obj.imageId];
      if (bytes) images[obj.imageId] = await bakeAlpha(bytes, obj.bakeOpacity);
    }
  }
}

// ---- Probe --------------------------------------------------------------------------

async function readProbe(bytes: Uint8Array): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(bitmap, 0, 0);
  const alpha = ctx.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data[3] ?? 255;
  const applies = alpha < 250;
  $('probeStatus').textContent = `Center alpha = ${alpha}/255, so exportAsync ${applies ? 'DOES' : 'does NOT'} apply a node's own opacity. Saved.`;
  post({ type: 'probe-result', appliesOpacity: applies });
}

// ---- Export -------------------------------------------------------------------------

function options(): ExportOptions {
  return {
    resolution: Number(selectValue('resolution')) as 1 | 2 | 3,
    gradientText: selectValue('gradientText') === 'image' ? 'image' : 'solid',
    ungroupGroups: $<HTMLInputElement>('ungroup').checked,
    rasterizeNonGoogleFonts: $<HTMLInputElement>('rasterFonts').checked,
    layerReport: $<HTMLInputElement>('report').checked,
    filename: $<HTMLInputElement>('filename').value.trim() || 'SlideSync export',
  };
}

function download(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename.replace(/\.pptx$/i, '')}.pptx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function showError(message: string): void {
  setView('error');
  showStatus(stateCard('err', '!', 'Failed to build .pptx file.', message));
}

async function finish(): Promise<void> {
  if (progress) {
    progress.sub.textContent = 'Building .pptx…';
    progress.fill.style.width = '100%';
  }
  await bakeAll(slides);
  const buffer = await buildPptx(layout, slides, images);
  download(buffer, options().filename);
  const warnings = slides.reduce((n, s) => n + s.warnings.length, 0);
  setView('done');
  renderWarnings(slides);
  showStatus(stateCard('ok', '✓', `Exported ${slides.length} slide${slides.length === 1 ? '' : 's'}`, warnings ? `${warnings} warning${warnings === 1 ? '' : 's'} below. Click one to jump to the layer.` : 'No warnings.'));
}

function onMessage(msg: MainToUi): void {
  switch (msg.type) {
    case 'selection':
      frames = mergeFrames(msg.frames);
      for (const id of [...excluded]) if (!frames.some((f) => f.id === id)) excluded.delete(id);
      renderFrames();
      $('selectionText').textContent = msg.selectionText;
      if (!$<HTMLInputElement>('filename').value) $<HTMLInputElement>('filename').value = msg.fileName;
      $('ignored').textContent = msg.ignored ? `${msg.ignored} selected layer(s) ignored: only frames and components can become slides.` : '';
      $('ignored').classList.toggle('hidden', msg.ignored === 0);
      if (msg.opacityApplied !== null) $('probeStatus').textContent = `Saved probe result: exportAsync ${msg.opacityApplied ? 'applies' : 'does not apply'} a node's own opacity.`;
      break;
    case 'thumb': {
      const old = thumbs.get(msg.id);
      if (old) URL.revokeObjectURL(old);
      thumbs.set(msg.id, URL.createObjectURL(new Blob([msg.bytes.slice()], { type: 'image/png' })));
      if (view !== 'exporting') renderFrames();
      break;
    }
    case 'start':
      layout = msg.layout;
      slides = [];
      images = {};
      break;
    case 'progress': {
      const share = (msg.frameIndex + msg.layerIndex / Math.max(msg.layerCount, 1)) / msg.frameCount;
      if (progress) {
        progress.fill.style.width = `${Math.min(100, Math.round(share * 100))}%`;
        progress.percent.textContent = `${Math.min(100, Math.round(share * 100))}%`;
        progress.label.textContent = `Frame ${msg.frameIndex + 1}/${msg.frameCount}: ${msg.frameName}, layer ${msg.layerIndex}/${msg.layerCount}`;
      }
      break;
    }
    case 'slide':
      slides.push(msg.slide);
      Object.assign(images, msg.images);
      break;
    case 'done':
      finish().catch((e: unknown) => showError(e instanceof Error ? e.message : String(e)));
      break;
    case 'cancelled':
      setView('cancelled');
      showStatus(stateCard('cancel', '×', 'Export cancelled.', 'The export process was stopped.'));
      break;
    case 'error':
      showError(msg.message);
      break;
    case 'probe-bytes':
      void readProbe(msg.bytes);
      break;
  }
}

window.onmessage = (e: MessageEvent<{ pluginMessage?: MainToUi }>): void => {
  if (!e.data.pluginMessage) return;
  try {
    onMessage(e.data.pluginMessage);
  } catch (err) {
    showError(`UI error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

$('export').addEventListener('click', () => {
  progress = progressView();
  showStatus(progress.root);
  $('secWarnings').classList.add('hidden');
  setView('exporting');
  post({ type: 'export', frameIds: includedFrames().map((f) => f.id), options: options() });
});
$('cancel').addEventListener('click', () => post({ type: 'cancel' }));
$('probe').addEventListener('click', () => post({ type: 'probe' }));

applyCollapse();
post({ type: 'ready' });
