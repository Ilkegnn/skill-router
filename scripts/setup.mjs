// SessionStart hook. Whenever the user's skill set changes (or on first install), it re-tunes the router
// in a detached background process so the session never waits: domain hints, per-file-kind skill rules,
// and a list of duplicate/obsolete skills the user can review with /skill-router:cleanup.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR, PROFILE, FILE_KINDS, buildCatalog, catalogSignature, loadProfile, writeJson,
  askClaude, extractJson, log, readStdin,
} from './lib.mjs';

const LOCK = path.join(DATA_DIR, 'setup.lock');
const LOCK_TTL_MS = 10 * 60 * 1000;

const SYSTEM = `You configure a skill router for a coding agent. You get the user's installed skills (name: description) and a list of file kinds.
Return one JSON object, nothing else:
{
  "hints": [{"domain": "<kind of task, e.g. 'UI layout and visual polish'>", "skills": ["<skill>", ...]}],
  "fileRules": {"<file kind id>": ["<skill>", ...]},
  "cleanup": [{"skill": "<skill to retire>", "keep": "<skill that covers it, or null>", "reason": "<one short sentence>"}]
}
Rules:
- Use only exact skill names from the list.
- hints: group the skills into task domains. Within a domain, list the most generally useful skill first. Every skill that a model should ever pick on its own belongs to some domain.
- fileRules: for each file kind, the one or two skills that should be loaded before editing that kind of file. Leave a kind out if no skill fits well.
- cleanup: only skills that duplicate another installed skill (same purpose; keep the maintained or more complete one) or that describe themselves as deprecated. Being niche is NOT a reason. When unsure, leave it out.`;

function launchBackground() {
  try {
    const stat = fs.statSync(LOCK);
    if (Date.now() - stat.mtimeMs < LOCK_TTL_MS) return;
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCK, String(Date.now()));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, SKILL_ROUTER_CHILD: '1' },
  });
  child.unref();
}

async function hook() {
  if (process.env.SKILL_ROUTER_CHILD) return;
  await readStdin().catch(() => ({}));
  const catalog = buildCatalog();
  const profile = loadProfile();

  if (!profile || profile.signature !== catalogSignature(catalog)) {
    launchBackground();
    if (!profile) {
      process.stdout.write(JSON.stringify({
        systemMessage: `skill-router: tuning itself to your ${catalog.length} skills in the background (one time, about a minute).`,
      }));
    }
    return;
  }

  if (profile.cleanup?.length && !profile.cleanupNoticeShown) {
    profile.cleanupNoticeShown = true;
    writeJson(PROFILE, profile);
    process.stdout.write(JSON.stringify({
      systemMessage: `skill-router: ${profile.cleanup.length === 1 ? '1 installed skill looks' : `${profile.cleanup.length} installed skills look`} duplicated or deprecated. Run /skill-router:cleanup to review them — nothing changes without your OK.`,
    }));
  }
}

function run() {
  const started = Date.now();
  const catalog = buildCatalog();
  const names = new Set(catalog.map(s => s.name));
  const message = [
    'SKILLS:',
    ...catalog.map(s => `- ${s.name}: ${s.description}`),
    '\nFILE KINDS:',
    ...Object.entries(FILE_KINDS).map(([id, k]) => `- ${id}: ${k.desc}`),
  ].join('\n');

  const res = askClaude({ model: 'sonnet', system: SYSTEM, message, timeout: 240000 });
  const out = extractJson(res.text, '{');
  if (!out) {
    log(`setup failed status=${res.status} error=${res.error || ''} output=${res.text.slice(0, 200)}`);
    fs.rmSync(LOCK, { force: true });
    return;
  }

  const valid = (list) => [...new Set((list || []).filter(n => names.has(n)))];
  const profile = {
    signature: catalogSignature(catalog),
    builtAt: new Date().toISOString(),
    skillCount: catalog.length,
    hints: (out.hints || []).map(h => ({ domain: String(h.domain), skills: valid(h.skills) })).filter(h => h.skills.length),
    fileRules: Object.fromEntries(Object.entries(out.fileRules || {})
      .filter(([kind]) => FILE_KINDS[kind])
      .map(([kind, list]) => [kind, valid(list)])
      .filter(([, list]) => list.length)),
    cleanup: (out.cleanup || [])
      .filter(c => names.has(c.skill))
      .map(c => ({ ...c, source: catalog.find(s => s.name === c.skill).source, dir: catalog.find(s => s.name === c.skill).dir })),
    cleanupNoticeShown: false,
  };
  writeJson(PROFILE, profile);
  fs.rmSync(LOCK, { force: true });
  log(`setup ok ms=${Date.now() - started} skills=${catalog.length} domains=${profile.hints.length} fileRules=${Object.keys(profile.fileRules).length} cleanup=${profile.cleanup.length}`);
}

if (process.argv.includes('--run')) run();
else hook().catch(err => log(`setup hook crash ${err?.stack || err}`));
