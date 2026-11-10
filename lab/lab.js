// EditFrame lab — tests what consumers get: imports the built single file (dist/editframe.mjs).
import { createEditor, worknotePreset, EditorView, VERSION } from "../dist/editframe.mjs";
import { BASIC, WORKNOTE, TABLES, longNote } from "./samples.js";

const SAMPLES = {
  basic: { doc: BASIC, presets: [] },
  worknote: { doc: WORKNOTE, presets: [worknotePreset({ onOpenNote: (id) => setStatus(`노트 열기 요청: ${id} (시험대에서는 이동하지 않습니다)`) })] },
  tables: { doc: TABLES, presets: [] },
  long: { doc: longNote(), presets: [] }, // 「긴 글 불러오기」 — also what scripts/bench.mjs measures
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status"), mdEl = $("md"), logEl = $("log");
let original = "";
let current = "basic";
let editor = null;
let note = "";

// ---------------------------------------------------------------- 입력 기록 (input trace)
// Off by default. When off, every listener returns immediately — the cost is one boolean check.
let logOn = false;
let t0 = 0;
let events = [];
let traceStartDoc = "";
let traceStartHead = 0;
const MAX_EVENTS = 3000;

function headInfo() {
  const s = editor.view.state.selection.main;
  return { anchor: s.anchor, head: s.head };
}
function cellOf(target) {
  const td = target?.closest?.(".ef-table th, .ef-table td");
  return td ? { row: Number(td.dataset.row), col: Number(td.dataset.col) } : null;
}
function record(ev) {
  if (events.length >= MAX_EVENTS) return;
  ev.t = Math.round(performance.now() - t0);
  events.push(ev);
  const line = `+${ev.t}ms ${ev.type}` + Object.entries(ev).filter(([k]) => k !== "t" && k !== "type").map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join("");
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}
function targetLen(e) {
  try {
    const r = e.getTargetRanges?.()[0];
    if (r && r.startContainer === r.endContainer) return r.endOffset - r.startOffset;
  } catch {}
  return null;
}
const domListeners = {
  beforeinput: (e) => record({ type: "beforeinput", inputType: e.inputType, data: e.data, isComposing: e.isComposing, targetLen: targetLen(e), cell: cellOf(e.target), sel: cellOf(e.target) ? null : headInfo() }),
  input: (e) => record({ type: "input", inputType: e.inputType, data: e.data, isComposing: e.isComposing, cell: cellOf(e.target), value: e.target.value ?? undefined }),
  compositionstart: (e) => record({ type: "compositionstart", data: e.data, cell: cellOf(e.target) }),
  compositionupdate: (e) => record({ type: "compositionupdate", data: e.data, cell: cellOf(e.target) }),
  compositionend: (e) => record({ type: "compositionend", data: e.data, cell: cellOf(e.target) }),
  keydown: (e) => record({ type: "keydown", key: e.key, code: e.code, keyCode: e.keyCode, isComposing: e.isComposing, cell: cellOf(e.target) }),
};
function onSelectionChange() {
  if (!logOn) return;
  const sel = document.getSelection();
  if (!sel || !editor.view.dom.contains(sel.anchorNode)) return;
  record({ type: "selectionchange", sel: headInfo() });
}
function attachLog() {
  for (const [name, fn] of Object.entries(domListeners)) editor.view.dom.addEventListener(name, (e) => { if (logOn) fn(e); }, true);
}
document.addEventListener("selectionchange", onSelectionChange);
// Document diff per transaction (registered once through the `extensions` option).
const txLog = EditorView.updateListener.of((u) => {
  if (!logOn) return;
  for (const tr of u.transactions) {
    if (!tr.docChanged) continue;
    const changes = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => changes.push({ from: fromA, to: toA, removed: tr.startState.sliceDoc(fromA, toA), inserted: ins.toString() }));
    record({ type: "tx", userEvent: tr.annotation(tr.constructor.userEvent) ?? null, changes });
  }
});

