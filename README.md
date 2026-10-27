# Prism

A personal AI coding IDE for your own laptop: Monaco editor, file tree, terminal, and a Claude-powered agent that can read, write and run code in any folder or repo you open.

## Run
```bash
git clone https://github.com/Koushikv18/prism.git && cd prism
npm install
npm start
```
Pick a provider (**Gemini**, **Claude**, or free local **Ollama**), click **API Key** and paste your key (stored encrypted via the OS keychain), or set `ANTHROPIC_API_KEY`.

## Run as an app
- **Quickest:** double-click `run.bat` (Windows) or run `./run.sh` (macOS/Linux).
- **Installer:** `npm run dist` builds a real installer in `dist/` (.exe, .dmg, or .AppImage/.deb for your OS).
- **No build needed (optional CI):** move `ci/build.yml` to `.github/workflows/build.yml`, push, then run it from GitHub → Actions and download the installers.

Agent tools: `git_clone`, `list_dir`, `read_file`, `write_file`, `code_search`, `run_command` (always asks first). Ask: *"Clone https://github.com/owner/repo, find where authentication is handled, and explain it."* Repos clone into `~/.prism/workspaces/`.

## Free local mode (Ollama)
1. Install Ollama from https://ollama.com
2. `ollama pull qwen2.5-coder:7b` (use a larger model if you have the RAM)
3. Pick **Local (Ollama)** in the top bar. No API key, no cost, works offline.

## Use
- **Open Folder** or paste a git URL and **Clone** to work on any external repo.
- Chat on the right: the agent lists/reads/writes files; shell commands always ask for your approval.
- Change the model with `PRISM_MODEL`.

## Roadmap
Streaming responses, multi-tab editing, diff review, real PTY terminal (node-pty), git panel, MCP servers.

## UI
VS Code/Cursor-style layout: activity bar, explorer, multi-tab editing with dirty indicators, quick open (`Ctrl+P`), command palette (`Ctrl+Shift+P`), resizable panels, terminal with history (`` Ctrl+` ``), AI agent panel (`Ctrl+L`), and a status bar with git branch and cursor position.
