# Sakura Event — Utang Usaha & Reimbursement

Aplikasi desktop sederhana untuk mencatat utang usaha, pengajuan reimbursement karyawan, pembayaran, dan laporan. Server menggunakan Node.js bawaan tanpa dependensi npm; data disimpan di Supabase PostgreSQL.

## Demo web

Buka [Sakura Event](https://rahelinda885-lab.github.io/Sistem-informasi-utang-usaha-dan-reimbursement-karyawan/).

## ERD — empat entitas

- **parties** menyimpan nama supplier atau karyawan (`party_type`).
- **expense_categories** menyimpan kategori pengeluaran reimbursement.
- **obligations** menyimpan utang maupun reimbursement dan merujuk ke satu pihak; reimbursement juga merujuk kategori.
- **payments** menyimpan pembayaran untuk satu kewajiban.

Relasi: `parties 1—N obligations`, `expense_categories 1—N obligations`, `obligations 1—N payments`.

## Menyiapkan Supabase

1. Buat project Supabase.
2. Buka **SQL Editor**, lalu jalankan seluruh isi `backend\schema.sql`.
3. `backend\schema.sql` mengaktifkan akses tanpa login untuk role `anon`. Ini membuat seluruh data dapat dibaca/diubah siapa pun yang mengetahui URL project. Gunakan konfigurasi ini hanya jika memang menginginkan akses publik.
4. Frontend langsung menggunakan Project URL dan publishable key; keduanya boleh berada di browser. Jangan pernah menaruh `service_role` key pada frontend.

> **Penting untuk lampiran:** faktur, kuitansi karyawan, dan bukti transfer disimpan pada record Supabase yang mengikuti kebijakan akses publik di atas. Jangan unggah dokumen asli/berisi data sensitif ke project dengan akses `anon` ini. Untuk penggunaan produksi, aktifkan autentikasi dan kebijakan akses privat (termasuk penyimpanan dokumen privat) terlebih dahulu.

## Menjalankan aplikasi

Gunakan Node.js 18 atau lebih baru (membutuhkan `fetch` bawaan). Dari PowerShell pada folder proyek:

```powershell
$env:SUPABASE_URL = "https://PROJECT-REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "SERVICE-ROLE-KEY"
node backend\app.js
```

Buka `http://localhost:3000`. Untuk menghentikan server tekan `Ctrl+C`. Port dapat diubah melalui variabel lingkungan `PORT`.

## Membuka frontend langsung

`frontend\index.html` dapat dibuka langsung di browser tanpa menjalankan server. Frontend menggunakan Project URL dan publishable key yang telah dikonfigurasi, lalu membaca dan menyimpan transaksi langsung ke Supabase melalui REST API tanpa layar login. Jalankan `backend\schema.sql` di SQL Editor agar tabel dan kebijakan RLS publik tersedia.

Untuk mode server lokal, jalankan langkah berikut. **Service role key hanya digunakan oleh server lokal dan tidak boleh dimasukkan ke frontend atau dibagikan.**

## Laporan Excel

Di menu **Laporan**, pilih periode lalu klik **Unduh Excel**. File `.xlsx` berisi ringkasan, kewajiban, pembayaran selama periode, ringkasan per supplier/karyawan, dan snapshot saldo pada akhir periode. Cetak laporan menyediakan layout yang siap dicetak.

## Pembaruan fitur

Jika project Supabase sudah memiliki tabel, jalankan kembali seluruh `Backend\schema.sql` di SQL Editor untuk menambahkan kolom dokumen dan alasan penolakan. Status reimbursement sekarang mencakup Diajukan, Disetujui, Ditolak, dan Dibayar (ditentukan oleh saldo pembayaran). Faktur atau dokumen pendukung wajib dilampirkan pada utang usaha, dan bukti pengeluaran atau dokumen pendukung wajib dilampirkan pada reimbursement sebelum transaksi dapat disimpan. Dokumen transaksi dan bukti pembayaran menerima PDF/JPG/PNG/WebP maksimal 3 MB per berkas; file disimpan pada kolom data transaksi Supabase.

Dashboard menampilkan pengingat jatuh tempo, pekerjaan menunggu persetujuan, dan tren enam/dua belas bulan dari transaksi dan pembayaran aktual. Detail transaksi dapat dibuka melalui panel samping. Laporan pembayaran periode dan saldo kewajiban pada tanggal snapshot ditampilkan terpisah.

Struktur folder aplikasi:

```text
backend\
  app.js
  schema.sql
frontend\
  index.html
  styles.css
  script.js
```

Backend server lokal tidak memiliki autentikasi pengguna dan ditujukan hanya untuk penggunaan pada komputer/jaringan tepercaya; jangan mengeksposnya ke internet publik. Mode frontend langsung menggunakan Supabase Auth dan kebijakan RLS yang dijalankan melalui `backend\schema.sql`.
