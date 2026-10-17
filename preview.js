/* preview.js — miniature SVG preview for the intro screen. */
(function (global) {
  "use strict";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isHash = v => typeof v === "string" && /^[0-9a-f]{7,}$/.test(v);

  function svg(state, w = 560, h = 320) {
    const head = global.GitSim.headHash(state);
    const history = [];
    let cur = head;
    while (cur && state.commits[cur]) { history.push(cur); cur = state.commits[cur].parents[0]; }
    const remote = [];
    for (const k in state.remote) if (isHash(state.remote[k]) && state.remote[k] !== head) remote.push(state.remote[k]);

    const lines = [`<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;">`];
    lines.push(`<text x="16" y="24" font-family="var(--mono)" font-size="12" fill="var(--text-3)">RIWAYAT COMMIT</text>`);
    
    if (!history.length) {
      lines.push(`<text x="16" y="60" font-family="var(--mono)" font-size="13" fill="var(--text-2)">Belum ada commit. Jalankan git init lalu git commit.</text>`);
    } else {
      history.slice(0, 5).forEach((hash, i) => {
        const y = 60 + i * 40;
        const isHead = hash === head;
        lines.push(`<circle cx="24" cy="${y - 4}" r="4" fill="${isHead ? "var(--accent)" : "var(--border-strong)"}"/>`);
        lines.push(`<text x="40" y="${y}" font-family="var(--mono)" font-size="12" fill="var(--text)">${esc(state.commits[hash].msg)}</text>`);
        if (isHead) lines.push(`<text x="40" y="${y + 14}" font-family="var(--mono)" font-size="10" fill="var(--accent)">⎇ ${esc(state.head)}</text>`);
      });
    }

    const committed = global.GitSim.currentFiles(state);
    const dirty = Object.keys(state.workdir).filter(f => state.workdir[f] !== committed[f]);
    if (dirty.length) {
      lines.push(`<text x="${w - 16}" y="${h - 32}" text-anchor="end" font-family="var(--mono)" font-size="11" fill="var(--warn)">${dirty.length} file belum di-commit</text>`);
    }
    return lines.join("") + "</svg>";
  }

  function paper(s) {
    const state = global.GitSim.createState(s.files, s.opts);
    if (s.setup) s.setup(state);
    return state;
  }

  global.Preview = { svg, paper };
})(typeof window !== "undefined" ? window : globalThis);