# Console Capture Pro - VSCode Extension

Real-time console log streaming from your browser directly into VSCode. This extension works in conjunction with the Console Capture Pro browser extension to provide seamless debugging workflows.

## Features

- 🔄 **Real-time Streaming**: Console logs appear instantly in VSCode as they happen in your browser
- 🎯 **Clickable Stack Traces**: Click on error stack traces to jump directly to source code  
- 🌐 **Multi-Session Support**: Handle multiple browser tabs/sessions simultaneously
- 🎨 **Syntax Highlighting**: Color-coded log levels (error, warning, info, log)
- 💾 **Export Capabilities**: Save debug sessions as JSON or text files
- ⚡ **Auto-reconnect**: Automatically reconnects to browser extension
- 🔍 **Tree View**: Organized display of sessions and logs in VSCode Explorer

## Quick Start

1. **Install the Extension**: Install this VSCode extension
2. **Start the Server**: Use `Ctrl+Shift+P` → "Console Capture: Start Server" 
3. **Configure Browser**: In the browser extension, check "Stream to VSCode"
4. **Start Debugging**: Begin console capture in your browser - logs will stream live to VSCode!

## How It Works

```
Browser Extension → WebSocket (localhost:8765) → VSCode Extension → Tree View
```

The browser extension captures console logs and streams them via WebSocket to VSCode, where they appear in a dedicated tree view with full debugging context.

## Extension Commands

- `Console Capture: Start Server` - Start the WebSocket server (default port 8765)
- `Console Capture: Stop Server` - Stop the WebSocket server  
- `Console Capture: Clear Logs` - Clear all captured console logs
- `Console Capture: Export Logs` - Export logs to JSON file

## Configuration

```json
{
  "consoleCapture.port": 8765,           // WebSocket server port
  "consoleCapture.autoStart": true,      // Auto-start server when VSCode opens  
  "consoleCapture.maxLogs": 1000         // Maximum logs to keep in memory
}
```

## Development

To build and run the extension:

```bash
cd vscode-extension
npm install
npm run compile
```

Then press F5 in VSCode to launch the extension development host.

## Requirements

- VSCode 1.74.0 or higher
- Console Capture Pro browser extension
- Node.js 18+ for development