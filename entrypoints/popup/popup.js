/**
 * Popup script for ConsoleCapture Pro
 */

document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    startBtn.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) return;
            
            chrome.tabs.sendMessage(tab.id, { type: 'capture:start' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Runtime error:', chrome.runtime.lastError);
                    return;
                }
                
                if (response?.success) {
                    statusDot.classList.add('active');
                    statusText.textContent = 'Capturing';
                    startBtn.disabled = true;
                    stopBtn.disabled = false;
                } else {
                    console.error('Failed to start capture:', response);
                }
            });
        } catch (error) {
            console.error('Error starting capture:', error);
        }
    });

    stopBtn.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) return;
            
            chrome.tabs.sendMessage(tab.id, { type: 'capture:stop' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Runtime error:', chrome.runtime.lastError);
                    return;
                }
                
                if (response?.success) {
                    statusDot.classList.remove('active');
                    statusText.textContent = 'Not capturing';
                    startBtn.disabled = false;
                    stopBtn.disabled = true;
                    console.log('Captured logs:', response.session?.logs);
                } else {
                    console.error('Failed to stop capture:', response);
                }
            });
        } catch (error) {
            console.error('Error stopping capture:', error);
        }
    });

    // Check initial status
    setTimeout(() => {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (!tab?.id) return;
            
            chrome.tabs.sendMessage(tab.id, { type: 'capture:status' }, (response) => {
                if (chrome.runtime.lastError) {
                    // Content script might not be ready yet
                    return;
                }
                
                if (response?.success && response.status?.isCapturing) {
                    statusDot.classList.add('active');
                    statusText.textContent = 'Capturing';
                    startBtn.disabled = true;
                    stopBtn.disabled = false;
                }
            });
        });
    }, 100);
});