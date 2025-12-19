# Changelog

## [0.1.1] - 2024-12-19

### Fixed
- Fixed bug where sync was only creating an empty `.cursor/` folder instead of copying the complete files and folders structure
- Pattern matching now correctly normalizes paths to handle both `.cursor/` prefixed and non-prefixed patterns
- Aligned default `filesToSync` patterns between config fallback and package.json

All notable changes to the Cursor Dotfiles Sync extension will be documented in this file.

## [0.1.0] - 2024

### Added
- Initial release
- Pull configuration from public GitHub repositories
- Push configuration to GitHub (with token)
- Sync to global (`~/.cursor/`) or workspace (`.cursor/`) targets
- Auto-sync with configurable interval
- Sync on startup option
- New workspace detection and sync prompt
- Conflict resolution with diff viewer
- Status bar integration with quick actions
- Support for `.cursorrules`, rules, MCP config, and prompts
- Glob pattern support for file matching
