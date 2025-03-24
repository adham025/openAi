import express from "express"
import cors  from "cors"
import OpenAI from "openai"
import {Configuration, OpenAIApi} from "openai"
import axios from "axios"
import "dotenv/config"

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, 
});

async function generateResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", 
      messages: [{ role: "user", content: prompt }],
    });

    console.log(response.choices[0].message.content);
  } catch (error) {
    console.error("Error:", error);
  }
}

generateResponse("Hello, how are you?");


let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000;

async function callGeminiAPI(message) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{ text: message }]
        }]
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    return response.data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw error;
  }
}

app.post('/chat', async (req, res) => {
  try {

    const now = Date.now();
    if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
      return res.status(429).json({ 
        error: 'Please wait a moment before sending another message',
        isRateLimit: true 
      });
    }
    lastRequestTime = now;

    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }


    try {

      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: message }],
        temperature: 0.7,
      });

      if (!completion.data.choices || completion.data.choices.length === 0) {
        throw new Error('No response from OpenAI');
      }

      res.json({ response: completion.data.choices[0].message.content });
    } catch (error) {
      console.warn('OpenAI API failed, falling back to Gemini:', error.message);
      
      try {

        const geminiResponse = await callGeminiAPI(message);
        res.json({ 
          response: geminiResponse,
          isFailover: true,
          provider: 'gemini'
        });
      } catch (fallbackError) {
        if (fallbackError.response?.data?.error?.code === 'insufficient_quota') {
          console.warn('Gemini API quota exceeded, using fallback response');

          return res.json({ 
            response: "I apologize, but the API quota has been exceeded. Please try again later or add billing information to your Gemini account.",
            isFailover: true
          });
        }
        throw new Error('Both APIs failed');
      }
    }
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: 'Error communicating with AI services',
      details: error.message 
    });
  }
});


app.use((err, req, res, next) => {

  res.status(500).json({ 
    status: "fail",
    message: "internal server error",
    error: err.message 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
