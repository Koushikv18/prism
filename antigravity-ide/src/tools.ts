import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { Type, type FunctionDeclaration } from '@google/genai';
import { cloneRepo, buildOverview, isSkipped } from './workspace.js';

export interface ToolContext {
  root: string | null;
  setRoot(p: string): void;
  approve(command: string): Promise<boolean>;
  status(msg: string): void;
}

const str = (description: string) => ({ type: Type.STRING, description });
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: Type.OBJECT, properties, required }) as FunctionDeclaration['parameters'];

export const declarations: FunctionDeclaration[] = [
  { name: 'git_clone', description: 'Clone a public GitHub repository into the sandbox workspace and make it the active workspace. Returns an architecture overview.', parameters: obj({ url: str('https://github.com/owner/repo') }, ['url']) },
  { name: 'fs_read', description: 'Read a UTF-8 text file from the active workspace (path relative to repo root).', parameters: obj({ path: str('Relative file path') }, ['path']) },
  { name: 'fs_write', description: 'Create or overwrite a file in the active workspace.', parameters: obj({ path: str('Relative file path'), content: str('Full new file content') }, ['path', 'content']) },
  { name: 'shell_exec', description: 'Run a shell command in the workspace root (tests, installs, builds). The user must approve each command.', parameters: obj({ command: str('Shell command') }, ['command']) },
  { name: 'code_search', description: 'Regex search across workspace files. Returns file:line matches.', parameters: obj({ query: str('JavaScript regex, case-insensitive') }, ['query']) },
];

function safe(ctx: ToolContext, rel: string): string {
  if (!ctx.root) throw new Error('No active workspace. Call git_clone first.');
  const p = path.resolve(ctx.root, rel);
  if (p !== ctx.root && !p.startsWith(ctx.root + path.sep)) throw new Error('Path escapes the workspace');
  return p;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (isSkipped(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full); else yield full;
  }
}

const MAX_OUT = 20_000;
const clip = (s: string) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + `\n…[truncated ${s.length - MAX_OUT} chars]` : s);

export async function runTool(name: string, args: Record<string, string>, ctx: ToolContext): Promise<string> {
  try {
    switch (name) {
      case 'git_clone': {
        ctx.status('Cloning…');
        const dest = await cloneRepo(args.url);
        ctx.setRoot(dest);
        ctx.status('Indexing structure…');
        return clip(await buildOverview(dest));
      }
      case 'fs_read':
        ctx.status(`Reading ${args.path}`);
        return clip(await fs.readFile(safe(ctx, args.path), 'utf8'));
      case 'fs_write': {
        ctx.status(`Writing ${args.path}`);
        const p = safe(ctx, args.path);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, args.content);
        return `Wrote ${args.content.length} chars to ${args.path}`;
      }
      case 'shell_exec': {
        const cwd = safe(ctx, '.');
        if (!(await ctx.approve(args.command))) return 'User denied this command.';
        ctx.status('Running command…');
        return await new Promise(res => exec(args.command, { cwd, timeout: 120_000, maxBuffer: 4_000_000 },
          (err, out, errOut) => res(clip(`${out}${errOut}${err ? `\n[exit ${err.code ?? 'error'}]` : ''}`))));
      }
      case 'code_search': {
        ctx.status(`Searching /${args.query}/`);
        const re = new RegExp(args.query, 'i');
        const root = safe(ctx, '.');
        const hits: string[] = [];
        for await (const f of walk(root)) {
          if (hits.length >= 200) break;
          const text = await fs.readFile(f, 'utf8').catch(() => '');
          if (text.includes('\0')) continue;
          text.split('\n').forEach((l, i) => { if (re.test(l) && hits.length < 200) hits.push(`${path.relative(root, f)}:${i + 1}: ${l.trim().slice(0, 160)}`); });
        }
        return hits.join('\n') || 'No matches.';
      }
      default: return `Unknown tool ${name}`;
    }
  } catch (e) { return `Error: ${(e as Error).message}`; }
}
