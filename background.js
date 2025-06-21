// First, add tiktoken to your project: npm install tiktoken
import { encoding_for_model } from 'tiktoken';

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
        - A reworded version of this in (${(optimalTokenLen*4)/3}) words

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

chrome.storage.sync.set({apiKey: "Replace this text with your API Key"});


//INCLUDE FUNCTION TO SCAN CHATGPT URL HERE


// Cache encoder instance
let encoder;
async function getEncoder() {
  if (!encoder) {
    encoder = encoding_for_model("gpt-4o");
  }
  return encoder;
}

// Add at module level:
let encoderUsers = 0;

// Add before any encoder usage:
chrome.runtime.onSuspend.addListener(() => {
  if (encoder) {
    encoder.free();
    encoder = null;
    encoderUsers = 0;
  }
});

function releaseEncoder() {
    encoderUsers--;
    if (encoderUsers === 0 && encoder) {
      encoder.free();
      encoder = null;
    }
}

// Rate limiting
const RATE_LIMIT = new Map();
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "analyzePrompt") {
      handlePromptAnalysis(request, sender, sendResponse);
      return true; // Required for async sendResponse
    }
  });

  async function handlePromptAnalysis(request, sender, sendResponse) {
    const startTime = Date.now();
    let tokenCount = 0;

    try {
        const { apiKey } = await chrome.storage.sync.get('apiKey');
        const { prompt } = request;

        if (!apiKey || !apiKey.startsWith('sk-') || apiKey.length < 32) {
            throw new Error("Invalid API key format");
        }

        if (!prompt || prompt.trim().length === 0) {
          throw new Error("Prompt cannot be empty");
        }

        // Rate limiting
        const senderId = sender?.origin || 'unknown';
        const lastRequest = RATE_LIMIT.get(senderId);
        if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_WINDOW_MS) {
        throw new Error("Rate limit exceeded (1 request/second)");
        }
        RATE_LIMIT.set(senderId, Date.now());

        // Initialize tiktoken
        const enc = await getEncoder();
        encoderUsers++;
        const tokens = enc.encode(prompt);
        const tokenCount = tokens.length;

        const MAX_TOKENS_SINGLE = maxOptimalTokenLen;
        const TOKEN_LIMIT = max_tokens-(0.0625 * max_tokens);
        const CHUNKS = Math.ceil(tokenCount/maxOptimalTokenLen);
        const chunkedWords = Math.round(((maxOptimalTokenLen/CHUNKS)*4)/3);

        if (tokenCount >= TOKEN_LIMIT) {
            throw new Error(`Input exceeds ${TOKEN_LIMIT} token limit (has ${tokenCount} tokens)`);
        }

        // Process single chunk
        const processChunk = async (content, isChunked = false, isBegin = false, isEnd = false, chunkIndex = 0, totalChunks = 1) => {
            
            let prompt; 

            if (isChunked && isBegin)
              prompt = PROMPT_TEMPLATES.beginChunked(chunkIndex, totalChunks, chunkedWords);
            else if (isChunked && isEnd)
              prompt = PROMPT_TEMPLATES.endChunked(chunkIndex, totalChunks, chunkedWords);
            else if (isChunked)
              prompt = PROMPT_TEMPLATES.chunked(chunkIndex, totalChunks, chunkedWords);
            else
              prompt = PROMPT_TEMPLATES.regular;

            
            try {
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: MODEL_CONFIG.model,
                    messages: [
                        {
                            role: "system",
                            content: "You are a prompt analysis engine. Return ONLY valid JSON."
                        },
                        {
                            role: "user",
                            content: `${prompt}\n\n${isChunked ? 'Chunk Content' : 'Prompt'}: ${content}`
                        }
                    ],
                    temperature: MODEL_CONFIG.temperature,
                    max_tokens: MODEL_CONFIG.max_tokens,
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            return await response.json();
            
            } catch (error) {
                throw error;
            }
        };
        
        if (tokenCount >= optimalTokenLen * 0.75 && tokenCount <= optimalTokenLen * 1.25) {
              sendResponse({
                type: 'no_optimization_needed',
                message: 'Prompt is already within optimal token range',
                tokenCount
            });
            return;
        }

        if (tokenCount >= MAX_TOKENS_SINGLE) {
            // NEW: Token-based chunking
            let cumulative = {
                accuracy: 0,
                suggestions: new Set(),
                reworded: []
            };

            for (let i = 0; i < CHUNKS; i++) {
                const start = i * maxOptimalTokenLen;
                const end = Math.min((i + 1) * maxOptimalTokenLen, tokenCount);
                const chunkTokens = tokens.slice(start, end);
                const actualChunkTokens = chunkTokens.length;
                const chunkText = new TextDecoder().decode(enc.decode(chunkTokens));

                // Verify chunk token count
                if (actualChunkTokens > maxOptimalTokenLen) {
                    throw new Error(`Chunk ${i+1} too large (${actualChunkTokens} tokens)`);
                }
                
                if (i == 0) {
                  result = validateUnifiedResponse(await processChunk(chunkText, true, true, false, i, CHUNKS));
                } else if (i == CHUNKS-1) {
                  result = validateUnifiedResponse(await processChunk(chunkText, true, false, true, i, CHUNKS));
                } else {
                  result = validateUnifiedResponse(await processChunk(chunkText, true, false, false, i, CHUNKS));
                }
                cumulative.accuracy += result.Evaluation.Accuracy / CHUNKS;
                result.Evaluation.Suggestions.forEach(s => cumulative.suggestions.add(s));
                cumulative.reworded.push(result.Optimization.Reword);
            }

            const finalResponse = {
              accuracy: Math.round(cumulative.accuracy * 10) / 10,
              suggestions: Array.from(cumulative.suggestions),
              reword: cumulative.reworded.join("\n\n"),
              wasChunked: true,
              tokenCount: tokenCount
            }

            sendResponse(finalResponse);

        } else if (tokenCount < MAX_TOKENS_SINGLE) {
            // Process normally (unchanged)
            const result = validateUnifiedResponse(await processChunk(prompt));
            const finalResponse = {
              accuracy: result.Evaluation.Accuracy,
              suggestions: result.Evaluation.Suggestions,
              reword: result.Optimization.Reword,
              wasChunked: false,
              tokenCount: tokenCount
            }
            sendResponse(finalResponse);
        }        

    } catch (error) {
        console.error("Analysis Error:", error);
        sendResponse({
            type: 'analysis_error',
            error: error.message,
            tokenCount,
            durationMs: Date.now() - startTime
        });
    } finally {
        releaseEncoder();
    }
}

