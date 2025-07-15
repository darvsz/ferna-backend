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

// === Firebase Init (pakai BASE64)
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

// === Endpoint untuk AI Chat
app.post('/chat', async (req, res) => {
  const nama = req.body.nama || req.body.name;
  const keluhan = req.body.keluhan || req.body.message;

  if (!nama || !keluhan) {
    console.warn('⚠️ Nama atau keluhan kosong');
    return res.status(400).json({ reply: '❌ Nama dan keluhan wajib diisi.' });
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Kamu adalah tabib ahli herbal. Tugasmu adalah menjawab hanya dengan resep herbal dan gramnya (bukan satuan lain alias hanya gram) dalam format JSON yang valid. Gunakan HANYA bahan herbal dari: jahe, kunyit, temulawak, daun mint, daun sirih, kayu manis, cengkeh, sereh, daun kelor, lada hitam. Tanpa penjelasan.`
          },
          {
            role: 'user',
            content: `Nama pasien: ${nama}\nKeluhan: ${keluhan}`
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const output = response.data.choices?.[0]?.message?.content || 'Tidak ada jawaban.';
    resepTerakhir = { nama, keluhan, resep: output, status: 'proses', waktu: new Date() };

    const docRef = await db.collection('antrian').add(resepTerakhir);
    console.log(`📥 Resep untuk ${nama} disimpan ke Firestore`);

    setTimeout(async () => {
      try {
        await docRef.update({ status: 'done' });
        console.log(`✅ Status ${nama} diubah jadi DONE`);
      } catch (e) {
        console.error(`🔥 Gagal update status untuk ${nama}:`, e.message);
      }
    }, Math.random() * 3000 + 5000);

    res.json({ status: '✅ Resep dikirim ke tabib. Menunggu proses.', resep: output });

  } catch (err) {
    console.error('🔥 Gagal proses /chat:', err.response?.data || err.message);
    res.status(500).json({
      error: '⚠️ Gagal memproses permintaan.',
      detail: err.response?.data || err.message
    });
  }
});

// === Endpoint status pasien
app.get('/status', async (req, res) => {
  const nama = (req.query.nama || '').toLowerCase();
  if (!nama) {
    console.warn('⚠️ Query nama kosong');
    return res.status(400).json({ error: 'Nama wajib dikirim sebagai query (?nama=...)' });
  }

  try {
    const snapshot = await db.collection('antrian')
      .where('nama', '==', nama)
      .orderBy('waktu', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.warn(`❌ Tidak ditemukan status untuk: ${nama}`);
      return res.status(404).json({ status: '❌ Tidak ditemukan' });
    }

    const data = snapshot.docs[0].data();
    res.json({ status: data.status });
  } catch (err) {
    console.error(`🔥 Gagal ambil status untuk ${nama}:`, err.message);
    res.status(500).json({
      error: 'Gagal mengambil status',
      detail: err.message
    });
  }
});


// === Endpoint untuk daftar pasien yang statusnya 'proses'
app.get('/daftar-pasien', async (req, res) => {
  try {
    const snapshot = await db.collection('antrian')
      .where('status', '==', 'done')
      .orderBy('waktu', 'asc')
      .limit(10) // batas maksimal yang diambil
      .get();

    if (snapshot.empty) {
      return res.json({ daftar: [] });
    }

    const daftar = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        nama: data.nama,
        waktu: data.waktu.toDate?.().toISOString?.() || data.waktu,
        status: data.status
      };
    });

    res.json({ daftar });
  } catch (err) {
    console.error('🔥 Gagal ambil daftar pasien:', err.message);
    res.status(500).json({ error: 'Gagal ambil daftar pasien', detail: err.message });
  }
});



// === Endpoint resep terakhir
app.get('/resep', (req, res) => {
  if (resepTerakhir) {
    res.json(resepTerakhir);
  } else {
    console.log('📭 Belum ada resep terakhir');
    res.status(404).json({ message: 'Belum ada resep.' });
  }
});

// === Root
app.get('/', (req, res) => {
  res.send('🌿 Tabib AI Backend Aktif');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Tabib AI running on port ${PORT}`));