// Best-effort replay steps from the raw events (scripts/replay-traces.mjs runs them).
// The raw `events` stay authoritative — refine `steps` by hand if needed.
function deriveSteps(evts) {
  const steps = [];
  let lastKey = null, inCell = null, composing = false;
  for (const e of evts) {
    if (e.cell && JSON.stringify(e.cell) !== JSON.stringify(inCell)) { inCell = e.cell; steps.push({ op: "cell", ...e.cell }); }
    if (!e.cell && e.type !== "tx" && e.type !== "selectionchange" && inCell) inCell = null;
    if (e.type === "keydown") {
      lastKey = e.key;
      if (!e.isComposing && e.keyCode !== 229 && ["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) steps.push({ op: "key", key: e.key });
    } else if (e.type === "compositionstart") composing = true;
    else if (e.type === "compositionupdate") steps.push({ op: "ime", text: e.data || "" });
    else if (e.type === "compositionend") { composing = false; steps.push({ op: "commit", text: e.data || "" }); }
    else if (e.type === "beforeinput" && !composing) {
      if (e.inputType === "insertReplacementText") steps.push({ op: "replacePrev", len: e.targetLen || 1, text: e.data || "" });
      else if (e.inputType === "insertText") steps.push(e.targetLen ? { op: "replacePrev", len: e.targetLen, text: e.data || "" } : { op: "insertText", text: e.data || "" });
      else if (e.inputType === "deleteContentBackward" && lastKey !== "Backspace") steps.push({ op: "key", key: "Backspace" });
      else if ((e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") && lastKey !== "Enter") steps.push({ op: "key", key: "Enter" });
    }
    if (e.type !== "keydown") lastKey = e.type === "beforeinput" ? null : lastKey;
  }
  return steps;
}

function traceJson() {
  return JSON.stringify({
    format: "editframe-trace/1",
    name: "lab-" + new Date().toISOString().replace(/[:.]/g, "-"),
    version: VERSION,
    userAgent: navigator.userAgent,
    sample: current,
    setup: { doc: traceStartDoc, head: traceStartHead },
    steps: deriveSteps(events),
    expect: editor.getDoc(),
    events,
  }, null, 1);
}

$("btn-log").addEventListener("click", () => {
  logOn = !logOn;
  $("btn-log").setAttribute("aria-pressed", String(logOn));
  $("log-panel").hidden = !logOn;
  if (logOn && !events.length) { t0 = performance.now(); traceStartDoc = editor.getDoc(); traceStartHead = editor.view.state.selection.main.head; }
});
$("btn-log-clear").addEventListener("click", () => {
  events = []; logEl.textContent = ""; t0 = performance.now(); traceStartDoc = editor.getDoc(); traceStartHead = editor.view.state.selection.main.head;
});
$("btn-log-copy").addEventListener("click", async () => {
  const text = traceJson();
  try {
    await navigator.clipboard.writeText(text);
    setStatus("기록을 복사했습니다. 메신저나 메일에 붙여 보내 주세요.");
  } catch {
    // Fallback: show the text selected so the user can copy it by hand (iOS: 길게 눌러 복사).
    const ta = $("log-fallback");
    ta.hidden = false;
    ta.value = text;
    ta.focus();
    ta.select();
    setStatus("자동 복사가 막혀 있습니다. 아래 상자의 글을 길게 눌러 복사해 주세요.");
  }
});

// ---------------------------------------------------------------- editor

function setStatus(msg) { note = msg; refreshStatus(); }
function refreshStatus() {
  const doc = editor.getDoc();
  const same = doc === original;
  statusEl.innerHTML = "";
  const s = document.createElement("span");
  s.className = same ? "ok" : "warn";
  s.textContent = same ? "원문과 같음 ✓" : `고쳐짐 (${doc.length - original.length >= 0 ? "+" : ""}${doc.length - original.length}자)`;
  statusEl.append(s, ` · EditFrame ${VERSION} · 저장되지 않는 시험 화면입니다.` + (note ? " " + note : ""));
}
let mdTimer = 0;
function onChange() {
  clearTimeout(mdTimer);
  mdTimer = setTimeout(() => { mdEl.textContent = editor.getDoc(); refreshStatus(); }, 150);
}

// `lines` (long sample only) builds a note of that many lines — scripts/bench.mjs --lines.
function load(which, lines) {
  current = which;
  const s = which === "long" && lines ? { ...SAMPLES.long, doc: longNote(lines) } : SAMPLES[which];
  original = s.doc;
  editor?.destroy();
  $("editor").replaceChildren();
  editor = createEditor($("editor"), {
    doc: s.doc,
    presets: s.presets,
    onChange,
    raw: $("btn-raw").getAttribute("aria-pressed") === "true",
    readOnly: $("btn-ro").getAttribute("aria-pressed") === "true",
    extensions: [txLog],
  });
  attachLog();
  mdEl.textContent = editor.getDoc();
  note = "";
  refreshStatus();
  window.__ef = { editor, load, SAMPLES, traceJson, get events() { return events; } };
}

$("sample").addEventListener("change", (e) => load(e.target.value));
$("btn-reset").addEventListener("click", () => load(current));
$("btn-raw").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  e.currentTarget.textContent = on ? "원문 닫기" : "원문 보기";
  editor.setRaw(on);
  refreshStatus();
});
$("btn-ro").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  editor.setReadOnly(on);
});

// Checklist ticks persist per device (a convenience only).
for (const box of document.querySelectorAll("#checklist input")) {
  const k = "ef-lab-check-" + box.dataset.k;
  try { box.checked = localStorage.getItem(k) === "1"; } catch {}
  box.addEventListener("change", () => { try { localStorage.setItem(k, box.checked ? "1" : "0"); } catch {} });
}

load("basic");
