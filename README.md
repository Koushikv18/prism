# Prism

A personal AI coding IDE for your own laptop: Monaco editor, file tree, terminal, and a Claude-powered agent that can read, write and run code in any folder or repo you open.

## Run
```bash
git clone https://github.com/Koushikv18/prism.git && cd prism
npm install
npm start
```
Click **API Key** and paste your Anthropic key (stored encrypted via the OS keychain), or set `ANTHROPIC_API_KEY`.

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
