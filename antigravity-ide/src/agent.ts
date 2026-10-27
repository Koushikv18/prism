import { GoogleGenAI, type Content } from '@google/genai';
import { declarations, runTool, type ToolContext } from './tools.js';

const SYSTEM = `You are Antigravity, an elite senior software architect and coding companion running on the user's laptop.
Work like an engineer: clone or open the repo, read ARCHITECTURE.md output, use code_search to locate relevant code, read files before changing them, make minimal focused edits with fs_write, and verify with shell_exec (tests, type checks) when sensible.
Explain findings clearly with file paths and line references. Never invent file contents; read them. Ask before destructive actions.`;

export class Agent {
  private ai: GoogleGenAI;
  private history: Content[] = [];
  private model = process.env.ANTIGRAVITY_MODEL ?? 'gemini-2.5-flash';

  constructor(apiKey: string, private ctx: ToolContext) { this.ai = new GoogleGenAI({ apiKey }); }

  async run(prompt: string, onText: (t: string) => void, maxSteps = 25): Promise<void> {
    this.history.push({ role: 'user', parts: [{ text: prompt }] });
    for (let step = 0; step < maxSteps; step++) {
      const res = await this.ai.models.generateContent({
        model: this.model, contents: this.history,
        config: { systemInstruction: SYSTEM, tools: [{ functionDeclarations: declarations }] },
      });
      const content = res.candidates?.[0]?.content;
      if (!content) return onText('(no response)');
      this.history.push(content);
      const calls = res.functionCalls ?? [];
      if (res.text) onText(res.text);
      if (!calls.length) return;
      const parts = [];
      for (const c of calls) {
        const output = await runTool(c.name ?? '', (c.args ?? {}) as Record<string, string>, this.ctx);
        parts.push({ functionResponse: { name: c.name, response: { output } } });
      }
      this.history.push({ role: 'user', parts });
    }
    onText('Stopped: step limit reached.');
  }
}
