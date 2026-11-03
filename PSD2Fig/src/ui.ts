import { parsePsd } from "./psd";
import type { ToMain, ToUI } from "./messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $("drop"), file = $<HTMLInputElement>("file"), bar = $("bar"), status = $("status");
const report = $("report"), cancel = $("cancel"), hidden = $<HTMLInputElement>("hidden");

const send = (m: ToMain) => parent.postMessage({ pluginMessage: m }, "*");
let busy = false;
let cancelRequested = false;

function setStatus(text: string, err = false) {
  status.textContent = text;
  status.className = err ? "err" : "";
}

function setBusy(b: boolean) {
  busy = b;
  bar.style.display = b ? "block" : "none";
  cancel.style.display = b ? "block" : "none";
  drop.style.opacity = b ? "0.5" : "1";
}

function setBar(f: number) {
  (bar.firstElementChild as HTMLElement).style.width = Math.round(f * 100) + "%";
}

async function handle(f: File) {
  if (busy) return;
  if (!/\.psd$/i.test(f.name)) return setStatus("Please choose a .psd file (PSB is not supported).", true);
  report.innerHTML = "";
  cancelRequested = false;
  setBusy(true);
  setBar(0.05);
  setStatus(`Reading ${f.name}…`);
  try {
    const buf = await f.arrayBuffer();
    // yield so the status paints before the heavy parse
    await new Promise((r) => setTimeout(r, 20));
    const doc = await parsePsd(
      buf,
      f.name,
      async (id, bytes) => {
        if (cancelRequested) throw new Error("Import cancelled");
        send({ type: "image", id, bytes });
        await new Promise((r) => setTimeout(r, 0));
      },
      (s) => setStatus(s),
    );
    if (cancelRequested) throw new Error("Import cancelled");
    setBar(0.4);
    setStatus("Building Figma layers…");
    send({ type: "build", doc, keepHidden: hidden.checked });
  } catch (e) {
    setBusy(false);
    setStatus(cancelRequested ? "Import cancelled" : "Could not read this PSD: " + (e instanceof Error ? e.message : String(e)), !cancelRequested);
  }
}

drop.onclick = () => !busy && file.click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!busy) file.click(); } };
file.onchange = () => { const f = file.files?.[0]; if (f) handle(f); file.value = ""; };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer?.files?.[0];
  if (f) handle(f);
};
cancel.onclick = () => { cancelRequested = true; send({ type: "cancel" }); };

window.onmessage = (ev) => {
  const m = ev.data.pluginMessage as ToUI | undefined;
  if (!m) return;
  if (m.type === "progress") {
    setBar(0.4 + 0.6 * (m.done / Math.max(m.total, 1)));
    setStatus(`Building ${m.done}/${m.total}: ${m.label}`);
  } else if (m.type === "error") {
    setBusy(false);
    setStatus(m.message, true);
  } else if (m.type === "done") {
    setBusy(false);
    setStatus(`Imported ${m.created} layers into a new frame.`);
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    report.innerHTML =
      `<div class="stats">
        <div><strong>${m.created}</strong>layers</div>
        <div><strong>${m.text}</strong>text</div>
        <div><strong>${m.shapes}</strong>shapes</div>
        <div><strong>${m.smart}</strong>smart obj.</div>
        <div><strong>${m.images}</strong>images</div>
      </div>` +
      (m.warnings.length ? `<ul>${m.warnings.slice(0, 40).map((w) => `<li>${esc(w)}</li>`).join("")}${m.warnings.length > 40 ? `<li>…and ${m.warnings.length - 40} more</li>` : ""}</ul>` : "");
  }
};
