import { OpenAI } from 'openai';
import { 
  MODEL_CONFIG,
  PROMPT_TEMPLATES 
} from './background.js';

export default async function handler(req, res) {
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://your-frontend.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  // Auth and validation
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
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
    const chunkedWords = Math.round((maxOptimalTokenLen / (totalChunks || 1)) * 0.75);

    // Select and generate template
    let prompt;
    if (isChunked && isBegin) {
      prompt = PROMPT_TEMPLATES.beginChunked(chunkIndex, totalChunks, chunkedWords);
    } else if (isChunked && isEnd) {
      prompt = PROMPT_TEMPLATES.endChunked(chunkIndex, totalChunks, chunkedWords);
    } else if (isChunked) {
      prompt = PROMPT_TEMPLATES.chunked(chunkIndex, totalChunks, chunkedWords);
    } else {
      prompt = PROMPT_TEMPLATES.regular(optimalTokenLen);
    }

    // OpenAI call
    const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a prompt analysis engine. Return ONLY valid JSON." },
        { role: "user", content: `${prompt}\n\n${isChunked ? 'Chunk Content' : 'Prompt'}: ${content}` }
      ],
      temperature: 0.4,
      max_tokens: maxOptimalTokenLen,
      response_format: { type: "json_object" }
    });

    // Validate and return response
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
}
