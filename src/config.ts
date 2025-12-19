import * as vscode from 'vscode';
import { SyncConfig, RepoInfo, SyncState } from './types';

const CONFIG_SECTION = 'cursorSync';
const STATE_KEY = 'cursorSyncState';

export function getConfig(): SyncConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  
  return {
    repoUrl: config.get<string>('repoUrl', ''),
    branch: config.get<string>('branch', 'main'),
    repoPath: config.get<string>('repoPath', 'cursor'),
    defaultSyncTarget: config.get<'global' | 'workspace' | 'ask'>('defaultSyncTarget', 'ask'),
    autoSyncEnabled: config.get<boolean>('autoSyncEnabled', false),
    autoSyncIntervalMinutes: config.get<number>('autoSyncIntervalMinutes', 60),
    syncOnStartup: config.get<boolean>('syncOnStartup', false),
    syncOnNewWorkspace: config.get<boolean>('syncOnNewWorkspace', true),
    githubToken: getGitHubToken(config),
    conflictResolution: config.get<'ask' | 'keepLocal' | 'useRemote'>('conflictResolution', 'ask'),
    filesToSync: config.get<string[]>('filesToSync', [
      '.cursorrules',
      'rules/**',
      'mcp.json',
      'prompts/**'
    ])
  };
}

function getGitHubToken(config: vscode.WorkspaceConfiguration): string {
  const configToken = config.get<string>('githubToken', '');
  if (configToken) return configToken;
  
  return process.env.CURSOR_SYNC_GITHUB_TOKEN || '';
}

export function parseRepoUrl(url: string): RepoInfo | null {
  if (!url) return null;
  
  const patterns = [
    /^([^\/]+)\/([^\/\.]+)$/,  // username/dotfiles
    /github\.com\/([^\/]+)\/([^\/\.]+)/,  // github.com/username/dotfiles
    /github\.com:([^\/]+)\/([^\/\.]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, '')
      };
    }
  }
  
  return null;
}

export function isConfigured(): boolean {
  const config = getConfig();
  return !!config.repoUrl && !!parseRepoUrl(config.repoUrl);
}

export function canPush(): boolean {
  const config = getConfig();
  return !!config.githubToken;
}

export async function openSettings(): Promise<void> {
  await vscode.commands.executeCommand(
    'workbench.action.openSettings',
    `@ext:your-publisher-name.sync-code-dotfiles`
  );
}

let globalState: vscode.Memento | null = null;

export function initStateStorage(context: vscode.ExtensionContext): void {
  globalState = context.globalState;
}

export function getSyncState(): SyncState {
  if (!globalState) {
    return getDefaultState();
  }
  return globalState.get<SyncState>(STATE_KEY, getDefaultState());
}

export async function updateSyncState(partial: Partial<SyncState>): Promise<void> {
  if (!globalState) return;
  
  const current = getSyncState();
  const updated = { ...current, ...partial };
  await globalState.update(STATE_KEY, updated);
}

function getDefaultState(): SyncState {
  return {
    lastSyncedAt: null,
    lastSyncTarget: null,
    lastSyncDirection: null,
    lastSyncFiles: [],
    lastError: null
  };
}

export function formatLastSynced(): string {
  const state = getSyncState();
  
  if (!state.lastSyncedAt) {
    return 'Never synced';
  }
  
  const date = new Date(state.lastSyncedAt);
  const now = Date.now();
  const diffMs = now - state.lastSyncedAt;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  let timeAgo: string;
  if (diffMins < 1) {
    timeAgo = 'just now';
  } else if (diffMins < 60) {
    timeAgo = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    timeAgo = `${diffHours}h ago`;
  } else {
    timeAgo = `${diffDays}d ago`;
  }
  
  const direction = state.lastSyncDirection === 'push' ? '↑' : '↓';
  const target = state.lastSyncTarget === 'global' ? 'global' : 'workspace';
  
  return `${direction} ${timeAgo} (${target})`;
}
