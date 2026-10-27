import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';

export const WORKSPACES = path.join(os.homedir(), '.antigravity', 'workspaces');
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', '.venv', 'target']);
const GITHUB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;

export const isSkipped = (name: string) => SKIP.has(name);

/** Clone (or fast-forward) a public GitHub repo into the sandbox. Returns the local path. */
export async function cloneRepo(url: string): Promise<string> {
  if (!GITHUB_URL.test(url)) throw new Error('Only https://github.com/<owner>/<repo> URLs are allowed');
  const name = url.replace(/\/$/, '').replace(/\.git$/, '').split('/').slice(-2).join('__');
  const dest = path.join(WORKSPACES, name);
  await fs.mkdir(WORKSPACES, { recursive: true });
  const exists = await fs.stat(path.join(dest, '.git')).then(() => true, () => false);
  if (exists) await simpleGit(dest).pull(['--ff-only']);
  else await simpleGit().clone(url, dest, ['--depth', '1']);
  return dest;
}

export interface TreeNode { name: string; dir: boolean; children?: TreeNode[] }

export async function scanTree(root: string, depth = 4, rel = ''): Promise<TreeNode[]> {
  if (depth < 0) return [];
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  const out: TreeNode[] = [];
  for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name)) continue;
    const node: TreeNode = { name: e.name, dir: e.isDirectory() };
    if (e.isDirectory()) node.children = await scanTree(root, depth - 1, path.join(rel, e.name));
    out.push(node);
  }
  return out;
}

export function renderTree(nodes: TreeNode[], prefix = ''): string {
  return nodes.map((n, i) => {
    const last = i === nodes.length - 1;
    const line = `${prefix}${last ? '└── ' : '├── '}${n.name}${n.dir ? '/' : ''}\n`;
    return line + (n.children ? renderTree(n.children, prefix + (last ? '    ' : '│   ')) : '');
  }).join('');
}

const MARKERS: Record<string, string> = {
  'package.json': 'Node.js', 'tsconfig.json': 'TypeScript', 'requirements.txt': 'Python (pip)', 'pyproject.toml': 'Python',
  'go.mod': 'Go', 'Cargo.toml': 'Rust', 'pom.xml': 'Java (Maven)', 'build.gradle': 'Java/Kotlin (Gradle)', 'Gemfile': 'Ruby',
  'Dockerfile': 'Docker', 'next.config.js': 'Next.js', 'next.config.mjs': 'Next.js', 'vite.config.ts': 'Vite', 'composer.json': 'PHP',
};

export async function detectStack(root: string): Promise<string[]> {
  const found = new Set<string>();
  for (const [file, label] of Object.entries(MARKERS)) {
    if (await fs.stat(path.join(root, file)).then(() => true, () => false)) found.add(label);
  }
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const d of ['react', 'vue', 'svelte', 'express', 'fastify', 'next', 'tailwindcss', 'prisma']) if (deps[d]) found.add(d);
  } catch { /* no package.json */ }
  return [...found];
}

/** Auto-scan: directory map + detected stack, written as ARCHITECTURE.md inside the workspace's .antigravity folder. */
export async function buildOverview(root: string): Promise<string> {
  const [tree, stack] = await Promise.all([scanTree(root, 3), detectStack(root)]);
  const md = `# Architecture overview: ${path.basename(root)}\n\n**Detected stack:** ${stack.join(', ') || 'unknown'}\n\n## Directory layout (depth 3)\n\n\`\`\`\n${renderTree(tree)}\`\`\`\n`;
  await fs.mkdir(path.join(root, '.antigravity'), { recursive: true });
  await fs.writeFile(path.join(root, '.antigravity', 'ARCHITECTURE.md'), md);
  return md;
}
