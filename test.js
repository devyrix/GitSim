globalThis.window = globalThis;
for (const f of ["git-engine", "scenarios", "brain"]) require("./" + f + ".js");
const R = (s, c) => GitSim.run(s, c);
let fail = 0;
const t = (name, cond, info) => {
  if (!cond) fail++;
  console.log((cond ? "✓ " : "✗ ") + name + (cond ? "" : "  -> " + info));
};
const mk = (files, setup) => {
  const s = GitSim.createState(files, { isRepo: true });
  setup && setup(s);
  return s;
};
const base10 =
  Array.from({ length: 10 }, (_, i) => "baris" + (i + 1)).join("\n") + "\n";

// 1. merge per-hunk: saya ubah baris 1 & 10, rekan ubah baris 5 => Git asli TIDAK konflik
let s = mk({ f: base10 }, (s) => {
  R(s, "git add f");
  R(s, "git commit -m a");
  const b = s.branches.main;
  GitSim.setRemote(
    s,
    "u",
    "main",
    GitSim.addCommit(s, "rekan", b, { f: base10.replace("baris5", "REKAN5") }),
    b,
  );
  s.workdir.f = base10
    .replace("baris1\n", "SAYA1\n")
    .replace("baris10", "SAYA10");
  R(s, "git add f");
  R(s, "git commit -m b");
});
let r = R(s, "git pull");
t(
  "hunk terpisah di berkas yang sama digabung tanpa konflik",
  r.ok &&
    s.workdir.f ===
      base10
        .replace("baris1\n", "SAYA1\n")
        .replace("baris5", "REKAN5")
        .replace("baris10", "SAYA10"),
  r.lines.join("|") + JSON.stringify(s.workdir.f),
);
t(
  "merge otomatis membuat commit 2 parent",
  s.commits[s.branches.main].parents.length === 2,
  "",
);
// hunk bersebelahan = konflik (seperti Git)
s = mk({ f: "a\nb\nc\n" }, (s) => {
  R(s, "git add f");
  R(s, "git commit -m a");
  const b = s.branches.main;
  GitSim.setRemote(
    s,
    "u",
    "main",
    GitSim.addCommit(s, "rekan", b, { f: "a\nB\nc\n" }),
    b,
  );
  s.workdir.f = "a\nb\nC\n";
  R(s, "git add f");
  R(s, "git commit -m b");
});
r = R(s, "git pull");
t(
  "hunk bersebelahan menjadi konflik",
  !r.ok && s.conflicts.f,
  r.lines.join("|"),
);
// status saat merge
t(
  "status menyebut unmerged paths",
  /unmerged paths/.test(R(s, "git status").lines.join("\n")),
  "",
);
// add/commit ditolak selama berkas masih berisi penanda (Git asli menolak)
t(
  "git add pada berkas ber-penanda ditolak",
  !R(s, "git add f").ok && /penanda konflik/.test(R(s, "git add f").lines[0]),
  "",
);
t(
  "commit -am tidak melewati konflik",
  !R(s, "git commit -am x").ok,
  "",
);
// status saat merge
t(
  "status menyebut unmerged paths setelah add ditolak",
  /unmerged paths/.test(R(s, "git status").lines.join("\n")),
  "",
);
s.workdir.f = "a\nB\nc\n";
R(s, "git add f");
t(
  "status: 'still merging' setelah penanda dihapus dan add",
  /still merging/.test(R(s, "git status").lines.join("\n")),
  "",
);
// add . tetap stage berkas bersih walau berkas lain masih berpenanda
{
  const m = mk({ a: "1\n", b: "1\n" }, (x) => {
    R(x, "git add .");
    R(x, "git commit -m i");
  });
  m.conflicts.a = true;
  m.conflicts.b = true;
  m.workdir.a = "2\n";
  m.workdir.b = "<<<<<<< HEAD\n1\n=======\n3\n>>>>>>> o/main\n";
  t(
    "add . stage berkas bersih, tolak yang berpenanda",
    !R(m, "git add .").ok && m.index.a === "2\n" && m.conflicts.a === undefined && m.conflicts.b && m.index.b === "1\n",
    JSON.stringify(m.index),
  );
}
// merge --abort
s = mk({ f: "a\nb\nc\n" }, (s) => {
  R(s, "git add f");
  R(s, "git commit -m a");
  const b = s.branches.main;
  GitSim.setRemote(
    s,
    "u",
    "main",
    GitSim.addCommit(s, "rekan", b, { f: "a\nB\nc\n" }),
    b,
  );
  s.workdir.f = "a\nB2\nc\n";
  R(s, "git add f");
  R(s, "git commit -m b");
});
const before = s.branches.main;
R(s, "git pull");
r = R(s, "git merge --abort");
t(
  "merge --abort mengembalikan keadaan",
  r.ok &&
    s.workdir.f === "a\nB2\nc\n" &&
    !Object.keys(s.conflicts).length &&
    !s.pendingMerge &&
    s.branches.main === before,
  JSON.stringify(s.workdir),
);
t("merge --abort tanpa merge = error", !R(s, "git merge --abort").ok, "");

