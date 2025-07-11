const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

app.post('/ask', async (req, res) => {
  const prompt = req.body.prompt;

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

    res.json({ result: response.data.choices[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Running on port 3000'));
