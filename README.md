# Prism Pro Ultra

A personal AI coding IDE for your own laptop. A Monaco editor, file explorer, terminal and an autonomous coding agent that reads, writes, searches and runs code in any folder or GitHub repo you open. Runs fully local and free with Ollama, or with the Claude or Gemini APIs if you add a key.

**Version 0.3.0** · branch `pro-ultra`

## How to run

**Requirements:** [Node.js 18+](https://nodejs.org), [git](https://git-scm.com), and [Ollama](https://ollama.com) for free local models.

```bash
git clone https://github.com/Koushikv18/prism.git && cd prism
git checkout pro-ultra
npm install
npm start
```

Shortcuts: double-click `run.bat` (Windows) or run `./run.sh` (macOS/Linux). `npm run dist` builds an installer (.exe, .dmg, .AppImage/.deb) into `dist/`.

### Set up a free local model
```bash
node scripts/setup-local.js        # picks a Qwen coder model by RAM and pulls it
node scripts/selftest.js           # real-model check: writes, runs, learns
```
`setup-local.js` chooses by RAM only. If you have an NVIDIA GPU, choose by VRAM instead: 12 GB fits `qwen2.5-coder:14b`, 6 GB fits `qwen2.5-coder:7b`. Then `PRISM_MODEL=<model> node scripts/selftest.js`. Install helpers: `scripts/install-ollama.sh` / `.ps1`.

### Providers
Pick **Local (Ollama)**, **Claude** or **Gemini** in the app. Cloud keys are stored encrypted by the OS keychain, or set `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`.

### Settings (environment variables)
| Variable | Default | Purpose |
|---|---|---|
| `PRISM_MODEL` | provider default | Model name |
| `PRISM_PROVIDER` | `ollama` | Provider for `selftest.js` |
| `PRISM_CTX` | `12288` | Local context window; lower to 8192 if your GPU runs out of memory |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama address |

## What's updated in Pro Ultra
- **13 agent tools:** `list_dir`, `read_file`, `write_file`, `edit_file` (exact-snippet edits), `code_search`, `semantic_search` (local TF-IDF ranking), `analyze_repo`, `git_clone`, `clone_reference`, `run_command` (always asks first), `undo_last_change`, `remember`, `learn`.
- **Reverse engineering of public repos:** ask *"reverse engineer https://github.com/owner/repo"*. It clones the repo read-only into `.prism/refs/`, maps it, reads the core modules and writes `ARCHITECTURE.md` plus a clean-room build plan. It reports the license and does not copy code verbatim. Source code only, not compiled binaries.
- **Self-learning:** after each task the agent saves a short lesson to `~/.prism/learnings.md` (deduped, capped at 100). The newest 40 load into every future session.
- **Project memory:** `remember` writes to `PRISM.md` in the project, which the agent re-reads every session.
- **Self-correction:** every written `.js`, `.py` and `.json` file is syntax-checked and the result goes straight back to the model. Three identical tool calls in a row trigger a "try something else" nudge.
- **Undo:** `undo_last_change` restores the previous content of the last file the agent changed (50-step history in `~/.prism/checkpoints.json`).
- **Local-model hardening:** recovers tool calls that small models print as JSON text, trims context, runs at low temperature.
- **New look:** flat, solid-color theme with a Pro Ultra badge.

## UI
VS Code/Cursor-style layout: activity bar, explorer, multi-tab editing with dirty indicators, quick open (`Ctrl+P`), command palette (`Ctrl+Shift+P`), resizable panels, terminal with history (`` Ctrl+` ``), AI agent panel (`Ctrl+L`), and a status bar with git branch and cursor position.

## What's still needed to be pro like Claude Code, Cursor and Antigravity
Honest gaps, in suggested build order:

| # | Missing | Why it matters |
|---|---|---|
| 1 | **Streaming replies** | Text appears as it's written instead of after each full turn |
| 2 | **Diff review before changes apply** | Accept or reject each edit, like Cursor |
| 3 | **Real interactive terminal** (node-pty) | Current terminal is a command box |
| 4 | **MCP tool support** | Plug in external tools and data sources |
| 5 | **Whole-repo embeddings index** | Current search is keyword-weighted, not semantic |
| 6 | **Inline completion as you type** | Cursor and Antigravity's signature feature |
| 7 | **Sub-agents and background tasks** | Parallel work on separate tasks |
| 8 | **Browser control and UI testing** | Antigravity-style verification |
| 9 | **Real-model evals** | Run `selftest.js` on your model and tune prompts to it |
| 10 | **Cloud model option for hard tasks** | Local 7B-14B models struggle with big multi-file refactors |

Quality depends mostly on the model you run. A 14B local coder handles small and medium tasks; it will not match a frontier model on large ones.

## Project layout
`main.js` (Electron main, IPC) · `agent.js` (agent loop, tools, providers) · `preload.js` · `renderer/` (UI) · `scripts/` (setup, self-test, Ollama install) · `ci/build.yml` (optional installer workflow: move to `.github/workflows/`)

## Safety
Shell commands and repo clones need your approval. File access is locked to the open workspace. Never commit API keys or tokens.
