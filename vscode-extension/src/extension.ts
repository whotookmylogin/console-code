/**
 * Console Capture Pro - VSCode Extension
 * Real-time console log streaming from browser extensions
 */

import * as vscode from 'vscode';
import { WebSocketServer } from './webSocketServer';
import { ConsoleLogProvider } from './consoleLogProvider';

let webSocketServer: WebSocketServer | undefined;
let consoleLogProvider: ConsoleLogProvider;

/**
 * Extension activation - called when extension is activated
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Console Capture Pro is now active');
    vscode.window.showInformationMessage('Console Capture Pro extension activated!');

    // Initialize console log provider
    consoleLogProvider = new ConsoleLogProvider(context);
    
    // Register tree view
    vscode.window.createTreeView('consoleCaptureExplorer', {
        treeDataProvider: consoleLogProvider,
        showCollapseAll: true
    });

    // Register commands
    const startServerCommand = vscode.commands.registerCommand('consoleCapture.startServer', async () => {
        console.log('Starting WebSocket server command triggered');
        vscode.window.showInformationMessage('Starting Console Capture server...');
        try {
            await startWebSocketServer();
        } catch (error) {
            console.error('Failed to start server:', error);
            vscode.window.showErrorMessage(`Failed to start server: ${error}`);
        }
    });

    const stopServerCommand = vscode.commands.registerCommand('consoleCapture.stopServer', () => {
        stopWebSocketServer();
    });

    const clearLogsCommand = vscode.commands.registerCommand('consoleCapture.clearLogs', () => {
        consoleLogProvider.clearLogs();
        vscode.window.showInformationMessage('Console logs cleared');
    });

    const exportLogsCommand = vscode.commands.registerCommand('consoleCapture.exportLogs', async () => {
        await exportLogs();
    });

    // Add commands to context
    context.subscriptions.push(
        startServerCommand,
        stopServerCommand,
        clearLogsCommand,
        exportLogsCommand
    );

    // Auto-start server if configured
    const config = vscode.workspace.getConfiguration('consoleCapture');
    if (config.get('autoStart')) {
        startWebSocketServer();
    }

    // Update status bar
    updateStatusBar();
}

/**
 * Start the WebSocket server for receiving console logs
 */
async function startWebSocketServer(): Promise<void> {
    if (webSocketServer?.isRunning()) {
        vscode.window.showWarningMessage('Console Capture server is already running');
        return;
    }

    try {
        const config = vscode.workspace.getConfiguration('consoleCapture');
        const port = config.get<number>('port') || 8765;

        webSocketServer = new WebSocketServer(port, consoleLogProvider);
        await webSocketServer.start();

        vscode.commands.executeCommand('setContext', 'consoleCapture.serverActive', true);
        vscode.window.showInformationMessage(`Console Capture server started on port ${port}`);
        updateStatusBar();

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start Console Capture server: ${error}`);
    }
}

/**
 * Stop the WebSocket server
 */
function stopWebSocketServer(): void {
    if (webSocketServer) {
        webSocketServer.stop();
        webSocketServer = undefined;
        vscode.commands.executeCommand('setContext', 'consoleCapture.serverActive', false);
        vscode.window.showInformationMessage('Console Capture server stopped');
        updateStatusBar();
    }
}

/**
 * Export console logs to file
 */
async function exportLogs(): Promise<void> {
    const logs = consoleLogProvider.getAllLogs();
    if (logs.length === 0) {
        vscode.window.showWarningMessage('No console logs to export');
        return;
    }

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`console-logs-${new Date().toISOString().split('T')[0]}.json`),
        filters: {
            'JSON': ['json'],
            'Text': ['txt']
        }
    });

    if (uri) {
        const content = JSON.stringify(logs, null, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
        vscode.window.showInformationMessage(`Console logs exported to ${uri.fsPath}`);
    }
}

/**
 * Update status bar with server status
 */
function updateStatusBar(): void {
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    
    if (webSocketServer?.isRunning()) {
        statusBar.text = "$(debug-console) Console Capture: Active";
        statusBar.tooltip = "Console Capture server is running";
        statusBar.command = 'consoleCapture.stopServer';
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    } else {
        statusBar.text = "$(debug-console) Console Capture: Inactive";
        statusBar.tooltip = "Click to start Console Capture server";
        statusBar.command = 'consoleCapture.startServer';
    }
    
    statusBar.show();
}

/**
 * Extension deactivation
 */
export function deactivate() {
    if (webSocketServer) {
        webSocketServer.stop();
    }
}