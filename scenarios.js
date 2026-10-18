(function () {
  const G = () => window.GitSim;
  const commit = (s, f, msg) => {
    G().run(s, `git add ${f}`);
    G().run(s, `git commit -m "${msg}"`);
  };
  const origin = (s, name) =>
    G().setRemote(
      s,
      `https://github.com/kamu/${name}.git`,
      "main",
      s.branches.main,
    );
  // Rekan sudah push satu commit di GitHub, tetapi origin/main di lokal masih tertinggal sampai fetch.
  const teammate = (s, name, msg, files) => {
    const h = G().addCommit(s, msg, s.branches.main, files);
    G().setRemote(
      s,
      `https://github.com/kamu/${name}.git`,
      "main",
      h,
      s.branches.main,
    ); // lokal belum tahu: belum fetch
  };
  const S = [];

  S.push({
    id: "dari-nol",
    num: "01",
    title: "From Zero",
    subtitle:
      "Folder ini belum dilacak oleh Git. Inisialisasi repositori, buat berkas, simpan commit, lalu kirim ke GitHub.",
    files: {},
    opts: { isRepo: false },
    steps: [
      { cmd: "git status", hint: "Periksa kondisi folder", fail: true },
      { cmd: "git init", hint: "Inisialisasi repositori Git" },
      { cmd: "touch catatan.md", hint: "Buat berkas kosong" },
      { cmd: 'echo "# Catatan" > catatan.md', hint: "Isi berkas" },
      { cmd: "git status", hint: "Berkas belum dilacak" },
      { cmd: "git add catatan.md", hint: "Tambahkan ke staging" },
      { cmd: 'git commit -m "catatan pertama"', hint: "Simpan commit pertama" },
      {
        cmd: "git remote add origin https://github.com/kamu/proyek.git",
        hint: "Hubungkan dengan GitHub",
      },
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
    check: (s) =>
      s.remote.refs.main === s.branches.main &&
      !!s.branches.main &&
      Object.keys(s.commits).length === 1,
    why: {
      title: "Mengapa Git memerlukan repositori",
      blocks: [
        {
          h: "Kesalahpahaman umum",
          p: "Banyak orang menganggap Git sebagai tempat menyimpan berkas. Sebenarnya Git adalah **pencatat riwayat** untuk folder yang telah Anda tentukan.",
        },
        {
          h: "Urutan yang benar",
          p: "1. Folder tersedia. 2. `git init` membuat `.git`. 3. Anda membuat berkas. 4. `git add` memilih berkas. 5. `git commit` menyimpan. 6. `git remote add` menunjuk GitHub. 7. `git push` mengirim.",
        },
      ],
    },
  });

  S.push({
    id: "lupa-add",
    num: "02",
    title: "Common Traps",
    subtitle:
      "Lupa `add`, berkas yang harus diabaikan lewat `.gitignore`, dan jebakan pemula lainnya.",
    files: {
      "server.js": "const port = 3000;\n",
      "node_modules/lib.js": "module.exports = {};\n",
    },
    opts: { isRepo: true },
    setup(s) {
      commit(s, "server.js", "awal");
      s.workdir["server.js"] = "const port = 4000;\n";
    },
    steps: [
      {
        cmd: 'git commit -m "ubah port"',
        hint: "Coba langsung commit (akan gagal)",
        fail: true,
      },
      {
        cmd: "git status",
        hint: "Perhatikan changes not staged dan node_modules",
      },
      { cmd: "git add server.js", hint: "Stage terlebih dahulu" },
      { cmd: 'echo "node_modules/" > .gitignore', hint: "Buat .gitignore" },
      { cmd: "git add .", hint: "Stage sisanya — node_modules dilewati" },
      {
        cmd: 'git commit -m "ubah port dan abaikan node_modules"',
        hint: "Commit seluruh perubahan",
      },
      { cmd: "git log --oneline", hint: "Periksa riwayat" },
    ],
    stepNotes: {
      0: "'no changes added to commit' berarti perubahan belum di-add, bukan berarti tidak ada perubahan. Lanjutkan dengan memeriksa status.",
      3: "`.gitignore` hanya memengaruhi berkas yang belum dilacak. Berkas yang sudah pernah di-commit tetap dilacak.",
      5: "Jika lupa `-m`, Git membuka editor teks. Di Vim: `Esc`, `:wq`, Enter.",
    },
    check: (s) => {
      const f = (s.commits[s.branches.main] || {}).files || {};
      return (
        f["server.js"] === "const port = 4000;\n" &&
        f[".gitignore"] !== undefined &&
        f["node_modules/lib.js"] === undefined
      );
    },
    why: {
      title: "Kesalahan yang paling umum",
      blocks: [
        {
          h: "1. Berkas berubah, tetapi Git menyatakan bersih",
          p: "Tiga kemungkinan: belum di-add, berkas untracked, atau namanya cocok dengan pola di `.gitignore`.",
        },
        {
          h: "2. Lupa `-m` saat commit",
          p: "Tanpa `-m`, Git membuka editor. Jika Vim terbuka: `Esc`, `:wq`, Enter.",
        },
      ],
    },
  });

  S.push({
    id: "branch-pr",
    num: "03",
    title: "Feature Branch",
    subtitle:
      "Alur yang digunakan hampir semua tim: buat branch, commit di sana, push, lalu merge.",
    files: { "app.js": "function utama() {}\n" },
    opts: { isRepo: true },
    setup(s) {
      commit(s, "app.js", "awal proyek");
      origin(s, "proyek");
      s.workdir["app.js"] = "function utama() {}\nfunction login() {}\n";
    },
    steps: [
      { cmd: "git switch -c fitur-login", hint: "Buat branch baru" },
      { cmd: "git status", hint: "Perubahan Anda ikut pindah ke branch baru" },
      { cmd: "git add app.js", hint: "Stage perubahan" },
      {
        cmd: 'git commit -m "tambah fungsi login"',
        hint: "Commit di branch fitur",
      },
      { cmd: "git push origin fitur-login", hint: "Push branch terpisah" },
      { cmd: "git switch main", hint: "Kembali ke main" },
      { cmd: "git merge fitur-login", hint: "Gabungkan branch fitur" },
      { cmd: "git push origin main", hint: "Push hasil merge" },
      {
        cmd: "git branch -d fitur-login",
        hint: "Hapus branch yang sudah digabung",
      },
    ],
    stepNotes: {
      0: "`git switch -c` membuat branch baru dan langsung berpindah. Titik awalnya sama dengan `main`.",
      4: "Push branch terpisah tidak menyentuh `main`. Itu inti alasan alur ini aman.",
      6: "Merge fast-forward: `main` hanya bergeser maju, tanpa commit merge baru.",
      8: "`-d` hanya mau menghapus branch yang sudah digabung. Commit-nya tetap ada di riwayat `main`.",
    },
    check: (s) => {
      const m = s.branches.main,
        c = s.commits[m];
      return (
        !!c &&
        c.msg === "tambah fungsi login" &&
        !s.branches["fitur-login"] &&
        s.head === "main" &&
        s.remote.refs.main === m
      );
    },
    why: {
      title: "Mengapa tim menggunakan branch dan PR",
      blocks: [
        {
          h: "Alurnya",
          pre: "git switch -c fitur   <- ruang aman\ngit commit ...\ngit push origin fitur\ngit switch main\ngit merge fitur",
        },
      ],
    },
  });

  S.push({
    id: "undo",
    num: "04",
    title: "Undo Changes",
    subtitle:
      "`restore`, `reset`, dan `revert` sama-sama 'membatalkan', tetapi masing-masing untuk situasi yang berbeda.",
    files: { "server.js": "const port = 3000;\n", ".env": "API_KEY=rahasia\n" },
    opts: { isRepo: true },
    setup(s) {
      commit(s, ".", "awal");
      s.workdir["server.js"] = "const port = 9999;\n";
      commit(s, "server.js", "ubah port");
      origin(s, "server");
      s.workdir["server.js"] = "const port = 1234;\n";
    },
    steps: [
      { cmd: "git status", hint: "Ada perubahan yang belum di-commit" },
      {
        cmd: "git restore server.js",
        hint: "Buang perubahan yang belum di-commit",
      },
      { cmd: 'echo "// coba-coba" >> server.js', hint: "Ubah berkas lagi" },
      { cmd: "git add server.js", hint: "Stage perubahan" },
      {
        cmd: 'git commit -m "coba lokal"',
        hint: "Commit yang belum pernah di-push",
      },
      { cmd: "git reset --hard HEAD~1", hint: "Hapus commit lokal tersebut" },
      { cmd: "git log --oneline", hint: "Commit lokal sudah hilang" },
      {
        cmdAt: (s) => "git revert " + s.branches.main,
        hint: "Batalkan commit yang sudah di-push",
      },
      { cmd: "git push origin main", hint: "Push hasil revert" },
    ],
    stepNotes: {
      1: "`restore` hanya menyentuh berkas yang belum di-commit. Perubahan tersebut hilang permanen, tidak ada cadangan.",
      5: "`reset --hard` memindahkan branch mundur dan membuang isinya. Aman hanya untuk commit yang belum dibagikan.",
      7: "`revert` aman untuk riwayat bersama. Perintah ini menambah commit, tidak menghapus apa pun.",
      8: "Mengapa bukan `reset`? `reset` menghapus commit. Jika sudah di-push, riwayat Anda dan rekan menjadi berbeda.",
    },
    check: (s) => {
      const c = s.commits[s.branches.main],
        par = c && s.commits[c.parents[0]];
      return (
        !!c &&
        /^Revert/.test(c.msg) &&
        !!par &&
        par.msg === "ubah port" &&
        s.remote.refs.main === c.hash &&
        s.workdir["server.js"] === "const port = 3000;\n"
      );
    },
    why: {
      title: "Kapan menggunakan restore, reset, atau revert",
      blocks: [
        {
          h: "Ringkasan",
          p: "`restore` untuk berkas yang belum di-commit. `reset` untuk commit yang belum dibagikan. `revert` untuk commit yang sudah di-push.",
        },
      ],
    },
  });

  S.push({
    id: "push-ditolak",
    num: "05",
    title: "Push Rejected",
    subtitle:
      "Anda dan rekan kerja menggunakan repositori GitHub yang sama. Rekan Anda push lebih dulu, sehingga riwayat Anda tertinggal satu langkah.",
    files: {
      "index.html": "<h1>Toko</h1>\n<main></main>\n<footer></footer>\n",
    },
    opts: { isRepo: true },
    setup(s) {
      commit(s, "index.html", "awal");
      teammate(s, "toko", "rekan: ubah judul", {
        "index.html": "<h1>Toko Kita</h1>\n<main></main>\n<footer></footer>\n",
      });
      s.workdir["index.html"] =
        "<h1>Toko</h1>\n<main></main>\n<footer>versi saya</footer>\n";
    },
    steps: [
      { cmd: "git diff", hint: "Periksa perubahan" },
      { cmd: "git add index.html", hint: "Stage perubahan" },
      { cmd: 'git commit -m "tambah footer"', hint: "Simpan commit" },
      { cmd: "git status", hint: "Perhatikan status ahead" },
      { cmd: "git push origin main", hint: "Push — akan ditolak", fail: true },
      { cmd: "git fetch", hint: "Ambil kabar terbaru dari GitHub" },
      { cmd: "git status", hint: "Perhatikan status diverged" },
      {
        cmd: "git pull",
        hint: "Gabungkan pekerjaan rekan — bagian berbeda, jadi otomatis",
      },
      { cmd: "git log --oneline", hint: "Periksa riwayat gabungan" },
      { cmd: "git push origin main", hint: "Push ulang" },
    ],
    stepNotes: {
      3: "'ahead by 1' hanya mencerminkan apa yang Git lokal ketahui. Git belum tahu rekan Anda sudah push, karena belum ada `fetch`.",
      4: "Ini bukan masalah akses. Git menolak menimpa pekerjaan orang lain. Lanjutkan dengan `fetch` untuk melihat apa yang berubah.",
      5: "`fetch` hanya memperbarui `origin/main` di komputer Anda, tidak menyentuh berkas. Lihat panel Riwayat: kini terlihat percabangan.",
      6: "'diverged' berarti kedua sisi punya commit yang tidak dimiliki sisi lain.",
      7: "Anda dan rekan mengubah baris yang berbeda, jadi Git menggabungkannya sendiri dan membuat merge commit. Jika baris yang sama berubah, hasilnya konflik (modul 07). Alternatif: `git pull --rebase` memutar ulang commit Anda di atas commit rekan tanpa merge commit.",
    },
    check: (s) =>
      !!s.branches.main &&
      s.remote.refs.main === s.branches.main &&
      Object.keys(s.commits).length >= 4,
    why: {
      title: "Mengapa push ditolak: `fetch first`",
      blocks: [
        {
          h: "Terjemahan",
          p: "`fetch first` berarti 'ambil terlebih dahulu pekerjaan pihak lain'. Git menolak karena menerima push akan menghilangkan commit rekan dari riwayat.",
        },
        {
          h: "Jalan keluar",
          p: "`git pull` = `fetch` + penggabungan. Jika perubahan tidak bersentuhan, Git menggabungkannya otomatis.",
        },
      ],
    },
  });

  S.push({
    id: "pull-bentrok",
    num: "06",
    title: "Pull Blocked",
    subtitle:
      "Terdapat berkas yang telah Anda ubah tetapi belum di-commit. Git menolak pull karena versi baru akan menimpa perubahan tersebut.",
    files: { "app.js": "function utama() {\n}\n" },
    opts: { isRepo: true },
    setup(s) {
      commit(s, "app.js", "awal");
      teammate(s, "app", "rekan: tambah fungsi", {
        "app.js": "function utama() {\n  console.log('halo');\n}\n",
      });
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
      s.branches.main === s.remote.refs.main &&
      s.stash.length === 0 &&
      /editan saya/.test(s.workdir["app.js"] || "") &&
      /halo/.test(s.workdir["app.js"] || ""),
    why: {
      title: "Mengapa pull ditolak: `local changes`",
      blocks: [
        {
          h: "Terjemahan",
          p: "Git berhenti sebelum proses dimulai. `Aborting` berarti tidak ada satu byte pun yang berubah.",
        },
      ],
    },
  });

  S.push({
    id: "konflik",
    num: "07",
    title: "Merge Conflict",
    subtitle:
      "Anda dan rekan kerja mengubah baris yang sama dengan cara berbeda. Git tidak dapat memilih, sehingga keputusan diserahkan kepada Anda.",
    files: { "harga.js": "const harga = 10000;\n" },
    opts: { isRepo: true },
    setup(s) {
      commit(s, "harga.js", "awal");
      teammate(s, "harga", "rekan: naikkan harga", {
        "harga.js": "const harga = 12000;\n",
      });
      s.workdir["harga.js"] =
        "const harga = 10000;\n// TODO: harga belum dinaikkan\n";
    },
    steps: [
      { cmd: "git diff", hint: "Periksa perubahan" },
      { cmd: "git add harga.js", hint: "Stage perubahan" },
      { cmd: 'git commit -m "tambah catatan harga"', hint: "Simpan commit" },
      { cmd: "git pull", hint: "Pull — akan menghasilkan konflik", fail: true },
      { cmd: "git status", hint: "Periksa status konflik" },
      { cmd: "git add harga.js", hint: "Pilih versi di panel Berkas dulu" },
      {
        cmd: 'git commit -m "selesaikan konflik harga"',
        hint: "Commit hasil penyelesaian",
      },
      { cmd: "git push origin main", hint: "Push ke remote" },
    ],
    stepNotes: {
      3: "`CONFLICT (content)` bukan crash. Git menyerahkan keputusan yang tidak dapat diambilnya. Pilih versi di panel Berkas, lalu jalankan `add`.",
      5: "Mengapa `add` lagi? Itu cara memberi tahu Git bahwa konflik telah diselesaikan.",
    },
    check: (s) =>
      !!s.branches.main &&
      Object.keys(s.conflicts).length === 0 &&
      s.remote.refs.main === s.branches.main &&
      !/^(<{7}|={7}|>{7})/m.test(s.workdir["harga.js"] || ""),
    why: {
      title: "Apa yang terjadi saat konflik: `<<<<<<<`",
      blocks: [
        {
          h: "Terjemahan",
          p: "`HEAD` menunjuk commit terakhir Anda. `origin/main` menunjuk posisi remote. Ketiga penanda tersebut menandai batas, bukan error.",
        },
      ],
    },
  });

  S.push({
    id: "detached",
    num: "08",
    title: "Old Commit",
    subtitle:
      "Anda kembali ke commit lama untuk memeriksa isinya. Di sana, kepala riwayat tidak lagi mengikuti branch mana pun.",
    files: { "a.txt": "versi 1\n" },
    opts: { isRepo: true },
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
      {
        cmd: 'echo "catatan eksperimen" >> a.txt',
        hint: "Ubah berkas di detached HEAD",
      },
      { cmd: "git add a.txt", hint: "Stage perubahan" },
      {
        cmd: 'git commit -m "eksperimen di detached HEAD"',
        hint: "Commit tanpa branch yang menunjuk",
      },
      {
        cmd: "git log --oneline",
        hint: "Perhatikan panel Riwayat: main tidak bergerak",
      },
      {
        cmdAt: (s) => "git branch eksperimen " + s.detached,
        hint: "Selamatkan dengan branch baru",
      },
      { cmd: "git branch", hint: "Periksa branch" },
      { cmd: "git switch eksperimen", hint: "Pindah ke branch penyelamat" },
    ],
    stepNotes: {
      1: "'detached HEAD' adalah peringatan, bukan error. Anda sedang di luar branch mana pun. Lanjutkan eksperimen.",
      5: "Commit baru di detached HEAD tidak masuk riwayat branch mana pun. Jika berpindah branch, commit tersebut hilang.",
      6: "`git branch <nama> <hash>` memberikan nama pada commit yang menggantung, sehingga menjadi permanen.",
    },
    check: (s) =>
      !!s.branches.eksperimen && !s.detached && s.head === "eksperimen",
    why: {
      title: "Mengapa detached HEAD berbahaya",
      blocks: [
        {
          h: "Analogi",
          p: "Branch ibarat penunjuk jalan yang memiliki nama. Detached HEAD berarti Anda berada di tengah jalan tanpa nama tersebut.",
        },
      ],
    },
  });

  window.SCENARIOS = S;
  window.stepCommand = (step, s) => (step.cmdAt ? step.cmdAt(s) : step.cmd);
})();
