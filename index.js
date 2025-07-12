import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

let resepTerakhir = null;  // Simpan data terakhir untuk ESP32

app.post('/chat', async (req, res) => {
  const { nama, keluhan } = req.body;

  if (!nama || !keluhan) {
    return res.status(400).json({ reply: '❌ Nama dan keluhan wajib diisi.' });
  }

  try {
    const response = await axios.post(
      'https://api.together.xyz/inference',
      {
        model: "meta-llama/Llama-3-8B-Instruct",  // Atau model gratis kamu
        prompt: `Kamu adalah tabib ahli herbal. Berikan resep herbal alami untuk keluhan berikut:\n\nNama pasien: ${nama}\nKeluhan: ${keluhan}\n\nTulis dalam format JSON per gram dan mudah dipahami untuk otomatisasi.`,
        max_tokens: 200,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const output = response.data.output || response.data.choices?.[0]?.text || 'Tidak ada jawaban.';
    
    // Simpan hasil untuk diakses ESP32
    resepTerakhir = {
      nama,
      keluhan,
      resep: output,
      timestamp: new Date().toISOString()
    };

    // Kirim ke frontend (tapi bisa kosong karena frontend tidak perlu lihat hasil)
    res.json({ status: "✅ Resep dikirim ke tabib. Menunggu proses.", resep: output });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ reply: '⚠️ Gagal menghubungi tabib AI.' });
  }
});

// === Endpoint untuk ESP32 ambil data ===
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Tabib AI running on port ${PORT}`);
});
