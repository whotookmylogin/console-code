/**
 * Console Log Tree Data Provider for VSCode Explorer
 */

import * as vscode from 'vscode';
import { ConsoleLogEntry } from './webSocketServer';

interface SessionInfo {
    id: string;
    url: string;
    timestamp: string;
    userAgent: string;
    logs: ConsoleLogEntry[];
}

export class ConsoleLogProvider implements vscode.TreeDataProvider<LogTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<LogTreeItem | undefined | null | void> = new vscode.EventEmitter<LogTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LogTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private sessions = new Map<string, SessionInfo>();
    private maxLogs: number;

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('consoleCapture');
        this.maxLogs = config.get<number>('maxLogs') || 1000;
    }

    /**
     * Start a new console capture session
     */
    startSession(sessionId: string, info: Omit<SessionInfo, 'id' | 'logs'>): void {
        this.sessions.set(sessionId, {
            id: sessionId,
            ...info,
            logs: []
        });
        this._onDidChangeTreeData.fire();
    }

    /**
     * End a console capture session
     */
    endSession(sessionId: string): void {
        // Keep the session data but mark it as ended
        const session = this.sessions.get(sessionId);
        if (session) {
            // Could add an 'ended' flag here if needed
        }
        this._onDidChangeTreeData.fire();
    }

    /**
     * Add a console log entry to a session
     */
    addLog(sessionId: string, log: ConsoleLogEntry): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.logs.push(log);
            
            // Trim logs if exceeding max limit
            if (session.logs.length > this.maxLogs) {
                session.logs.splice(0, session.logs.length - this.maxLogs);
            }
            
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * Clear all console logs
     */
    clearLogs(): void {
        this.sessions.clear();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get all logs from all sessions
     */
    getAllLogs(): ConsoleLogEntry[] {
        const allLogs: ConsoleLogEntry[] = [];
        for (const session of this.sessions.values()) {
            allLogs.push(...session.logs);
        }
        return allLogs;
    }

    /**
     * Get tree item representation
     */
    getTreeItem(element: LogTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children for tree view
     */
    getChildren(element?: LogTreeItem): Thenable<LogTreeItem[]> {
        if (!element) {
            // Root level - show sessions
            return Promise.resolve(Array.from(this.sessions.values()).map(session => 
                new SessionTreeItem(
                    session.id,
                    session.url,
                    session.timestamp,
                    session.logs.length,
                    vscode.TreeItemCollapsibleState.Expanded
                )
            ));
        } else if (element instanceof SessionTreeItem) {
            // Session level - show logs
            const session = this.sessions.get(element.sessionId);
            if (session) {
                return Promise.resolve(session.logs.map((log, index) => 
                    new LogEntryTreeItem(
                        `${element.sessionId}-${index}`,
                        log,
                        vscode.TreeItemCollapsibleState.None
                    )
                ));
            }
        }
        
        return Promise.resolve([]);
    }
}

/**
 * Base class for tree items
 */
abstract class LogTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

/**
 * Session tree item
 */
class SessionTreeItem extends LogTreeItem {
    constructor(
        public readonly sessionId: string,
        public readonly url: string,
        public readonly timestamp: string,
        public readonly logCount: number,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(`${new URL(url).hostname} (${logCount} logs)`, collapsibleState);
        
        this.tooltip = `URL: ${url}\nTime: ${new Date(timestamp).toLocaleString()}\nLogs: ${logCount}`;
        this.description = new Date(timestamp).toLocaleTimeString();
        this.iconPath = new vscode.ThemeIcon('browser');
    }
}

/**
 * Log entry tree item
 */
class LogEntryTreeItem extends LogTreeItem {
    constructor(
        public readonly id: string,
        public readonly log: ConsoleLogEntry,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        super(`[${log.level.toUpperCase()}] ${log.message}`, collapsibleState);
        
        this.tooltip = `Level: ${log.level}\nMessage: ${log.message}\nTime: ${time}\nURL: ${log.url}`;
        this.description = time;
        
        // Set icon based on log level
        switch (log.level) {
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
                break;
            case 'warn':
                this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
                break;
            case 'info':
                this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('output');
        }

        // Add command to show log details
        if (log.sourceInfo) {
            this.command = {
                command: 'vscode.open',
                title: 'Open Source',
                arguments: [
                    vscode.Uri.file(log.sourceInfo.file),
                    { selection: new vscode.Range(log.sourceInfo.line - 1, log.sourceInfo.column, log.sourceInfo.line - 1, log.sourceInfo.column) }
                ]
            };
        }
    }
}