globalThis.window = globalThis;
for (const f of ["git-engine", "scenarios", "brain"]) require("./" + f + ".js");
const R = (s, c) => GitSim.run(s, c);
const out = (r) => r.lines.join("\n");
let fail = 0;
const t = (name, cond, info) => { if (!cond) fail++; console.log((cond ? "✓ " : "✗ ") + name + (cond ? "" : "  -> " + info)); };
const mk = (files, setup) => { const s = GitSim.createState(files, { isRepo: true }); setup && setup(s); return s; };
const cm = (s, msg) => { R(s, "git add ."); return R(s, `git commit -m "${msg}"`); };
// A teammate pushes one commit (not yet fetched), then I commit my own change.
const diverge = (base, theirs, mine) => mk({ f: base }, (s) => {
  cm(s, "a");
  const b = s.branches.main;
  GitSim.setRemote(s, "u", "main", GitSim.addCommit(s, "rekan", b, { f: theirs }), b);
  s.workdir.f = mine; cm(s, "b");
});
const base10 = Array.from({ length: 10 }, (_, i) => "baris" + (i + 1)).join("\n") + "\n";
let s, r;

// 1. pull: a strategy must be chosen when branches diverged (as in Git >= 2.33)
s = diverge(base10, base10.replace("baris5", "REKAN5"), base10.replace("baris1\n", "SAYA1\n").replace("baris10", "SAYA10"));
const before0 = s.branches.main;
r = R(s, "git pull");
t("pull diverged tanpa strategi ditolak", !r.ok && /reconcile divergent/.test(out(r)) && s.branches.main === before0, out(r));
r = R(s, "git pull --ff-only");
t("pull --ff-only diverged ditolak", !r.ok && /Not possible to fast-forward/.test(out(r)), out(r));
R(s, "git config pull.rebase false");
r = R(s, "git pull");
t("config pull.rebase false: pull menggabung hunk terpisah tanpa konflik", r.ok && s.workdir.f === base10.replace("baris1\n", "SAYA1\n").replace("baris5", "REKAN5").replace("baris10", "SAYA10"), out(r));
t("merge otomatis membuat commit 2 parent", s.commits[s.branches.main].parents.length === 2, "");

// 2. conflict: adjacent hunks, status output, add, and commit without -m concluding the merge
s = diverge("a\nb\nc\n", "a\nB\nc\n", "a\nb\nC\n");
r = R(s, "git pull --no-rebase");
t("hunk bersebelahan menjadi konflik", !r.ok && s.conflicts.f && s.pendingMerge, out(r));
t("status menyebut unmerged paths", /Unmerged paths/.test(out(R(s, "git status"))) && /both modified/.test(out(R(s, "git status"))), "");
t("commit saat konflik ditolak", !R(s, 'git commit -m "x"').ok, "");
t("git add pada berkas ber-penanda diterima (seperti Git)", R(s, "git add f").ok && /<<<<<<</.test(s.index.f), "");
t("status: 'still merging' setelah add", /still merging/.test(out(R(s, "git status"))), "");
r = R(s, "git commit");
t("git commit tanpa -m menutup merge dengan pesan bawaan", r.ok && s.commits[s.branches.main].parents.length === 2 && !s.pendingMerge, out(r));

// 3. merge --abort
s = diverge("a\nb\nc\n", "a\nB\nc\n", "a\nB2\nc\n");
const b4 = s.branches.main;
R(s, "git pull --no-rebase");
r = R(s, "git merge --abort");
t("merge --abort mengembalikan keadaan", r.ok && s.workdir.f === "a\nB2\nc\n" && !Object.keys(s.conflicts).length && !s.pendingMerge && s.branches.main === b4, JSON.stringify(s.workdir));
t("merge --abort tanpa merge = error", !R(s, "git merge --abort").ok, "");

