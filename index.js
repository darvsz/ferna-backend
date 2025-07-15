import crypto from 'crypto';
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

// === Init Firebase (pakai base64)
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

// === Hitung Total Harga dari Resep
function hitungTotalBayar(resep) {
  let totalGram = 0;
  for (let bahan in resep) {
    totalGram += parseFloat(resep[bahan] || 0);
  }

  const hargaPerGram = 300;
  const biayaAwal = totalGram * hargaPerGram;
  const biayaTransaksi = 750 + (0.007 * biayaAwal);
  const biayaSistem = 5000;
  const total = Math.ceil(biayaAwal + biayaTransaksi + biayaSistem);

  return { total, rincian: { totalGram, biayaAwal, biayaTransaksi, biayaSistem } };
}

// === Endpoint /chat
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
    try { parsed = JSON.parse(aiRes.data.choices?.[0]?.message?.content || '{}'); }
    catch (e) { parsed = {}; }

    const kodeInvoice = `INV-${Date.now()}`;
    const { total } = hitungTotalBayar(parsed);

    // Signature Tripay
    const signature = crypto
      .createHmac('sha256', process.env.TRIPAY_PRIVATE_KEY)
      .update(process.env.TRIPAY_API_KEY + kodeInvoice + total)
      .digest('hex');

    // Buat Link Pembayaran QRIS Tripay
    let linkPembayaran = '';
    try {
      const tripayRes = await axios.post(
        'https://tripay.co.id/api-sandbox/transaction/create',
        {
          method: 'QRIS',
          merchant_ref: kodeInvoice,
          amount: total,
          customer_name: nama,
	  customer_email: `${nama.replace(/\s+/g, '').toLowerCase()}@example.com`,
          order_items: Object.entries(parsed).map(([bahan, jumlah]) => ({
            name: bahan, price: 300, quantity: jumlah
          })),
          callback_url: `${process.env.BASE_URL}/tripay-callback`,
          return_url: `${process.env.FRONTEND_URL || 'https://yourfrontend.netlify.app'}/bayar-selesai`,
          signature
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.TRIPAY_API_KEY}`
          }
        }
      );
      linkPembayaran = tripayRes.data.data?.checkout_url || '';
    } catch (err) {
      console.error('🔥 Gagal membuat link pembayaran:', err.response?.data || err.message);
    }

    // Simpan ke Firestore
    resepTerakhir = {
      nama,
      keluhan,
      resep: parsed,
      status: 'proses',
      kodeInvoice,
      total,
      pembayaran: 'belum',
      checkout_url: linkPembayaran,
      waktu: new Date()
    };

    const docRef = await db.collection('antrian').add(resepTerakhir);
    console.log(`📥 Resep untuk ${nama} disimpan ke Firestore`);

    // Auto update status setelah delay
    setTimeout(async () => {
      try {
        await docRef.update({ status: 'done' });
        console.log(`✅ Status ${nama} diubah jadi DONE`);
      } catch (e) {
        console.error(`🔥 Gagal update status:`, e.message);
      }
    }, Math.random() * 3000 + 5000);

    res.json({
      status: '✅ Resep dikirim ke tabib.',
      resep: parsed,
      checkout_url: linkPembayaran,
      total
    });

  } catch (err) {
    console.error('🔥 Gagal proses /chat:', err.response?.data || err.message);
    res.status(500).json({ error: '⚠️ Gagal memproses permintaan.' });
  }
});

// === Callback Tripay
app.post('/tripay-callback', async (req, res) => {
  const { merchant_ref, status } = req.body;
  if (!merchant_ref) return res.status(400).json({ error: 'Merchant_ref tidak ada' });

  try {
    const snapshot = await db.collection('antrian').where('kodeInvoice', '==', merchant_ref).limit(1).get();
    if (!snapshot.empty && status === 'PAID') {
      const doc = snapshot.docs[0];
      await doc.ref.update({ pembayaran: 'lunas' });
      console.log(`✅ Pembayaran lunas untuk: ${merchant_ref}`);
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('🔥 Callback error:', err.message);
    res.status(500).json({ error: 'Callback gagal' });
  }
});

// === Status pasien
app.get('/status', async (req, res) => {
  const nama = (req.query.nama || '').toLowerCase();
  if (!nama) return res.status(400).json({ error: 'Nama wajib dikirim sebagai query' });

  try {
    const snapshot = await db.collection('antrian').where('nama', '==', nama).orderBy('waktu', 'desc').limit(1).get();
    if (snapshot.empty) return res.status(404).json({ status: '❌ Tidak ditemukan' });

    const data = snapshot.docs[0].data();
    res.json({ status: data.status, pembayaran: data.pembayaran, checkout_url: data.checkout_url });
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
  res.send('🌿 Tabib AI Backend Aktif');
});

// === Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Tabib AI running on port ${PORT}`));
