# GitSim

Simulator Git di browser. Tujuannya satu: latihan perintah Git tanpa merusak repo asli.

Tidak ada build, framework, atau dependency. Buka `index.html`, ketik perintah di terminal, lihat hasilnya di panel riwayat dan berkas.

## Jalankan

```bash
git clone <url-repo-ini>
cd GitSim
```

Buka `index.html` langsung di browser, atau lewat server lokal:

```bash
python3 -m http.server 8000
```

Progres belajar disimpan di `localStorage`. Tidak ada data yang dikirim ke mana pun.

## Isi repo

```
GitSim/
  index.html      kerangka UI
  styles.css      tampilan
  git-engine.js   mesin Git: commit, branch, merge, remote
  scenarios.js    9 modul latihan
  brain.js        render graph, berkas, detail commit
  app.js          pengendali UI
  preview.js      miniatur SVG
  test.js         uji mesin Git dan tiap modul
  smoke.js        uji cepat: berkas lengkap, skrip termuat, modul jalan
```

## Modul

| # | Modul | Isi |
|:-:|---|---|
| 01 | From Zero | init, commit pertama, push ke remote |
| 02 | Staging | add, diff, restore |
| 03 | Ignore Files | `.gitignore`, commit yang gagal |
| 04 | Feature Branch | branch, push, merge fast-forward |
| 05 | Undo Commit | revert vs reset |
| 06 | Old Commit | detached HEAD, menyelamatkan commit |
| 07 | Pull Blocked | pull ditolak, stash |
| 08 | Push Rejected | fetch, diverged, pilih strategi pull |
| 09 | Merge Conflict | `<<<<<<<`, selesaikan, commit |

## Perintah

Shell: `touch`, `cat`, `ls`, `rm`, `echo` dengan `>` dan `>>`.

Git: `init`, `status`, `add`, `rm`, `commit`, `log`, `diff`, `branch`, `switch`, `checkout`, `restore`, `reset`, `revert`, `stash`, `merge`, `fetch`, `pull`, `push`, `remote`, `config`.

Yang cukup dalam: merge 3 arah per hunk, diff unified, glob `.gitignore`, ref seperti `HEAD~2` dan `origin/main`, dan pesan error yang sama dengan Git asli (`fetch first`, `non-fast-forward`, `divergent branches`).

## Batasan

- Konflik modify/delete belum didukung. Simulator menolak dan tidak mengubah state.
- Konflik saat `revert` atau rebase belum bisa diselesaikan interaktif.
- Hanya satu remote, yaitu `origin`.
- Hash commit acak, bukan SHA-1 sungguhan.
- `commit` tanpa `-m` menganggap tidak ada editor teks, kecuali saat menutup merge.

## Uji

```bash
cd GitSim
node test.js    # logika Git, 67 asersi
node smoke.js   # berkas lengkap, skrip termuat, semua modul bisa diselesaikan
```

Keduanya keluar dengan kode 1 kalau ada yang gagal, jadi bisa dipakai di CI.

## Menambah modul

Tambah satu objek ke `SCENARIOS` di `scenarios.js`:

```js
S.push({
  id: "nama-modul", num: "10", group: "Dasar", title: "Judul",
  subtitle: "Penjelasan singkat.",
  files: { "a.txt": "isi\n" }, opts: { isRepo: true },
  steps: [{ cmd: "git status", hint: "Periksa kondisi" }],
  check: (s) => s.isRepo,
  why: { title: "Penjelasan", blocks: [{ h: "Judul", p: "Isi." }] },
});
```

Lalu jalankan `node smoke.js`. Uji ini akan langsung mengecek modul baru.

## Lisensi

MIT
