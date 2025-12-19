import * as vscode from 'vscode';
import { 
  getConfig, 
  isConfigured, 
  canPush, 
  openSettings, 
  initStateStorage,
  getSyncState,
  formatLastSynced 
} from './config';
import { SyncManager, askSyncTarget } from './sync';
import { GitHubClient } from './github';
import { createStatusBar, updateStatusBar, disposeStatusBar } from './statusBar';
import { SyncTarget } from './types';

let autoSyncInterval: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext): void {
  console.log('Cursor Dotfiles Sync is activating...');
  
  // Initialize state storage
  initStateStorage(context);
  
  // Create status bar
  const statusBar = createStatusBar();
  context.subscriptions.push(statusBar);
  
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorSync.pull', () => executePull()),
    vscode.commands.registerCommand('cursorSync.push', () => executePush()),
    vscode.commands.registerCommand('cursorSync.configure', () => openSettings()),
    vscode.commands.registerCommand('cursorSync.showStatus', () => showStatusDetail()),
    vscode.commands.registerCommand('cursorSync.syncToWorkspace', () => executePull('workspace')),
    vscode.commands.registerCommand('cursorSync.syncToGlobal', () => executePull('global'))
  );
  
  // Watch for workspace folder changes (new project detection)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      if (event.added.length > 0) {
        await handleNewWorkspace(event.added[0]);
      }
    })
  );
  
  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('cursorSync')) {
        handleConfigChange();
      }
    })
  );
  
  // Initialize auto-sync if enabled
  setupAutoSync();
  
  // Sync on startup if configured
  const config = getConfig();
  if (config.syncOnStartup && isConfigured()) {
    setTimeout(() => executePull(), 2000); // Slight delay to let VS Code fully initialize
  }
  
  console.log('Cursor Dotfiles Sync activated');
}

export function deactivate(): void {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
  disposeStatusBar();
}

