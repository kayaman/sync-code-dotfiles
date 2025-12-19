export interface SyncConfig {
  repoUrl: string;
  branch: string;
  repoPath: string;
  defaultSyncTarget: 'global' | 'workspace' | 'ask';
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  syncOnStartup: boolean;
  syncOnNewWorkspace: boolean;
  githubToken: string;
  conflictResolution: 'ask' | 'keepLocal' | 'useRemote';
  filesToSync: string[];
}

export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  download_url: string | null;
}

export interface GitHubContent {
  path: string;
  content: string;
  sha?: string;
  encoding?: string;
}

export interface SyncResult {
  success: boolean;
  filesProcessed: number;
  errors: string[];
  conflicts: ConflictInfo[];
}

export interface ConflictInfo {
  path: string;
  localContent: string;
  remoteContent: string;
  resolution?: 'keepLocal' | 'useRemote' | 'skip';
}

export interface SyncState {
  lastSyncedAt: number | null;
  lastSyncTarget: 'global' | 'workspace' | null;
  lastSyncDirection: 'pull' | 'push' | null;
  lastSyncFiles: string[];
  lastError: string | null;
}

export type SyncTarget = 'global' | 'workspace';
export type SyncDirection = 'pull' | 'push';
