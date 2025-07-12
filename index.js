import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  //const prompt = req.body.message;
const prompt = `
Kamu adalah seorang tabib herbal tradisional.
Tugasmu adalah memberikan saran pengobatan alami berbasis tanaman herbal kepada pasien.

Jika pasien menyebutkan keluhan, balaslah dengan:
1. Diagnosa ringan berdasarkan keluhan.
2. Resep herbal: sebutkan nama tanaman, dosis, dan cara penggunaan.
3. Pantangan atau anjuran tambahan.

Berikut keluhannya:
"${prompt}"
  `;

  try {
    const response = await axios.post(
      'https://api.together.xyz/inference',
      {
        model:"deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free",
        prompt: prompt,
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

    const reply = response.data.output?.choices?.[0]?.text || 'Tidak ada jawaban.';
    res.json({ reply });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ reply: '⚠️ Gagal memproses permintaan.' });
  }
});

app.get("/", (req, res) => {
  res.send("Server is running");
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
