# Antigravity IDE (Phase 1)
Local AI coding agent: clone any public GitHub repo into `~/.antigravity/workspaces/`, auto-scan its structure and stack, and let Gemini explore, edit and test it with tools (`git_clone`, `fs_read`, `fs_write`, `shell_exec`, `code_search`).

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY, then: export $(cat .env | xargs)
npm run dev
```
Safety: file tools are confined to the active workspace; `shell_exec` asks for approval each time; only `https://github.com/owner/repo` URLs are cloneable.

Next phases: streaming output, Ink TUI, Vite + React + Tailwind + Monaco web dashboard over an SSE server, semantic index.
