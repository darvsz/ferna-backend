import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(cors()); // penting biar bisa diakses dari netlify
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
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const result = response.data.output || response.data.choices?.[0]?.text || 'Tidak ada balasan.';
    res.json({ reply: result });

  } catch (err) {
    res.status(500).json({ reply: 'Error: ' + err.message });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
