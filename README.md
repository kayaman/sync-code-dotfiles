# Cursor Dotfiles Sync

Sync your Cursor IDE configuration (rules, MCP servers, prompts) from a public GitHub dotfiles repository. Keep your Cursor setup consistent across machines and share your configuration with the community.

## Features

- **Pull from GitHub** - Download your Cursor config from any public GitHub repository
- **Push to GitHub** - Upload local changes back to your repository (requires token)
- **Flexible Sync Targets** - Sync to global (`~/.cursor/`) or workspace (`.cursor/`) configs
- **Auto-sync** - Optionally sync on a schedule
- **New Project Detection** - Prompt to sync when opening new workspaces
- **Conflict Resolution** - Choose how to handle differences between local and remote
- **Status Bar Integration** - Quick access to sync status and actions

## Installation

### From VSIX (Local)

```bash
# Build the extension
cd sync-code-dotfiles
npm install
npm run build
npm run package

# Install in Cursor/VS Code
code --install-extension sync-code-dotfiles-0.1.0.vsix
```

### From Marketplace

*Coming soon*

## Configuration

### Required Settings

| Setting | Description | Example |
|---------|-------------|---------|
| `cursorSync.repoUrl` | Your GitHub dotfiles repository URL | `https://github.com/username/dotfiles` |

### Optional Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorSync.branch` | `main` | Git branch to sync from/to |
| `cursorSync.repoPath` | `cursor` | Path within repo where configs live |
| `cursorSync.defaultSyncTarget` | `ask` | Where to sync: `global`, `workspace`, or `ask` |
| `cursorSync.autoSyncEnabled` | `false` | Enable automatic sync on interval |
| `cursorSync.autoSyncIntervalMinutes` | `60` | Minutes between auto-syncs (5-1440) |
| `cursorSync.syncOnStartup` | `false` | Sync when Cursor starts |
| `cursorSync.syncOnNewWorkspace` | `true` | Prompt to sync for new projects |
| `cursorSync.githubToken` | *(empty)* | GitHub PAT for push operations |
| `cursorSync.conflictResolution` | `ask` | How to handle conflicts: `ask`, `keepLocal`, `useRemote` |
| `cursorSync.filesToSync` | See below | File patterns to sync |

### Default Files to Sync

```json
[
  ".cursorrules",
  "rules/**",
  "mcp.json",
  "prompts/**"
]
```

## Repository Structure

Your dotfiles repository should have a structure like:

```
your-dotfiles/
└── cursor/                    # cursorSync.repoPath
    ├── .cursorrules           # Project-level rules (synced to workspace root)
    ├── rules/                 # Rule files
    │   ├── coding-standards.mdc
    │   ├── documentation.mdc
    │   └── testing.mdc
    ├── mcp.json               # MCP server configurations
    └── prompts/               # Custom prompts/commands
        ├── code-review.md
        └── refactor.md
```

## Commands

Access via Command Palette (`Cmd/Ctrl + Shift + P`):

| Command | Description |
|---------|-------------|
| `Cursor Sync: Pull from GitHub` | Download configs from repository |
| `Cursor Sync: Push to GitHub` | Upload local configs (requires token) |
| `Cursor Sync: Open Settings` | Open extension settings |
| `Cursor Sync: Show Sync Status` | View detailed sync status |
| `Cursor Sync: Sync to Current Workspace` | Pull directly to workspace |
| `Cursor Sync: Sync to Global Config` | Pull directly to global |

## Push Support

To enable pushing changes back to GitHub:

1. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope
2. Configure via one of:
   - Setting: `cursorSync.githubToken`
   - Environment variable: `CURSOR_SYNC_GITHUB_TOKEN`

> ⚠️ **Security Note**: For better security, use the environment variable approach rather than storing the token in settings.

## Status Bar

The extension adds a status bar item showing:
- Sync status icon (`↓` pull, `↑` push available)
- Last sync time
- Click to see full status and quick actions

## Conflict Handling

When local and remote files differ, based on your `conflictResolution` setting:

- **ask** (default): Shows a dialog with options to keep local, use remote, view diff, or skip
- **keepLocal**: Always preserves your local version
- **useRemote**: Always uses the GitHub version

## Tips

### Sharing Your Config

1. Create a public GitHub repository for your dotfiles
2. Add your Cursor config under a `cursor/` directory
3. Share the URL - others can pull your setup!

### Team Sync

For team configurations:
1. Create a team dotfiles repository
2. Team members configure the same `repoUrl`
3. Use workspace sync for project-specific overrides

### MCP Server Configuration

The `mcp.json` file syncs your MCP server configurations. Example:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-github"],
      "env": {
        "GITHUB_TOKEN": "${env:GITHUB_TOKEN}"
      }
    }
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Watch mode
npm run watch

# Build
npm run build

# Package
npm run package

# Lint
npm run lint
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.
