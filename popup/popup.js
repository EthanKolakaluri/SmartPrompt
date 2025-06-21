document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const saveButton = document.getElementById('save-key');
    const statusDiv = document.getElementById('status');
  
    // Load saved API key
    chrome.storage.sync.get(['apiKey'], (result) => {
      if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
        statusDiv.textContent = 'API key loaded';
        setTimeout(() => {
          statusDiv.textContent = '';
        }, 2000);
      }
    });
  
    // Save API key
    saveButton.addEventListener('click', () => {
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        chrome.storage.sync.set({ apiKey: apiKey }, () => {
          statusDiv.textContent = 'API key saved!';
          statusDiv.style.color = '#4CAF50';
          setTimeout(() => {
            statusDiv.textContent = '';
          }, 2000);
        });
      } else {
        statusDiv.textContent = 'Please enter an API key';
        statusDiv.style.color = '#F44336';
      }
    });
  });