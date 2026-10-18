# GitSim

Simulator Git di browser. Latihan perintah Git tanpa takut merusak repo asli.

Tidak ada build, framework, atau dependency. Buka dan langsung pakai.

## Menjalankan

```bash
git clone https://github.com/devyrix/GitSim
cd GitSim
```

Buka `index.html` di browser, atau:

```bash
python3 -m http.server 8000
```

Progres tersimpan di `localStorage`. Tidak ada data yang dikirim ke mana pun.

## Modul

| # | Modul | Isi |
|:-:|---|---|
| 01 | From Zero | init, commit pertama, push ke remote |
| 02 | Common Traps | lupa add, `.gitignore` |
| 03 | Feature Branch | branch, push, merge fast-forward |
| 04 | Undo Changes | restore, reset, revert |
| 05 | Push Rejected | fetch, diverged, merge otomatis |
| 06 | Pull Blocked | pull ditolak, stash |
| 07 | Merge Conflict | `<<<<<<<`, selesaikan konflik |
| 08 | Old Commit | detached HEAD, menyelamatkan commit |

## Uji

```bash
node test.js    # logika Git dan tiap modul
node smoke.js   # kelengkapan berkas dan skrip
```

## Lisensi

MIT
