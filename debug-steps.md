# Console Capture Pro Debugging Guide

## Step 1: Check VSCode Extension
1. Open VSCode
2. Press `Cmd+Shift+P`
3. Type: `Console Capture: Start Console Capture Server`
4. If this command doesn't exist, the extension isn't loaded properly

## Step 2: Check Chrome Extension  
1. Open Chrome
2. Go to `chrome://extensions/`
3. Find "ConsoleCapture Pro" 
4. Click "Details" → "Inspect views: background page"
5. Check console for errors

## Step 3: Test Integration
1. Start VSCode extension server first
2. Load Chrome extension 
3. Go to any webpage
4. Open extension popup
5. Click "Start Capturing"
6. Type in browser console: `console.log("test")`

## Common Error Messages & Solutions

### "Command not found"
- VSCode extension isn't loaded
- Solution: Reinstall with `code --install-extension`

### "WebSocket connection failed"
- VSCode server not started
- Solution: Start server first, then load Chrome extension

### "Content script not injected"
- Chrome extension permissions issue
- Solution: Check manifest permissions

### "Port 8765 in use" 
- Another process using the port
- Solution: `lsof -i :8765` then kill process

## If Still Having Issues
Please share:
1. Exact error message
2. Which extension (VSCode or Chrome)
3. Browser/VSCode console logs