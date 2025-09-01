/**
 * WebSocket Server for receiving console logs from browser extension
 */

import * as WebSocket from 'ws';
import * as vscode from 'vscode';
import { ConsoleLogProvider } from './consoleLogProvider';

export interface ConsoleLogEntry {
    level: 'log' | 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
    url: string;
    stackTrace?: string;
    sourceInfo?: {
        file: string;
        line: number;
        column: number;
    };
    userAgent?: string;
    viewport?: {
        width: number;
        height: number;
    };
}

export interface SessionMessage {
    type: 'session:start' | 'log:entry';
    url?: string;
    timestamp?: string;
    userAgent?: string;
    level?: string;
    message?: string;
    stackTrace?: string;
    sourceInfo?: any;
}

export class WebSocketServer {
    private wss: WebSocket.Server | undefined;
    private port: number;
    private logProvider: ConsoleLogProvider;
    private activeSessions = new Map<WebSocket, string>();

    constructor(port: number, logProvider: ConsoleLogProvider) {
        this.port = port;
        this.logProvider = logProvider;
    }

    /**
     * Start the WebSocket server
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.wss = new WebSocket.Server({ port: this.port });

                this.wss.on('connection', (ws: WebSocket) => {
                    console.log('Console Capture: Browser extension connected');
                    
                    ws.on('message', (data: WebSocket.Data) => {
                        try {
                            const message: SessionMessage = JSON.parse(data.toString());
                            this.handleMessage(ws, message);
                        } catch (error) {
                            console.error('Console Capture: Failed to parse message:', error);
                        }
                    });

                    ws.on('close', () => {
                        const sessionId = this.activeSessions.get(ws);
                        if (sessionId) {
                            console.log(`Console Capture: Session ${sessionId} ended`);
                            this.activeSessions.delete(ws);
                            this.logProvider.endSession(sessionId);
                        }
                    });

                    ws.on('error', (error: Error) => {
                        console.error('Console Capture: WebSocket error:', error);
                    });
                });

                this.wss.on('listening', () => {
                    console.log(`Console Capture: WebSocket server listening on port ${this.port}`);
                    resolve();
                });

                this.wss.on('error', (error: Error) => {
                    console.error('Console Capture: Server error:', error);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Stop the WebSocket server
     */
    stop(): void {
        if (this.wss) {
            this.wss.close();
            this.wss = undefined;
            this.activeSessions.clear();
            console.log('Console Capture: WebSocket server stopped');
        }
    }

    /**
     * Check if server is running
     */
    isRunning(): boolean {
        return this.wss !== undefined;
    }

    /**
     * Handle incoming messages from browser extension
     */
    private handleMessage(ws: WebSocket, message: SessionMessage): void {
        switch (message.type) {
            case 'session:start':
                const sessionId = `session-${Date.now()}`;
                this.activeSessions.set(ws, sessionId);
                this.logProvider.startSession(sessionId, {
                    url: message.url || 'Unknown',
                    timestamp: message.timestamp || new Date().toISOString(),
                    userAgent: message.userAgent || 'Unknown'
                });
                vscode.window.showInformationMessage(`Console Capture: New session from ${message.url}`);
                break;

            case 'log:entry':
                const activeSessionId = this.activeSessions.get(ws);
                if (activeSessionId) {
                    const logEntry: ConsoleLogEntry = {
                        level: (message.level as any) || 'log',
                        message: message.message || '',
                        timestamp: message.timestamp || new Date().toISOString(),
                        url: message.url || 'Unknown',
                        stackTrace: message.stackTrace,
                        sourceInfo: message.sourceInfo
                    };

                    this.logProvider.addLog(activeSessionId, logEntry);

                    // Show error notifications in VSCode
                    if (logEntry.level === 'error') {
                        const action = logEntry.sourceInfo ? 'Go to Source' : undefined;
                        const options = action ? [action] : undefined;
                        vscode.window.showErrorMessage(
                            `Console Error: ${logEntry.message}`,
                            ...(options || [])
                        ).then(selection => {
                            if (selection === 'Go to Source' && logEntry.sourceInfo) {
                                this.openSourceLocation(logEntry.sourceInfo);
                            }
                        });
                    }
                }
                break;

            default:
                console.warn('Console Capture: Unknown message type:', message.type);
        }
    }

    /**
     * Open source file location in VSCode
     */
    private async openSourceLocation(sourceInfo: any): Promise<void> {
        try {
            // Try to resolve the file path
            let filePath = sourceInfo.file;
            
            // Handle different URL formats
            if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
                // For web URLs, try to find corresponding local file
                const fileName = filePath.split('/').pop();
                if (fileName) {
                    const files = await vscode.workspace.findFiles(`**/${fileName}`);
                    if (files.length > 0) {
                        filePath = files[0].fsPath;
                    }
                }
            }

            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            // Jump to the specific line
            if (sourceInfo.line) {
                const line = Math.max(0, sourceInfo.line - 1); // Convert to 0-based
                const position = new vscode.Position(line, sourceInfo.column || 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position));
            }
        } catch (error) {
            vscode.window.showWarningMessage(`Could not open source file: ${sourceInfo.file}`);
        }
    }
}