// Same validateUnifiedResponse as before
function validateUnifiedResponse(data) {
    try {

        // Handle both direct API responses and potential stringified JSON
        const rawContent = typeof data === 'string' ? data : 
                          data.choices?.[0]?.message?.content || '{}';
        
        if (data.includes('> ')) {
            throw new Error("Blockquotes are unsupported");
        }
        
        const content = JSON.parse(rawContent);
        
        // Validate chunked vs unified responses
        const isChunked = content.Evaluation?.Accuracy !== undefined && 
                         content.Optimization?.Reword !== undefined;

        // Validate required fields
        if (typeof content.Optimization?.Reword !== 'string') {
            throw new Error("Missing required Reword field");
        }
  
      return {
        Evaluation: {
          Accuracy: Math.round(
            Math.max(0, Math.min(100, content.Evaluation?.Accuracy || 0))
          ),
          Suggestions: [...new Set(
            (content.Evaluation?.Suggestions || [])
              .slice(0, 3)
              .filter(s => typeof s === 'string' && s.length > 0)
          )]
        },
        Optimization: {
          Reword: content.Optimization.Reword.trim()
        }
      };

    } catch (e) {
        console.error("Validation Error:", e);
        return {
            Evaluation: { Accuracy: 0, Suggestions: [] },
            Optimization: { Reword: "" }
        };
    }
}