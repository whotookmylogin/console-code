# Testing Instructions for ConsoleCapture Pro

## Issue Fixed
The browser extension wasn't building correctly due to a missing WXT format in the background script. This has been fixed and the extension has been rebuilt.

## How to Test

### 1. Load the Browser Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked"
4. Navigate to `/Users/joethomas/Documents/dev/apps/console-code/.output/chrome-mv3/`
5. Select this folder and click "Select"
6. The ConsoleCapture Pro extension should now appear in your extensions list

### 2. Test the VS Code Extension

1. Open VS Code
2. Open the VS Code extension folder: `/Users/joethomas/Documents/dev/apps/console-code/vscode-extension/`
3. Press `F5` to launch a new VS Code window with the extension loaded
4. In the new VS Code window, you should see the Console Capture Pro icon in the activity bar
5. Click on it to open the Console Capture panel
6. The WebSocket server should start automatically (check the status bar)

### 3. Test the Integration

1. With both extensions loaded:
   - Open any website in Chrome
   - Click the ConsoleCapture Pro extension icon in Chrome
   - Click "Start Capture" button
   - You should see a red indicator on the webpage showing capture is active
   
2. To verify console capture:
   - Open the browser developer console (F12)
   - Type some test commands:
     ```javascript
     console.log("Test log message");
     console.error("Test error message");
     console.warn("Test warning message");
     ```
   
3. Check if logs appear in:
   - The Chrome extension popup (recent logs section)
   - The VS Code extension panel (if "Stream to VSCode" is enabled)

### 4. Troubleshooting

If the "Start Capture" button still doesn't work:

1. **Check Chrome Console for Errors:**
   - Right-click the extension icon → "Inspect popup"
   - Check the Console tab for any errors

2. **Verify Content Script Injection:**
   - Open any webpage
   - Open Developer Tools (F12)
   - Go to Console
   - Type: `window.consoleCapturePro`
   - If undefined, the content script isn't being injected

3. **Check Background Script:**
   - Go to `chrome://extensions/`
   - Find ConsoleCapture Pro
   - Click "Service Worker" link
   - Check console for errors

4. **WebSocket Connection:**
   - Ensure VS Code extension is running (F5 in VS Code)
   - Check if port 8765 is available: `lsof -i :8765`
   - The VS Code status bar should show "Console Capture: Active"

## What Was Fixed

1. **Background Script Format:** Updated to use WXT's `defineBackground()` wrapper
2. **Build Process:** Successfully rebuilt the extension with proper manifest and content scripts
3. **Content Script:** Verified it's properly included in the manifest for all URLs

The extension should now work correctly. The "Start Capture" button will inject the capture functionality into the current webpage and begin logging console output.