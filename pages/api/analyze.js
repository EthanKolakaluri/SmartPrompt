import { OpenAI } from 'openai';

// Configuration Constants
const MODEL_CONFIG = {
  model: "gpt-4o",
  temperature: 0.4,
  max_tokens: 128000,
  optimalTokenLen: 4820,
  maxOptimalTokenLen: 9820,
};

const PROMPT_TEMPLATES = {
  regular: `Analyze and optimize this prompt by doing the following: 

        **1. Evaluation (JSON):**
        - Accuracy contribution (0-100%) based on this chunk's Clarity (40%), Specificity (30%), Relevance (30%)
        - 3 NEW suggestions for improvement (don't repeat previous ones)

        **2. Optimization (JSON):**
        - A reworded version of this in (${(MODEL_CONFIG.optimalTokenLen*4)/3}) words

        Return EXACTLY:
        {
            "Evaluation": {
                "Accuracy": X,
                "Suggestions": ["...", "...", "..."]
            },
            "Optimization": {
                "Reword": "..."
            }
        }`,

  beginChunked: (chunkIndex, totalChunks, words) => `Analyze and optimize this prompt chunk (${chunkIndex + 1}/${totalChunks}) in (${words}) words by adding to (NOT replacing) the cumulative analysis:

      **1. Evaluation (JSON):**
       - Accuracy contribution (0-100%) based on this chunk's Clarity (40%), Specificity (30%), Relevance (30%)
       - 3 NEW suggestions for improvement (don't repeat previous ones)

      **2. Optimization (JSON):**
       - A reworded version of JUST THIS CHUNK, assume this is the first chunk in the batch and other chunks will follow this one.

      Return EXACTLY:
      {
          "Evaluation": {
              "Accuracy": X,
              "Suggestions": ["...", "...", "..."]
          },
          "Optimization": {
              "Reword": "..."
          }
      }`,

  endChunked: (chunkIndex, totalChunks, words) => `Analyze and optimize this prompt chunk (${chunkIndex + 1}/${totalChunks}) in (${words}) words by adding to (NOT replacing) the cumulative analysis:

      **1. Evaluation (JSON):**
       - Accuracy contribution (0-100%) based on this chunk's Clarity (40%), Specificity (30%), Relevance (30%)
       - 3 NEW suggestions for improvement (don't repeat previous ones)

      **2. Optimization (JSON):**
       - A reworded version of JUST THIS CHUNK, assume this is the last chunk needed. So end it strong.

      Return EXACTLY:
      {
          "Evaluation": {
              "Accuracy": X,
              "Suggestions": ["...", "...", "..."]
          },
          "Optimization": {
              "Reword": "..."
          }
      }`,

  chunked: (chunkIndex, totalChunks, words) => `Analyze and optimize this prompt chunk (${chunkIndex + 1}/${totalChunks}) in (${words}) words by adding to (NOT replacing) the cumulative analysis:

        **1. Evaluation (JSON):**
        - Accuracy contribution (0-100%) based on this chunk's Clarity (40%), Specificity (30%), Relevance (30%)
        - 3 NEW suggestions for improvement (don't repeat previous ones)

        **2. Optimization (JSON):**
        - A reworded version of JUST THIS CHUNK, assume this chunk is building off the previous chunk and will have content following afterwards.

        Return EXACTLY:
        {
            "Evaluation": {
                "Accuracy": X,
                "Suggestions": ["...", "...", "..."]
            },
            "Optimization": {
                "Reword": "..."
            }
        }`
};

// Option 1: Using Tiktoken Lite (Recommended for Vercel)
async function getTokenCount(prompt) {
  try {
    const { Tiktoken } = await import('@dqbd/tiktoken/lite');
    const cl100k_base = await import('@dqbd/tiktoken/encoders/cl100k_base.json');
    
    const encoding = new Tiktoken(
      cl100k_base.bpe_ranks,
      cl100k_base.special_tokens,
      cl100k_base.pat_str
    );
    
    const tokens = encoding.encode(prompt);
    const tokenCount = tokens.length;
    encoding.free(); // Important to prevent memory leaks
    
    return tokenCount;
  } catch (error) {
    console.error("Token counting error:", error);
    // Fallback to approximate counting if Tiktoken fails
    return Math.ceil(prompt.length / 4); // Rough estimate (~4 chars per token)
  }
}