// 2. fetch: status ahead sebelum fetch, diverged sesudahnya; push ditolak sebelum fetch
s = mk({ f: "x\n" }, (s) => {
  R(s, "git add f");
  R(s, "git commit -m a");
  const b = s.branches.main;
  GitSim.setRemote(
    s,
    "u",
    "main",
    GitSim.addCommit(s, "rekan", b, { f: "x\ny\n" }),
    b,
  );
  s.workdir.f = "x\nz\n";
  R(s, "git add f");
  R(s, "git commit -m b");
});
t(
  "sebelum fetch: status 'ahead'",
  /ahead of/.test(R(s, "git status").lines.join("\n")),
  "",
);
t(
  "sebelum fetch: commit rekan tidak tampil di graph",
  !/rekan/.test(Brain.renderHistory(s)),
  "",
);
t("push ditolak walau status 'ahead'", !R(s, "git push origin main").ok, "");
r = R(s, "git fetch");
t(
  "fetch mencetak From ... main -> origin/main",
  /origin\/main/.test(r.lines.join("\n")),
  r.lines.join("|"),
);
t(
  "setelah fetch: diverged + graph menampilkan commit rekan",
  /diverged/.test(R(s, "git status").lines.join("\n")) &&
    /rekan/.test(Brain.renderHistory(s)),
  "",
);
t(
  "fetch kedua tidak mencetak apa pun",
  R(s, "git fetch").lines.length === 0,
  "",
);

// 3. stash pop konflik: stash dipertahankan
s = mk({ f: "a\n" }, (s) => {
  R(s, "git add f");
  R(s, "git commit -m a");
  s.workdir.f = "SAYA\n";
});
R(s, "git stash");
s.workdir.f = "LAIN\n";
R(s, "git add f");
R(s, "git commit -m b");
r = R(s, "git stash pop");
t(
  "stash pop konflik: error + stash dipertahankan + berkas ber-penanda",
  !r.ok && s.stash.length === 1 && s.conflicts.f && /<<<<<<</.test(s.workdir.f),
  r.lines.join("|"),
);
t(
  "git stash list menampilkan isi",
  R(s, "git stash list").lines.length === 1,
  "",
);

// 4. pull --rebase
s = mk({ f: "a\nb\nc\nd\n" }, (s) => {
  R(s, "git add f");
  R(s, "git commit -m a");
  const b = s.branches.main;
  GitSim.setRemote(
    s,
    "u",
    "main",
    GitSim.addCommit(s, "rekan", b, { f: "A\nb\nc\nd\n" }),
    b,
  );
  s.workdir.f = "a\nb\nc\nD\n";
  R(s, "git add f");
  R(s, "git commit -m saya");
});
const old = s.branches.main;
r = R(s, "git pull --rebase");
const c = s.commits[s.branches.main];
t(
  "pull --rebase: riwayat linear, hash baru, isi tergabung",
  r.ok &&
    c.parents.length === 1 &&
    s.branches.main !== old &&
    c.files.f === "A\nb\nc\nD\n" &&
    s.workdir.f === "A\nb\nc\nD\n",
  r.lines.join("|"),
);
t(
  "pull --rebase: commit rekan jadi parent",
  s.commits[c.parents[0]].msg === "rekan",
  "",
);

// 5. Setiap modul dapat diselesaikan persis mengikuti langkahnya (perintah, hasil ok/gagal, check akhir)
for (const sc of SCENARIOS) {
  const st = GitSim.createState(sc.files, sc.opts);
  sc.setup && sc.setup(st);
  let bad = null;
  sc.steps.forEach((step, i) => {
    if (bad) return;
    for (const p in st.conflicts)
      if (!st.resolved[p]) {
        st.workdir[p] = Brain.sides(st.workdir[p]).both;
        st.resolved[p] = true;
      } // seperti klik "Pakai keduanya"
    const cmd = window.stepCommand(step, st),
      res = GitSim.run(st, cmd);
    if (res.ok === !!step.fail)
      bad = `langkah ${i + 1} "${cmd}": ${res.lines.join("|")}`;
  });
  t(
    `modul ${sc.num} ${sc.id} selesai`,
    !bad && sc.check(st),
    bad || "check() gagal",
  );
}
// 6. Fidelitas add/restore/commit -a/branch -d
s = mk({ a: "1\n", d: "x\n", "n/m.js": "m\n" }, (s) => {
  R(s, "git add .");
  R(s, "git commit -m i");
});
delete s.workdir.d;
s.workdir.a = "2\n";
s.workdir["n/z.js"] = "z\n";
R(s, "git add n");
t(
  "git add <folder> hanya men-stage isi folder itu",
  s.index["n/z.js"] && s.index.a === "1\n",
  "",
);
R(s, "git add .");
t(
  "git add . men-stage penghapusan",
  s.index.d === undefined && s.index.a === "2\n",
  "",
);
R(s, "git restore --staged .");
R(s, "git restore a d");
t("restore banyak berkas", s.workdir.a === "1\n" && s.workdir.d === "x\n", "");
s.workdir.a = "3\n";
R(s, 'git commit -am "semua"');
t(
  "commit -am men-stage berkas terlacak",
  s.commits[s.branches.main].files.a === "3\n",
  "",
);
R(s, "git branch f");
s.workdir.a = "4\n";
R(s, 'git commit -am "x"');
R(s, "git switch f");
t(
  "branch -d menolak yang belum digabung",
  !R(s, "git branch -d main").ok && R(s, "git branch -D main").ok,
  "",
);
console.log(fail ? "GAGAL " + fail : "SEMUA LULUS");
