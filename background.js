import * as tiktoken from '@dqbd/tiktoken';

// Configuration Constants
export const MODEL_CONFIG = {
  model: "gpt-4o",
  temperature: 0.4,
  max_tokens: 128000,
  optimalTokenLen: 4820,
  maxOptimalTokenLen: 9820,
};

export const PROMPT_TEMPLATES = {
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

let encoding

async function getEncoding() {
  if (!encoding) {
    try {
        const wasmResponse = await fetch('https://tiktoken.pages.dev/tiktoken_bg.wasm');
        encoding = await tiktoken.get_encoding('cl100k_base', {
          wasm: new Uint8Array(await wasmResponse.arrayBuffer())
        });
    } catch (error) {
      console.error("Failed to initialize tokenizer:", error);
          throw new Error("Tokenizer initialization failed");
    }
  }
  return encoding; // Reuse this everywhere
}

async function callAnalysisAPI(content, isChunked = false, chunkInfo = {}) {
  const userToken = await chrome.identity.getAuthToken({ interactive: true });
  
  const response = await fetch('https://your-backend.com/analyze-prompt', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content, // Changed from 'prompt' for consistency
      isChunked,
      ...chunkInfo, // { isBegin, isEnd, chunkIndex, totalChunks, tokenLen}
      modelConfig: MODEL_CONFIG,
      template: isChunked 
          ? PROMPT_TEMPLATES[chunkInfo.type || 'chunked'] 
          : PROMPT_TEMPLATES.regular
    })
  });
  
  if (!response.ok) throw new Error(await response.text());
  return validateUnifiedResponse(await response.json());
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

    try {
        const { prompt } = request;

        if (!prompt?.trim()) {
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
        const encoder = await getEncoding();
        const tokens = encoder.encode(prompt);
        const tokenCount = tokens.length;

        const MAX_TOKENS_SINGLE = maxOptimalTokenLen;
        const TOKEN_LIMIT = max_tokens-(0.0625 * max_tokens);
        const CHUNKS = Math.ceil(tokenCount/maxOptimalTokenLen);

        if (tokenCount >= TOKEN_LIMIT) {
            throw new Error(`Input exceeds ${TOKEN_LIMIT} token limit (has ${tokenCount} tokens)`);
        }
        
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
                
                const chunkText = encoder.decode(tokens.slice(
                  i * maxOptimalTokenLen,
                  Math.min((i + 1) * maxOptimalTokenLen, tokenCount)
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
              accuracy: Math.round(cumulative.accuracy * 10) / 10,
              suggestions: Array.from(cumulative.suggestions),
              reword: cumulative.reworded.join("\n\n"),
              wasChunked: true,
              tokenCount: tokenCount
            }

            sendResponse(validateUnifiedResponse(finalResponse));

        } else if (tokenCount < MAX_TOKENS_SINGLE) {
            // Process normally (unchanged)
            const result = validateUnifiedResponse(await callAnalysisAPI(prompt, false));
            const finalResponse = {
              accuracy: result.Evaluation.Accuracy,
              suggestions: result.Evaluation.Suggestions,
              reword: result.Optimization.Reword,
              wasChunked: false,
              tokenCount: tokenCount
            }
            sendResponse(validateUnifiedResponse(finalResponse));
        }        

    } catch (error) {
        console.error("Analysis Error:", error);
        sendResponse({
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
