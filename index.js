import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  const prompt = req.body.message;

  try {
    const response = await axios.post(
      'https://api.together.xyz/inference',
      {
        model: 'meta-llama/Llama-3-8B-Instruct',
        prompt: `Kamu adalah ahli herbal. ${prompt}`,
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

    const reply = response.data.output || response.data.choices?.[0]?.text || 'Tidak ada jawaban.';
    res.json({ reply });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ reply: '⚠️ Gagal memproses permintaan.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
