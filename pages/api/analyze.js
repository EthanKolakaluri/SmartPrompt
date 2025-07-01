import { OpenAI } from 'openai';
import { 
  MODEL_CONFIG,
  PROMPT_TEMPLATES 
} from './background.js';
import rateLimit from 'express-rate-limit';

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

// Create the rate-limited handler
const applyRateLimit = (handler) => limiter(handler);

// Main API handler function
export default async function handler(req, res) {
  // Apply rate limiting
  const rateLimited = applyRateLimit(async (req, res) => {
    // CORS configuration
    const allowedOrigins = [
      'https://your-frontend.com',
      process.env.NODE_ENV === 'development' && 'http://localhost:3000'
    ].filter(Boolean);
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    
    // Handle OPTIONS for preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Main request handling
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const authToken = req.headers.authorization?.split(' ')[1];
    if (!authToken) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { 
        content,
        isChunked = false,
        isBegin = false,
        isEnd = false,
        chunkIndex = 0,
        totalChunks = 1,
      } = req.body;

      // Calculate dynamic values
      const chunkedWords = Math.round((MODEL_CONFIG.maxOptimalTokenLen / (totalChunks || 1)) * 0.75);

      // Select template
      let prompt;
      if (isChunked && isBegin) {
        prompt = PROMPT_TEMPLATES.beginChunked(chunkIndex, totalChunks, chunkedWords);
      } else if (isChunked && isEnd) {
        prompt = PROMPT_TEMPLATES.endChunked(chunkIndex, totalChunks, chunkedWords);
      } else if (isChunked) {
        prompt = PROMPT_TEMPLATES.chunked(chunkIndex, totalChunks, chunkedWords);
      } else {
        prompt = PROMPT_TEMPLATES.regular(MODEL_CONFIG.optimalTokenLen);
      }

      // OpenAI API call
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a prompt analysis engine. Return ONLY valid JSON." },
          { role: "user", content: `${prompt}\n\n${isChunked ? 'Chunk Content' : 'Prompt'}: ${content}` }
        ],
        temperature: 0.4,
        max_tokens: MODEL_CONFIG.maxOptimalTokenLen,
        response_format: { type: "json_object" }
      });

      // Process response
      const result = JSON.parse(completion.choices[0].message.content);
      res.status(200).json({
        Evaluation: {
          Accuracy: Math.max(0, Math.min(100, result.Evaluation?.Accuracy || 0)),
          Suggestions: result.Evaluation?.Suggestions?.slice(0, 3) || []
        },
        Optimization: {
          Reword: result.Optimization?.Reword?.trim() || ""
        }
      });

    } catch (error) {
      console.error("API Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Execute the rate-limited handler
  return rateLimited(req, res);
}
