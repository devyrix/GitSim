(function () {
  const G = () => window.GitSim;
  const commit = (s, f, msg) => {
    G().run(s, `git add ${f}`);
    G().run(s, `git commit -m "${msg}"`);
  };
  const origin = (s, name) => G().setRemote(s, `https://github.com/kamu/${name}.git`, "main", s.branches.main);
  // A teammate pushed one commit to GitHub. The local origin/main lags behind until fetched.
  const teammate = (s, name, msg, files) => {
    const h = G().addCommit(s, msg, s.branches.main, files);
    G().setRemote(s, `https://github.com/kamu/${name}.git`, "main", h, s.branches.main); // lokal belum tahu: belum fetch
  };
  const S = [];

  // ---------- Fundamentals ----------
  S.push({
    id: "dari-nol", num: "01", group: "Dasar", title: "From Zero",
    subtitle: "Folder ini belum dilacak oleh Git. Inisialisasi repositori, buat berkas, simpan commit, lalu kirim ke GitHub.",
    files: {}, opts: { isRepo: false },
    steps: [
      { cmd: "git status", hint: "Periksa kondisi folder", fail: true },
      { cmd: "git init", hint: "Inisialisasi repositori Git" },
      { cmd: "touch catatan.md", hint: "Buat berkas kosong" },
      { cmd: 'echo "# Catatan" > catatan.md', hint: "Isi berkas" },
      { cmd: "git status", hint: "Berkas belum dilacak" },
      { cmd: "git add catatan.md", hint: "Tambahkan ke staging" },
      { cmd: 'git commit -m "catatan pertama"', hint: "Simpan commit pertama" },
      { cmd: "git remote add origin https://github.com/kamu/proyek.git", hint: "Hubungkan dengan GitHub" },
      { cmd: "git push origin main", hint: "Kirim ke GitHub" },
      { cmd: "git log --oneline", hint: "Periksa riwayat commit" },
    ],
    stepNotes: {
      0: "'not a git repository' menandakan folder ini belum memiliki repositori Git. Ini kondisi normal untuk folder baru. Lanjutkan dengan `git init`.",
      1: "`git init` hanya membuat folder `.git`. Berkas yang sudah ada tidak otomatis masuk repositori. Lanjutkan membuat berkas.",
      2: "`touch` membuat berkas kosong. Perintah ini milik sistem operasi, bukan Git.",
      4: "`Untracked files` menandakan berkas ada di folder, tetapi belum pernah didaftarkan ke Git.",
      8: "`[new branch]` menandakan branch ini baru pertama kali muncul di remote. Ini bukan peringatan.",
    },
    check: (s) => s.remote.refs.main === s.branches.main && !!s.branches.main && Object.keys(s.commits).length === 1,
    why: { title: "Mengapa Git memerlukan repositori", blocks: [
      { h: "Kesalahpahaman umum", p: "Banyak orang menganggap Git sebagai tempat menyimpan berkas. Sebenarnya Git adalah **pencatat riwayat** untuk folder yang telah Anda tentukan." },
      { h: "Urutan yang benar", p: "1. Folder tersedia. 2. `git init` membuat `.git`. 3. Anda membuat berkas. 4. `git add` memilih berkas. 5. `git commit` menyimpan. 6. `git remote add` menunjuk GitHub. 7. `git push` mengirim." },
    ] },
  });

  S.push({
    id: "staging", num: "02", group: "Dasar", title: "Staging",
    subtitle: "Dua berkas berubah, tetapi hanya satu yang layak di-commit. Pelajari cara memilih perubahan, melihat selisihnya, membatalkan pilihan, dan membuang perubahan.",
    files: { "a.txt": "satu\ndua\n", "b.txt": "x\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, ".", "awal");
      s.workdir["a.txt"] = "satu\nDUA\ntiga\n";
      s.workdir["b.txt"] = "x\ny\n";
    },
    steps: [
      { cmd: "git status", hint: "Periksa kondisi awal" },
      { cmd: "git diff", hint: "Lihat isi perubahan" },
      { cmd: "git add a.txt", hint: "Pilih a.txt untuk commit" },
      { cmd: "git add b.txt", hint: "Anggap b.txt tidak sengaja ikut dipilih" },
      { cmd: "git diff --staged", hint: "Lihat apa yang akan di-commit" },
      { cmd: "git restore --staged b.txt", hint: "Keluarkan b.txt dari staging" },
      { cmd: "git status", hint: "a.txt di staging, b.txt tidak" },
      { cmd: 'git commit -m "ubah a.txt"', hint: "Commit hanya yang di staging" },
      { cmd: "git restore b.txt", hint: "Buang perubahan b.txt" },
      { cmd: "git status", hint: "Periksa hasil akhir" },
    ],
    stepNotes: {
      0: "`Changes not staged` berarti berkas berubah di Direktori Kerja tetapi belum dipilih untuk commit. Klik berkas di panel Berkas untuk melihat selisihnya.",
      1: "Baris `-` dihapus, baris `+` ditambah. `git diff` tanpa opsi hanya membandingkan Direktori Kerja dengan staging.",
      4: "Tanpa `--staged`, `git diff` tidak menampilkan perubahan yang sudah di-stage. Dengan opsi ini Anda melihat persis isi commit berikutnya.",
      5: "`restore --staged` hanya memindahkan berkas keluar dari staging. Isi berkas tidak berubah.",
      7: "Hanya `a.txt` yang masuk commit. `b.txt` tetap berubah di Direktori Kerja.",
      8: "Hati-hati: `restore` tanpa `--staged` membuang perubahan permanen. Git tidak menyimpannya di mana pun.",
    },
    check: (s) => {
      const h = s.commits[s.branches.main];
      return Object.keys(s.commits).length === 2 && h.files["a.txt"] === "satu\nDUA\ntiga\n" && h.files["b.txt"] === "x\n" && s.workdir["b.txt"] === "x\n";
    },
    why: { title: "Mengapa add dan commit dipisahkan", blocks: [
      { h: "Tiga zona", p: "Direktori Kerja → staging → riwayat. `git add` memindahkan perubahan ke zona kedua. `git commit` memindahkannya ke zona ketiga secara permanen." },
      { h: "Mengapa ada zona tengah", p: "Staging memungkinkan satu commit berisi satu maksud saja, walaupun Anda mengubah banyak berkas sekaligus." },
      { h: "Dua cara membatalkan", p: "`git restore --staged <berkas>` membatalkan **pilihan**. `git restore <berkas>` membuang **isi** perubahan." },
    ] },
  });

  S.push({
    id: "gitignore", num: "03", group: "Dasar", title: "Ignore Files",
    subtitle: "Lupa `add`, folder `node_modules` dan berkas log yang tidak boleh ikut commit, serta cara memakai `.gitignore`.",
    files: { "server.js": "const port = 3000;\n", "node_modules/lib.js": "module.exports = {};\n", "debug.log": "start\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, "server.js", "awal");
      s.workdir["server.js"] = "const port = 4000;\n";
    },
    steps: [
      { cmd: 'git commit -m "ubah port"', hint: "Coba langsung commit (akan gagal)", fail: true },
      { cmd: "git status", hint: "Perhatikan perubahan dan berkas untracked" },
      { cmd: "git add server.js", hint: "Stage terlebih dahulu" },
      { cmd: 'echo "node_modules/" > .gitignore', hint: "Abaikan folder node_modules" },
      { cmd: 'echo "*.log" >> .gitignore', hint: "Abaikan semua berkas .log" },
      { cmd: "git status", hint: "Hanya .gitignore yang tersisa" },
      { cmd: "git add .", hint: "Stage sisanya" },
      { cmd: 'git commit -m "ubah port dan abaikan berkas sampah"', hint: "Commit seluruh perubahan" },
      { cmd: "git log --oneline", hint: "Periksa riwayat" },
    ],
    stepNotes: {
      0: "'no changes added to commit' berarti perubahan belum di-add, bukan berarti tidak ada perubahan. Lanjutkan dengan memeriksa status.",
      3: "`.gitignore` hanya memengaruhi berkas yang belum dilacak. Berkas yang sudah pernah di-commit tetap dilacak.",
      5: "`node_modules/` dan `debug.log` tidak lagi muncul. Git menganggap keduanya tidak ada. `.gitignore` sendiri harus di-commit agar rekan tim ikut mengabaikan.",
      7: "Jika lupa `-m`, Git membuka editor teks. Di Vim: `Esc`, `:wq`, Enter. Pesan dengan spasi wajib diapit tanda kutip.",
    },
    check: (s) => {
      const c = s.commits[s.branches.main];
      const f = (c || {}).files || {};
      return Object.keys(s.commits).length === 2 && f["server.js"] === "const port = 4000;\n" && f[".gitignore"] !== undefined
        && f["node_modules/lib.js"] === undefined && f["debug.log"] === undefined;
    },
    why: { title: "Kesalahan yang paling umum", blocks: [
      { h: "1. Berkas berubah, tetapi Git menyatakan bersih", p: "Tiga kemungkinan: belum di-add, berkas untracked, atau namanya cocok dengan pola di `.gitignore`." },
      { h: "2. Lupa `-m` saat commit", p: "Tanpa `-m`, Git membuka editor. Jika Vim terbuka: `Esc`, `:wq`, Enter." },
      { h: "3. Pola `.gitignore`", p: "`node_modules/` mengabaikan folder. `*.log` mengabaikan semua berkas berakhiran `.log`. `!penting.log` mengecualikan satu berkas." },
    ] },
  });

  // ---------- History ----------
  S.push({
    id: "branch-pr", num: "04", group: "Riwayat", title: "Feature Branch",
    subtitle: "Alur yang digunakan hampir semua tim: buat branch, commit di sana, push, lalu merge.",
    files: { "app.js": "function utama() {}\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, "app.js", "awal proyek");
      origin(s, "proyek");
      s.workdir["app.js"] = "function utama() {}\nfunction login() {}\n";
    },
    steps: [
      { cmd: "git switch -c fitur-login", hint: "Buat branch baru" },
      { cmd: "git status", hint: "Perubahan Anda ikut pindah ke branch baru" },
      { cmd: "git add app.js", hint: "Stage perubahan" },
      { cmd: 'git commit -m "tambah fungsi login"', hint: "Commit di branch fitur" },
      { cmd: "git push origin fitur-login", hint: "Push branch terpisah" },
      { cmd: "git switch main", hint: "Kembali ke main" },
      { cmd: "git merge fitur-login", hint: "Gabungkan branch fitur" },
      { cmd: "git push origin main", hint: "Push hasil merge" },
    ],
    stepNotes: {
      0: "`git switch -c` membuat branch baru dan langsung berpindah. Titik awalnya sama dengan `main`.",
      4: "Push branch terpisah tidak menyentuh `main`. Itu inti alasan alur ini aman.",
      6: "Merge fast-forward: `main` hanya bergeser maju, tanpa commit merge baru.",
    },
    check: (s) => {
      const m = s.branches.main, f = s.branches["fitur-login"];
      return !!m && !!f && m === f && s.head === "main" && s.remote.refs.main === m;
    },
    why: { title: "Mengapa tim menggunakan branch dan PR", blocks: [
      { h: "Alurnya", pre: "git switch -c fitur   <- ruang aman\ngit commit ...\ngit push origin fitur\ngit switch main\ngit merge fitur" },
    ] },
  });

  S.push({
    id: "undo", num: "05", group: "Riwayat", title: "Undo Commit",
    subtitle: "Sebuah commit yang sudah di-push ternyata salah. `reset` dan `revert` sama-sama terlihat 'membatalkan', tetapi hanya satu yang aman untuk riwayat bersama.",
    files: { "server.js": "const port = 3000;\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, "server.js", "awal");
      s.workdir["server.js"] = "const port = 9999;\n";
      commit(s, "server.js", "ubah port");
      origin(s, "server");
    },
    steps: [
      { cmd: "git log --oneline", hint: "Periksa riwayat" },
      { cmdAt: (s) => "git revert --no-edit " + s.branches.main, hint: "Buat commit pembatalan" },
      { cmd: "git log --oneline", hint: "Commit lama tetap ada, ditambah commit Revert" },
      { cmd: "git status", hint: "Satu commit lebih maju dari GitHub" },
      { cmd: "git push origin main", hint: "Push hasil revert" },
    ],
    stepNotes: {
      1: "`revert` aman untuk riwayat bersama. Perintah ini menambah commit, tidak menghapus apa pun. `--no-edit` memakai pesan bawaan tanpa membuka editor.",
      2: "Isi `server.js` kembali ke 3000, tetapi riwayatnya jujur: ada commit salah, lalu commit yang membatalkannya.",
      4: "Mengapa bukan `reset`? `reset` menghapus commit. Jika sudah di-push, riwayat Anda dan rekan menjadi berbeda.",
    },
    check: (s) => {
      const c = s.commits[s.branches.main];
      return !!c && /^Revert/.test(c.msg) && s.remote.refs.main === c.hash && s.workdir["server.js"] === "const port = 3000;\n";
    },
    why: { title: "Kapan menggunakan reset atau revert", blocks: [
      { h: "Ringkasan", p: "`restore` untuk berkas yang belum di-commit. `reset` untuk commit yang belum dibagikan. `revert` untuk commit yang sudah di-push." },
    ] },
  });

  S.push({
    id: "detached", num: "06", group: "Riwayat", title: "Old Commit",
    subtitle: "Anda kembali ke commit lama untuk memeriksa isinya. Di sana, kepala riwayat tidak lagi mengikuti branch mana pun.",
    files: { "a.txt": "versi 1\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, "a.txt", "versi 1");
      for (const n of [2, 3]) {
        s.workdir["a.txt"] = `versi ${n}\n`;
        commit(s, "a.txt", `versi ${n}`);
      }
      origin(s, "a");
    },
    steps: [
      { cmd: "git log --oneline", hint: "Periksa riwayat" },
      {
        cmdAt: (s) => {
          let h = s.branches.main;
          while (s.commits[h].parents[0]) h = s.commits[h].parents[0];
          return "git checkout " + h;
        },
        hint: "Checkout ke versi 1",
      },
      { cmd: 'echo "catatan eksperimen" >> a.txt', hint: "Ubah berkas di detached HEAD" },
      { cmd: "git add a.txt", hint: "Stage perubahan" },
      { cmd: 'git commit -m "eksperimen di detached HEAD"', hint: "Commit tanpa branch yang menunjuk" },
      { cmd: "git log --oneline", hint: "Perhatikan panel Riwayat: main tidak bergerak" },
      { cmdAt: (s) => "git branch eksperimen " + s.detached, hint: "Selamatkan dengan branch baru" },
      { cmd: "git branch", hint: "Periksa branch" },
      { cmd: "git switch eksperimen", hint: "Pindah ke branch penyelamat" },
    ],
    stepNotes: {
      1: "'detached HEAD' adalah peringatan, bukan error. Anda sedang di luar branch mana pun. Lanjutkan eksperimen.",
      5: "Commit baru di detached HEAD tidak masuk riwayat branch mana pun. Jika berpindah branch, commit tersebut hilang.",
      6: "`git branch <nama> <hash>` memberikan nama pada commit yang menggantung, sehingga menjadi permanen.",
    },
    check: (s) => !!s.branches.eksperimen && !s.detached && s.head === "eksperimen",
    why: { title: "Mengapa detached HEAD berbahaya", blocks: [
      { h: "Analogi", p: "Branch ibarat penunjuk jalan yang memiliki nama. Detached HEAD berarti Anda berada di tengah jalan tanpa nama tersebut." },
    ] },
  });

  // ---------- Teamwork ----------
  S.push({
    id: "pull-bentrok", num: "07", group: "Kerja Tim", title: "Pull Blocked",
    subtitle: "Terdapat berkas yang telah Anda ubah tetapi belum di-commit. Git menolak pull karena versi baru akan menimpa perubahan tersebut.",
    files: { "app.js": "function utama() {\n}\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, "app.js", "awal");
      teammate(s, "app", "rekan: tambah fungsi", { "app.js": "function utama() {\n  console.log('halo');\n}\n" });
      s.workdir["app.js"] = "// editan saya\nfunction utama() {\n}\n";
    },
    steps: [
      { cmd: "git status", hint: "Periksa kondisi awal" },
      { cmd: "git pull", hint: "Coba pull — akan ditolak", fail: true },
      { cmd: "git stash", hint: "Simpan perubahan sementara" },
      { cmd: "git pull", hint: "Pull kini berhasil" },
      { cmd: "git stash pop", hint: "Ambil kembali perubahan Anda" },
      { cmd: "git status", hint: "Periksa hasil" },
    ],
    stepNotes: {
      0: "Status menyatakan 'up to date' karena Git belum fetch, jadi belum tahu rekan Anda sudah push.",
      1: "`pull` melakukan fetch lebih dulu (lihat baris `From ...`), baru mencoba merge. Perubahan yang belum di-commit tidak memiliki cadangan. Jika ditimpa, isinya hilang permanen. Lanjutkan dengan `stash`.",
      4: "Perubahan Anda digabung dengan versi baru dari rekan, karena keduanya mengubah bagian berbeda.",
      5: 'Alternatif tanpa stash: `git commit -m "wip"` lalu `git pull`.',
    },
    check: (s) =>
      s.branches.main === s.remote.refs.main && s.stash.length === 0 &&
      /editan saya/.test(s.workdir["app.js"] || "") && /halo/.test(s.workdir["app.js"] || ""),
    why: { title: "Mengapa pull ditolak: `local changes`", blocks: [
      { h: "Terjemahan", p: "Git berhenti sebelum proses dimulai. `Aborting` berarti tidak ada satu byte pun yang berubah." },
    ] },
  });

  S.push({
    id: "push-ditolak", num: "08", group: "Kerja Tim", title: "Push Rejected",
    subtitle: "Anda dan rekan kerja menggunakan repositori GitHub yang sama. Rekan Anda push lebih dulu, sehingga riwayat Anda tertinggal satu langkah.",
    files: { "index.html": "<h1>Toko</h1>\n<p>Menu</p>\n<p>Kontak</p>\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, "index.html", "awal");
      teammate(s, "toko", "rekan: ubah judul", { "index.html": "<h1>Toko Kami</h1>\n<p>Menu</p>\n<p>Kontak</p>\n" });
      s.workdir["index.html"] = "<h1>Toko</h1>\n<p>Menu</p>\n<footer>hak cipta</footer>\n";
    },
    steps: [
      { cmd: "git diff", hint: "Periksa perubahan" },
      { cmd: "git add index.html", hint: "Stage perubahan" },
      { cmd: 'git commit -m "tambah footer"', hint: "Simpan commit" },
      { cmd: "git status", hint: "Perhatikan status ahead" },
      { cmd: "git push origin main", hint: "Push — akan ditolak", fail: true },
      { cmd: "git fetch", hint: "Ambil kabar terbaru dari GitHub" },
      { cmd: "git status", hint: "Kini terlihat diverged" },
      { cmd: "git pull", hint: "Pull — Git minta strategi", fail: true },
      { cmd: "git pull --no-rebase", hint: "Gabungkan dengan merge" },
      { cmd: "git log --oneline", hint: "Periksa riwayat gabungan" },
      { cmd: "git push origin main", hint: "Push ulang" },
    ],
    stepNotes: {
      3: "'ahead by 1' hanya mencerminkan apa yang Git lokal ketahui. Git belum tahu rekan Anda sudah push, karena belum ada `fetch`.",
      4: "Ini bukan masalah akses. Git menolak menimpa pekerjaan orang lain. Lanjutkan dengan `fetch` untuk melihat apa yang berubah.",
      5: "`fetch` hanya memperbarui `origin/main` di komputer Anda, tidak menyentuh berkas. Lihat panel Riwayat: kini terlihat percabangan.",
      6: "'diverged' berarti Anda dan GitHub masing-masing punya commit yang tidak dimiliki pihak lain.",
      7: "Git modern menolak menebak. Anda harus memilih: merge (`--no-rebase`), rebase (`--rebase`), atau hanya fast-forward (`--ff-only`). Pilih merge dulu.",
      8: "Kedua pihak mengubah baris berbeda, jadi Git menggabungkan otomatis dan membuat commit merge. Git asli membuka editor untuk pesan commit; simulator memakai pesan bawaan.",
      10: "Alternatif: `git pull --rebase` memutar ulang commit Anda di atas commit rekan tanpa merge commit. Kedua pendekatan sah digunakan.",
    },
    check: (s) => !!s.branches.main && s.remote.refs.main === s.branches.main && Object.keys(s.commits).length >= 4,
    why: { title: "Mengapa push ditolak: `fetch first`", blocks: [
      { h: "Terjemahan", p: "`fetch first` berarti 'ambil terlebih dahulu pekerjaan pihak lain'. Git menolak karena menerima push akan menghilangkan commit rekan dari riwayat." },
      { h: "Setelah fetch", p: "Jika Anda mencoba push lagi tanpa menggabungkan, pesannya berubah menjadi `non-fast-forward`: Git sudah tahu commit rekan, tetapi riwayat Anda belum memuatnya." },
    ] },
  });

  S.push({
    id: "konflik", num: "09", group: "Kerja Tim", title: "Merge Conflict",
    subtitle: "Anda dan rekan kerja mengubah baris yang sama dengan cara berbeda. Git tidak dapat memilih, sehingga keputusan diserahkan kepada Anda.",
    files: { "harga.js": "const harga = 10000;\n" }, opts: { isRepo: true },
    setup(s) {
      commit(s, "harga.js", "awal");
      teammate(s, "harga", "rekan: naikkan harga", { "harga.js": "const harga = 12000;\n" });
      s.workdir["harga.js"] = "const harga = 10000;\n// TODO: harga belum dinaikkan\n";
    },
    steps: [
      { cmd: "git diff", hint: "Periksa perubahan" },
      { cmd: "git add harga.js", hint: "Stage perubahan" },
      { cmd: 'git commit -m "tambah catatan harga"', hint: "Simpan commit" },
      { cmd: "git fetch", hint: "Ambil kabar terbaru dari GitHub" },
      { cmd: "git merge origin/main", hint: "Gabungkan sendiri — akan konflik", fail: true },
      { cmd: "git status", hint: "Periksa status konflik" },
      { cmd: "git add harga.js", hint: "Pilih versi di panel Berkas dulu" },
      { cmd: 'git commit -m "selesaikan konflik harga"', hint: "Commit hasil penyelesaian" },
      { cmd: "git push origin main", hint: "Push ke remote" },
    ],
    stepNotes: {
      3: "`git pull` sebenarnya adalah `git fetch` ditambah `git merge origin/main`. Di sini Anda menjalankan keduanya terpisah.",
      4: "`CONFLICT (content)` bukan crash. Git menyerahkan keputusan yang tidak dapat diambilnya. Pilih versi di panel Berkas, lalu jalankan `add`. Ingin batal? `git merge --abort`.",
      6: "Mengapa `add` lagi? Itu cara memberi tahu Git bahwa konflik telah diselesaikan.",
    },
    check: (s) =>
      !!s.branches.main && Object.keys(s.conflicts).length === 0 && s.remote.refs.main === s.branches.main &&
      !/^(<{7}|={7}|>{7})/m.test(s.workdir["harga.js"] || ""),
    why: { title: "Apa yang terjadi saat konflik: `<<<<<<<`", blocks: [
      { h: "Terjemahan", p: "`HEAD` menunjuk commit terakhir Anda. `origin/main` menunjuk posisi remote. Ketiga penanda tersebut menandai batas, bukan error." },
    ] },
  });

  window.SCENARIOS = S;
  window.stepCommand = (step, s) => (step.cmdAt ? step.cmdAt(s) : step.cmd);
})();