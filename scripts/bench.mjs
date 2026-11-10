// Long-note performance: per-keystroke cost on a ~2,000-line note in headless Chrome (the built dist file,
// loaded through the lab).
//
//   node scripts/bench.mjs              → table of numbers, exit 1 when over budget
//   node scripts/bench.mjs --lines 4000
//
// What is measured (milliseconds, median and p95 over many runs after a warm-up):
//   recompute   one full decoration pass for the whole note (state update only). This runs on every edit
//               that is not typing, on every caret move that reveals or hides a marker, and once after each
//               typing pause (the IME guard's deferred refresh). Budget: median < BUDGET_MS.
//   typing      one typed character through view.dispatch while the guard is "hot" (decorations are only
//               mapped) — what each keystroke costs during continuous typing, DOM update included.
//   caret       a caret move that reveals markers elsewhere: full recompute + DOM update.
//   toggle      a checkbox toggle: full recompute + DOM update.
//   open        createEditor with the note and its first draw (once).
import { openLab } from "./cdp.mjs";

const BUDGET_MS = 8;
const args = process.argv.slice(2);
const lines = Number(args[args.indexOf("--lines") + 1]) || 2000;

const PAGE = (lines) => `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { median: q(0.5), p95: q(0.95), max: s[s.length - 1], n: s.length }; };
  const t0 = performance.now();
  __ef.load("long", ${lines});
  await frame();
  const open = performance.now() - t0;
  const v = __ef.editor.view;
  const doc = v.state.doc;
  const find = (from, re) => { for (let n = from; n <= doc.lines; n++) if (re.test(doc.line(n).text)) return doc.line(n); throw new Error("no line " + re); };
  const mid = Math.floor(doc.lines / 2);
  const para = find(mid, /^보통 문단/);
  const boldLine = find(mid, /\\*\\*/);
  const boldIn = boldLine.from + boldLine.text.indexOf("**") + 3;
  const taskLine = find(mid, /^- \\[[ x]\\]/);
  v.focus();
  v.dispatch({ selection: { anchor: para.to } });
  await frame();
  const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
  const WARM = 10, N = 60;

  const recompute = [];
  for (let i = 0; i < WARM + N; i++) {
    const ms = time(() => v.state.update({ changes: { from: para.to, insert: "가" } }).state);
    if (i >= WARM) recompute.push(ms);
  }

  const typing = [];
  for (let i = 0; i < WARM + N; i++) {
    const h = v.state.selection.main.head;
    const ms = time(() => v.dispatch({ changes: { from: h, insert: "가" }, selection: { anchor: h + 1 }, userEvent: "input.type" }));
    if (i >= WARM) typing.push(ms);
  }
  await new Promise((r) => setTimeout(r, 600)); // the guard's deferred refresh runs here
  await frame();

  const caret = [];
  for (let i = 0; i < WARM + N; i++) {
    const ms = time(() => v.dispatch({ selection: { anchor: i % 2 ? para.to : boldIn } }));
    if (i >= WARM) caret.push(ms);
  }

  const toggle = [];
  const box = taskLine.from + taskLine.text.indexOf("[") + 1;
  for (let i = 0; i < WARM + N; i++) {
    const ch = v.state.sliceDoc(box, box + 1) === " " ? "x" : " ";
    const ms = time(() => v.dispatch({ changes: { from: box, to: box + 1, insert: ch }, userEvent: "input.toggle" }));
    if (i >= WARM) toggle.push(ms);
  }
  await frame();
  const text = __ef.editor.getDoc();
  return {
    lines: doc.lines, chars: doc.length, tables: document.querySelectorAll(".ef-table").length, totalTables: (text.match(/^\\| 날짜/gm) || []).length,
    open, recompute: stats(recompute), typing: stats(typing), caret: stats(caret), toggle: stats(toggle), ua: navigator.userAgent,
  };
})()`;

const lab = await openLab();
let over = false;
try {
  const r = await lab.cdp.eval(PAGE(lines));
  const f = (x) => x.toFixed(2).padStart(6);
  const row = (name, s) => console.log(`  ${name.padEnd(48)} median ${f(s.median)}  p95 ${f(s.p95)}  max ${f(s.max)}  (n=${s.n})`);
  console.log(`EditFrame bench — ${r.lines} lines, ${r.chars} chars, ${r.totalTables} tables (${r.tables} drawn in the viewport) — ${r.ua.match(/Chrome\/[\d.]+/)?.[0] || "Chrome"} headless`);
  console.log(`  open (createEditor + first draw)                 ${f(r.open)} ms`);
  row("recompute: full decoration pass (state)", r.recompute);
  row("typing: keystroke while hot (dispatch+DOM)", r.typing);
  row("caret: reveal markers elsewhere (dispatch+DOM)", r.caret);
  row("toggle: checkbox (dispatch+DOM)", r.toggle);
  over = r.recompute.median >= BUDGET_MS;
  console.log(`budget: recompute median < ${BUDGET_MS} ms → ${over ? "OVER BUDGET" : "ok"}`);
  if (lab.problems.length) { over = true; for (const p of lab.problems) console.log("  " + p); }
} finally {
  await lab.close();
}
process.exit(over ? 1 : 0);
