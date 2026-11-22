# token-radar-02 — VERIFY (22 Nov 2026, ~12:36 WIB)

Semua pemeriksaan dijalankan terhadap `out/` (hasil `main.ts` dengan snapshot
kit yang tersegel). TIDAK ada submit, repo GitHub, klaim, atau pengeluaran.

## 1. Run program (2x, byte-identik)
- `MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json` — sukses.
- Run kedua ke direktori terpisah: `board.json`, `data.js`, `dossier.json`,
  `dashboard/`, `screenshots/` — SEMUA byte-identik (sha256 sama).
- Output run: 758 protokol, 40 watchlist, 198 baris, integritas
  198 ranked + 416 traded + 144 excluded = 758.
- Fit: log(mcap) = 6,9646 + 0,5223·log(TVL) pada 128 comps, R² 0,1939.
  LOO median error 83,63%, within-3x 46,88%.
- Verdict: FARM 37 / THIN 98 / SKIP 63.

## 2. Gate board.json (diperiksa dengan skrip independen)
- 198 baris; rank tepat 1..198; `implied_value_usd` (EV) tidak naik seiring
  rank; semua 198 nilai EV berbeda; rentang $43.954.383 → $537.119.
- Watchlist 40/40 ter-cover; slug unik; tidak ada NaN/Infinity/null di
  semua field numerik; interval low < EV < high di semua baris.
- Farm steps: 7 per baris, semua 20–600 karakter (0 pelanggaran).
- `board.json` 349.512 byte (< 8 MiB); `data.js` 348.042 byte.

## 3. Stdlib-only + tanpa network
- Import program: hanya `node:fs`, `node:path`, `node:url` + file lokal
  (`./lib/model.ts`, `./vendor/makefun-board.ts`). Tidak ada npm install,
  tidak ada package pihak ketiga.
- Tidak ada `fetch(`, `XMLHttpRequest`, atau `http://` di `main.ts`,
  `lib/model.ts`, maupun `dashboard/` (grep: 0 temuan; tidak ada pula
  `https://` di file dashboard — gate menolaknya).
- Output hanya ke MAKEFUN_OUTPUT_DIR; snapshot dibaca read-only.

## 4. Dossier (rekonstruksi independen)
- `dossier.json` 1.329.214 byte (< 1,5 MiB); teks dashboard 27.286 byte
  (< 65.536 — ketiga file dashboard masuk utuh).
- Rekonstruksi independen dengan `buildDossier` dari `out/`:
  BYTE-IDENTICAL dengan `dossier.json` yang ditulis `main.ts`.
- Cover = `1-board.jpg` (screenshot pertama menurut nama).

## 5. Screenshot (Chromium 131 headless asli, file://, tanpa network)
- `1-board.jpg` 1440×800, 316.641 byte — board + strip integritas + KPI + filter.
- `2-detail.jpg` 1440×800, 343.677 byte — detail Steakhouse Financial
  (rank 1): breakdown model + break-even + verdict FARM + farm plan.
- `3-filtered.jpg` 1440×800, 315.297 byte — board terfilter verdict=FARM
  (37 dari 198 baris).
- Ketiganya JPEG, 300–350 KB, sisi panjang 1440, sisi pendek 800
  (di bawah cap 512 KiB per file). Ketiganya dilihat langsung dan cocok
  dengan dashboard yang di-submit (data yang sama, dari `out/`).

## 6. Dashboard offline
- Di-render dari `out/dashboard/index.html` via `file://` tanpa server
  dan tanpa network; ketiga screenshot diambil dari render itu.
- Dashboard: board sortable (rank, EV, TVL, growth, umur, odds) + filter
  (kategori, chain, verdict, watchlist, teks) + detail per protokol +
  halaman metodologi + live-token view (24 baris).
- Total sumber dashboard 27.022 byte (index.html 443 + app.css 6.257 +
  app.js 20.322) — di bawah 64 KB, jadi teks dossier memuat semuanya utuh.

## 7. Kuota live (22 Nov ~12:36 WIB)
- `GET /api/competitions/token-radar-01/quota`: day cap 5, taken 0,
  left 5 (reset 23 Nov 07:00 WIB), hard limit left 38, can_submit true.
- Cukup untuk submit v2 hari ini (1 slot dari 5).

## 8. Yang BELUM diperiksa (di luar tugas ini)
- Kit check `node cli/makefun.mjs check` butuh bundle transkrip — itu
  langkah submit oleh agen utama, bukan di sini.
- Tidak ada repo GitHub yang dibuat/di-push dari pekerjaan ini.
- `.makefun/owner.json` berisi hanya wallet publik
  GWXNPYTKQvCfbgx1viQCkb5UkukVVPthYuyKXzadvi65.
