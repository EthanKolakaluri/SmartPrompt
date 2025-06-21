// Track all enhanced textareas
const enhancedTextareas = new WeakSet();
let debounceTimer;

function enhanceTextarea(textarea) {
  if (enhancedTextareas.has(textarea)) return;
  enhancedTextareas.add(textarea);

  // Create UI container
  const container = document.createElement('div');
  container.className = 'prompt-optimizer-container';
  textarea.insertAdjacentElement('afterend', container);

  // Create score display
  const scoreDisplay = document.createElement('div');
  scoreDisplay.className = 'prompt-score';
  container.appendChild(scoreDisplay);

  // Create optimize button
  const optimizeBtn = document.createElement('button');
  optimizeBtn.className = 'optimize-btn';
  optimizeBtn.textContent = 'Optimize';
  optimizeBtn.disabled = true;
  optimizeBtn.style.cssText = `
    padding: 4px 8px;
    cursor: pointer;
    border: 1px solid #ddd;
    border-radius: 4px;
  `;
  container.appendChild(optimizeBtn);

  let lastResult = null;

  // Updated evaluation function
  const evaluate = async () => {
    const prompt = textarea.value.trim();
    if (!prompt) {
      scoreDisplay.textContent = 'Empty';
      optimizeBtn.disabled = true;
      return;
    }

    scoreDisplay.textContent = 'Evaluating...';
    scoreDisplay.style.color = '#FF9800';
    optimizeBtn.disabled = true;

    try {
      
      const { apiKey } = await chrome.storage.sync.get('apiKey');
      if (!apiKey) throw new Error('No API key configured');

      chrome.runtime.sendMessage(
        { action: "analyzePrompt", apiKey, prompt },
        (response) => {
          
          

          if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message);
          }
          if (response?.error) {
            throw new Error(response.error);
          }

          lastResult = {
            ...response,
            originalPrompt: prompt // Store exact analyzed text
          };
          
          updateUI(response);
        }
      );
    } catch (error) {
      console.error('Analysis failed:', error);
      scoreDisplay.textContent = error.message.slice(0, 50);
      scoreDisplay.style.color = '#F44336';
      optimizeBtn.disabled = false;
    }
  };

  const updateUI = (response) => {
    const score = response.accuracy || 0;
    const color = score >= 80 ? '#4CAF50' : 
                 score >= 60 ? '#FFC107' : '#F44336';
    
    scoreDisplay.textContent = `${score}%`;
    scoreDisplay.style.color = color;
    optimizeBtn.disabled = false;
    
    textarea.style.border = `2px solid ${color}`;
    textarea.style.boxShadow = `0 0 5px ${color}`;
  };

  optimizeBtn.addEventListener('click', async () => {
    if (!lastResult?.reword) return;
    
    const currentText = textarea.value.trim();
    const isUnchanged = currentText === lastResult.originalPrompt;
    
    if (isUnchanged) {
      // Apply cached optimization
      textarea.value = lastResult.reword;
      scoreDisplay.textContent = 'Optimized!';
      setTimeout(() => {
        scoreDisplay.textContent = `${lastResult.accuracy}%`;
      }, 1500);
    } else {
      // Notify user to re-analyze
      scoreDisplay.textContent = 'Please analyze again';
      scoreDisplay.style.color = '#FF9800';
      setTimeout(evaluate, 2000);
    }
  });

  function resetUI() {
    clearTimeout(debounceTimer);
    scoreDisplay.textContent = 'Empty';
    scoreDisplay.style.color = '';
    textarea.style.border = '';
    textarea.style.boxShadow = '';
    optimizeBtn.disabled = true;
  }

  // Debounced input handler
  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluate, 1500);
  });

  // Initial evaluation
  evaluate();

// Initialize existing textareas
document.querySelectorAll('textarea').forEach(enhanceTextarea);

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (!node.isConnected) return; 
      if (node.nodeName === 'TEXTAREA') {
        enhanceTextarea(node);
      }
      node.querySelectorAll?.('textarea').forEach(enhanceTextarea);
    });

    mutation.removedNodes.forEach((node) => {
      if (!node.isConnected) return; 
      if (node.nodeName === 'TEXTAREA' && enhancedTextareas.has(node)) {
        clearTimeout(debounceTimer);
      }
    });
  });
});

observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});

// Cleanup on extension unload
chrome.runtime.onSuspend.addListener(() => {
  observer.disconnect();
  clearTimeout(debounceTimer);
}); 
}