// 4. fetch, status, push
s = diverge("x\n", "x\ny\n", "x\nz\n");
t("sebelum fetch: status 'ahead by 1 commit'", /ahead of 'origin\/main' by 1 commit\./.test(out(R(s, "git status"))), "");
t("sebelum fetch: commit rekan tidak tampil di graph", !/rekan/.test(Brain.renderHistory(s)), "");
r = R(s, "git push origin main");
t("push ditolak 'fetch first' walau status 'ahead'", !r.ok && /fetch first/.test(out(r)), out(r));
r = R(s, "git fetch");
t("fetch mencetak From ... main -> origin/main", /origin\/main/.test(out(r)), out(r));
t("setelah fetch: diverged dengan hitungan + graph menampilkan commit rekan", /diverged/.test(out(R(s, "git status"))) && /1 and 1 different commits/.test(out(R(s, "git status"))) && /rekan/.test(Brain.renderHistory(s)), "");
t("fetch kedua tidak mencetak apa pun", R(s, "git fetch").lines.length === 0, "");
r = R(s, "git push origin main");
t("setelah fetch: push ditolak 'non-fast-forward'", !r.ok && /non-fast-forward/.test(out(r)), out(r));
r = R(s, "git push --force origin main");
t("push --force menimpa remote", r.ok && s.remote.refs.main === s.branches.main && /forced update/.test(out(r)), out(r));

// 5. manual merge of origin/main (fetch followed by merge)
s = diverge("a\nb\nc\n", "a\nB\nc\n", "a\nB2\nc\n");
t("merge origin/main sebelum fetch: Already up to date (ref lokal masih posisi lama)", /Already up to date/.test(out(R(s, "git merge origin/main"))), "");
R(s, "git fetch");
r = R(s, "git merge origin/main");
t("merge origin/main konflik, label penanda origin/main", !r.ok && /Merge conflict in f/.test(out(r)) && /^>>>>>>> origin\/main$/m.test(s.workdir.f), out(r) + s.workdir.f);
t("git pull saat merge belum selesai ditolak", !R(s, "git pull").ok, "");

// 6. stash
s = mk({ f: "a\n" }, (s) => { cm(s, "a"); s.workdir.f = "SAYA\n"; });
r = R(s, "git stash");
t("stash menyimpan dengan label WIP on main", r.ok && /WIP on main: \w{7} a/.test(out(r)) && s.workdir.f === "a\n", out(r));
s.workdir.f = "LAIN\n"; cm(s, "b");
r = R(s, "git stash pop");
t("stash pop konflik: error + stash dipertahankan + berkas ber-penanda", !r.ok && s.stash.length === 1 && s.conflicts.f && /<<<<<<</.test(s.workdir.f), out(r));
t("git stash list menampilkan isi", /^stash@\{0\}: WIP on main/.test(out(R(s, "git stash list"))), "");
t("git stash drop menghapus entri", R(s, "git stash drop").ok && !s.stash.length, "");
t("stash tanpa commit awal ditolak", !R(mk({ f: "x\n" }), "git stash").ok, "");

// 7. pull --rebase
s = diverge("a\nb\nc\nd\n", "A\nb\nc\nd\n", "a\nb\nc\nD\n");
const old = s.branches.main; r = R(s, "git pull --rebase");
const c = s.commits[s.branches.main];
t("pull --rebase: riwayat linear, hash baru, isi tergabung", r.ok && c.parents.length === 1 && s.branches.main !== old && c.files.f === "A\nb\nc\nD\n" && s.workdir.f === "A\nb\nc\nD\n", out(r));
t("pull --rebase: commit rekan jadi parent", s.commits[c.parents[0]].msg === "rekan", "");

