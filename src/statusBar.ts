import * as vscode from 'vscode';
import { formatLastSynced, isConfigured, canPush } from './config';

let statusBarItem: vscode.StatusBarItem | null = null;

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  
  updateStatusBar('idle');
  statusBarItem.show();
  
  return statusBarItem;
}

export function updateStatusBar(
  state: 'idle' | 'syncing' | 'success' | 'error',
  message?: string
): void {
  if (!statusBarItem) return;
  
  const configured = isConfigured();
  
  if (!configured) {
    statusBarItem.text = '$(gear) Cursor Sync';
    statusBarItem.tooltip = 'Click to configure Cursor Dotfiles Sync';
    statusBarItem.command = 'cursorSync.configure';
    statusBarItem.backgroundColor = undefined;
    return;
  }
  
  switch (state) {
    case 'syncing':
      statusBarItem.text = '$(sync~spin) Syncing...';
      statusBarItem.tooltip = message || 'Syncing with GitHub...';
      statusBarItem.command = undefined;
      statusBarItem.backgroundColor = undefined;
      break;
      
    case 'success':
      const lastSynced = formatLastSynced();
      statusBarItem.text = `$(check) ${lastSynced}`;
      statusBarItem.tooltip = buildTooltip(message);
      statusBarItem.command = 'cursorSync.showStatus';
      statusBarItem.backgroundColor = undefined;
      
      // Reset to idle after 5 seconds
      setTimeout(() => updateStatusBar('idle'), 5000);
      break;
      
    case 'error':
      statusBarItem.text = '$(error) Sync Error';
      statusBarItem.tooltip = message || 'Sync failed. Click for details.';
      statusBarItem.command = 'cursorSync.showStatus';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
      
    case 'idle':
    default:
      const idleText = formatLastSynced();
      const pushIcon = canPush() ? '$(cloud-upload)' : '';
      statusBarItem.text = `$(cloud-download)${pushIcon ? ' ' + pushIcon : ''} ${idleText}`;
      statusBarItem.tooltip = buildTooltip();
      statusBarItem.command = 'cursorSync.showStatus';
      statusBarItem.backgroundColor = undefined;
      break;
  }
}

function buildTooltip(extraMessage?: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  
  const lastSynced = formatLastSynced();
  const pushEnabled = canPush();
  
  md.appendMarkdown('### Cursor Dotfiles Sync\n\n');
  md.appendMarkdown(`**Status:** ${lastSynced}\n\n`);
  
  if (extraMessage) {
    md.appendMarkdown(`${extraMessage}\n\n`);
  }
  
  md.appendMarkdown('---\n\n');
  md.appendMarkdown(`[$(cloud-download) Pull](command:cursorSync.pull)`);
  
  if (pushEnabled) {
    md.appendMarkdown(` | [$(cloud-upload) Push](command:cursorSync.push)`);
  }
  
  md.appendMarkdown(` | [$(gear) Settings](command:cursorSync.configure)`);
  
  return md;
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = null;
}
