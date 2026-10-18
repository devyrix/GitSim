(function (g) {
  "use strict";
  const ok = (l) => ({ ok: true, lines: l || [] });
  const err = (l) => ({ ok: false, lines: l || [] });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const lines = (t) => (t ? t.replace(/\n$/, "").split("\n") : []);
  const unq = (x) => x.replace(/^(["'])([\s\S]*)\1$/, "$2");
  const mkHash = (s) => {
    let h;
    do h = Math.random().toString(16).slice(2, 9).padEnd(7, "0");
    while (s.commits[h]);
    return h;
  };

  function createState(files, opts) {
    return {
      isRepo: !!(opts && opts.isRepo),
      commits: {},
      seq: 0,
      branches: {},
      head: "main",
      detached: null,
      index: {},
      workdir: { ...files },
      remote: { url: null, name: null, refs: {}, tracked: {} }, // refs = isi GitHub; tracked = origin/* yang diketahui lokal
      conflicts: {},
      resolved: {},
      stash: [],
      pendingMerge: null,
    };
  }

  const headHash = (s) => s.detached || s.branches[s.head] || null;
  const filesAt = (s, h) => (h && s.commits[h] ? s.commits[h].files : {});
  const currentFiles = (s) => filesAt(s, headHash(s));
  const advance = (s, h) =>
    s.detached ? (s.detached = h) : (s.branches[s.head] = h);

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
    const seen = new Set(),
      st = [h];
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
    const A = reach(s, a),
      q = [b],
      seen = new Set();
    while (q.length) {
      const x = q.shift();
      if (!x || seen.has(x) || !s.commits[x]) continue;
      if (A.has(x)) return x;
      seen.add(x);
      q.push(...s.commits[x].parents);
    }
    return null;
  }

  function resolve(s, ref) {
    if (!ref) return null;
    let n = 0;
    const m = ref.match(/^(.+?)~(\d*)$/);
    if (m) {
      ref = m[1];
      n = +(m[2] || 1);
    }
    let h =
      ref === "HEAD"
        ? headHash(s)
        : own(s.branches, ref)
          ? s.branches[ref]
          : s.commits[ref]
            ? ref
            : ref.length >= 4
              ? Object.keys(s.commits).find((k) => k.startsWith(ref))
              : null;
    while (h && n--) h = s.commits[h].parents[0];
    return h && s.commits[h] ? h : null;
  }

  // Pindah ke commit t: hanya berkas bersih yang diganti; berkas kotor yang bentrok memblokir.
  function moveTo(s, t) {
    const a = currentFiles(s),
      b = filesAt(s, t);
    const ps = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
      (p) => a[p] !== b[p],
    );
    const bad = ps.filter((p) => s.workdir[p] !== a[p] || s.index[p] !== a[p]);
    if (bad.length) return bad;
    for (const p of ps)
      for (const m of [s.workdir, s.index])
        b[p] === undefined ? delete m[p] : (m[p] = b[p]);
    return null;
  }

  // Perubahan X terhadap A sebagai hunk [{a, b, x}] dalam koordinat A.
  function hunks(A, X) {
    const out = [];
    let i = 0,
      cur = null;
    for (const [k, t] of diffLines(A, X)) {
      if (k === " ") {
        cur = null;
        i++;
        continue;
      }
      if (!cur) out.push((cur = { a: i, b: i, x: [] }));
      if (k === "-") {
        cur.b++;
        i++;
      } else cur.x.push(t);
    }
    return out;
  }

  // Merge 3 arah per hunk (seperti diff3): hunk yang tidak bersentuhan digabung, yang bersentuhan
  // dan berbeda menjadi konflik. Hunk yang bersebelahan dihitung bersentuhan, sama seperti Git.
  function merge3(b, o, t, label) {
    if (o === t || t === b) return { text: o };
    if (o === b) return { text: t };
    const A = lines(b);
    const H = [
      ...hunks(A, lines(o)).map((h) => ({ ...h, s: 0 })),
      ...hunks(A, lines(t)).map((h) => ({ ...h, s: 1 })),
    ].sort((p, q) => p.a - q.a || p.b - q.b);
    const apply = (lo, hi, hs) => {
      const r = [];
      let p = lo;
      for (const h of hs) {
        r.push(...A.slice(p, h.a), ...h.x);
        p = h.b;
      }
      return [...r, ...A.slice(p, hi)];
    };
    const out = [];
    let pos = 0,
      conflict = false;
    for (let i = 0; i < H.length; ) {
      let j = i + 1,
        hi = H[i].b;
      while (j < H.length && H[j].a <= hi) hi = Math.max(hi, H[j++].b);
      const lo = H[i].a,
        grp = H.slice(i, j);
      const ho = grp.filter((h) => !h.s),
        ht = grp.filter((h) => h.s);
      const ro = apply(lo, hi, ho),
        rt = apply(lo, hi, ht);
      out.push(...A.slice(pos, lo));
      if (!ht.length) out.push(...ro);
      else if (!ho.length || ro.join("\n") === rt.join("\n")) out.push(...rt);
      else {
        conflict = true;
        out.push("<<<<<<< HEAD", ...ro, "=======", ...rt, ">>>>>>> " + label);
      }
      pos = hi;
      i = j;
    }
    return { conflict, text: [...out, ...A.slice(pos)].join("\n") + "\n" };
  }

  function diffLines(a, b) {
    const n = a.length,
      m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] =
          a[i] === b[j]
            ? dp[i + 1][j + 1] + 1
            : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        out.push([" ", a[i]]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["-", a[i++]]);
      else out.push(["+", b[j++]]);
    }
    while (i < n) out.push(["-", a[i++]]);
    while (j < m) out.push(["+", b[j++]]);
    return out;
  }

  function ignored(s, p) {
    return lines(s.workdir[".gitignore"])
      .map((x) => x.trim())
      .filter((x) => x && x[0] !== "#")
      .some((x) => {
        const n = x.replace(/\/$/, "");
        return n.includes("/")
          ? p === n || p.startsWith(n + "/")
          : p.split("/").includes(n);
      });
  }

  // Satu sumber kebenaran untuk status dan panel Berkas.
  function changes(s) {
    const h = currentFiles(s),
      i = s.index,
      w = s.workdir,
      c = s.conflicts;
    const o = { conflicted: [], staged: [], unstaged: [], untracked: [] };
    const all = new Set([
      ...Object.keys(h),
      ...Object.keys(i),
      ...Object.keys(w),
      ...Object.keys(c),
    ]);
    for (const p of [...all].sort()) {
      if (c[p]) {
        o.conflicted.push({ p, st: s.resolved[p] ? "modified" : "conflict" });
        continue;
      }
      if (i[p] !== h[p])
        o.staged.push({
          p,
          st:
            h[p] === undefined
              ? "new file"
              : i[p] === undefined
                ? "deleted"
                : "modified",
        });
      if (i[p] !== undefined) {
        if (w[p] === undefined) o.unstaged.push({ p, st: "deleted" });
        else if (w[p] !== i[p]) o.unstaged.push({ p, st: "modified" });
      } else if (w[p] !== undefined && h[p] === undefined && !ignored(s, p))
        o.untracked.push({ p, st: "untracked" });
    }
    return o;
  }

  function refsAt(s) {
    const m = {},
      add = (h, t, n) => h && (m[h] = m[h] || []).push({ t, n });
    for (const b of Object.keys(s.branches).sort())
      add(
        s.branches[b],
        !s.detached && b === s.head ? "head" : "branch",
        !s.detached && b === s.head ? `HEAD -> ${b}` : b,
      );
    if (s.detached) add(s.detached, "head", "HEAD");
    for (const b of Object.keys(s.remote.tracked).sort())
      add(s.remote.tracked[b], "remote", `${s.remote.name || "origin"}/${b}`);
    for (const h in m)
      m[h].sort((x, y) => (x.t === "head" ? 0 : 1) - (y.t === "head" ? 0 : 1));
    return m;
  }

  // ---- perintah ----
  const cmdInit = (s) => {
    if (s.isRepo) return ok(["Reinitialized existing Git repository."]);
    s.isRepo = true;
    return ok(["Initialized empty Git repository."]);
  };

  function cmdStatus(s) {
    const L = [
      s.detached ? `HEAD detached at ${s.detached}` : `On branch ${s.head}`,
    ];
    const lh = headHash(s),
      rh = s.remote.tracked[s.head],
      rn = `${s.remote.name}/${s.head}`;
    if (!s.detached && rh && lh) {
      if (lh === rh) L.push(`Your branch is up to date with '${rn}'.`);
      else if (isAncestor(s, rh, lh))
        L.push(`Your branch is ahead of '${rn}'.`);
      else if (isAncestor(s, lh, rh)) L.push(`Your branch is behind '${rn}'.`);
      else L.push(`Your branch and '${rn}' have diverged.`);
    }
    if (!lh) L.push("No commits yet");
    const c = changes(s);
    if (s.pendingMerge)
      L.push(
        c.conflicted.length
          ? '\nYou have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)'
          : '\nAll conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)',
      );
    const sec = (t, a, f) => a.length && L.push(`\n${t}:`, ...a.map(f));
    sec("Unmerged paths", c.conflicted, (x) => `  both modified:   ${x.p}`);
    sec("Changes to be committed", c.staged, (x) => `  ${x.st}:   ${x.p}`);
    sec(
      "Changes not staged for commit",
      c.unstaged,
      (x) => `  ${x.st}:   ${x.p}`,
    );
    sec("Untracked files", c.untracked, (x) => `  ${x.p}`);
    if (
      lh &&
      !s.pendingMerge &&
      !c.conflicted.length &&
      !c.staged.length &&
      !c.unstaged.length &&
      !c.untracked.length
    )
      L.push("\nnothing to commit, working tree clean");
    return ok(L);
  }

  // Pathspec: "." / -A = semua; "dir" = seluruh isi folder; selain itu nama berkas persis.
  const under = (p, spec) =>
    spec === "." || p === spec || p.startsWith(spec.replace(/\/$/, "") + "/");
  function cmdAdd(s, a) {
    const specs = a.filter((x) => x[0] !== "-");
    if (!specs.length)
      return err(
        a.includes("-A")
          ? []
          : [
              "Nothing specified, nothing added.",
              "hint: Maybe you wanted to say 'git add .'?",
            ],
      );
    const h = currentFiles(s);
    const known = new Set([
      ...Object.keys(s.workdir),
      ...Object.keys(s.index),
      ...Object.keys(h),
    ]);
    const targets = new Set(),
      blocked = [];
    for (const spec of a.includes("-A") ? ["."] : specs) {
      const hit = [...known].filter((p) => under(p, spec));
      if (!hit.length)
        return err([`fatal: pathspec '${spec}' did not match any files`]);
      for (const p of hit) {
        const skip =
          ignored(s, p) && s.index[p] === undefined && h[p] === undefined;
        if (!skip) targets.add(p);
        else if (spec !== "." && p === spec) blocked.push(p);
      }
    }
    if (blocked.length)
      return err([
        "The following paths are ignored by one of your .gitignore files:",
        ...blocked,
        "hint: Use -f if you really want to add them.",
      ]);
    // Git asli menolak stage berkas yang masih berisi penanda konflik; berkas lain tetap di-stage.
    const marked = [...targets].filter(
      (p) => own(s.conflicts, p) && /^(<{7}|={7}|>{7})/m.test(s.workdir[p] || ""),
    );
    marked.forEach((p) => targets.delete(p));
    for (const p of targets) {
      s.workdir[p] === undefined
        ? delete s.index[p]
        : (s.index[p] = s.workdir[p]);
      delete s.conflicts[p];
      delete s.resolved[p];
    }
    return marked.length
      ? err(
          marked.flatMap((p) => [
            `error: '${p}' masih berisi penanda konflik`,
            `hint: Selesaikan konflik di ${p} (pilih versi di panel Berkas atau sunting berkas), lalu jalankan git add lagi.`,
          ]),
        )
      : ok([]);
  }

  function cmdCommit(s, a) {
    const i = a.findIndex((x) => /^-[a-z]*m$/.test(x));
    const msg = i >= 0 ? unq(a.slice(i + 1).join(" ")) : "";
    if (!msg)
      return err([
        "error: switch `m' requires a value",
        "hint: Tanpa -m, git membuka editor.",
      ]);
    if (a.some((x) => /^-[a-z]*a[a-z]*$/.test(x) || x === "--all"))
      for (const p of Object.keys(s.index))
        if (!s.conflicts[p] && s.workdir[p] !== s.index[p])
          s.workdir[p] === undefined
            ? delete s.index[p]
            : (s.index[p] = s.workdir[p]);
    if (Object.keys(s.conflicts).length)
      return err([
        "error: Committing is not possible because you have unmerged files.",
        "hint: Selesaikan konflik, lalu jalankan git add.",
      ]);
    const c = changes(s);
    if (!s.pendingMerge && !c.staged.length)
      return err([
        c.unstaged.length || c.untracked.length
          ? 'no changes added to commit (use "git add")'
          : "nothing to commit, working tree clean",
      ]);
    const prev = headHash(s);
    const pm = s.pendingMerge;
    s.pendingMerge = null;
    const hash = addCommit(s, msg, pm ? pm.parents : prev, s.index);
    advance(s, hash);
    return ok([
      `[${s.detached ? "detached HEAD" : s.head}${prev ? "" : " (root-commit)"} ${hash}] ${msg}`,
    ]);
  }

  function cmdLog(s, a) {
    const hs = [...reach(s, headHash(s))].sort(
      (x, y) => s.commits[y].seq - s.commits[x].seq,
    );
    if (!hs.length)
      return err(["fatal: your current branch has no commits yet"]);
    const refs = refsAt(s);
    return ok(
      hs.map((h) => {
        const d = (refs[h] || []).map((r) => r.n).join(", ");
        const c = s.commits[h];
        return a.includes("--oneline")
          ? `${h}${d ? ` (${d})` : ""} ${c.msg}`
          : `commit ${h}${d ? ` (${d})` : ""}\n\n    ${c.msg}\n`;
      }),
    );
  }

  function cmdBranch(s, a) {
    if (!a.length) {
      const L = Object.keys(s.branches)
        .sort()
        .map((b) => (b === s.head && !s.detached ? "* " : "  ") + b);
      if (s.detached) L.unshift(`* (HEAD detached at ${s.detached})`);
      return ok(L);
    }
    if (/^-[dD]$/.test(a[0])) {
      const n = a[1];
      if (!own(s.branches, n)) return err([`error: branch '${n}' not found.`]);
      if (n === s.head && !s.detached)
        return err([`error: Cannot delete branch '${n}' checked out`]);
      if (a[0] === "-d" && !isAncestor(s, s.branches[n], headHash(s)))
        return err([
          `error: the branch '${n}' is not fully merged.`,
          `hint: If you are sure you want to delete it, run 'git branch -D ${n}'.`,
        ]);
      const t = s.branches[n];
      delete s.branches[n];
      return ok([`Deleted branch ${n} (was ${t}).`]);
    }
    if (own(s.branches, a[0]))
      return err([`fatal: a branch named '${a[0]}' already exists`]);
    const t = a[1] ? resolve(s, a[1]) : headHash(s);
    if (!t) return err([`fatal: not a valid object name: '${a[1] || "HEAD"}'`]);
    s.branches[a[0]] = t;
    return ok([]);
  }

  function cmdSwitch(s, a) {
    const create = a.includes("-c") || a.includes("-b");
    const name = a.filter((x) => x[0] !== "-")[0];
    if (!name) return err(["fatal: missing branch name"]);
    if (create) {
      if (own(s.branches, name))
        return err([`fatal: a branch named '${name}' already exists`]);
      if (!headHash(s)) s.head = name;
      else {
        s.branches[name] = headHash(s);
        s.head = name;
        s.detached = null;
      }
      return ok([`Switched to a new branch '${name}'`]);
    }
    const isBranch = own(s.branches, name),
      t = isBranch ? s.branches[name] : resolve(s, name);
    if (!t) return err([`fatal: invalid reference: ${name}`]);
    const bad = moveTo(s, t);
    if (bad)
      return err([
        "error: Your local changes would be overwritten by checkout:",
        ...bad.map((p) => `\t${p}`),
        "Commit atau stash perubahan Anda terlebih dahulu.",
      ]);
    if (isBranch) {
      s.head = name;
      s.detached = null;
      return ok([`Switched to branch '${name}'`]);
    }
    s.detached = t;
    return ok([
      `Note: switching to '${name}'.`,
      "You are in 'detached HEAD' state.",
    ]);
  }

  function cmdStash(s, a) {
    if (a[0] === "list")
      return ok(
        s.stash
          .map((_, i) => `stash@{${s.stash.length - 1 - i}}: WIP`)
          .reverse(),
      );
    if (a[0] === "pop") {
      const e = s.stash[s.stash.length - 1];
      if (!e) return err(["No stash entries found."]);
      const bad = [];
      for (const p in e.files) {
        const m = merge3(
          e.base[p] || "",
          s.workdir[p] || "",
          e.files[p],
          "Stashed changes",
        );
        s.workdir[p] = m.text;
        if (m.conflict) {
          s.conflicts[p] = true;
          delete s.resolved[p];
          bad.push(`CONFLICT (content): Merge conflict in ${p}`);
        }
      }
      if (bad.length)
        return err([
          ...bad,
          "The stash entry is kept in case you need it again.",
        ]);
      s.stash.pop();
      return ok(["Dropped refs/stash@{0}"]);
    }
    const h = currentFiles(s),
      files = {};
    for (const p in s.workdir)
      if (
        s.workdir[p] !== h[p] &&
        (h[p] !== undefined || s.index[p] !== undefined)
      )
        files[p] = s.workdir[p];
    if (!Object.keys(files).length) return ok(["No local changes to save"]);
    s.stash.push({ files, base: { ...h } });
    for (const p in files)
      h[p] === undefined ? delete s.workdir[p] : (s.workdir[p] = h[p]);
    s.index = { ...h };
    return ok(["Saved working directory and index state WIP"]);
  }

  function cmdReset(s, a) {
    const t = resolve(s, a.filter((x) => x[0] !== "-")[0] || "HEAD");
    if (!t) return err(["fatal: ambiguous argument: unknown revision"]);
    if (headHash(s)) advance(s, t);
    if (!a.includes("--soft")) s.index = { ...s.commits[t].files };
    if (a.includes("--hard")) {
      s.workdir = { ...s.commits[t].files };
      return ok([`HEAD is now at ${t} ${s.commits[t].msg}`]);
    }
    return ok([]);
  }

  function cmdRevert(s, a) {
    const t = resolve(s, a[0]);
    if (!t) return err([`fatal: bad revision '${a[0] || ""}'`]);
    const c = s.commits[t],
      before = filesAt(s, c.parents[0]),
      cur = { ...currentFiles(s) };
    for (const p of new Set([
      ...Object.keys(c.files),
      ...Object.keys(before),
    ])) {
      if (c.files[p] === before[p]) continue;
      for (const m of [cur, s.workdir, s.index])
        before[p] === undefined ? delete m[p] : (m[p] = before[p]);
    }
    const hash = addCommit(s, `Revert "${c.msg}"`, headHash(s), cur);
    advance(s, hash);
    return ok([
      `[${s.detached ? "detached HEAD" : s.head} ${hash}] Revert "${c.msg}"`,
    ]);
  }

  function cmdRestore(s, a) {
    const specs = a.filter((x) => x[0] !== "-"),
      h = currentFiles(s),
      staged = a.includes("--staged");
    if (!specs.length)
      return err(["fatal: you must specify path(s) to restore"]);
    const known = new Set([
      ...Object.keys(s.workdir),
      ...Object.keys(s.index),
      ...Object.keys(h),
    ]);
    const ps = new Set();
    for (const spec of specs) {
      const hit = [...known].filter((p) => under(p, spec));
      if (!hit.length)
        return err([
          `error: pathspec '${spec}' did not match any file(s) known to git`,
        ]);
      hit.forEach((p) => ps.add(p));
    }
    for (const p of ps) {
      const src = staged ? h[p] : s.index[p] !== undefined ? s.index[p] : h[p];
      const dst = staged ? s.index : s.workdir;
      if (!staged && s.index[p] === undefined && h[p] === undefined) continue; // untracked: restore tidak menyentuhnya
      src === undefined ? delete dst[p] : (dst[p] = src);
    }
    return ok([]);
  }

  function cmdRemote(s, a) {
    if (a[0] !== "add" || !a[2])
      return err(["usage: git remote add <name> <url>"]);
    if (s.remote.url) return err([`error: remote ${a[1]} already exists.`]);
    s.remote.name = a[1];
    s.remote.url = a[2];
    return ok([]);
  }

  function cmdPush(s, a) {
    const p = a.filter((x) => x[0] !== "-"),
      rb = p[1] || s.head;
    if (!s.remote.url)
      return err([
        "fatal: No configured push destination.",
        "hint: git remote add origin <url>",
      ]);
    if (p[0] && p[0] !== s.remote.name)
      return err([`fatal: '${p[0]}' does not appear to be a git repository`]);
    const local = s.branches[rb],
      r = s.remote.refs[rb]; // ditolak/diterima berdasarkan isi GitHub, bukan origin/* lokal
    if (!local) return err([`error: src refspec ${rb} does not match any`]);
    if (!r) {
      s.remote.refs[rb] = s.remote.tracked[rb] = local;
      return ok([` * [new branch]      ${rb} -> ${rb}`]);
    }
    if (r === local) {
      s.remote.tracked[rb] = local;
      return ok(["Everything up-to-date"]);
    }
    if (isAncestor(s, r, local)) {
      s.remote.refs[rb] = s.remote.tracked[rb] = local;
      return ok([`   ${r}..${local}  ${rb} -> ${rb}`]);
    }
    return err([
      ` ! [rejected]        ${rb} -> ${rb} (fetch first)`,
      "error: failed to push some refs",
      "hint: Updates were rejected because the remote contains work that you do not have locally.",
    ]);
  }

  function integrate(s, t, label, msg) {
    const l = headHash(s);
    if (!t || t === l || isAncestor(s, t, l))
      return ok(["Already up to date."]);
    const blocked = (bad) =>
      err([
        "error: Your local changes would be overwritten by merge:",
        ...bad.map((p) => `\t${p}`),
        "Aborting",
      ]);
    if (isAncestor(s, l, t)) {
      const bad = moveTo(s, t);
      if (bad) return blocked(bad);
      advance(s, t);
      return ok(["Fast-forward"]);
    }
    const a = filesAt(s, l),
      b = filesAt(s, t),
      base = filesAt(s, mergeBase(s, l, t));
    const ps = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
      (p) => a[p] !== b[p],
    );
    const bad = ps.filter((p) => s.workdir[p] !== a[p] || s.index[p] !== a[p]);
    if (bad.length) return blocked(bad);
    const files = { ...a },
      out = [];
    for (const p of ps) {
      const m = merge3(base[p] || "", a[p] || "", b[p] || "", label);
      s.workdir[p] = m.text;
      if (m.conflict) {
        s.conflicts[p] = true;
        delete s.resolved[p];
        out.push(`CONFLICT (content): Merge conflict in ${p}`);
      } else files[p] = s.index[p] = m.text;
    }
    if (out.length) {
      s.pendingMerge = { parents: [l, t] };
      return err([
        "Auto-merging...",
        ...out,
        "Automatic merge failed; fix conflicts and then commit the result.",
      ]);
    }
    advance(s, addCommit(s, msg, [l, t], files));
    return ok(["Merge made by the 'ort' strategy."]);
  }

  function fetchAll(s) {
    const out = [];
    for (const b in s.remote.refs) {
      const n = s.remote.refs[b],
        o = s.remote.tracked[b];
      if (n === o) continue;
      s.remote.tracked[b] = n;
      out.push(
        o
          ? `   ${o}..${n}  ${b} -> ${s.remote.name}/${b}`
          : ` * [new branch]      ${b} -> ${s.remote.name}/${b}`,
      );
    }
    return out.length ? [`From ${s.remote.url}`, ...out] : [];
  }
  function cmdFetch(s) {
    return s.remote.url
      ? ok(fetchAll(s))
      : err(["fatal: No remote repository specified."]);
  }

  // Rebase tanpa konflik: commit lokal diputar ulang di atas ujung remote (hash baru).
  function rebaseOnto(s, t) {
    const l = headHash(s),
      base = mergeBase(s, l, t),
      chain = [];
    for (let h = l; h && h !== base; h = s.commits[h].parents[0])
      chain.unshift(h);
    const c0 = changes(s);
    if (c0.staged.length || c0.unstaged.length)
      return err([
        "error: cannot pull with rebase: You have unstaged changes.",
        "Commit atau stash perubahan Anda terlebih dahulu.",
      ]);
    let files = { ...filesAt(s, t) };
    const made = [];
    for (const h of chain) {
      const c = s.commits[h],
        before = filesAt(s, c.parents[0]),
        next = { ...files };
      for (const p of new Set([
        ...Object.keys(c.files),
        ...Object.keys(before),
      ])) {
        if (c.files[p] === before[p]) continue;
        const m = merge3(
          before[p] || "",
          files[p] || "",
          c.files[p] || "",
          c.msg,
        );
        if (m.conflict)
          return err([
            `CONFLICT (content): Merge conflict in ${p}`,
            "Simulator belum mendukung konflik saat rebase; gunakan git pull (merge) untuk berlatih.",
            "Rebase dibatalkan, tidak ada yang berubah.",
          ]);
        c.files[p] === undefined ? delete next[p] : (next[p] = m.text);
      }
      files = next;
      made.push([c.msg, files]);
    }
    let tip = t;
    for (const [msg, f] of made) tip = addCommit(s, msg, tip, f);
    moveTo(s, tip);
    advance(s, tip);
    return ok([`Successfully rebased and updated refs/heads/${s.head}.`]);
  }

  function cmdPull(s, a) {
    if (s.detached) return err(["You are not currently on a branch."]);
    if (!s.remote.url) return err(["fatal: No remote repository specified."]);
    const fetched = fetchAll(s),
      t = s.remote.tracked[s.head],
      l = headHash(s);
    const r =
      a.includes("--rebase") &&
      t &&
      l &&
      t !== l &&
      !isAncestor(s, t, l) &&
      !isAncestor(s, l, t)
        ? rebaseOnto(s, t)
        : integrate(
            s,
            t,
            `${s.remote.name}/${s.head}`,
            `Merge branch '${s.head}' of ${s.remote.url}`,
          );
    return { ok: r.ok, lines: [...fetched, ...r.lines] };
  }

  function mergeAbort(s) {
    if (!s.pendingMerge)
      return err(["fatal: There is no merge to abort (MERGE_HEAD missing)."]);
    const h = currentFiles(s);
    for (const p of new Set([
      ...Object.keys(s.conflicts),
      ...Object.keys(s.index),
      ...Object.keys(h),
    ]))
      if (s.conflicts[p] || s.index[p] !== h[p])
        h[p] === undefined ? delete s.workdir[p] : (s.workdir[p] = h[p]);
    s.index = { ...h };
    s.conflicts = {};
    s.resolved = {};
    s.pendingMerge = null;
    return ok([]);
  }

  function cmdMerge(s, a) {
    if (a.includes("--abort")) return mergeAbort(s);
    const t = own(s.branches, a[0]) ? s.branches[a[0]] : null;
    if (!t) return err([`merge: ${a[0]} - not something we can merge`]);
    return integrate(s, t, a[0], `Merge branch '${a[0]}'`);
  }

  function cmdDiff(s, a) {
    const staged = a.includes("--staged") || a.includes("--cached");
    const c = changes(s),
      h = currentFiles(s),
      out = [];
    for (const { p } of staged ? c.staged : c.unstaged) {
      const [x, y] = staged ? [h[p], s.index[p]] : [s.index[p], s.workdir[p]];
      out.push(`--- a/${p}`, `+++ b/${p}`);
      for (const [k, t] of diffLines(lines(x), lines(y))) out.push(k + t);
    }
    return ok(out);
  }

  const cmdTouch = (s, a) => {
    if (!a[0]) return err(["touch: missing file operand"]);
    if (s.workdir[a[0]] === undefined) s.workdir[a[0]] = "";
    return ok([]);
  };
  function cmdEcho(s, a) {
    const m = a.join(" ").match(/^(.*?)\s*(>>|>)\s*(\S+)\s*$/);
    if (!m) return ok([unq(a.join(" "))]);
    s.workdir[m[3]] =
      (m[2] === ">>" ? s.workdir[m[3]] || "" : "") + unq(m[1].trim()) + "\n";
    return ok([]);
  }

  const GIT = {
    init: cmdInit,
    fetch: cmdFetch,
    status: cmdStatus,
    add: cmdAdd,
    commit: cmdCommit,
    log: cmdLog,
    branch: cmdBranch,
    switch: cmdSwitch,
    checkout: cmdSwitch,
    stash: cmdStash,
    reset: cmdReset,
    revert: cmdRevert,
    restore: cmdRestore,
    remote: cmdRemote,
    push: cmdPush,
    pull: cmdPull,
    merge: cmdMerge,
    diff: cmdDiff,
  };

  function run(s, raw) {
    const t = (raw || "").trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (!t.length) return ok([]);
    if (t[0] === "touch") return cmdTouch(s, t.slice(1));
    if (t[0] === "echo") return cmdEcho(s, t.slice(1));
    if (t[0] !== "git") return err([`command not found: ${t[0]}`]);
    if (!s.isRepo && t[1] !== "init")
      return err(["fatal: not a git repository. Run 'git init' first."]);
    return GIT[t[1]]
      ? GIT[t[1]](s, t.slice(2))
      : err([`git: '${t[1] || ""}' is not a git command.`]);
  }

  g.GitSim = {
    createState,
    run,
    headHash,
    currentFiles,
    isAncestor,
    addCommit,
    setRemote,
    changes,
    refsAt,
    diffLines,
    lines,
  };
})(typeof window !== "undefined" ? window : globalThis);