// 8. reset, revert, restore
s = mk({ f: "1\n" }, (s) => { cm(s, "c1"); s.workdir.f = "2\n"; cm(s, "c2"); s.workdir["baru.txt"] = "u\n"; s.workdir.f = "3\n"; });
R(s, "git reset --hard HEAD~1");
t("reset --hard membuang perubahan tracked tetapi mempertahankan untracked", s.workdir.f === "1\n" && s.workdir["baru.txt"] === "u\n" && s.commits[s.branches.main].msg === "c1", JSON.stringify(s.workdir));
s = mk({ f: "1\n" }, (s) => { cm(s, "c1"); s.workdir.f = "2\n"; R(s, "git add f"); });
r = R(s, "git reset HEAD f");
t("git reset HEAD <berkas> mengeluarkan dari staging", r.ok && s.index.f === "1\n" && s.workdir.f === "2\n", out(r));
s = mk({ f: "1\n" }, (s) => { cm(s, "c1"); s.workdir.f = "2\n"; cm(s, "c2"); });
R(s, "git reset --soft HEAD~1");
t("reset --soft menyimpan perubahan di staging", s.index.f === "2\n" && s.workdir.f === "2\n" && s.commits[s.branches.main].msg === "c1", "");
const L = "satu\ndua\ntiga\nempat\nlima\nenam\ntujuh\ndelapan\n";
s = mk({ f: L }, (s) => { cm(s, "c1"); s.workdir.f = L.replace("satu", "SATU"); cm(s, "c2"); s.workdir.f = L.replace("satu", "SATU").replace("delapan", "DELAPAN"); cm(s, "c3"); });
const c2 = Object.keys(s.commits).find((h) => s.commits[h].msg === "c2");
r = R(s, `git revert --no-edit ${c2}`);
t("revert memakai merge 3 arah: perubahan lain dipertahankan", r.ok && s.workdir.f === L.replace("delapan", "DELAPAN"), out(r) + JSON.stringify(s.workdir.f));
s = mk({ f: "a\n" }, (s) => { cm(s, "c1"); s.workdir.f = "b\n"; R(s, "git add f"); });
t("git restore --staged . dan git restore . bekerja pada semua berkas", R(s, "git restore --staged .").ok && s.index.f === "a\n" && R(s, "git restore .").ok && s.workdir.f === "a\n", "");
t("restore berkas untracked ditolak", !R(mk({ f: "a\n" }), "git restore f").ok, "");

// 9. commit
s = mk({ f: "a\n" }, (s) => cm(s, "c1"));
s.workdir.f = "b\n";
r = R(s, "git commit -m pesan tanpa kutip");
t("commit pesan tanpa kutip ditolak (pathspec)", !r.ok && /pathspec 'tanpa'/.test(out(r)), out(r));
r = R(s, 'git commit -am "ubah f"');
t("commit -am menstage berkas tracked", r.ok && s.commits[s.branches.main].files.f === "b\n", out(r));
const h1 = s.branches.main;
r = R(s, 'git commit --amend -m "ubah f lagi"');
t("commit --amend mengganti commit terakhir (hash baru, parent sama)", r.ok && s.branches.main !== h1 && s.commits[s.branches.main].parents[0] === s.commits[h1].parents[0] && s.commits[s.branches.main].msg === "ubah f lagi", out(r));
t("commit tanpa -m ditolak", !R(s, "git commit").ok, "");

// 10. switch, checkout, branch
s = mk({ f: "a\n" }, (s) => { cm(s, "c1"); s.workdir.f = "b\n"; cm(s, "c2"); });
const first = Object.keys(s.commits).find((h) => s.commits[h].msg === "c1");
t("switch ke hash tanpa --detach ditolak", !R(s, `git switch ${first}`).ok, "");
t("switch --detach hash diterima", R(s, `git switch --detach ${first}`).ok && s.detached === first, "");
R(s, "git switch main");
s.workdir.f = "kotor\n";
t("checkout <berkas> memulihkan berkas", R(s, "git checkout f").ok && s.workdir.f === "b\n", "");
R(s, "git branch fitur");
t("branch -d branch yang sudah merged berhasil", R(s, "git branch -d fitur").ok && !s.branches.fitur, "");
t("branch -d branch aktif ditolak", !R(s, "git branch -d main").ok, "");
R(s, "git switch -c lain"); s.workdir.f = "z\n"; cm(s, "c3"); R(s, "git switch main");
r = R(s, "git branch -d lain");
t("branch -d branch belum merged ditolak, -D berhasil", !r.ok && /not fully merged/.test(out(r)) && R(s, "git branch -D lain").ok, out(r));
t("switch -c dengan titik awal", R(s, `git switch -c dari-awal ${first}`).ok && s.branches["dari-awal"] === first && s.workdir.f === "a\n", "");