async function executePull(forceTarget?: SyncTarget): Promise<void> {
  if (!isConfigured()) {
    const action = await vscode.window.showWarningMessage(
      'Cursor Dotfiles Sync is not configured',
      'Configure Now'
    );
    if (action === 'Configure Now') {
      await openSettings();
    }
    return;
  }
  
  const target = forceTarget || await askSyncTarget();
  if (!target) return;
  
  updateStatusBar('syncing', 'Pulling from GitHub...');
  
  try {
    const syncManager = new SyncManager();
    const result = await syncManager.pull(target);
    
    if (result.success) {
      const message = `Pulled ${result.filesProcessed} file(s) to ${target}`;
      updateStatusBar('success', message);
      vscode.window.showInformationMessage(`✅ ${message}`);
    } else {
      const errorMsg = result.errors.join('\n');
      updateStatusBar('error', errorMsg);
      vscode.window.showErrorMessage(`Sync failed: ${result.errors[0]}`);
    }
    
    // Show conflict summary if any
    if (result.conflicts.length > 0) {
      const skipped = result.conflicts.filter(c => c.resolution === 'skip').length;
      const kept = result.conflicts.filter(c => c.resolution === 'keepLocal').length;
      const used = result.conflicts.filter(c => c.resolution === 'useRemote').length;
      
      vscode.window.showInformationMessage(
        `Conflicts resolved: ${used} used remote, ${kept} kept local, ${skipped} skipped`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatusBar('error', message);
    vscode.window.showErrorMessage(`Pull failed: ${message}`);
  }
}

async function executePush(forceTarget?: SyncTarget): Promise<void> {
  if (!isConfigured()) {
    const action = await vscode.window.showWarningMessage(
      'Cursor Dotfiles Sync is not configured',
      'Configure Now'
    );
    if (action === 'Configure Now') {
      await openSettings();
    }
    return;
  }
  
  if (!canPush()) {
    const action = await vscode.window.showWarningMessage(
      'GitHub token required for push operations',
      'Configure Token'
    );
    if (action === 'Configure Token') {
      await openSettings();
    }
    return;
  }
  
  const target = forceTarget || await askSyncTarget();
  if (!target) return;
  
  // Confirm push
  const confirm = await vscode.window.showWarningMessage(
    `Push ${target} Cursor config to GitHub?`,
    { modal: true },
    'Push'
  );
  if (confirm !== 'Push') return;
  
  updateStatusBar('syncing', 'Pushing to GitHub...');
  
  try {
    const syncManager = new SyncManager();
    const result = await syncManager.push(target);
    
    if (result.success) {
      const message = `Pushed ${result.filesProcessed} file(s) from ${target}`;
      updateStatusBar('success', message);
      vscode.window.showInformationMessage(`✅ ${message}`);
    } else {
      const errorMsg = result.errors.join('\n');
      updateStatusBar('error', errorMsg);
      vscode.window.showErrorMessage(`Push failed: ${result.errors[0]}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatusBar('error', message);
    vscode.window.showErrorMessage(`Push failed: ${message}`);
  }
}

async function showStatusDetail(): Promise<void> {
  const state = getSyncState();
  const config = getConfig();
  
  let details = '# Cursor Dotfiles Sync Status\n\n';
  details += `**Repository:** ${config.repoUrl || 'Not configured'}\n`;
  details += `**Branch:** ${config.branch}\n`;
  details += `**Config Path:** ${config.repoPath}\n\n`;
  details += `**Last Synced:** ${formatLastSynced()}\n`;
  
  if (state.lastSyncDirection) {
    details += `**Direction:** ${state.lastSyncDirection === 'pull' ? 'Pull ↓' : 'Push ↑'}\n`;
  }
  
  if (state.lastSyncTarget) {
    details += `**Target:** ${state.lastSyncTarget}\n`;
  }
  
  if (state.lastSyncFiles.length > 0) {
    details += `\n**Files Synced:**\n`;
    state.lastSyncFiles.forEach(f => {
      details += `- ${f}\n`;
    });
  }
  
  if (state.lastError) {
    details += `\n**Last Error:**\n\`\`\`\n${state.lastError}\n\`\`\`\n`;
  }
  
  details += `\n**Auto-sync:** ${config.autoSyncEnabled ? `Every ${config.autoSyncIntervalMinutes} minutes` : 'Disabled'}\n`;
  details += `**Push Enabled:** ${canPush() ? 'Yes' : 'No (token not configured)'}\n`;
  
  // Show in a virtual document
  const doc = await vscode.workspace.openTextDocument({
    content: details,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function handleNewWorkspace(folder: vscode.WorkspaceFolder): Promise<void> {
  const config = getConfig();
  
  if (!config.syncOnNewWorkspace || !isConfigured()) {
    return;
  }
  
  const choice = await vscode.window.showInformationMessage(
    `New workspace detected: ${folder.name}. Sync Cursor config?`,
    'Sync to Workspace',
    'Sync Global',
    'Skip'
  );
  
  if (choice === 'Sync to Workspace') {
    await executePull('workspace');
  } else if (choice === 'Sync Global') {
    await executePull('global');
  }
}

function handleConfigChange(): void {
  updateStatusBar('idle');
  setupAutoSync();
}

function setupAutoSync(): void {
  // Clear existing interval
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
  
  const config = getConfig();
  
  if (!config.autoSyncEnabled || !isConfigured()) {
    return;
  }
  
  const intervalMs = config.autoSyncIntervalMinutes * 60 * 1000;
  
  autoSyncInterval = setInterval(async () => {
    console.log('Auto-sync triggered');
    
    // Use default target or global if set to 'ask'
    const target = config.defaultSyncTarget === 'ask' ? 'global' : config.defaultSyncTarget;
    
    updateStatusBar('syncing', 'Auto-syncing...');
    
    try {
      const syncManager = new SyncManager();
      const result = await syncManager.pull(target);
      
      if (result.success) {
        updateStatusBar('success', `Auto-synced ${result.filesProcessed} files`);
      } else {
        updateStatusBar('error', result.errors[0]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      updateStatusBar('error', `Auto-sync failed: ${message}`);
    }
  }, intervalMs);
  
  console.log(`Auto-sync scheduled every ${config.autoSyncIntervalMinutes} minutes`);
}
