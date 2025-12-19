import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitHubClient } from './github';
import { getConfig, updateSyncState, getSyncState } from './config';
import { SyncTarget, SyncResult, ConflictInfo } from './types';

const CURSOR_DIR = '.cursor';

export class SyncManager {
  private github: GitHubClient;

  constructor() {
    this.github = new GitHubClient();
  }

  /**
   * Get the target directory for sync operations
   */
  getTargetPath(target: SyncTarget): string {
    if (target === 'global') {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, CURSOR_DIR);
    } else {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder open');
      }
      return path.join(workspaceFolder.uri.fsPath, CURSOR_DIR);
    }
  }

  /**
   * Pull files from GitHub to local
   */
  async pull(target: SyncTarget): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      filesProcessed: 0,
      errors: [],
      conflicts: []
    };

    try {
      const config = getConfig();
      const targetPath = this.getTargetPath(target);
      
      // Ensure target directory exists
      await fs.promises.mkdir(targetPath, { recursive: true });
      
      // Fetch all files from GitHub
      const remoteFiles = await this.github.fetchAllFiles(config.filesToSync);
      
      for (const [relativePath, remoteContent] of remoteFiles) {
        try {
          const localPath = this.mapToLocalPath(relativePath, targetPath);
          const localDir = path.dirname(localPath);
          
          // Ensure directory exists
          await fs.promises.mkdir(localDir, { recursive: true });
          
          // Check for conflicts
          let shouldWrite = true;
          if (fs.existsSync(localPath)) {
            const localContent = await fs.promises.readFile(localPath, 'utf-8');
            
            if (localContent !== remoteContent) {
              const resolution = await this.handleConflict(
                relativePath,
                localContent,
                remoteContent,
                config.conflictResolution
              );
              
              result.conflicts.push({
                path: relativePath,
                localContent,
                remoteContent,
                resolution
              });
              
              shouldWrite = resolution === 'useRemote';
            }
          }
          
          if (shouldWrite) {
            await fs.promises.writeFile(localPath, remoteContent, 'utf-8');
            result.filesProcessed++;
          }
        } catch (error) {
          result.errors.push(`${relativePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      result.success = result.errors.length === 0;
      
      // Update sync state
      await updateSyncState({
        lastSyncedAt: Date.now(),
        lastSyncTarget: target,
        lastSyncDirection: 'pull',
        lastSyncFiles: Array.from(remoteFiles.keys()),
        lastError: result.errors.length > 0 ? result.errors.join('; ') : null
      });
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      await updateSyncState({
        lastError: result.errors[0]
      });
    }

    return result;
  }

  /**
   * Push files from local to GitHub
   */
  async push(target: SyncTarget): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      filesProcessed: 0,
      errors: [],
      conflicts: []
    };

    try {
      const config = getConfig();
      
      if (!config.githubToken) {
        throw new Error('GitHub token required for push. Configure cursorSync.githubToken in settings.');
      }
      
      const targetPath = this.getTargetPath(target);
      
      if (!fs.existsSync(targetPath)) {
        throw new Error(`Target directory does not exist: ${targetPath}`);
      }
      
      // Collect local files matching patterns
      const localFiles = await this.collectLocalFiles(targetPath, config.filesToSync);
      
      for (const [relativePath, localContent] of localFiles) {
        try {
          // Check for conflicts with remote
          let shouldPush = true;
          try {
            const remoteContent = await this.github.fetchFileRaw(relativePath);
            
            if (remoteContent !== localContent) {
              const resolution = await this.handleConflict(
                relativePath,
                localContent,
                remoteContent,
                config.conflictResolution,
                'push'
              );
              
              result.conflicts.push({
                path: relativePath,
                localContent,
                remoteContent,
                resolution
              });
              
              shouldPush = resolution === 'keepLocal';
            }
          } catch {
            // File doesn't exist remotely, safe to push
          }
          
          if (shouldPush) {
            await this.github.pushFile(
              relativePath,
              localContent,
              `Update ${relativePath} via Cursor Dotfiles Sync`
            );
            result.filesProcessed++;
          }
        } catch (error) {
          result.errors.push(`${relativePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      result.success = result.errors.length === 0;
      
      await updateSyncState({
        lastSyncedAt: Date.now(),
        lastSyncTarget: target,
        lastSyncDirection: 'push',
        lastSyncFiles: Array.from(localFiles.keys()),
        lastError: result.errors.length > 0 ? result.errors.join('; ') : null
      });
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      await updateSyncState({
        lastError: result.errors[0]
      });
    }

    return result;
  }

  /**
   * Map remote path to local filesystem path
   */
  private mapToLocalPath(remotePath: string, targetDir: string): string {
    // Handle special mappings
    // .cursorrules goes to workspace root, not .cursor/
    if (remotePath === '.cursorrules') {
      const parent = path.dirname(targetDir);
      return path.join(parent, '.cursorrules');
    }
    
    return path.join(targetDir, remotePath);
  }

  /**
   * Map local path to remote path for pushing
   */
  private mapToRemotePath(localPath: string, targetDir: string): string {
    const parent = path.dirname(targetDir);
    
    // Handle .cursorrules special case
    if (localPath === path.join(parent, '.cursorrules')) {
      return '.cursorrules';
    }
    
    return path.relative(targetDir, localPath);
  }

  /**
   * Collect local files matching patterns
   */
  private async collectLocalFiles(
    targetDir: string,
    patterns: string[]
  ): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const parent = path.dirname(targetDir);
    
    // Normalize patterns by stripping .cursor/ prefix since we're scanning
    // the .cursor directory and paths are relative to it
    const normalizedPatterns = patterns.map(p => 
      p.replace(/^\.?cursor\/?/, '')
    );
    
    // Check for .cursorrules at workspace root
    const cursorrules = path.join(parent, '.cursorrules');
    if (fs.existsSync(cursorrules) && this.matchesAnyPattern('.cursorrules', normalizedPatterns)) {
      const content = await fs.promises.readFile(cursorrules, 'utf-8');
      files.set('.cursorrules', content);
    }
    
    // Recursively scan .cursor directory
    const scanDir = async (dir: string, base: string) => {
      if (!fs.existsSync(dir)) return;
      
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(base, entry.name).replace(/\\/g, '/');
        
        if (entry.isDirectory()) {
          await scanDir(fullPath, relativePath);
        } else if (entry.isFile()) {
          if (this.matchesAnyPattern(relativePath, normalizedPatterns)) {
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            files.set(relativePath, content);
          }
        }
      }
    };
    
    await scanDir(targetDir, '');
    return files;
  }

  private matchesAnyPattern(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchPattern(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    if (pattern === filePath) return true;
    
    let regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/{{GLOBSTAR}}/g, '.*');
    
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(filePath);
  }

  /**
   * Handle file conflict
   */
  private async handleConflict(
    filePath: string,
    localContent: string,
    remoteContent: string,
    defaultResolution: 'ask' | 'keepLocal' | 'useRemote',
    direction: 'pull' | 'push' = 'pull'
  ): Promise<'keepLocal' | 'useRemote' | 'skip'> {
    if (defaultResolution === 'keepLocal') return 'keepLocal';
    if (defaultResolution === 'useRemote') return 'useRemote';
    
    // Show conflict dialog
    const localLabel = direction === 'pull' ? 'Keep Local' : 'Push Local';
    const remoteLabel = direction === 'pull' ? 'Use Remote' : 'Keep Remote';
    
    const choice = await vscode.window.showWarningMessage(
      `Conflict in ${filePath}`,
      { modal: true, detail: 'Local and remote versions differ. How would you like to resolve this?' },
      { title: localLabel },
      { title: remoteLabel },
      { title: 'Show Diff' },
      { title: 'Skip' }
    );
    
    if (!choice || choice.title === 'Skip') {
      return 'skip';
    }
    
    if (choice.title === 'Show Diff') {
      // Show diff in editor
      await this.showDiff(filePath, localContent, remoteContent);
      
      // Ask again after showing diff
      const afterDiff = await vscode.window.showInformationMessage(
        `After reviewing the diff for ${filePath}:`,
        { title: localLabel },
        { title: remoteLabel },
        { title: 'Skip' }
      );
      
      if (!afterDiff || afterDiff.title === 'Skip') return 'skip';
      return afterDiff.title === localLabel ? 'keepLocal' : 'useRemote';
    }
    
    return choice.title === localLabel ? 'keepLocal' : 'useRemote';
  }

  /**
   * Show diff between local and remote content
   */
  private async showDiff(filePath: string, localContent: string, remoteContent: string): Promise<void> {
    const localUri = vscode.Uri.parse(`cursor-sync:local/${filePath}`);
    const remoteUri = vscode.Uri.parse(`cursor-sync:remote/${filePath}`);
    
    // Register content provider temporarily
    const provider = new (class implements vscode.TextDocumentContentProvider {
      private contents = new Map<string, string>();
      
      constructor() {
        this.contents.set(localUri.toString(), localContent);
        this.contents.set(remoteUri.toString(), remoteContent);
      }
      
      provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) || '';
      }
    })();
    
    const disposable = vscode.workspace.registerTextDocumentContentProvider('cursor-sync', provider);
    
    try {
      await vscode.commands.executeCommand('vscode.diff', remoteUri, localUri, `${filePath} (Remote ↔ Local)`);
    } finally {
      // Keep provider alive for a bit so diff can render
      setTimeout(() => disposable.dispose(), 30000);
    }
  }
}

/**
 * Ask user for sync target
 */
export async function askSyncTarget(): Promise<SyncTarget | undefined> {
  const config = getConfig();
  
  if (config.defaultSyncTarget !== 'ask') {
    return config.defaultSyncTarget;
  }
  
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(home) Global', description: '~/.cursor/', value: 'global' as SyncTarget },
      { label: '$(folder) Workspace', description: '.cursor/ in current project', value: 'workspace' as SyncTarget }
    ],
    { placeHolder: 'Where should files be synced?' }
  );
  
  return choice?.value;
}
