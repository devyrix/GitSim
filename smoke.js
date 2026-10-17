#!/usr/bin/env node
// smoke.js — fast health check for the application.
// Unlike test.js, which exercises Git semantics in depth, this file only confirms that
//   1. every file referenced by index.html exists,
//   2. every script loads without error,
//   3. every module renders to stable markup, and
//   4. every module completes when its steps are replayed verbatim.
// Run: node smoke.js (exits with code 1 on any failure)

const fs = require("fs");
const path = require("path");

const here = (f) => path.join(__dirname, f);
let fail = 0;
const ok = (name) => console.log("✓ " + name);
const bad = (name, why) => { fail++; console.log("✗ " + name + "\n    " + String(why).split("\n")[0]); };
const check = (name, fn) => {
  try { fn(); ok(name); } catch (e) { bad(name, e && e.stack || e); }
};

// --- 1. Referenced files ---
check("index.html ada", () => fs.readFileSync(here("index.html"), "utf8"));
const html = fs.readFileSync(here("index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^":#]+)"/g)]
  .map((m) => m[1])
  .filter((r) => !/^https?:/.test(r));
check("semua src/href lokal ada (" + refs.length + " berkas)", () => {
  const missing = refs.filter((r) => !fs.existsSync(here(r)));
  if (missing.length) throw new Error("tidak ditemukan: " + missing.join(", "));
});

// Script order must be: engine -> scenarios -> brain -> app
check("urutan <script> benar", () => {
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const want = ["git-engine.js", "scenarios.js", "brain.js", "app.js"];
  if (JSON.stringify(order) !== JSON.stringify(want)) throw new Error("didapat " + order.join(" -> "));
});

// --- 2. Load scripts in a minimal Node environment ---
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
  querySelector: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {} }),
  addEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
  body: { appendChild() {} },
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.matchMedia = () => ({ matches: false });
for (const f of ["git-engine", "scenarios", "brain", "preview"]) {
  check("muat " + f + ".js", () => require(here(f + ".js")));
}

check("SCENARIOS berisi 9 modul", () => {
  if (!Array.isArray(SCENARIOS) || SCENARIOS.length !== 9) throw new Error("jumlah: " + (SCENARIOS || []).length);
});

check("setiap modul punya kontrak dasar", () => {
  const bads = [];
  for (const s of SCENARIOS) {
    for (const k of ["id", "num", "group", "title", "subtitle", "files", "opts", "steps", "why"])
      if (s[k] === undefined) bads.push(s.id + ": " + k);
    if (typeof s.check !== "function") bads.push(s.id + ": check()");
    for (const st of s.steps) if (!st.cmd && !st.cmdAt) bads.push(s.id + ": langkah tanpa cmd");
  }
  if (bads.length) throw new Error(bads.join(", "));
});

check("id modul unik", () => {
  const ids = SCENARIOS.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error(ids.join(", "));
});

// --- 3. Render every module ---
const esc = (s) => String(s);
for (const s of SCENARIOS) {
  check("render modul " + s.num + " (" + s.title + ")", () => {
    const st = GitSim.createState(s.files, s.opts);
    if (s.setup) s.setup(st);
    const g = Brain.renderHistory(st);
    const f = Brain.renderFiles(st, "working");
    const d = Brain.renderCommit(st, null);
    const m = Preview.svg ? "" : "";
    for (const [n, v] of [["graph", g], ["files", f], ["detail", d]]) {
      if (typeof v !== "string") throw new Error(n + " bukan string");
      if (/undefined|\[object Object\]/.test(v)) throw new Error(n + " berisi undefined");
      if (/<script/i.test(v)) throw new Error(n + " menyisipkan script");
    }
    if (typeof s.check(st) !== "boolean") throw new Error("check() bukan boolean pada state awal");
  });
}

// --- 4. Replay every step of every module ---
for (const s of SCENARIOS) {
  check("langkah modul " + s.num + " berjalan sampai akhir", () => {
    const st = GitSim.createState(s.files, s.opts);
    if (s.setup) s.setup(st);
    const log = [];
    s.steps.forEach((step, i) => {
      const cmd = step.cmdAt ? step.cmdAt(st) : step.cmd;
      const r = GitSim.run(st, cmd);
      log.push(cmd);
      const expectFail = !!step.fail;
      if (!r || typeof r.ok !== "boolean" || !Array.isArray(r.lines))
        throw new Error("hasil tidak valid pada langkah " + (i + 1) + ": " + cmd);
      if (r.ok === expectFail)
        throw new Error("langkah " + (i + 1) + " '" + cmd + "' " + (expectFail ? "seharusnya gagal" : "seharusnya berhasil") + ": " + r.lines.join(" | "));
      Brain.renderHistory(st);
      Brain.renderFiles(st, "working");
      // Conflict modules await a human decision. Select a version as the user would in the Files panel.
      for (const p of Object.keys(st.conflicts))
        if (!st.resolved[p]) { st.workdir[p] = Brain.sides(st.workdir[p] || "").ours; st.resolved[p] = true; }
    });
    if (!s.check(st)) throw new Error("tujuan modul tidak tercapai. langkah: " + log.join(" ; "));
  });
}

// --- 5. Referenced sources must not be empty ---
for (const f of refs.filter((r) => /\.(js|css)$/.test(r))) {
  check(f + " tidak kosong", () => {
    if (!fs.readFileSync(here(f), "utf8").trim()) throw new Error("kosong");
  });
}

console.log(fail ? "\n" + fail + " CHECK GAGAL" : "\nSMOKE LULUS");
process.exit(fail ? 1 : 0);
