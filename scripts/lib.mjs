// Shared helpers: skill catalog, per-user profile and per-session state, and a headless `claude -p` runner.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const DATA_DIR = path.join(CLAUDE_DIR, 'skill-router');
export const PROFILE = path.join(DATA_DIR, 'profile.json');

// Robust frontmatter parser: handles UTF-8 BOM, chomp indicators (>-, |+, >|), and multiline folded blocks.
export function parseFrontmatter(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if (/^[|>][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        block.push(lines[++i].trim());
      }
      value = block.join(' ');
    } else if (value === '' && i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
      const block = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        block.push(lines[++i].trim());
      }
      value = block.join(' ');
    }
    fm[key] = value.replace(/^["']|["']$/g, '');
  }
  // Opening of the body, where skills usually say what they cover and what they don't.
  fm.excerpt = text.slice(m[0].length).replace(/\s+/g, ' ').trim().slice(0, 600);
  return fm;
}

function scan(dir, prefix, source, out, allowOverwrite = true) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const fm = parseFrontmatter(path.join(dir, e.name, 'SKILL.md'));
    if (!fm || fm['disable-model-invocation'] === 'true') continue;
    const baseName = (/^[a-z0-9][a-z0-9-]*$/.test(fm.name || '') ? fm.name : e.name);
    let name = prefix + baseName;
    // Security & Shadowing protection: do not let untrusted project skills overwrite user or plugin skills
    if (!allowOverwrite && out.has(name)) {
      name = `project:${baseName}`;
    }
    out.set(name, {
      name,
      source,
      dir: path.join(dir, e.name),
      description: (fm.description || '').slice(0, 320),
      excerpt: fm.excerpt,
    });
  }
}

// Every skill the model can invoke: user, claude.ai-synced, enabled plugins, then the project.
export function buildCatalog(cwd) {
  const out = new Map();
  scan(path.join(CLAUDE_DIR, 'skills'), '', 'user', out);

  const synced = path.join(CLAUDE_DIR, 'skills', 'synced');
  try {
    for (const bundle of fs.readdirSync(synced)) {
      scan(path.join(synced, bundle), 'anthropic-skills:', 'synced', out);
    }
  } catch {}

  try {
    const settings = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'settings.json'), 'utf8'));
    const installed = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'), 'utf8'));
    const plugins = installed.plugins || installed;
    for (const [id, on] of Object.entries(settings.enabledPlugins || {})) {
      if (!on || !plugins[id]?.[0]?.installPath) continue;
      scan(path.join(plugins[id][0].installPath, 'skills'), id.split('@')[0] + ':', `plugin:${id}`, out);
    }
  } catch {}

  // Untrusted project skills do not overwrite user/plugin skills
  if (cwd) scan(path.join(cwd, '.claude', 'skills'), '', 'project', out, false);

  // A local copy of a plugin skill (same name, e.g. `systematic-debugging` next to `superpowers:systematic-debugging`)
  // would be offered twice; keep the one the user installed directly.
  return [...out.values()].filter(s => !(s.name.includes(':') && out.has(s.name.split(':').pop())));
}

// Catalog signature includes name, description, and excerpt so edits in SKILL.md trigger a re-tune.
export function catalogSignature(catalog) {
  return crypto.createHash('sha1').update(
    catalog.map(s => `${s.name}:${s.description || ''}:${s.excerpt || ''}`).sort().join('\n')
  ).digest('hex').slice(0, 16);
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Atomic write to avoid corrupted JSON on concurrent reads or unexpected interruptions.
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export const loadProfile = () => readJson(PROFILE, null);

// Optional, user-written; absent by default. { "protect": [...], "ignore": [...], "fileRules": { kind: [...] } }
// protect: never offered for cleanup. ignore: never routed or reminded. fileRules: replaces setup's choice for a kind.
export function loadOverrides() {
  const o = readJson(path.join(DATA_DIR, 'overrides.json'), {});
  return { protect: o.protect || [], ignore: o.ignore || [], fileRules: o.fileRules || {} };
}

const stateFile = (sid) => path.join(DATA_DIR, 'state', `${String(sid).replace(/[^\w-]/g, '')}.json`);
export const loadState = (sid) => readJson(stateFile(sid), { routed: [], invoked: [], reminded: [] });
export const saveState = (sid, state) => writeJson(stateFile(sid), state);

export function log(line) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'router.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

// Maintenance: cleans state files older than 7 days and rotates router.log if > 1MB.
export function performMaintenance() {
  try {
    const stateDir = path.join(DATA_DIR, 'state');
    if (fs.existsSync(stateDir)) {
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      for (const file of fs.readdirSync(stateDir)) {
        const fp = path.join(stateDir, file);
        try {
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > maxAge) {
            fs.rmSync(fp, { force: true });
          }
        } catch {}
      }
    }

    const logFile = path.join(DATA_DIR, 'router.log');
    if (fs.existsSync(logFile)) {
      const stat = fs.statSync(logFile);
      if (stat.size > 1024 * 1024) {
        const content = fs.readFileSync(logFile, 'utf8');
        const tail = content.slice(-256 * 1024);
        const firstNl = tail.indexOf('\n');
        fs.writeFileSync(logFile, firstNl >= 0 ? tail.slice(firstNl + 1) : tail, 'utf8');
      }
    }
  } catch {}
}

