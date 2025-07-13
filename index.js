import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

let resepTerakhir = null;  // Simpan data terakhir untuk ESP32

// === POST untuk minta resep ===
app.post('/chat', async (req, res) => {
  const nama = req.body.nama || req.body.name;
  const keluhan = req.body.keluhan || req.body.message;

  console.log('📥 Data diterima dari frontend:', { nama, keluhan });

  if (!nama || !keluhan) {
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
            content: `Kamu adalah tabib ahli herbal. Jawab hanya dengan resep herbal dalam format JSON. Jangan berikan penjelasan atau kalimat tambahan.`
          },
          {
            role: 'user',
            content: `Berikan resep herbal alami untuk:\nNama pasien: ${nama}\nKeluhan: ${keluhan}`
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

    resepTerakhir = {
      nama,
      keluhan,
      resep: output,
      timestamp: new Date().toISOString()
    };

    res.json({ status: "✅ Resep dikirim ke tabib. Menunggu proses.", resep: output });

  } catch (err) {
    console.error('API error:', err.response?.data || err.message);
    res.status(500).json({ reply: '⚠️ Gagal menghubungi tabib AI (OpenAI).' });
  }
});

// === GET untuk ambil resep terakhir (oleh ESP32 / monitoring) ===
app.get('/resep', (req, res) => {
  if (resepTerakhir) {
    res.json(resepTerakhir);
  } else {
    res.status(404).json({ message: 'Belum ada resep.' });
  }
});

// === Ping endpoint ===
app.get('/', (req, res) => {
  res.send('🌿 Tabib AI Backend Aktif');
});

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Tabib AI running on port ${PORT}`);
});
