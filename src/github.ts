import { GitHubFile, GitHubContent, RepoInfo } from './types';
import { getConfig, parseRepoUrl } from './config';

const GITHUB_API = 'https://api.github.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com';

interface GitHubApiFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  download_url: string | null;
  content?: string;
  encoding?: string;
}

interface GitHubRepoResponse {
  permissions?: {
    push?: boolean;
  };
}

interface GitHubErrorResponse {
  message?: string;
}

export class GitHubClient {
  private repoInfo: RepoInfo;
  private branch: string;
  private basePath: string;
  private token: string | null;

  constructor() {
    const config = getConfig();
    const repoInfo = parseRepoUrl(config.repoUrl);
    
    if (!repoInfo) {
      throw new Error('Invalid repository URL configured');
    }
    
    this.repoInfo = repoInfo;
    this.branch = config.branch;
    this.basePath = config.repoPath;
    this.token = config.githubToken || null;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'sync-code-dotfiles'
    };
    
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }
    
    return headers;
  }

  /**
   * List contents of a directory in the repository
   */
  async listDirectory(path: string = ''): Promise<GitHubFile[]> {
    const fullPath = this.basePath ? `${this.basePath}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '') : path;
    const url = `${GITHUB_API}/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/contents/${fullPath}?ref=${this.branch}`;
    
    const response = await fetch(url, { headers: this.getHeaders() });
    
    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as GitHubApiFile | GitHubApiFile[];
    const files = Array.isArray(data) ? data : [data];
    return files.map(f => ({
      name: f.name,
      path: f.path,
      sha: f.sha,
      size: f.size,
      type: f.type,
      download_url: f.download_url
    }));
  }

  /**
   * Fetch file content using raw.githubusercontent.com (no auth needed for public repos)
   */
  async fetchFileRaw(path: string): Promise<string> {
    const fullPath = this.basePath ? `${this.basePath}/${path}`.replace(/\/+/g, '/') : path;
    const url = `${GITHUB_RAW}/${this.repoInfo.owner}/${this.repoInfo.repo}/${this.branch}/${fullPath}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status}`);
    }
    
    return response.text();
  }

  /**
   * Fetch file content via API (includes SHA for updates)
   */
  async fetchFile(path: string): Promise<GitHubContent> {
    const fullPath = this.basePath ? `${this.basePath}/${path}`.replace(/\/+/g, '/') : path;
    const url = `${GITHUB_API}/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/contents/${fullPath}?ref=${this.branch}`;
    
    const response = await fetch(url, { headers: this.getHeaders() });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status}`);
    }
    
    const data = await response.json() as GitHubApiFile;
    
    // Decode base64 content
    const content = data.encoding === 'base64' && data.content
      ? Buffer.from(data.content, 'base64').toString('utf-8')
      : data.content || '';
    
    return {
      path: data.path,
      content,
      sha: data.sha,
      encoding: data.encoding
    };
  }

  /**
   * Create or update a file in the repository (requires token)
   */
  async pushFile(path: string, content: string, message: string): Promise<void> {
    if (!this.token) {
      throw new Error('GitHub token required for push operations');
    }
    
    const fullPath = this.basePath ? `${this.basePath}/${path}`.replace(/\/+/g, '/') : path;
    const url = `${GITHUB_API}/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/contents/${fullPath}`;
    
    // Try to get existing file SHA
    let sha: string | undefined;
    try {
      const existing = await this.fetchFile(path);
      sha = existing.sha;
    } catch {
      // File doesn't exist, that's fine for creation
    }
    
    const body: Record<string, string> = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch: this.branch
    };
    
    if (sha) {
      body.sha = sha;
    }
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as GitHubErrorResponse;
      throw new Error(`Failed to push ${path}: ${response.status} - ${error.message || response.statusText}`);
    }
  }

  /**
   * Recursively fetch all files matching patterns
   */
  async fetchAllFiles(patterns: string[]): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    
    // Normalize patterns by stripping .cursor/ prefix since files in the repo's
    // basePath directory are already what should go into .cursor/
    const normalizedPatterns = patterns.map(p => 
      p.replace(/^\.?cursor\/?/, '')
    );
    
    const processDirectory = async (dirPath: string) => {
      const entries = await this.listDirectory(dirPath);
      
      for (const entry of entries) {
        const relativePath = this.basePath 
          ? entry.path.replace(new RegExp(`^${this.basePath}/?`), '')
          : entry.path;
        
        if (entry.type === 'dir') {
          // Check if any pattern matches this directory
          if (this.shouldProcessDirectory(relativePath, normalizedPatterns)) {
            await processDirectory(relativePath);
          }
        } else if (entry.type === 'file') {
          if (this.matchesPatterns(relativePath, normalizedPatterns)) {
            try {
              const content = await this.fetchFileRaw(relativePath);
              files.set(relativePath, content);
            } catch (err) {
              console.error(`Failed to fetch ${relativePath}:`, err);
            }
          }
        }
      }
    };
    
    await processDirectory('');
    return files;
  }

  private shouldProcessDirectory(path: string, patterns: string[]): boolean {
    // Check if any pattern could match files in this directory
    for (const pattern of patterns) {
      if (pattern.includes('**')) {
        const base = pattern.split('**')[0].replace(/\/$/, '');
        if (!base || path.startsWith(base) || base.startsWith(path)) {
          return true;
        }
      } else if (pattern.includes('/')) {
        const dir = pattern.substring(0, pattern.lastIndexOf('/'));
        if (path === dir || path.startsWith(dir + '/') || dir.startsWith(path + '/')) {
          return true;
        }
      }
    }
    return false;
  }

  private matchesPatterns(path: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchPattern(path, pattern)) {
        return true;
      }
    }
    return false;
  }

  private matchPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    // Handle: exact match, *, **, ?
    
    if (pattern === path) return true;
    
    let regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/{{GLOBSTAR}}/g, '.*');
    
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(path);
  }

  /**
   * Check if repository is accessible
   */
  async checkAccess(): Promise<{ read: boolean; write: boolean }> {
    try {
      const url = `${GITHUB_API}/repos/${this.repoInfo.owner}/${this.repoInfo.repo}`;
      const response = await fetch(url, { headers: this.getHeaders() });
      
      if (!response.ok) {
        return { read: false, write: false };
      }
      
      const data = await response.json() as GitHubRepoResponse;
      return {
        read: true,
        write: this.token ? data.permissions?.push === true : false
      };
    } catch {
      return { read: false, write: false };
    }
  }
}
