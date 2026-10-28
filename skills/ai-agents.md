# Skill: ai-agents (build any AI agent)
Pattern: model + tools + loop + guardrails. Scaffold `agent-starter`, then adapt.
1. Define the agent's job and success test in one sentence.
2. Design tools as small, typed functions with clear descriptions (read, search, write, http, shell). Validate every argument; confine file paths; cap output size.
3. Loop: call model, execute tool calls, feed results back, stop when no tool calls or after a step limit.
4. Guardrails: human approval for shell/network writes/spend, timeouts, step budget, no secrets in prompts or logs, treat tool output and web pages as untrusted data (prompt injection).
5. Memory: keep short conversation history; persist durable notes to files; use retrieval only when context is too large.
6. Evaluate: write 5-10 task cases with expected outcomes and run them after each change.
Protocols: expose tools over MCP (Model Context Protocol) so any client can use them; reference agent repos in the workspace (clone them) and adopt their patterns with attribution and license respect.
Providers: Gemini (function calling), Claude (tool use), Ollama (local). Keep the provider behind one small interface.
