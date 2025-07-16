import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// === Init Firebase pakai base64
try {
  const decoded = Buffer.from(process.env.FIREBASE_KEY_BASE64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decoded);
  initializeApp({ credential: cert(serviceAccount) });
  console.log('✅ Firebase initialized via Base64 key');
} catch (err) {
  console.error('🔥 Gagal inisialisasi Firebase:', err.message);
}

const db = getFirestore();
let resepTerakhir = null;

// === Fungsi hitung harga resep
function hitungTotalBayar(resep) {
  let totalGram = 0;
  for (let bahan in resep) {
    totalGram += parseFloat(resep[bahan] || 0);
  }

  const hargaPerGram = 300;
  const biayaAwal = totalGram * hargaPerGram;
  const biayaTambahan = 750 + (0.007 * biayaAwal);
  const biayaSistem = 5000;
  const total = Math.ceil(biayaAwal + biayaTambahan + biayaSistem);

  return { total, rincian: { totalGram, biayaAwal, biayaTambahan, biayaSistem } };
}

// === Endpoint /chat → tabib & simpan Firestore
app.post('/chat', async (req, res) => {
  const nama = req.body.nama || req.body.name;
  const keluhan = req.body.keluhan || req.body.message;
  if (!nama || !keluhan) return res.status(400).json({ reply: '❌ Nama dan keluhan wajib diisi.' });

  try {
    const aiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Kamu adalah tabib herbal. Jawab dalam JSON valid dengan satuan gram. Gunakan bahan: jahe, kunyit, temulawak, daun mint, daun sirih, kayu manis, cengkeh, sereh, daun kelor, lada hitam.`
          },
          { role: 'user', content: `Nama: ${nama}\nKeluhan: ${keluhan}` }
        ],
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    let parsed = {};
    try {
      parsed = JSON.parse(aiRes.data.choices?.[0]?.message?.content || '{}');
    } catch (e) {
      parsed = {};
    }

    const kodeInvoice = `INV-${Date.now()}`;
    const { total } = hitungTotalBayar(parsed);

    // Simpan ke Firestore
    resepTerakhir = {
      nama,
      keluhan,
      resep: parsed,
      status: 'proses',
      kodeInvoice,
      total,
      pembayaran: 'belum',
      waktu: new Date()
    };

    const docRef = await db.collection('antrian').add(resepTerakhir);
    console.log(`📥 Resep untuk ${nama} disimpan ke Firestore`);

    // Update status jadi 'done' setelah delay
    setTimeout(async () => {
      try {
        await docRef.update({ status: 'done' });
        console.log(`✅ Status ${nama} diubah jadi DONE`);
      } catch (e) {
        console.error('🔥 Gagal update status:', e.message);
      }
    }, Math.random() * 3000 + 5000);

    // Tampilkan total harga bayar manual
    res.json({
      status: '✅ Resep dikirim ke tabib.',
      resep: parsed,
      total,
      instruksi_bayar: `Silakan transfer sebesar Rp${total} ke rekening yang tertera di tempat, lalu konfirmasi ke petugas.`
    });

  } catch (err) {
    console.error('🔥 Gagal proses /chat:', err.response?.data || err.message);
    res.status(500).json({ error: ⚠️ Gagal memproses permintaan.' });
  }
});

// === Endpoint status
app.get('/status', async (req, res) => {
  const nama = (req.query.nama || '').toLowerCase();
  if (!nama) return res.status(400).json({ error: 'Nama wajib dikirim sebagai query' });

  try {
    const snapshot = await db.collection('antrian').where('nama', '==', nama).orderBy('waktu', 'desc').limit(1).get();
    if (snapshot.empty) return res.status(404).json({ status: '❌ Tidak ditemukan' });

    const data = snapshot.docs[0].data();
    res.json({ status: data.status, pembayaran: data.pembayaran, total: data.total });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil status' });
  }
});

// === Daftar pasien selesai
app.get('/daftar-pasien', async (req, res) => {
  try {
    const snapshot = await db.collection('antrian').where('status', '==', 'done').orderBy('waktu', 'desc').limit(10).get();
    const daftar = snapshot.docs.map(doc => ({
      id: doc.id,
      nama: doc.data().nama,
      waktu: doc.data().waktu.toDate?.().toISOString?.() || ''
    }));
    res.json({ daftar });
  } catch (err) {
    res.status(500).json({ error: 'Gagal ambil daftar pasien' });
  }
});

// === Resep berdasarkan ID
app.get('/resep/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const doc = await db.collection('antrian').doc(id).get();
    if (!doc.exists) return res.status(404).json({ error: '❌ Resep tidak ditemukan' });

    let resep = doc.data().resep;
    if (typeof resep === 'string') {
      try { resep = JSON.parse(resep); } catch { return res.status(500).json({ error: 'Resep tidak valid JSON' }); }
    }

    res.json(resep);
  } catch (err) {
    res.status(500).json({ error: 'Gagal ambil resep' });
  }
});

// === Resep terakhir
app.get('/resep', (req, res) => {
  if (resepTerakhir) res.json(resepTerakhir);
  else res.status(404).json({ message: 'Belum ada resep.' });
});

// === Root
app.get('/', (req, res) => {
  res.send('🌿 Tabib AI Backend Aktif - Mode Pembayaran Manual');
});

// === Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Tabib AI running on port ${PORT}`));
