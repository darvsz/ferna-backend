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
const statusMap = {}; // Simpan status pasien

// === MQTT Setup
const mqttClient = mqtt.connect(process.env.MQTT_BROKER, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS
});

mqttClient.on('connect', () => {
  console.log('📡 Terhubung ke HiveMQ!');
  mqttClient.subscribe('tabibai/status', err => {
    if (err) console.error('❌ Gagal subscribe:', err.message);
    else console.log('📡 Subscribed ke tabibai/status');
  });
});

mqttClient.on('error', err => console.error('❌ MQTT Error:', err.message));

// === Terima pesan dari MQTT dan update status
mqttClient.on('message', (topic, message) => {
  if (topic === 'tabibai/status') {
    try {
      const data = JSON.parse(message.toString());
      if (data.nama && data.status === 'done') {
        console.log(`✅ Resep ${data.nama} selesai via MQTT`);
        statusMap[data.nama.toLowerCase()] = 'done';
      }
    } catch (e) {
      console.error('❌ Gagal parsing pesan MQTT:', e.message);
    }
  }
});

function kirimKeESP32(resepData) {
  mqttClient.publish('tabibai/resep', JSON.stringify(resepData), { qos: 1 });
}

// === Endpoint chat
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
          { role: 'system', content: `Kamu adalah tabib ahli herbal. Jawab hanya dengan resep herbal dalam format JSON. Jangan berikan penjelasan atau kalimat tambahan.` },
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
    statusMap[nama.toLowerCase()] = 'processing'; // tandai sebagai diproses
    kirimKeESP32(resepTerakhir);

    res.json({ status: "✅ Resep dikirim ke tabib. Menunggu proses.", resep: output });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ reply: '⚠️ Gagal menghubungi tabib AI.' });
  }
});

// === Endpoint status pasien
app.get('/status', (req, res) => {
  const nama = (req.query.nama || '').toLowerCase();
  if (!nama) return res.status(400).json({ status: 'error', message: 'Nama dibutuhkan' });

  const status = statusMap[nama];
  res.json({ status: status || 'not_found' });
});

app.get('/', (req, res) => {
  res.send('🌿 Tabib AI Backend Aktif');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Tabib AI running on port ${PORT}`));