// 11. add, ignore rules, rm, status
s = mk({ "node_modules/x.js": "1\n", "debug.log": "l\n", "src/a.js": "a\n", "keep.log": "k\n", ".gitignore": "node_modules/\n*.log\n!keep.log\n" });
const st = out(R(s, "git status"));
t("status: direktori untracked ditulis sebagai dir/, pola glob + negasi .gitignore", /\tsrc\//.test(st) && !/node_modules/.test(st) && !/debug\.log/.test(st) && /keep\.log/.test(st), st);
t("add berkas yang diabaikan ditolak", !R(s, "git add debug.log").ok, "");
R(s, "git add src");
t("add <direktori> menstage isinya", s.index["src/a.js"] === "a\n", "");
cm(s, "awal");
delete s.workdir["src/a.js"];
R(s, "git add .");
t("git add . menstage penghapusan", s.index["src/a.js"] === undefined && /deleted/.test(out(R(s, "git status"))), "");
s = mk({ f: "a\n" }, (s) => cm(s, "c1"));
r = R(s, "git rm f");
t("git rm menghapus dari index dan berkas", r.ok && s.index.f === undefined && s.workdir.f === undefined && /deleted/.test(out(R(s, "git status"))), out(r));
s = mk({ f: "a\n" }, (s) => { cm(s, "c1"); s.workdir.f = "b\n"; });
t("git rm berkas termodifikasi ditolak, --cached diterima", !R(s, "git rm f").ok && R(s, "git rm --cached f").ok && s.workdir.f === "b\n", "");
s = mk({ "a.txt": "x\n", "d/b.txt": "y\n" });
t("shell: cat, ls, rm", out(R(s, "cat a.txt")) === "x" && out(R(s, "ls")) === "a.txt  d" && R(s, "rm a.txt").ok && s.workdir["a.txt"] === undefined && !R(s, "rm d").ok && R(s, "rm -r d").ok, "");

// 12. diff unified
s = mk({ f: base10 }, (s) => cm(s, "a"));
s.workdir.f = base10.replace("baris5", "LIMA");
r = R(s, "git diff");
t("diff unified: header @@ dan 3 baris konteks", out(r).includes("@@ -2,7 +2,7 @@") && out(r).includes("-baris5") && out(r).includes("+LIMA") && !out(r).includes("baris1\n"), out(r));

// 13. remote
s = mk({ f: "a\n" }, (s) => cm(s, "c1"));
R(s, "git remote add origin https://x/y.git");
t("remote -v menampilkan fetch dan push", /fetch/.test(out(R(s, "git remote -v"))) && /push/.test(out(R(s, "git remote -v"))), "");
t("branch -a menampilkan remote setelah push", (R(s, "git push origin main"), /remotes\/origin\/main/.test(out(R(s, "git branch -a")))), "");

// 14. every module completes by following its steps verbatim
const order = SCENARIOS.map((x) => x.num).join(",");
t("nomor modul berurutan 01..09", order === "01,02,03,04,05,06,07,08,09", order);
for (const sc of SCENARIOS) {
  const x = GitSim.createState(sc.files, sc.opts);
  sc.setup && sc.setup(x);
  let bad = null;
  for (const [i, st] of sc.steps.entries()) {
    const cmd = stepCommand(st, x), res = R(x, cmd);
    if (res.ok === !!st.fail) { bad = `langkah ${i}: ${cmd} -> ${out(res)}`; break; }
    for (const p of Object.keys(x.conflicts)) if (!x.resolved[p]) { x.workdir[p] = Brain.sides(x.workdir[p]).both; x.resolved[p] = true; }
  }
  t(`modul ${sc.num} (${sc.title}) selesai sesuai langkah`, !bad && sc.check(x), bad || "check gagal");
}
console.log(fail ? "GAGAL " + fail : "SEMUA LULUS");
process.exit(fail ? 1 : 0);