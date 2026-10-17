(() => {
  "use strict";
  let state = null, scenario = null, stepIdx = 0, finished = false;
  let hist = [], histIdx = 0, expandedFile = null, selected = null, seen = null;

  const $ = (id) => document.getElementById(id);
  const { esc } = Brain;
  const md = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const narrow = () => matchMedia("(max-width: 1000px)").matches;
  const inspector = () => document.querySelector(".inspector");

  const DONE_KEY = "gitsim-done";
  const doneSet = () => {
    try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]")); } catch { return new Set(); }
  };
  const markDone = (id) => {
    const d = doneSet().add(id);
    try { localStorage.setItem(DONE_KEY, JSON.stringify([...d])); } catch {}
  };

  const HINTS = [
    [/not a git repository/i, "Folder ini belum menjadi repositori Git. Jalankan `git init` terlebih dahulu."],
    [/unmerged files/i, "Konflik belum selesai. Pilih versi di panel Berkas, jalankan `git add`, lalu commit."],
    [/nothing to commit|no changes added/i, "Belum ada perubahan yang di-stage. Jalankan `git add <berkas>` terlebih dahulu."],
    [/did not match any files?/i, "Nama berkas tidak cocok atau belum dibuat."],
    [/divergent branches/i, "Branch lokal dan remote bercabang. Pilih strategi: `git pull --no-rebase` (merge), `git pull --rebase`, atau `git pull --ff-only`."],
    [/rejected/i, "Remote memiliki commit yang belum ada di lokal Anda. Jalankan `git pull` terlebih dahulu."],
    [/would be overwritten/i, "Perubahan yang belum di-commit akan tertimpa. Simpan dulu dengan `git stash` atau commit."],
    [/CONFLICT/, "Dua versi berkas bertentangan. Klik berkas di panel Berkas, pilih versi, lalu jalankan `git add`."],
  ];

  // Module list grouped by topic, shared by the intro screen and the sidebar.
  function grouped(render) {
    let last = "", html = "";
    for (const s of SCENARIOS) {
      if (s.group !== last) { html += `<div class="group">${esc(s.group)}</div>`; last = s.group; }
      html += render(s);
    }
    return html;
  }

  function init() {
    renderIntro();
    if (narrow()) $("sidebar").classList.add("hidden");
    $("btn-menu").onclick = () => $("sidebar").classList.toggle("hidden");
    $("btn-inspector").onclick = () => inspector().classList.toggle("open");
    $("btn-why").onclick = openWhy;
    $("btn-reset").onclick = () => scenario && openScenario(scenario.id);
    $("btn-newfile").onclick = openNewFile;
    $("nf-cancel").onclick = () => ($("newfile-modal").hidden = true);
    $("newfile-modal").onsubmit = submitNewFile;
    $("modal-close").onclick = () => ($("modal-back").hidden = true);
    $("cmd-form").onsubmit = (e) => { e.preventDefault(); submitCmd(); };

    $("cmd-input").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      histIdx = Math.max(0, Math.min(hist.length, histIdx + (e.key === "ArrowUp" ? -1 : 1)));
      e.target.value = hist[histIdx] || "";
    });
    $("btn-autofill").onclick = () => {
      const step = scenario && scenario.steps[stepIdx];
      if (step) { $("cmd-input").value = window.stepCommand(step, state); focusCmd(); }
    };
    setupGraph();
    $("files-working").onclick = $("files-staged").onclick = onFileClick;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      $("modal-back").hidden = $("newfile-modal").hidden = true;
      inspector().classList.remove("open");
      focusCmd();
    });
  }

  function renderIntro() {
    const done = doneSet();
    let n = 0;
    const overlay = document.createElement("div");
    overlay.className = "intro-overlay";
    overlay.innerHTML = `
      <div class="intro-title">GitSim</div>
      <div class="intro-sub">Simulator Git interaktif. Pilih modul untuk memulai.</div>
      <div class="intro-grid">${grouped((s) => `
        <div class="intro-card${done.has(s.id) ? " is-done" : ""}" data-id="${s.id}" style="--i:${n++}">
          <span class="num">${s.num}${done.has(s.id) ? " ✓" : ""}</span>
          <span class="title">${esc(s.title)}</span>
          <span class="desc">${md(s.subtitle)}</span>
        </div>`)}</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      const card = e.target.closest(".intro-card");
      if (!card) return;
      overlay.classList.add("is-leaving");
      setTimeout(() => { overlay.remove(); openScenario(card.dataset.id); }, 240);
    });
  }

  function openScenario(id) {
    scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) return;
    state = GitSim.createState(scenario.files, scenario.opts);
    if (scenario.setup) scenario.setup(state);
    stepIdx = 0; finished = false; selected = null; seen = null; hist = []; histIdx = 0; expandedFile = null;
    $("terminal").innerHTML = "";
    $("module-title").textContent = `${scenario.num} · ${scenario.title}`;
    $("btn-why").hidden = $("btn-reset").hidden = false;
    printBatch([{ html: `# ${esc(scenario.title)}`, cls: "cmd" }, { html: md(scenario.subtitle), cls: "" }], true);
    renderAll();
    updateSidebar();
    if (narrow()) $("sidebar").classList.add("hidden");
    focusCmd();
  }

  function renderAll() {
    renderGraph();
    renderFiles();
    renderStep();
    $("prompt").textContent = state.isRepo ? `${state.detached ? "detached" : state.head} $` : "$";
  }

  function renderGraph() {
    if (selected && !state.commits[selected]) selected = null;
    const box = $("history-graph"), top = box.scrollTop;
    box.innerHTML = Brain.renderHistory(state, selected);
    box.scrollTop = top;
    const now = [...box.querySelectorAll(".gr")].map((r) => r.dataset.h);
    if (seen) now.filter((h) => !seen.has(h)).forEach((h) => box.querySelectorAll(`[data-h="${h}"]`).forEach((el) => el.classList.add("new")));
    seen = new Set(now);
    $("commit-detail").innerHTML = Brain.renderCommit(state, selected);
  }

  function setupGraph() {
    const box = $("history-graph"), insp = inspector(), grip = $("resizer");
    $("btn-wide").onclick = () => insp.classList.toggle("wide");
    grip.onpointerdown = (e) => {
      grip.setPointerCapture(e.pointerId);
      grip.onpointermove = (m) => { insp.classList.remove("wide"); insp.style.width = Math.max(300, Math.min(window.innerWidth * 0.7, window.innerWidth - m.clientX)) + "px"; };
      grip.onpointerup = () => (grip.onpointermove = grip.onpointerup = null);
    };
    const hl = (e, on) => {
      const el = e.target.closest("[data-h]");
      if (el) box.querySelectorAll(`[data-h="${el.dataset.h}"]`).forEach((x) => x.classList.toggle("hl", on));
    };
    box.onmouseover = (e) => hl(e, true);
    box.onmouseout = (e) => hl(e, false);
    box.onclick = (e) => {
      const el = e.target.closest("[data-h]");
      selected = el && el.dataset.h !== selected ? el.dataset.h : null;
      renderGraph();
    };
    $("commit-detail").onclick = (e) => {
      const b = e.target.closest("[data-insert]");
      if (!b) return;
      const i = $("cmd-input"), at = i.selectionStart ?? i.value.length;
      i.value = i.value.slice(0, at) + b.dataset.insert + i.value.slice(at);
      focusCmd();
    };
  }

  function renderStep() {
    const step = scenario.steps[stepIdx];
    $("hint-box").classList.toggle("is-hidden", !step);
    if (!step) return;
    $("hint-step").textContent = `${stepIdx + 1}/${scenario.steps.length}`;
    $("hint-cmd").textContent = window.stepCommand(step, state);
    $("hint-desc").textContent = step.hint || "";
  }

  function renderFiles() {
    for (const z of ["working", "staged"]) {
      $("files-" + z).innerHTML = Brain.renderFiles(state, z, expandedFile);
      $("count-" + z).textContent = Brain.zoneFiles(state, z).length;
    }
  }

  function onFileClick(e) {
    const pick = e.target.closest("[data-resolve]");
    if (pick) {
      const p = expandedFile;
      if (!p || !state.conflicts[p]) return;
      state.workdir[p] = Brain.sides(state.workdir[p] || "")[pick.dataset.resolve];
      state.resolved[p] = true;
      toast("Versi telah dipilih. Jalankan git add untuk menandai selesai.");
      return renderAll();
    }
    const row = e.target.closest(".file-row");
    if (!row) return;
    expandedFile = expandedFile === row.dataset.path ? null : row.dataset.path;
    renderFiles();
  }

  function updateSidebar() {
    const done = doneSet();
    const p = Math.round((done.size / SCENARIOS.length) * 100);
    $("sidebar-progress").style.setProperty("--p", p);
    $("sidebar-progress").firstElementChild.textContent = p + "%";
    $("module-list").innerHTML = grouped((s) => `
      <div class="module-item${s.id === scenario.id ? " active" : ""}" data-id="${s.id}">
        <span class="num">${s.num}</span><span>${esc(s.title)}${done.has(s.id) ? " ✓" : ""}</span>
      </div>`);
    $("module-list").onclick = (e) => {
      const el = e.target.closest(".module-item");
      if (el) openScenario(el.dataset.id);
    };
  }

  function printBatch(lines, instant) {
    const t = $("terminal");
    lines.forEach((line, i) => {
      const div = document.createElement("div");
      div.className = `term-line ${line.cls || ""}${instant ? " no-anim" : ""}`;
      if (!instant) div.style.animationDelay = `${i * 20}ms`;
      div.innerHTML = line.html;
      t.appendChild(div);
    });
    t.scrollTo({ top: t.scrollHeight });
  }

  const focusCmd = () => $("cmd-input").focus();

  function submitCmd() {
    const input = $("cmd-input"), cmd = input.value.trim();
    if (!cmd) return;
    if (hist[hist.length - 1] !== cmd) hist.push(cmd);
    histIdx = hist.length;

    // The expected command is computed before execution, since it may depend on current state.
    const step = scenario.steps[stepIdx];
    const expected = step && window.stepCommand(step, state);

    const res = GitSim.run(state, cmd);
    const batch = [{ html: `$ ${esc(cmd)}`, cls: "cmd" }];
    res.lines.forEach((l) => batch.push({ html: esc(l), cls: res.ok ? "" : "err" }));

    if (!res.ok) {
      const joined = res.lines.join("\n"), hit = HINTS.find(([re]) => re.test(joined));
      if (hit) batch.push({ html: md(hit[1]), cls: "note" });
    }
    // Real Git does not inspect conflict markers on add, so we merely warn.
    const marked = /^git add/.test(norm(cmd)) ? Object.keys(state.index).filter((p) => /^(<{7}|={7}|>{7})/m.test(state.index[p])) : [];
    if (marked.length)
      batch.push({ html: md(`Peringatan: ${marked.join(", ")} masih berisi penanda konflik (<<<<<<<). Git tidak memeriksanya, jadi penanda ikut ter-commit. Pilih versi di panel Berkas (atau edit berkas), lalu \`git add\` lagi.`), cls: "err" });
    // Advance only when the outcome matches the plan: success, or failure on a step meant to fail.
    if (expected && norm(cmd) === norm(expected) && res.ok === !step.fail && !marked.length) {
      const note = scenario.stepNotes && scenario.stepNotes[stepIdx];
      if (note) batch.push({ html: md(note), cls: "note" });
      stepIdx++;
    }
    printBatch(batch, false);
    input.value = "";

    const open = Object.keys(state.conflicts).find((p) => !state.resolved[p]);
    if (open) expandedFile = open;
    renderAll();

    if (!finished && scenario.check(state)) {
      finished = true;
      markDone(scenario.id);
      setTimeout(() => {
        printBatch([{ html: "✓ Tujuan modul tercapai.", cls: "ok" }], false);
        toast("Modul berhasil diselesaikan.");
        updateSidebar();
      }, 200);
    }
    focusCmd();
  }

  function openWhy() {
    if (!scenario || !scenario.why) return;
    $("modal-title").textContent = scenario.why.title;
    $("modal-body").innerHTML = scenario.why.blocks.map((b) =>
      `<h3>${esc(b.h)}</h3>${b.p ? `<p>${md(b.p)}</p>` : ""}${b.pre ? `<pre>${esc(b.pre)}</pre>` : ""}`).join("");
    $("modal-back").hidden = false;
  }

  function openNewFile() {
    $("newfile-modal").hidden = false;
    $("nf-name").value = $("nf-body").value = "";
    $("nf-name").focus();
  }

  function submitNewFile(e) {
    e.preventDefault();
    const name = $("nf-name").value.trim(), body = $("nf-body").value;
    if (!name) return;
    if (/\s/.test(name)) return toast("Nama berkas tidak boleh mengandung spasi.");
    if (state.workdir[name] !== undefined) return toast(`Berkas "${name}" sudah ada.`);
    state.workdir[name] = body && !body.endsWith("\n") ? body + "\n" : body;
    $("newfile-modal").hidden = true;
    renderAll();
    toast("Berkas berhasil dibuat.");
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  document.addEventListener("DOMContentLoaded", init);
})();