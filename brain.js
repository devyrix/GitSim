(function (g) {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const H = 64, LW = 24, R = 30;
  const COL = ["var(--accent)", "var(--green)", "#b78bff", "#f0a24b", "#ff7eb6"];
  const col = (l) => COL[l % COL.length];

  // Every commit reachable from a branch, HEAD, or GitHub ref; newest first, one lane per path.
  function layout(s) {
    const tips = [...Object.values(s.branches), s.detached, ...Object.values(s.remote.tracked)].filter((h) => s.commits[h]);
    const set = new Set(), st = [...tips];
    while (st.length) {
      const h = st.pop();
      if (set.has(h) || !s.commits[h]) continue;
      set.add(h);
      st.push(...s.commits[h].parents);
    }
    const kids = {};
    set.forEach((h) => (kids[h] = 0));
    set.forEach((h) => s.commits[h].parents.forEach((p) => set.has(p) && kids[p]++));
    const order = [], ready = [...set].filter((h) => !kids[h]);
    while (ready.length) {
      ready.sort((a, b) => s.commits[b].seq - s.commits[a].seq);
      const h = ready.shift();
      order.push(h);
      for (const p of s.commits[h].parents) if (set.has(p) && --kids[p] === 0) ready.push(p);
    }
    const lanes = [], pos = {};
    const free = () => { const i = lanes.indexOf(null); return i < 0 ? lanes.length : i; };
    order.forEach((h, row) => {
      let l = lanes.indexOf(h);
      if (l < 0) l = free();
      lanes.forEach((x, i) => x === h && i !== l && (lanes[i] = null));
      pos[h] = { row, lane: l };
      const [p0, ...rest] = s.commits[h].parents.filter((p) => set.has(p));
      lanes[l] = p0 && !lanes.includes(p0) ? p0 : null;
      rest.forEach((p) => { if (!lanes.includes(p)) lanes[free()] = p; });
    });
    return { order, pos, width: Math.max(1, ...Object.values(pos).map((p) => p.lane + 1)) * LW + 16 };
  }

  function renderHistory(s, sel) {
    const { order, pos, width } = layout(s);
    if (!order.length) return '<div class="graph-empty">Belum ada commit.<br>Jalankan perintah Git pertama Anda.</div>';
    const X = (h) => pos[h].lane * LW + 14, Y = (h) => pos[h].row * H + H / 2;
    const local = new Set();
    [...Object.values(s.branches), s.detached].forEach((t) => t && collect(s, t, local));
    const refs = g.GitSim.refsAt(s), head = g.GitSim.headHash(s);
    let edges = "", nodes = "", rows = "";
    for (const h of order) {
      const x1 = X(h), y1 = Y(h), c1 = col(pos[h].lane);
      s.commits[h].parents.forEach((p, i) => {
        if (!pos[p]) return;
        const x2 = X(p), y2 = Y(p), r = Math.min(R, (y2 - y1) / 2);
        const k = (x2 - x1) * 0.5;
        const d = x1 === x2 ? `M${x1} ${y1}V${y2}`
          : i === 0 ? `M${x1} ${y1}V${y2 - r}C${x1} ${y2 - r * 0.35} ${x1 + k} ${y2} ${x2} ${y2}`
          : `M${x1} ${y1}C${x1 + k} ${y1} ${x2} ${y1 + r * 0.35} ${x2} ${y1 + r}V${y2}`;
        edges += `<path d="${d}" class="edge${local.has(h) ? "" : " e-remote"}" data-h="${h}" style="stroke:${i === 0 ? c1 : col(pos[p].lane)}"/>`;
      });
      const isHead = h === head, on = local.has(h);
      nodes += `<g class="nd${h === sel ? " sel" : ""}" data-h="${h}" style="color:${c1}">`
        + (isHead ? `<circle cx="${x1}" cy="${y1}" r="13" class="halo"/>` : "")
        + `<circle cx="${x1}" cy="${y1}" r="${isHead ? 8 : 7}" class="node ${on ? "n-on" : "n-off"}"/></g>`;
      const pills = (refs[h] || []).map((r) => `<span class="pill p-${r.t}">${esc(r.n)}</span>`).join("");
      rows += `<div class="gr${h === sel ? " sel" : ""}" data-h="${h}" style="height:${H}px"><span class="msg" title="${esc(s.commits[h].msg)}">${esc(s.commits[h].msg)}</span><span class="meta"><code>${h}</code>${pills}</span></div>`;
    }
    const ht = order.length * H;
    return `<div class="graph" style="padding-left:${width}px"><svg class="graph-svg" width="${width}" height="${ht}" viewBox="0 0 ${width} ${ht}">${edges}${nodes}</svg>${rows}</div>`;
  }

  // Detail of one commit: message, hash, parents, refs, and files changed against the first parent.
  function renderCommit(s, h) {
    const c = s.commits[h];
    if (!c) return '<div class="cd-hint">Klik sebuah commit untuk melihat detailnya.</div>';
    const prev = (c.parents[0] && s.commits[c.parents[0]] || { files: {} }).files;
    const ch = [...new Set([...Object.keys(c.files), ...Object.keys(prev)])].sort().filter((p) => c.files[p] !== prev[p])
      .map((p) => { const k = prev[p] === undefined ? "+" : c.files[p] === undefined ? "−" : "~"; return `<li><b class="k${k === "+" ? " a" : k === "−" ? " d" : ""}">${k}</b> ${esc(p)}</li>`; });
    const pills = (g.GitSim.refsAt(s)[h] || []).map((r) => `<span class="pill p-${r.t}">${esc(r.n)}</span>`).join("");
    return `<div class="cd-msg">${esc(c.msg)}</div>
      <div class="cd-meta"><code>${h}</code>${pills}</div>
      <div class="cd-meta">${c.parents.length ? "parent: " + c.parents.map((p) => `<code>${p}</code>`).join(" ") : "commit pertama"}${c.parents.length > 1 ? " · merge" : ""}</div>
      <ul class="cd-files">${ch.join("") || "<li>tidak ada perubahan berkas</li>"}</ul>
      <button class="btn-ghost cd-insert" data-insert="${h}">Isi hash ke terminal</button>`;
  }

  function collect(s, t, set) {
    const st = [t];
    while (st.length) {
      const h = st.pop();
      if (set.has(h) || !s.commits[h]) continue;
      set.add(h);
      st.push(...s.commits[h].parents);
    }
  }

  const CLS = { conflict: "conflict", untracked: "untracked", modified: "modified", deleted: "modified" };
  function zoneFiles(s, zone) {
    const c = g.GitSim.changes(s);
    return zone === "staged"
      ? c.staged.map((f) => ({ p: f.p, st: "staged", cls: "staged" }))
      : [...c.conflicted, ...c.unstaged, ...c.untracked].map((f) => ({ p: f.p, st: f.st, cls: CLS[f.st] }));
  }

  function renderFiles(s, zone, open) {
    const files = zoneFiles(s, zone);
    if (!files.length) return '<div class="file-empty">Tidak ada berkas</div>';
    return files.map((f) => `<div class="file-row${open === f.p ? " active" : ""}" data-path="${esc(f.p)}">
      <span>${esc(f.p)}</span><span class="file-badge badge-${f.cls}">${f.st}</span></div>${open === f.p ? `<div class="diff-view">${renderDiff(s, f.p, zone)}</div>` : ""}`).join("");
  }

  function renderDiff(s, p, zone) {
    const L = g.GitSim.lines, head = g.GitSim.currentFiles(s)[p], idx = s.index[p], work = s.workdir[p];
    if (s.conflicts[p] && !s.resolved[p]) {
      const o = sides(work || "");
      const btn = (k, t, v) => `<button class="pick" data-resolve="${k}"><b>${t}</b><pre>${esc(v)}</pre></button>`;
      return `<div class="picks">${btn("ours", "Pakai versi Anda", o.oursPart)}${btn("theirs", "Pakai versi rekan", o.theirsPart)}${btn("both", "Pakai keduanya", o.bothPart)}</div>`;
    }
    if (s.conflicts[p]) return `<div class="resolved">✓ Versi telah dipilih. Jalankan <code>git add ${esc(p)}</code> untuk menandai selesai.</div>`;
    const [a, b] = zone === "staged" ? [head, idx] : [idx !== undefined ? idx : head, work];
    if (a === b) return '<div class="resolved">Tidak ada perubahan.</div>';
    return g.GitSim.diffLines(L(a), L(b)).map(([k, t]) => `<div class="diff-line diff-${k === "+" ? "add" : k === "-" ? "del" : "ctx"}">${k}${esc(t)}</div>`).join("");
  }

  // Splits a conflict-marked file into one result per choice, covering the whole file, not only the conflict.
  function sides(content) {
    const o = { ours: [], theirs: [], both: [], oursPart: [], theirsPart: [] };
    let m = null;
    for (const l of content.replace(/\n$/, "").split("\n")) {
      if (l.startsWith("<<<<<<<")) m = "ours";
      else if (m && l.startsWith("=======")) m = "theirs";
      else if (m && l.startsWith(">>>>>>>")) m = null;
      else if (!m) { o.ours.push(l); o.theirs.push(l); o.both.push(l); }
      else { o[m].push(l); o.both.push(l); o[m + "Part"].push(l); }
    }
    const j = (a) => a.join("\n") + "\n";
    return { ours: j(o.ours), theirs: j(o.theirs), both: j(o.both), oursPart: o.oursPart.join("\n"), theirsPart: o.theirsPart.join("\n"), bothPart: [...o.oursPart, ...o.theirsPart].join("\n") };
  }

  g.Brain = { esc, renderHistory, renderCommit, renderFiles, zoneFiles, sides };
})(typeof window !== "undefined" ? window : globalThis);