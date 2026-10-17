(function (g) {
  "use strict";
  const ok = (l) => ({ ok: true, lines: l || [] });
  const err = (l) => ({ ok: false, lines: l || [] });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const keys = Object.keys;
  const lines = (t) => (t ? t.replace(/\n$/, "").split("\n") : []);
  const unq = (x) => x.replace(/^(["'])([\s\S]*)\1$/, "$2");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const NOSUP = "Simulator belum mendukung konflik hapus/ubah (modify/delete); tidak ada yang berubah.";
  const mkHash = (s) => {
    let h;
    do h = Math.random().toString(16).slice(2, 9).padEnd(7, "0");
    while (s.commits[h]);
    return h;
  };

  function createState(files, opts) {
    return {
      isRepo: !!(opts && opts.isRepo), commits: {}, seq: 0, branches: {},
      head: "main", detached: null, index: {}, workdir: { ...files },
      remote: { url: null, name: null, refs: {}, tracked: {} }, // refs = GitHub contents; tracked = origin/* as currently known locally
      conflicts: {}, resolved: {}, stash: [], pendingMerge: null, config: {},
    };
  }

  const headHash = (s) => s.detached || s.branches[s.head] || null;
  const filesAt = (s, h) => (h && s.commits[h] ? s.commits[h].files : {});
  const currentFiles = (s) => filesAt(s, headHash(s));
  const advance = (s, h) => (s.detached ? (s.detached = h) : (s.branches[s.head] = h));

  function addCommit(s, msg, parent, files) {
    const hash = mkHash(s);
    const parents = parent ? [].concat(parent) : [];
    s.commits[hash] = { hash, msg, parents, files: { ...files }, seq: ++s.seq };
    return hash;
  }
  function setRemote(s, url, branch, hash, known) {
    s.remote.url = url;
    s.remote.name = "origin";
    s.remote.refs[branch] = hash;
    s.remote.tracked[branch] = known === undefined ? hash : known;
  }

  function reach(s, h) {
    const seen = new Set(), st = [h];
    while (st.length) {
      const x = st.pop();
      if (!x || seen.has(x) || !s.commits[x]) continue;
      seen.add(x);
      st.push(...s.commits[x].parents);
    }
    return seen;
  }
  const isAncestor = (s, a, d) => !!a && !!d && reach(s, d).has(a);
  function mergeBase(s, a, b) {
    const A = reach(s, a), q = [b], seen = new Set();
    while (q.length) {
      const x = q.shift();
      if (!x || seen.has(x) || !s.commits[x]) continue;
      if (A.has(x)) return x;
      seen.add(x);
      q.push(...s.commits[x].parents);
    }
    return null;
  }

  const remoteTip = (s, ref) => {
    const m = ref.match(/^([^/]+)\/(.+)$/);
    return m && m[1] === s.remote.name && own(s.remote.tracked, m[2]) ? s.remote.tracked[m[2]] : null;
  };
  function resolve(s, ref) {
    if (!ref) return null;
    let n = 0;
    const m = ref.match(/^(.+?)(?:~(\d*)|(\^))$/);
    if (m) { ref = m[1]; n = m[3] ? 1 : +(m[2] || 1); }
    let h = ref === "HEAD" ? headHash(s)
      : own(s.branches, ref) ? s.branches[ref]
      : remoteTip(s, ref) || (s.commits[ref] ? ref
      : ref.length >= 4 ? keys(s.commits).find((k) => k.startsWith(ref)) : null);
    while (h && n--) h = s.commits[h].parents[0];
    return h && s.commits[h] ? h : null;
  }

  const overwrite = (what, bad, tail) => [
    `error: Your local changes to the following files would be overwritten by ${what}:`,
    ...bad.map((p) => `\t${p}`), tail, "Aborting",
  ];
  // Paths matching a pathspec: an exact name, a directory, or "." (everything).
  const under = (spec, ps) => {
    const d = spec.replace(/\/$/, "");
    return ps.filter((p) => spec === "." || p === d || p.startsWith(d + "/"));
  };

  // Move to commit t. Only clean files are replaced; a conflicting dirty file blocks the move.
  function moveTo(s, t) {
    const a = currentFiles(s), b = filesAt(s, t);
    const ps = [...new Set([...keys(a), ...keys(b)])].filter((p) => a[p] !== b[p]);
    const bad = ps.filter((p) => s.workdir[p] !== a[p] || s.index[p] !== a[p]);
    if (bad.length) return bad;
    for (const p of ps)
      for (const m of [s.workdir, s.index]) b[p] === undefined ? delete m[p] : (m[p] = b[p]);
    return null;
  }

  // Changes from A to X as hunks [{a, b, x}], expressed in A's coordinates.
  function hunks(A, X) {
    const out = [];
    let i = 0, cur = null;
    for (const [k, t] of diffLines(A, X)) {
      if (k === " ") { cur = null; i++; continue; }
      if (!cur) out.push((cur = { a: i, b: i, x: [] }));
      if (k === "-") { cur.b++; i++; } else cur.x.push(t);
    }
    return out;
  }

  // Three-way merge per hunk, as in diff3: disjoint hunks are combined, while touching hunks
  // that differ become conflicts. Adjacent hunks count as touching, matching Git.
  function merge3(b, o, t, label) {
    if (o === t || t === b) return { text: o };
    if (o === b) return { text: t };
    const A = lines(b);
    const H = [...hunks(A, lines(o)).map((h) => ({ ...h, s: 0 })), ...hunks(A, lines(t)).map((h) => ({ ...h, s: 1 }))]
      .sort((p, q) => p.a - q.a || p.b - q.b);
    const apply = (lo, hi, hs) => {
      const r = [];
      let p = lo;
      for (const h of hs) { r.push(...A.slice(p, h.a), ...h.x); p = h.b; }
      return [...r, ...A.slice(p, hi)];
    };
    const out = [];
    let pos = 0, conflict = false;
    for (let i = 0; i < H.length; ) {
      let j = i + 1, hi = H[i].b;
      while (j < H.length && H[j].a <= hi) hi = Math.max(hi, H[j++].b);
      const lo = H[i].a, grp = H.slice(i, j);
      const ho = grp.filter((h) => !h.s), ht = grp.filter((h) => h.s);
      const ro = apply(lo, hi, ho), rt = apply(lo, hi, ht);
      out.push(...A.slice(pos, lo));
      if (!ht.length) out.push(...ro);
      else if (!ho.length || ro.join("\n") === rt.join("\n")) out.push(...rt);
      else { conflict = true; out.push("<<<<<<< HEAD", ...ro, "=======", ...rt, ">>>>>>> " + label); }
      pos = hi;
      i = j;
    }
    return { conflict, text: [...out, ...A.slice(pos)].join("\n") + "\n" };
  }

  // A single file, where undefined means absent. An undefined text means the file is deleted.
  function mergeFile(b, o, t, label) {
    if (o === t || t === b) return { text: o };
    if (o === b) return { text: t };
    if (b !== undefined && (o === undefined || t === undefined)) return { unsupported: true };
    return merge3(b || "", o, t, label); // add/add: basis kosong
  }
  function mergeTrees(paths, base, ours, theirs, label) {
    const res = {};
    for (const p of paths) {
      res[p] = mergeFile(base[p], ours[p], theirs[p], label);
      if (res[p].unsupported) return { unsupported: p };
    }
    return { res };
  }

  function diffLines(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push([" ", a[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["-", a[i++]]);
      else out.push(["+", b[j++]]);
    }
    while (i < n) out.push(["-", a[i++]]);
    while (j < m) out.push(["+", b[j++]]);
    return out;
  }

  // Unified diff as produced by `git diff`: hunks with three context lines and @@ headers.
  function unified(A, B, ctx = 3) {
    const ops = diffLines(A, B), pa = [], pb = [];
    let x = 0, y = 0;
    ops.forEach((o) => { pa.push(x); pb.push(y); if (o[0] !== "+") x++; if (o[0] !== "-") y++; });
    const idx = ops.map((o, i) => (o[0] === " " ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return [];
    const groups = [];
    let g0 = idx[0], g1 = idx[0];
    for (const i of idx.slice(1)) { if (i - g1 > 2 * ctx) { groups.push([g0, g1]); g0 = i; } g1 = i; }
    groups.push([g0, g1]);
    const rng = (st, n) => (n === 1 ? `${st}` : `${st},${n}`);
    return groups.flatMap(([s0, s1]) => {
      const lo = Math.max(0, s0 - ctx), seg = ops.slice(lo, Math.min(ops.length - 1, s1 + ctx) + 1);
      const na = seg.filter((o) => o[0] !== "+").length, nb = seg.filter((o) => o[0] !== "-").length;
      return [`@@ -${rng(na ? pa[lo] + 1 : pa[lo], na)} +${rng(nb ? pb[lo] + 1 : pb[lo], nb)} @@`, ...seg.map((o) => o[0] + o[1])];
    });
  }

  // .gitignore: globs (*, ?, **), leading "/" anchoring, "dir/", and "!" negation. Last match wins.
  function ignored(s, p) {
    const segs = p.split("/");
    let res = false;
    for (let x of lines(s.workdir[".gitignore"]).map((t) => t.trim()).filter((t) => t && t[0] !== "#")) {
      const neg = x[0] === "!";
      if (neg) x = x.slice(1);
      const dirOnly = x.endsWith("/");
      x = x.replace(/\/$/, "");
      const anchored = x.includes("/");
      x = x.replace(/^\//, "");
      const re = new RegExp("^" + x.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\0/g, ".*") + "$");
      const last = dirOnly ? segs.length - 1 : segs.length;
      let hit = false;
      for (let i = 0; i < last && !hit; i++) hit = re.test(anchored ? segs.slice(0, i + 1).join("/") : segs[i]);
      if (hit) res = !neg;
    }
    return res;
  }

  // Single source of truth for status and the Files panel.
  function changes(s) {
    const h = currentFiles(s), i = s.index, w = s.workdir, c = s.conflicts;
    const o = { conflicted: [], staged: [], unstaged: [], untracked: [] };
    const all = new Set([...keys(h), ...keys(i), ...keys(w), ...keys(c)]);
    for (const p of [...all].sort()) {
      if (c[p]) { o.conflicted.push({ p, st: s.resolved[p] ? "modified" : "conflict" }); continue; }
      if (i[p] !== h[p]) o.staged.push({ p, st: h[p] === undefined ? "new file" : i[p] === undefined ? "deleted" : "modified" });
      if (i[p] !== undefined) {
        if (w[p] === undefined) o.unstaged.push({ p, st: "deleted" });
        else if (w[p] !== i[p]) o.unstaged.push({ p, st: "modified" });
      } else if (w[p] !== undefined && h[p] === undefined && !ignored(s, p)) o.untracked.push({ p, st: "untracked" });
    }
    return o;
  }

  function refsAt(s) {
    const m = {}, add = (h, t, n) => h && (m[h] = m[h] || []).push({ t, n });
    for (const b of keys(s.branches).sort())
      add(s.branches[b], !s.detached && b === s.head ? "head" : "branch", !s.detached && b === s.head ? `HEAD -> ${b}` : b);
    if (s.detached) add(s.detached, "head", "HEAD");
    for (const b of keys(s.remote.tracked).sort()) add(s.remote.tracked[b], "remote", `${s.remote.name || "origin"}/${b}`);
    for (const h in m) m[h].sort((x, y) => (x.t === "head" ? 0 : 1) - (y.t === "head" ? 0 : 1));
    return m;
  }

  // ---- Shell emulation ----
  const sh = {
    touch(s, a) {
      if (!a.length) return err(["touch: missing file operand"]);
      for (const f of a) if (s.workdir[f] === undefined) s.workdir[f] = "";
      return ok([]);
    },
    echo(s, a) {
      const m = a.join(" ").match(/^(.*?)\s*(>>|>)\s*(\S+)\s*$/);
      if (!m) return ok([unq(a.join(" "))]);
      s.workdir[m[3]] = (m[2] === ">>" ? s.workdir[m[3]] || "" : "") + unq(m[1].trim()) + "\n";
      return ok([]);
    },
    cat(s, a) {
      if (!a.length) return err(["cat: missing file operand"]);
      const out = [];
      for (const f of a) {
        if (s.workdir[f] === undefined) return err([...out, `cat: ${f}: No such file or directory`]);
        out.push(...lines(s.workdir[f]));
      }
      return ok(out);
    },
    ls(s, a) {
      const all = a.includes("-a"), names = new Set();
      for (const p of keys(s.workdir)) names.add(p.includes("/") ? p.split("/")[0] : p);
      if (all) names.add(".git");
      return ok([[...names].filter((n) => all || n[0] !== ".").sort().join("  ")].filter(Boolean));
    },
    rm(s, a) {
      const force = a.includes("-f") || a.includes("-rf") || a.includes("-fr"), rec = a.some((x) => /^-\w*r/.test(x));
      for (const f of a.filter((x) => x[0] !== "-")) {
        const m = under(f, keys(s.workdir));
        if (!m.length) { if (force) continue; return err([`rm: ${f}: No such file or directory`]); }
        if (!rec && !(m.length === 1 && m[0] === f)) return err([`rm: ${f}: is a directory`]);
        for (const p of m) delete s.workdir[p];
      }
      return ok([]);
    },
  };

  // ---- Git commands ----
  const cmdInit = (s) => {
    if (s.isRepo) return ok(["Reinitialized existing Git repository."]);
    s.isRepo = true;
    return ok(["Initialized empty Git repository."]);
  };

  function cmdStatus(s) {
    const L = [s.detached ? `HEAD detached at ${s.detached}` : `On branch ${s.head}`];
    const lh = headHash(s), rh = s.remote.tracked[s.head], rn = `${s.remote.name}/${s.head}`;
    if (!s.detached && rh && lh) {
      const A = reach(s, lh), B = reach(s, rh);
      const ahead = [...A].filter((h) => !B.has(h)).length, behind = [...B].filter((h) => !A.has(h)).length;
      if (!ahead && !behind) L.push(`Your branch is up to date with '${rn}'.`);
      else if (!behind) L.push(`Your branch is ahead of '${rn}' by ${plural(ahead, "commit")}.`, '  (use "git push" to publish your local commits)');
      else if (!ahead) L.push(`Your branch is behind '${rn}' by ${plural(behind, "commit")}, and can be fast-forwarded.`, '  (use "git pull" to update your local branch)');
      else L.push(`Your branch and '${rn}' have diverged,`, `and have ${ahead} and ${behind} different commits each, respectively.`, '  (use "git pull" if you want to integrate the remote branch with yours)');
    }
    if (!lh) L.push("\nNo commits yet");
    const c = changes(s);
    if (s.pendingMerge)
      L.push(c.conflicted.length
        ? '\nYou have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)'
        : '\nAll conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)');
    const row = (st, p) => `\t${(st + ":").padEnd(9)}   ${p}`;
    const sec = (t, hints, a, f) => a.length && L.push(`\n${t}:`, ...hints.map((h) => `  (${h})`), ...a.map(f));
    sec("Unmerged paths", ['use "git add <file>..." to mark resolution'], c.conflicted, (x) => row("both modified", x.p));
    sec("Changes to be committed", [lh ? 'use "git restore --staged <file>..." to unstage' : 'use "git rm --cached <file>..." to unstage'], c.staged, (x) => row(x.st, x.p));
    sec("Changes not staged for commit", ['use "git add <file>..." to update what will be committed', 'use "git restore <file>..." to discard changes in working directory'], c.unstaged, (x) => row(x.st, x.p));
    // A directory that is entirely untracked is reported as "dir/", matching Git.
    const tracked = [...keys(currentFiles(s)), ...keys(s.index)];
    const un = [...new Set(c.untracked.map((x) => {
      const d = x.p.split("/")[0];
      return x.p.includes("/") && !tracked.some((t) => t.startsWith(d + "/")) ? d + "/" : x.p;
    }))];
    sec("Untracked files", ['use "git add <file>..." to include in what will be committed'], un, (p) => `\t${p}`);
    if (!s.pendingMerge && !c.conflicted.length && !c.staged.length) {
      if (c.unstaged.length) L.push('\nno changes added to commit (use "git add" and/or "git commit -a")');
      else if (c.untracked.length) L.push('\nnothing added to commit but untracked files present (use "git add" to track)');
      else L.push(lh ? "\nnothing to commit, working tree clean" : '\nnothing to commit (create/copy files and use "git add" to track)');
    }
    return ok(L);
  }

  function cmdAdd(s, a) {
    const specs = a.filter((x) => x[0] !== "-"), force = a.includes("-f") || a.includes("--force");
    const everything = specs.includes(".") || a.includes("-A") || a.includes("--all");
    if (!specs.length && !everything) return err(["Nothing specified, nothing added.", "hint: Maybe you wanted to say 'git add .'?"]);
    const h = currentFiles(s);
    const known = [...new Set([...keys(s.workdir), ...keys(s.index), ...keys(h)])];
    const skip = (p) => !force && ignored(s, p) && s.index[p] === undefined && h[p] === undefined;
    let ps = [];
    if (everything) ps = known.filter((p) => !skip(p));
    else
      for (const sp of specs) {
        const m = under(sp, known);
        if (!m.length) return err([`fatal: pathspec '${sp}' did not match any files`]);
        if (m.length === 1 && m[0] === sp && skip(sp))
          return err(["The following paths are ignored by one of your .gitignore files:", sp, "hint: Use -f if you really want to add them."]);
        ps.push(...m.filter((p) => !skip(p)));
      }
    for (const p of ps) {
      s.workdir[p] === undefined ? delete s.index[p] : (s.index[p] = s.workdir[p]);
      delete s.conflicts[p];
      delete s.resolved[p];
    }
    return ok([]);
  }

  function cmdRm(s, a) {
    const cached = a.includes("--cached"), force = a.includes("-f") || a.includes("--force");
    const specs = a.filter((x) => x[0] !== "-");
    if (!specs.length) return err(["fatal: No pathspec was given. Which files should I remove?"]);
    const h = currentFiles(s), out = [], ps = [];
    for (const sp of specs) {
      const m = under(sp, keys(s.index));
      if (!m.length) return err([`fatal: pathspec '${sp}' did not match any files`]);
      ps.push(...m);
    }
    for (const p of ps) {
      if (!force && !cached && s.workdir[p] !== s.index[p])
        return err(["error: the following file has local modifications:", `    ${p}`, "(use --cached to keep the file, or -f to force removal)"]);
      if (!force && !cached && s.index[p] !== h[p])
        return err(["error: the following file has changes staged in the index:", `    ${p}`, "(use --cached to keep the file, or -f to force removal)"]);
    }
    for (const p of ps) { delete s.index[p]; if (!cached) delete s.workdir[p]; out.push(`rm '${p}'`); }
    return ok(out);
  }

  function cmdCommit(s, a) {
    const mi = a.findIndex((x) => x === "-m" || x === "-am" || x === "-ma" || x === "--message");
    const amend = a.includes("--amend");
    const auto = a.includes("-a") || a.includes("--all") || /^-(am|ma)$/.test(a[mi] || "");
    const extra = a.filter((x, i) => x[0] !== "-" && !(mi >= 0 && i === mi + 1));
    if (extra.length)
      return err([`error: pathspec '${extra[0]}' did not match any file(s) known to git`, "hint: Pesan commit yang mengandung spasi harus diapit tanda kutip."]);
    if (Object.keys(s.conflicts).length)
      return err(["error: Committing is not possible because you have unmerged files.", "hint: Selesaikan konflik, lalu jalankan git add."]);
    const prev = headHash(s), old = prev && s.commits[prev], pm = s.pendingMerge;
    let msg = mi >= 0 ? unq(a[mi + 1] || "") : "";
    if (mi >= 0 && !msg) return err(["error: switch `m' requires a value"]);
    if (!msg && pm) msg = pm.msg; // Git asli membuka editor dengan pesan bawaan ini
    if (!msg && amend && a.includes("--no-edit") && old) msg = old.msg;
    if (!msg) return err(["error: Simulator tidak membuka editor teks.", 'hint: Gunakan git commit -m "pesan".']);
    if (amend && !old) return err(["fatal: You have nothing to amend."]);
    if (auto) for (const p of keys(s.index)) s.workdir[p] === undefined ? delete s.index[p] : (s.index[p] = s.workdir[p]);
    const c = changes(s);
    if (!amend && !pm && !c.staged.length)
      return err([c.unstaged.length || c.untracked.length ? 'no changes added to commit (use "git add" and/or "git commit -a")' : "nothing to commit, working tree clean"]);
    s.pendingMerge = null;
    const hash = addCommit(s, msg, amend ? old.parents : pm ? pm.parents : prev, s.index);
    advance(s, hash);
    return ok([`[${s.detached ? "detached HEAD" : s.head}${prev ? "" : " (root-commit)"} ${hash}] ${msg}`]);
  }

  function cmdLog(s, a) {
    const rev = a.find((x) => x[0] !== "-"), num = a.find((x) => /^-\d+$/.test(x));
    const start = rev ? resolve(s, rev) : headHash(s);
    if (rev && !start) return err([`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`]);
    const hs = [...reach(s, start)].sort((x, y) => s.commits[y].seq - s.commits[x].seq).slice(0, num ? -num : Infinity);
    if (!hs.length) return err([`fatal: your current branch '${s.head}' does not have any commits yet`]);
    const refs = refsAt(s);
    return ok(hs.map((h) => {
      const d = (refs[h] || []).map((r) => r.n).join(", ");
      const c = s.commits[h];
      return a.includes("--oneline")
        ? `${h}${d ? ` (${d})` : ""} ${c.msg}`
        : `commit ${h}${d ? ` (${d})` : ""}\n\n    ${c.msg}\n`;
    }));
  }

  function cmdBranch(s, a) {
    const flags = a.filter((x) => x[0] === "-"), args = a.filter((x) => x[0] !== "-");
    if (flags.some((f) => f === "-d" || f === "-D" || f === "--delete")) {
      if (!args.length) return err(["fatal: branch name required"]);
      const out = [];
      for (const b of args) {
        if (!own(s.branches, b)) return err([...out, `error: branch '${b}' not found.`]);
        if (b === s.head && !s.detached) return err([...out, `error: Cannot delete branch '${b}' checked out`]);
        if (!flags.includes("-D") && !isAncestor(s, s.branches[b], headHash(s)))
          return err([...out, `error: The branch '${b}' is not fully merged.`, `If you are sure you want to delete it, run 'git branch -D ${b}'.`]);
        out.push(`Deleted branch ${b} (was ${s.branches[b]}).`);
        delete s.branches[b];
      }
      return ok(out);
    }
    if (!args.length) {
      const local = keys(s.branches).sort().map((b) => (b === s.head && !s.detached ? "* " : "  ") + b);
      if (s.detached) local.unshift(`* (HEAD detached at ${s.detached})`);
      const rem = keys(s.remote.tracked).sort().map((b) => `${s.remote.name}/${b}`);
      if (flags.includes("-r")) return ok(rem.map((r) => "  " + r));
      return ok(flags.includes("-a") ? [...local, ...rem.map((r) => "  remotes/" + r)] : local);
    }
    if (own(s.branches, args[0])) return err([`fatal: a branch named '${args[0]}' already exists`]);
    const t = args[1] ? resolve(s, args[1]) : headHash(s);
    if (!t) return err([`fatal: not a valid object name: '${args[1] || s.head}'`]);
    s.branches[args[0]] = t;
    return ok([]);
  }

  function cmdSwitch(s, a, strict) {
    const create = a.includes("-c") || a.includes("-b");
    const detach = a.includes("--detach") || a.includes("-d");
    const [name, start] = a.filter((x) => x[0] !== "-");
    if (!name) return err([strict ? "fatal: missing branch or commit argument" : "fatal: you must specify a branch"]);
    if (create) {
      if (own(s.branches, name)) return err([`fatal: a branch named '${name}' already exists`]);
      const base = start ? resolve(s, start) : headHash(s);
      if (start && !base) return err([`fatal: invalid reference: ${start}`]);
      if (base) {
        const bad = moveTo(s, base);
        if (bad) return err(overwrite("checkout", bad, "Please commit your changes or stash them before you switch branches."));
        s.branches[name] = base;
      }
      s.head = name;
      s.detached = null;
      return ok([`Switched to a new branch '${name}'`]);
    }
    const isBranch = own(s.branches, name), t = isBranch ? s.branches[name] : resolve(s, name);
    if (!t) {
      if (!strict && (s.index[name] !== undefined || currentFiles(s)[name] !== undefined)) return cmdRestore(s, [name]);
      return err([strict ? `fatal: invalid reference: ${name}` : `error: pathspec '${name}' did not match any file(s) known to git`]);
    }
    if (strict && !isBranch && !detach)
      return err([`fatal: a branch is expected, got commit '${name}'`, "hint: If you want to detach HEAD at the commit, try again with the --detach option."]);
    if (isBranch && !s.detached && name === s.head) return ok([`Already on '${name}'`]);
    const bad = moveTo(s, t);
    if (bad) return err(overwrite("checkout", bad, "Please commit your changes or stash them before you switch branches."));
    if (isBranch) { s.head = name; s.detached = null; return ok([`Switched to branch '${name}'`]); }
    s.detached = t;
    return ok([`Note: switching to '${name}'.`, "You are in 'detached HEAD' state.", `HEAD is now at ${t} ${s.commits[t].msg}`]);
  }

  function stashApply(s, e) {
    const paths = keys(e.files);
    const r = mergeTrees(paths, e.base, s.workdir, e.files, "Stashed changes");
    if (r.unsupported) return err([`CONFLICT (modify/delete): ${r.unsupported}`, NOSUP]);
    const out = [];
    for (const p of paths) {
      const m = r.res[p];
      m.text === undefined ? delete s.workdir[p] : (s.workdir[p] = m.text);
      if (m.conflict) { s.conflicts[p] = true; delete s.resolved[p]; out.push(`CONFLICT (content): Merge conflict in ${p}`); }
    }
    return out.length ? err([...out, "The stash entry is kept in case you need it again."]) : ok([]);
  }

  function cmdStash(s, a) {
    const sub = a[0] && a[0][0] !== "-" ? a[0] : "push", top = s.stash[s.stash.length - 1];
    if (sub === "list") return ok([...s.stash].reverse().map((e, k) => `stash@{${k}}: ${e.label}`));
    if (sub === "pop" || sub === "apply" || sub === "drop") {
      if (!top) return err(["No stash entries found."]);
      if (sub !== "drop") {
        const r = stashApply(s, top);
        if (!r.ok) return r;
      }
      if (sub !== "apply") s.stash.pop();
      return ok(sub === "apply" ? [] : [`Dropped refs/stash@{0} (${top.id})`]);
    }
    const prev = headHash(s);
    if (!prev) return err(["You do not have the initial commit yet"]);
    const h = currentFiles(s), files = {};
    for (const p of new Set([...keys(s.workdir), ...keys(h)]))
      if (s.workdir[p] !== h[p] && (h[p] !== undefined || s.index[p] !== undefined)) files[p] = s.workdir[p];
    if (!keys(files).length) return ok(["No local changes to save"]);
    const mi = a.indexOf("-m");
    const label = mi >= 0 ? `On ${s.head}: ${unq(a[mi + 1] || "")}` : `WIP on ${s.detached ? "(no branch)" : s.head}: ${prev} ${s.commits[prev].msg}`;
    s.stash.push({ files, base: { ...h }, label, id: mkHash(s) });
    for (const p in files) h[p] === undefined ? delete s.workdir[p] : (s.workdir[p] = h[p]);
    s.index = { ...h };
    return ok([`Saved working directory and index state ${label}`]);
  }

  function cmdReset(s, a) {
    const pos = a.filter((x) => x[0] !== "-"), mode = (a.find((x) => /^--(soft|mixed|hard)$/.test(x)) || "--mixed").slice(2);
    const first = pos[0], isRev = first && resolve(s, first);
    const rev = isRev ? first : "HEAD", paths = isRev ? pos.slice(1) : pos;
    const unknown = (x) => err([`fatal: ambiguous argument '${x}': unknown revision or path not in the working tree.`]);
    if (!headHash(s) && !pos.length) { if (mode !== "soft") s.index = {}; return ok([]); }
    const t = resolve(s, rev);
    if (!t) return unknown(rev);
    const tf = s.commits[t].files;
    const modified = () => keys({ ...s.workdir, ...s.index }).sort().filter((p) => s.workdir[p] !== s.index[p] && (s.index[p] !== undefined))
      .map((p) => `${s.workdir[p] === undefined ? "D" : "M"}\t${p}`);
    if (paths.length) {
      if (a.some((x) => /^--(soft|hard)$/.test(x))) return err([`fatal: Cannot do ${mode} reset with paths.`]);
      const known = [...new Set([...keys(s.index), ...keys(tf), ...keys(s.workdir)])];
      for (const sp of paths) {
        const m = under(sp, known);
        if (!m.length) return unknown(sp);
        for (const p of m) tf[p] === undefined ? delete s.index[p] : (s.index[p] = tf[p]);
      }
      const u = modified();
      return ok(u.length ? ["Unstaged changes after reset:", ...u] : []);
    }
    const before = { ...currentFiles(s), ...s.index };
    advance(s, t);
    if (mode === "soft") return ok([]);
    s.index = { ...tf };
    s.conflicts = {}; s.resolved = {}; s.pendingMerge = null;
    if (mode === "hard") {
      for (const p of new Set([...keys(before), ...keys(tf)])) tf[p] === undefined ? delete s.workdir[p] : (s.workdir[p] = tf[p]); // berkas untracked tidak disentuh
      return ok([`HEAD is now at ${t} ${s.commits[t].msg}`]);
    }
    const u = modified();
    return ok(u.length ? ["Unstaged changes after reset:", ...u] : []);
  }

  function cmdRevert(s, a) {
    const ref = a.filter((x) => x[0] !== "-")[0], t = resolve(s, ref);
    if (!t) return err([`fatal: bad revision '${ref || ""}'`]);
    const c = s.commits[t];
    if (c.parents.length > 1) return err([`error: commit ${t} is a merge but no -m option was given.`, "fatal: revert failed"]);
    const before = filesAt(s, c.parents[0]), cur = { ...currentFiles(s) };
    const paths = keys({ ...c.files, ...before }).filter((p) => c.files[p] !== before[p]);
    if (paths.some((p) => s.workdir[p] !== cur[p] || s.index[p] !== cur[p]))
      return err(["error: your local changes would be overwritten by revert.", "hint: commit your changes or stash them to proceed.", "fatal: revert failed"]);
    const r = mergeTrees(paths, c.files, cur, before, `parent of ${t}`);
    const bad = r.unsupported || paths.find((p) => r.res[p].conflict);
    if (bad) return err([`CONFLICT: revert of ${t} conflicts in ${bad}`, "Simulator belum mendukung konflik saat revert; tidak ada yang berubah."]);
    for (const p of paths)
      for (const m of [cur, s.workdir, s.index]) r.res[p].text === undefined ? delete m[p] : (m[p] = r.res[p].text);
    const hash = addCommit(s, `Revert "${c.msg}"`, headHash(s), cur);
    advance(s, hash);
    return ok([`[${s.detached ? "detached HEAD" : s.head} ${hash}] Revert "${c.msg}"`]);
  }

  function cmdRestore(s, a) {
    const specs = a.filter((x) => x[0] !== "-"), h = currentFiles(s);
    const staged = a.includes("--staged") || a.includes("-S"), wt = a.includes("--worktree") || a.includes("-W") || !staged;
    if (!specs.length) return err(["fatal: you must specify path(s) to restore"]);
    const known = staged ? [...new Set([...keys(h), ...keys(s.index)])] : keys(s.index);
    const ps = [];
    for (const sp of specs) {
      const m = under(sp, known);
      if (!m.length) return err([`error: pathspec '${sp}' did not match any file(s) known to git`]);
      ps.push(...m);
    }
    for (const p of ps) if (s.conflicts[p]) return err([`error: path '${p}' is unmerged`]);
    for (const p of ps) {
      const src = staged ? h[p] : s.index[p];
      if (staged) h[p] === undefined ? delete s.index[p] : (s.index[p] = h[p]);
      if (wt) src === undefined ? delete s.workdir[p] : (s.workdir[p] = src);
    }
    return ok([]);
  }

  function cmdRemote(s, a) {
    if (!a.length || a[0] === "-v") {
      const n = s.remote.name, u = s.remote.url;
      return ok(!u ? [] : a[0] === "-v" ? [`${n}\t${u} (fetch)`, `${n}\t${u} (push)`] : [n]);
    }
    if (a[0] !== "add" || !a[2]) return err(["usage: git remote add <name> <url>"]);
    if (s.remote.url) return err([a[1] === s.remote.name ? `error: remote ${a[1]} already exists.` : "Simulator hanya mendukung satu remote."]);
    s.remote.name = a[1];
    s.remote.url = a[2];
    return ok([]);
  }

  function cmdConfig(s, a) {
    const p = a.filter((x) => x[0] !== "-");
    if (!p.length) return err(["usage: git config [<options>] <name> [<value>]"]);
    if (p.length === 1) return own(s.config, p[0]) ? ok([s.config[p[0]]]) : err([]);
    s.config[p[0]] = unq(p[1]);
    return ok([]);
  }

  function cmdPush(s, a) {
    const force = a.some((x) => x === "-f" || x === "--force" || x === "--force-with-lease");
    const p = a.filter((x) => x[0] !== "-"), rb = p[1] || s.head;
    if (!s.remote.url) return err(["fatal: No configured push destination.", "hint: git remote add origin <url>"]);
    if (p[0] && p[0] !== s.remote.name) return err([`fatal: '${p[0]}' does not appear to be a git repository`]);
    const local = s.branches[rb], r = s.remote.refs[rb]; // Accepted or rejected against GitHub itself, not the local origin/* refs
    const to = `To ${s.remote.url}`;
    if (!local) return err([`error: src refspec ${rb} does not match any`, `error: failed to push some refs to '${s.remote.url}'`]);
    if (!r) { s.remote.refs[rb] = s.remote.tracked[rb] = local; return ok([to, ` * [new branch]      ${rb} -> ${rb}`]); }
    if (r === local) { s.remote.tracked[rb] = local; return ok(["Everything up-to-date"]); }
    if (isAncestor(s, r, local)) { s.remote.refs[rb] = s.remote.tracked[rb] = local; return ok([to, `   ${r}..${local}  ${rb} -> ${rb}`]); }
    if (force) { s.remote.refs[rb] = s.remote.tracked[rb] = local; return ok([to, ` + ${r}...${local} ${rb} -> ${rb} (forced update)`]); }
    const known = s.remote.tracked[rb] === r; // commit remote sudah ada di lokal (sudah fetch)?
    return err([
      to,
      ` ! [rejected]        ${rb} -> ${rb} (${known ? "non-fast-forward" : "fetch first"})`,
      `error: failed to push some refs to '${s.remote.url}'`,
      ...(known
        ? ["hint: Updates were rejected because the tip of your current branch is behind", "hint: its remote counterpart. If you want to integrate the remote changes,", "hint: use 'git pull' before pushing again."]
        : ["hint: Updates were rejected because the remote contains work that you do not", "hint: have locally. This is usually caused by another repository pushing to", "hint: the same ref. If you want to integrate the remote changes, use", "hint: 'git pull' before pushing again."]),
    ]);
  }

  // opt.ff: "default" | "no" | "only"
  function integrate(s, t, label, msg, opt = {}) {
    const l = headHash(s);
    if (!t || t === l || isAncestor(s, t, l)) return ok(["Already up to date."]);
    const blocked = (bad) => err(overwrite("merge", bad, "Please commit your changes or stash them before you merge."));
    if ((!l || isAncestor(s, l, t)) && opt.ff !== "no") {
      const bad = moveTo(s, t);
      if (bad) return blocked(bad);
      advance(s, t);
      return ok([...(l ? [`Updating ${l}..${t}`] : []), "Fast-forward"]);
    }
    if (opt.ff === "only") return err(["fatal: Not possible to fast-forward, aborting."]);
    const a = filesAt(s, l), b = filesAt(s, t), base = filesAt(s, mergeBase(s, l, t));
    const ps = [...new Set([...keys(a), ...keys(b)])].filter((p) => a[p] !== b[p]);
    const bad = ps.filter((p) => s.workdir[p] !== a[p] || s.index[p] !== a[p]);
    if (bad.length) return blocked(bad);
    const r = mergeTrees(ps, base, a, b, label);
    if (r.unsupported) return err([`CONFLICT (modify/delete): ${r.unsupported}`, NOSUP]);
    const files = { ...a }, out = [];
    for (const p of ps) {
      const m = r.res[p];
      if (m.text === undefined) { delete files[p]; delete s.index[p]; delete s.workdir[p]; continue; }
      s.workdir[p] = m.text;
      if (m.conflict) { s.conflicts[p] = true; delete s.resolved[p]; out.push(`Auto-merging ${p}`, `CONFLICT (content): Merge conflict in ${p}`); }
      else files[p] = s.index[p] = m.text;
    }
    if (out.length) {
      s.pendingMerge = { parents: [l, t], msg };
      return err([...out, "Automatic merge failed; fix conflicts and then commit the result."]);
    }
    advance(s, addCommit(s, msg, [l, t], files));
    return ok(["Merge made by the 'ort' strategy."]);
  }

  function fetchAll(s) {
    const out = [];
    for (const b in s.remote.refs) {
      const n = s.remote.refs[b], o = s.remote.tracked[b];
      if (n === o) continue;
      s.remote.tracked[b] = n;
      out.push(o ? `   ${o}..${n}  ${b} -> ${s.remote.name}/${b}` : ` * [new branch]      ${b} -> ${s.remote.name}/${b}`);
    }
    return out.length ? [`From ${s.remote.url}`, ...out] : [];
  }
  function cmdFetch(s) {
    return s.remote.url ? ok(fetchAll(s)) : err(["fatal: No remote repository specified."]);
  }

  // Conflict-free rebase: local commits are replayed onto the remote tip, yielding new hashes.
  function rebaseOnto(s, t) {
    const l = headHash(s), base = mergeBase(s, l, t), chain = [];
    for (let h = l; h && h !== base; h = s.commits[h].parents[0]) chain.unshift(h);
    const c0 = changes(s);
    if (c0.unstaged.length) return err(["error: cannot pull with rebase: You have unstaged changes.", "error: Please commit or stash them."]);
    if (c0.staged.length) return err(["error: cannot pull with rebase: Your index contains uncommitted changes.", "error: Please commit or stash them."]);
    let files = { ...filesAt(s, t) };
    const made = [];
    for (const h of chain) {
      const c = s.commits[h], before = filesAt(s, c.parents[0]);
      const paths = keys({ ...c.files, ...before }).filter((p) => c.files[p] !== before[p]);
      const r = mergeTrees(paths, before, files, c.files, c.msg);
      const bad = r.unsupported || paths.find((p) => r.res[p].conflict);
      if (bad)
        return err([`CONFLICT (content): Merge conflict in ${bad}`, "Simulator belum mendukung konflik saat rebase; gunakan git pull --no-rebase untuk berlatih.", "Rebase dibatalkan, tidak ada yang berubah."]);
      files = { ...files };
      for (const p of paths) r.res[p].text === undefined ? delete files[p] : (files[p] = r.res[p].text);
      made.push([c.msg, files]);
    }
    let tip = t;
    for (const [msg, f] of made) tip = addCommit(s, msg, tip, f);
    moveTo(s, tip);
    advance(s, tip);
    return ok([`Successfully rebased and updated refs/heads/${s.head}.`]);
  }

  const UNFINISHED = ["error: You have not concluded your merge (MERGE_HEAD exists).", "hint: Please, commit your changes before you merge.", "fatal: Exiting because of unfinished merge."];

  function cmdPull(s, a) {
    if (s.detached) return err(["You are not currently on a branch."]);
    if (!s.remote.url) return err(["fatal: No remote repository specified."]);
    if (s.pendingMerge) return err(UNFINISHED);
    const fetched = fetchAll(s), t = s.remote.tracked[s.head], l = headHash(s);
    if (!t) return err([...fetched, `fatal: couldn't find remote ref ${s.head}`]);
    const cfg = s.config["pull.rebase"];
    const rebase = a.includes("--rebase") || (!a.includes("--no-rebase") && cfg === "true") ? true
      : a.includes("--no-rebase") || cfg === "false" ? false : undefined;
    const ffOnly = a.includes("--ff-only") || s.config["pull.ff"] === "only";
    const diverged = l && t !== l && !isAncestor(s, t, l) && !isAncestor(s, l, t);
    if (diverged && ffOnly) return err([...fetched, "fatal: Not possible to fast-forward, aborting."]);
    if (diverged && rebase === undefined)
      return err([...fetched,
        "hint: You have divergent branches and need to specify how to reconcile them.",
        "hint: You can do so by running one of the following commands sometime before",
        "hint: your next pull:",
        "hint:",
        "hint:   git config pull.rebase false  # merge",
        "hint:   git config pull.rebase true   # rebase",
        "hint:   git config pull.ff only       # fast-forward only",
        "hint:",
        'hint: You can replace "git config" with "git config --global" to set a default',
        "hint: preference for all repositories. You can also pass --rebase, --no-rebase,",
        "hint: or --ff-only on the command line to override the configured default per",
        "hint: invocation.",
        "fatal: Need to specify how to reconcile divergent branches."]);
    const r = diverged && rebase ? rebaseOnto(s, t)
      : integrate(s, t, `${s.remote.name}/${s.head}`, `Merge branch '${s.head}' of ${s.remote.url}`, { ff: ffOnly ? "only" : "default" });
    return { ok: r.ok, lines: [...fetched, ...r.lines] };
  }

  function mergeAbort(s) {
    if (!s.pendingMerge) return err(["fatal: There is no merge to abort (MERGE_HEAD missing)."]);
    const h = currentFiles(s);
    for (const p of new Set([...keys(s.conflicts), ...keys(s.index), ...keys(h)]))
      if (s.conflicts[p] || s.index[p] !== h[p]) h[p] === undefined ? delete s.workdir[p] : (s.workdir[p] = h[p]);
    s.index = { ...h };
    s.conflicts = {}; s.resolved = {}; s.pendingMerge = null;
    return ok([]);
  }

  function cmdMerge(s, a) {
    if (a.includes("--abort")) return mergeAbort(s);
    if (s.pendingMerge) return err(UNFINISHED);
    const mi = a.indexOf("-m"), custom = mi >= 0 ? unq(a[mi + 1] || "") : "";
    const name = a.find((x, i) => x[0] !== "-" && (mi < 0 || i !== mi + 1));
    if (!name) return err(["fatal: No commit specified and merge.defaultToUpstream not set."]);
    const t = resolve(s, name);
    if (!t) return err([`merge: ${name} - not something we can merge`]);
    const ff = a.includes("--no-ff") ? "no" : a.includes("--ff-only") ? "only" : "default";
    const msg = custom || (remoteTip(s, name) ? `Merge remote-tracking branch '${name}'` : `Merge branch '${name}'`);
    return integrate(s, t, name, msg, { ff });
  }

  function cmdDiff(s, a) {
    const staged = a.includes("--staged") || a.includes("--cached");
    const specs = a.filter((x) => x[0] !== "-");
    const c = changes(s), h = currentFiles(s), out = [];
    for (const { p } of (staged ? c.staged : c.unstaged).filter((f) => !specs.length || specs.some((sp) => under(sp, [f.p]).length))) {
      const [x, y] = staged ? [h[p], s.index[p]] : [s.index[p], s.workdir[p]];
      out.push(`diff --git a/${p} b/${p}`);
      if (x === undefined) out.push("new file mode 100644");
      if (y === undefined) out.push("deleted file mode 100644");
      out.push(x === undefined ? "--- /dev/null" : `--- a/${p}`, y === undefined ? "+++ /dev/null" : `+++ b/${p}`, ...unified(lines(x), lines(y)));
    }
    return ok(out);
  }

  const GIT = {
    init: cmdInit, fetch: cmdFetch, status: cmdStatus, add: cmdAdd, rm: cmdRm, commit: cmdCommit, log: cmdLog,
    branch: cmdBranch, switch: (s, a) => cmdSwitch(s, a, true), checkout: (s, a) => cmdSwitch(s, a, false),
    stash: cmdStash, reset: cmdReset, revert: cmdRevert, restore: cmdRestore, remote: cmdRemote, config: cmdConfig,
    push: cmdPush, pull: cmdPull, merge: cmdMerge, diff: cmdDiff,
  };

  function run(s, raw) {
    const t = (raw || "").trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (!t.length) return ok([]);
    if (own(sh, t[0])) return sh[t[0]](s, t.slice(1));
    if (t[0] !== "git") return err([`command not found: ${t[0]}`]);
    if (!s.isRepo && t[1] !== "init") return err(["fatal: not a git repository (or any of the parent directories): .git", "Jalankan 'git init' terlebih dahulu."]);
    return own(GIT, t[1]) ? GIT[t[1]](s, t.slice(2)) : err([`git: '${t[1] || ""}' is not a git command. See 'git --help'.`]);
  }

  g.GitSim = { createState, run, headHash, currentFiles, addCommit, setRemote, changes, refsAt, diffLines, lines };
})(typeof window !== "undefined" ? window : globalThis);