// Shared helpers: skill catalog, per-user profile and per-session state, and multi-agent LLM runners (Haiku & Gemini Flash).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const GEMINI_CONFIG_DIR = path.join(os.homedir(), '.gemini', 'config');
export const DATA_DIR = path.join(CLAUDE_DIR, 'skill-router');
export const PROFILE = path.join(DATA_DIR, 'profile.json');

// Detect whether running under Antigravity or Claude Code
export function detectPlatform(input = {}) {
  if (process.env.ANTIGRAVITY_AGENT || input.conversationId || input.lastUserInput !== undefined || input.toolCall) {
    return 'antigravity';
  }
  return 'claude';
}

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

// Every skill the model can invoke across Claude Code and Antigravity ecosystems.
export function buildCatalog(cwd, platform = 'auto') {
  const out = new Map();

  // 1. Antigravity skills
  if (platform === 'antigravity' || platform === 'auto') {
    scan(path.join(GEMINI_CONFIG_DIR, 'skills'), '', 'antigravity-user', out);

    // Antigravity plugins
    const agyPlugins = path.join(GEMINI_CONFIG_DIR, 'plugins');
    try {
      for (const p of fs.readdirSync(agyPlugins, { withFileTypes: true })) {
        if (p.isDirectory()) {
          scan(path.join(agyPlugins, p.name, 'skills'), `${p.name}:`, `antigravity-plugin:${p.name}`, out);
        }
      }
    } catch {}

    // Workspace Antigravity skills
    if (cwd) {
      scan(path.join(cwd, '.agents', 'skills'), '', 'workspace-agent', out, false);
      scan(path.join(cwd, '.agent', 'skills'), '', 'workspace-agent', out, false);
    }
  }

  // 2. Claude Code skills
  if (platform === 'claude' || platform === 'auto') {
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

    if (cwd) scan(path.join(cwd, '.claude', 'skills'), '', 'project', out, false);
  }

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

// Safely finds Gemini API Key from environment or local config files
export function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY.trim();
  const candidates = [
    path.join(os.homedir(), '.gemini', 'gemini_api_key'),
    path.join(os.homedir(), '.config', 'gemini', 'api_key'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const key = fs.readFileSync(c, 'utf8').trim();
        if (key.length > 20) return key;
      }
    } catch {}
  }
  return null;
}

// Calls Gemini Flash API directly via native fetch (lightning fast, ~500ms)
export async function askGeminiFlash({ system, message, timeout = 15000 }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return { error: 'No Gemini API key found' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Active Gemini models
  const models = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-1.5-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: message }] }],
        })
      });
      const data = await res.json();
      if (data.error) {
        if (data.error.code === 404) continue;
        return { error: data.error.message };
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { text, status: 0 };
    } catch (err) {
      if (err.name === 'AbortError') return { error: 'Gemini API Timeout' };
      return { error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: 'No responding Gemini Flash model' };
}

// Dynamically searches PATH across platforms for Claude CLI binary
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

// Runs a one-shot, tool-less `claude -p`
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

// Unified fast model dispatcher: calls Gemini Flash for Antigravity, Claude Haiku for Claude Code
export async function askFlash({ system, message, timeout = 20000, platform = 'claude' }) {
  if (platform === 'antigravity') {
    // 1. Try native Gemini Flash first
    const geminiRes = await askGeminiFlash({ system, message, timeout: 15000 });
    if (geminiRes.text) return geminiRes;

    // 2. Fall back to Claude Haiku if available
    const claudeRes = askClaude({ model: 'haiku', system, message, timeout });
    if (claudeRes.text) return claudeRes;

    return { text: '', error: geminiRes.error || claudeRes.error };
  }

  // Claude platform
  return askClaude({ model: 'haiku', system, message, timeout });
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