async function callAnalysisAPI(content, isChunked = false, chunkInfo = {}) {
  
try {
    // Calculate dynamic values
    const chunkedWords = Math.round((MODEL_CONFIG.maxOptimalTokenLen / (chunkInfo.totalChunks || 1)) * 0.75);

    // Select and generate template
    let prompt;
    if (isChunked && chunkInfo.isBegin) {
      prompt = PROMPT_TEMPLATES.beginChunked(chunkInfo.chunkIndex, chunkInfo.totalChunks, chunkedWords);
    } else if (isChunked && chunkInfo.isEnd) {
      prompt = PROMPT_TEMPLATES.endChunked(chunkInfo.chunkIndex, chunkInfo.totalChunks, chunkedWords);
    } else if (isChunked) {
      prompt = PROMPT_TEMPLATES.chunked(chunkInfo.chunkIndex, chunkInfo.totalChunks, chunkedWords);
    } else {
      prompt = PROMPT_TEMPLATES.regular;
    }

    // OpenAI call
    const openai = new OpenAI({apiKey: process.env.API_KEY});
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
  
    // Validate and return response
    return validateUnifiedResponse(completion.choices[0].message.content);

  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
}

// Rate limiting
const RATE_LIMIT = new Map();
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second

export default async function handler(req, res) {

 // CORS dynamic input handling
  const allowedOrigins = [
    'https://your-frontend.com',
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000'] : []),
    /^chrome-extension:\/\/.*/ 
  ].filter(Boolean);
  
  const origin = req.headers.origin;
  
  // Fixed origin check (supports regex)
  if (allowedOrigins.some(allowed => 
    typeof allowed === 'string' 
      ? allowed === origin 
      : allowed.test(origin)
  )) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // Cache safety
  } else {
     return res.status(403).json({ 
      error: "Forbidden: Origin not allowed",
      receivedOrigin: origin // Optional (for debugging)
      });
  }
  
  // Standard CORS headers
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // ◀◀◀ Added OPTIONS
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Auth and validation
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

     const startTime = Date.now();

    try {
        const { prompt } = req.body;

        if (!prompt?.trim()) {
          throw new Error("Prompt cannot be empty");
        }

        // Initialize tiktoken
        const tokenCount = await getTokenCount(prompt);

        const MAX_TOKENS_SINGLE = MODEL_CONFIG.maxOptimalTokenLen;
        const TOKEN_LIMIT = MODEL_CONFIG.max_tokens-(0.0625 * MODEL_CONFIG.max_tokens);
        const CHUNKS = Math.ceil(tokenCount/MODEL_CONFIG.maxOptimalTokenLen);

        if (tokenCount >= TOKEN_LIMIT) {
            throw new Error(`Input exceeds ${TOKEN_LIMIT} token limit (has ${tokenCount} tokens)`);
        }
        
        if (tokenCount >= MODEL_CONFIG.optimalTokenLen * 0.75 && tokenCount <= MODEL_CONFIG.optimalTokenLen * 1.25) {
              return res.json({
                type: 'no_optimization_needed',
                message: 'Prompt is already within optimal token range',
                tokenCount
            });
        }

        if (tokenCount >= MAX_TOKENS_SINGLE) {
            // NEW: Token-based chunking
            let cumulative = {
                accuracy: 0,
                suggestions: new Set(),
                reworded: []
            };

            for (let i = 0; i < CHUNKS; i++) {
                
                const chunkText = encoder.decode(tokens.slice(
                  i * MODEL_CONFIG.maxOptimalTokenLen,
                  Math.min((i + 1) * MODEL_CONFIG.maxOptimalTokenLen, tokenCount)
                ));
          
                const result = await callAnalysisAPI(chunkText, true, {
                  type: i === 0 ? 'beginChunked' : 
                        i === CHUNKS-1 ? 'endChunked' : 'chunked',
                  isBegin: i === 0,
                  isEnd: i === CHUNKS-1,
                  chunkIndex: i,
                  totalChunks: CHUNKS,
                });

                cumulative.accuracy += result.Evaluation.Accuracy / CHUNKS;
                result.Evaluation.Suggestions.forEach(s => cumulative.suggestions.add(s));
                cumulative.reworded.push(result.Optimization.Reword);
            }

            const finalResponse = {
               Evaluation: {
                  Accuracy: Math.round(cumulative.accuracy * 10) / 10,
                  Suggestions: Array.from(cumulative.suggestions)
                },
                Optimization: {
                  Reword: cumulative.reworded.join("\n\n")
                }
            }

            return res.send(validateUnifiedResponse(finalResponse));

        } else if (tokenCount < MAX_TOKENS_SINGLE) {
            // Process normally (unchanged)
            const result = validateUnifiedResponse(await callAnalysisAPI(prompt, false));
            return res.json(result);
        }        

    } catch (error) {
        console.error("Analysis Error:", error);
        return res.status(500).json({
            type: 'analysis_error',
            error: error.message,
            tokenCount,
            durationMs: Date.now() - startTime
        });
    } 
}

// Same validateUnifiedResponse as before
function validateUnifiedResponse(data) {
    try {
        // Handle both raw API responses and pre-parsed objects
        let content;
        if (typeof data === 'string') {
            // Case 1: Raw API response (string)
            if (data.includes('> ')) {
                throw new Error("Blockquotes are unsupported");
            }
            content = JSON.parse(data);
        } else if (data.choices?.[0]?.message?.content) {
            // Case 2: Raw API response (object)
            const rawContent = data.choices[0].message.content;
            if (typeof rawContent === 'string' && rawContent.includes('> ')) {
                throw new Error("Blockquotes are unsupported");
            }
            content = JSON.parse(rawContent);
        } else {
            // Case 3: Already parsed final response
            content = data;
        }
        
        // Validate required fields
        if (content.Optimization?.Reword == null) { // Checks both null and undefined
            content.Optimization = content.Optimization || {};
            content.Optimization.Reword = "";
        } else if (typeof content.Optimization.Reword !== 'string') {
            throw new Error("Reword must be a string if provided");
        }

        return content;

    } catch (e) {
        console.error("Validation Error:", e);
        return {
            Evaluation: { Accuracy: 0, Suggestions: [] },
            Optimization: { Reword: "" }
        };
    }
}
