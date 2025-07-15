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

// === Endpoint AI Chat
app.post('/chat', async (req, res) => {
  const nama = req.body.nama || req.body.name;
  const keluhan = req.body.keluhan || req.body.message;
  if (!nama || !keluhan) return res.status(400).json({ reply: '❌ Nama dan keluhan wajib diisi.' });

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Kamu adalah tabib ahli herbal. Jawablah hanya dalam format JSON dengan bahan dari daftar berikut: jahe, kunyit, temulawak, daun mint, daun sirih, kayu manis, cengkeh, sereh, daun kelor, lada hitam. Gunakan hanya satuan gram. Tanpa penjelasan apapun.`
          },
          {
            role: 'user',
            content: `Nama pasien: ${nama}\nKeluhan: ${keluhan}`
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    let parsed = {};
    try {
      parsed = JSON.parse(response.data.choices?.[0]?.message?.content || '{}');
    } catch (e) {
      parsed = response.data.choices?.[0]?.message?.content || '{}';
    }

    resepTerakhir = {
      nama,
      keluhan,
      resep: parsed,
      status: 'proses',
      waktu: new Date()
    };

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

    res.json({ status: '✅ Resep dikirim ke tabib.', resep: parsed });

  } catch (err) {
    console.error('🔥 Gagal proses /chat:', err.response?.data || err.message);
    res.status(500).json({ error: '⚠️ Gagal memproses permintaan.' });
  }
});

// === Hitung total bayar dari resep
function hitungTotalBayar(resep) {
  let totalGram = 0;
  try {
    for (let key in resep) {
      const val = resep[key];
      totalGram += typeof val === 'number' ? val : parseFloat(val);
    }
  } catch (e) {
    console.warn('⚠️ Gagal hitung gram:', e.message);
  }

  const hargaPerGram = 300;
  const biayaAwal = totalGram * hargaPerGram;
  const biayaTransaksi = 750 + biayaAwal * 0.007;
  const total = Math.ceil(biayaAwal + biayaTransaksi + 5000); // Bulat ke atas

  return { total, rincian: { totalGram, biayaAwal, biayaTransaksi, biayaSistem: 5000 } };
}

// === Endpoint pembayaran QRIS
app.post('/bayar', async (req, res) => {
  const nama = req.body.nama;
  if (!nama) return res.status(400).json({ error: 'Nama tidak ditemukan' });

  try {
    const snapshot = await db.collection('antrian')
      .where('nama', '==', nama.toLowerCase())
      .orderBy('waktu', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const doc = snapshot.docs[0];
    const data = doc.data();

    const { total } = hitungTotalBayar(data.resep);
    const invoiceRef = 'INV' + Date.now();
const tripayRes = await axios.post('https://tripay.co.id/api-sandbox/transaction/create', {

      method: 'QRIS',
      merchant_ref: invoiceRef,
      amount: total,
      customer_name: nama,
      order_items: [{ name: 'Resep Herbal', price: total, quantity: 1 }],
      callback_url: `${process.env.BASE_URL}/callback`,
      return_url: `${process.env.BASE_URL}/sukses.html`
    }, {
      headers: { Authorization: `Bearer ${process.env.TRIPAY_API_KEY}` }
    });

    const paymentUrl = tripayRes.data.data?.checkout_url;
    await doc.ref.update({ invoiceRef, total, status: 'menunggu pembayaran' });

    res.json({ payment_url: paymentUrl });

  } catch (err) {
    console.error('🔥 Gagal membuat link pembayaran:', err.response?.data || err.message);
    res.status(500).json({ error: 'Gagal membuat link pembayaran' });
  }
});

// === Callback dari Tripay
app.post('/callback', async (req, res) => {
  const { merchant_ref, status } = req.body;
  if (!merchant_ref) return res.status(400).json({ error: 'Merchant_ref tidak ada' });

  try {
    const snapshot = await db.collection('antrian')
      .where('invoiceRef', '==', merchant_ref)
      .limit(1)
      .get();

    if (!snapshot.empty && status === 'PAID') {
      const doc = snapshot.docs[0];
      await doc.ref.update({ status: 'paid' });
      console.log(`💰 Pembayaran berhasil untuk ${merchant_ref}`);
    }

    res.json({ success: true });
  } catch (e) {
    console.error('🔥 Callback gagal:', e.message);
    res.status(500).json({ error: 'Callback gagal' });
  }
});

// === Endpoint status
app.get('/status', async (req, res) => {
  const nama = (req.query.nama || '').toLowerCase();
  if (!nama) return res.status(400).json({ error: 'Nama wajib dikirim sebagai query' });

  try {
    const snapshot = await db.collection('antrian')
      .where('nama', '==', nama)
      .orderBy('waktu', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return res.status(404).json({ status: '❌ Tidak ditemukan' });

    const data = snapshot.docs[0].data();
    res.json({ status: data.status });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil status' });
  }
});

// === Endpoint lain tetap sama...
app.get('/daftar-pasien', async (req, res) => {
  try {
    const snapshot = await db.collection('antrian')
      .where('status', '==', 'done')
      .orderBy('waktu', 'asc')
      .limit(10)
      .get();

    const daftar = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        nama: data.nama,
        waktu: data.waktu.toDate?.().toISOString?.() || data.waktu
      };
    });

    res.json({ daftar });
  } catch (err) {
    res.status(500).json({ error: 'Gagal ambil daftar pasien' });
  }
});

app.get('/resep/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const doc = await db.collection('antrian').doc(id).get();
    if (!doc.exists) return res.status(404).json({ error: '❌ Resep tidak ditemukan' });

    const data = doc.data();
    let resep = data.resep;

    if (typeof resep === 'string') {
      try { resep = JSON.parse(resep); } catch (e) {
        return res.status(500).json({ error: 'Resep tidak valid JSON' });
      }
    }

    res.json(resep);
  } catch (err) {
    res.status(500).json({ error: 'Gagal ambil resep' });
  }
});

app.get('/resep', (req, res) => {
  if (resepTerakhir) res.json(resepTerakhir);
  else res.status(404).json({ message: 'Belum ada resep.' });
});

app.get('/', (req, res) => {
  res.send('🌿 Tabib AI Backend Aktif');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Tabib AI running on port ${PORT}`));
