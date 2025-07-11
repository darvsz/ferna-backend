const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post("/ask", async (req, res) => {
  const { message } = req.body;

  try {
    const response = await axios.post("https://api.together.xyz/v1/chat/completions", {
      model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
      messages: [{ role: "user", content: message }],
    }, {
      headers: {
        Authorization: `Bearer cfffad636a440c87473cef1e709c8e4da85a9b306db7cd9740add32868839bc4`,
        "Content-Type": "application/json",
      },
    });

    const reply = response.data.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Gagal memproses" });
  }
});

app.get("/", (_, res) => {
  res.send("Ferna Backend is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server is running on port", PORT);
});