export async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data || '{}');
}

// Dynamically searches PATH across platforms (including Windows .cmd, .exe, .bat, nvm/fnm paths).
function claudeExe() {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const fixedCandidates = isWin
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
        path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
      ];

  for (const p of fixedCandidates) {
    if (p && fs.existsSync(p)) return p;
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `claude${ext}`);
      try {
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch {}
    }
  }
  return null;
}

// Runs a one-shot, tool-less, plugin-less `claude -p` so it neither recurses into these hooks nor loads the user's setup.
export function askClaude({ model, system, message, timeout }) {
  const exe = claudeExe();
  const base = ['-p', '--model', model, '--setting-sources', '', '--strict-mcp-config', '--tools', '',
    '--disable-slash-commands', '--no-session-persistence'];
  const opts = {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, SKILL_ROUTER_CHILD: '1' },
  };

  const res = exe
    ? spawnSync(exe, [...base, '--system-prompt', system], { ...opts, input: message })
    : spawnSync('claude', [...base, '--system-prompt', system], { ...opts, shell: process.platform === 'win32', input: message });

  return { text: res.stdout || '', status: res.status, error: res.error?.message };
}

// Balanced bracket JSON extractor: ignores brackets inside string literals and avoids greedy slice failures.
export function extractJson(text, open) {
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;
  let startIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === open) {
      if (depth === 0) startIndex = i;
      depth++;
    } else if (char === close && depth > 0) {
      depth--;
      if (depth === 0 && startIndex !== -1) {
        const candidate = text.slice(startIndex, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          startIndex = -1;
        }
      }
    }
  }
  return null;
}

// File kinds the edit hook recognises; setup maps each kind to the user's own skills.
export const FILE_KINDS = {
  ui: { desc: 'UI components, pages, styles (.tsx .jsx .vue .svelte .css .html)', test: (f) => /\.(tsx|jsx|vue|svelte|astro|css|scss|less|html)$/i.test(f) && !/\.(test|spec)\./i.test(f) },
  motion: { desc: 'animation code (framer-motion, CSS transitions/keyframes)', test: (f, c) => /framer-motion|from ['"]motion|@keyframes|animation:|transition:|useSpring|useAnimate/.test(c) },
  test: { desc: 'unit/integration test files', test: (f) => /\.(test|spec)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|(^|[\\/])test_\w+\.py$|_test\.go$/i.test(f) },
  e2e: { desc: 'end-to-end browser tests (Playwright, Cypress)', test: (f, c) => /[\\/](e2e|cypress)[\\/]|\.e2e\./i.test(f) || /@playwright\/test|cypress/.test(c) },
  reactNative: { desc: 'React Native / Expo code', test: (f, c) => /from ['"](react-native|expo)/.test(c) },
  swift: { desc: 'Swift / iOS code', test: (f) => /\.swift$/i.test(f) },
  android: { desc: 'Kotlin / Android code', test: (f) => /\.(kt|kts)$/i.test(f) },
  python: { desc: 'Python code', test: (f) => /\.py$/i.test(f) },
  rust: { desc: 'Rust code', test: (f) => /\.rs$/i.test(f) },
  go: { desc: 'Go code', test: (f) => /\.go$/i.test(f) },
  sql: { desc: 'SQL, migrations, database schema', test: (f) => /\.sql$|[\\/]migrations?[\\/]|schema\.prisma$/i.test(f) },
  infra: { desc: 'Dockerfiles, CI workflows, deploy config', test: (f) => /Dockerfile|docker-compose|\.github[\\/]workflows|\.gitlab-ci|vercel\.json|netlify\.toml/i.test(f) },
  llmApp: { desc: 'code calling an LLM API (Anthropic/OpenAI SDK)', test: (f, c) => /@anthropic-ai\/sdk|from anthropic|import anthropic|openai/.test(c) },
  designSpec: { desc: 'DESIGN.md design-system spec', test: (f) => path.basename(f) === 'DESIGN.md' },
  skillFile: { desc: 'SKILL.md files (writing a skill)', test: (f) => path.basename(f) === 'SKILL.md' },
};
