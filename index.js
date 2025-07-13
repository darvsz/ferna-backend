import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import mqtt from 'mqtt';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

let resepTerakhir = null;
let statusSementara = {}; // { "nama": "status" }

// === MQTT Setup
const mqttClient = mqtt.connect(process.env.MQTT_BROKER, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS
});
mqttClient.on('connect', () => console.log('📡 Terhubung ke HiveMQ!'));
mqttClient.on('error', err => console.error('❌ MQTT Error:', err.message));

function kirimKeESP32(resepData) {
  mqttClient.publish('tabibai/resep', JSON.stringify(resepData), { qos: 1 });
}

// === Endpoint untuk AI Chat
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
          { role: 'system', content: `Kamu adalah tabib ahli herbal. Tugasmu adalah menjawab hanya dengan **resep herbal dan gramnya dalam format JSON yang valid** Gunakan HANYA bahan herbal dari daftar berikut: jahe, kunyit, temulawak, daun mint, daun sirih, kayu manis, cengkeh, sereh, daun kelor, lada hitam. 
 contoh seperti berikut: 
{
  "jahe": "3 gram",
  "kunyit": "2 gram",
  ...
}
Tanpa penjelasan, tanpa salam pembuka atau penutup.`
},
          { role: 'user', content: `Berikan resep herbal alami untuk:\nNama pasien: ${nama}\nKeluhan: ${keluhan}` }
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
    resepTerakhir = { nama, keluhan, resep: output, timestamp: new Date().toISOString() };

    // Simpan status pasien
    statusSementara[nama.toLowerCase()] = 'proses';

    // Kirim ke ESP32 / HiveMQ
    kirimKeESP32(resepTerakhir);

    // Simulasikan pengolahan: ubah ke "done" dalam 2–5 detik
    const delay = Math.floor(Math.random() * 3000) + 6000; // 2000-5000 ms
    setTimeout(() => {
      const statusMsg = { nama, status: "done" };
      mqttClient.publish('tabibai/status', JSON.stringify(statusMsg), { qos: 1 });
      statusSementara[nama.toLowerCase()] = 'done';
      console.log(`✅ Status untuk ${nama} diubah jadi DONE via MQTT`);
    }, delay);

    res.json({ status: "✅ Resep dikirim ke tabib. Menunggu proses.", resep: output });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ reply: '⚠️ Gagal menghubungi tabib AI.' });
  }
});

// === Endpoint untuk polling status frontend
app.get('/status', (req, res) => {
  const nama = req.query.nama?.toLowerCase();
  if (!nama) return res.status(400).json({ error: 'Nama wajib dikirim sebagai query (?nama=...)' });

  const status = statusSementara[nama];
  res.json({ status: status || 'unknown' });
});

// === Endpoint untuk melihat hasil resep terakhir
app.get('/resep', (req, res) => {
  if (resepTerakhir) {
    return res.json(resepTerakhir);
  } else {
    return res.status(404).json({ message: 'Belum ada resep.' });
  }
});

// === Root route
app.get('/', (req, res) => {
  res.send('🌿 Tabib AI Backend Aktif');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Tabib AI running on port ${PORT}`));
