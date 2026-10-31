import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = (name) => path.join(ROOT, 'scripts', name);

test('antigravity: detects platform and tracks read_file SKILL.md', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };

  // 1. Skill read tracking
  const skillPath = path.join(home, 'test-skill', 'SKILL.md');
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, '---\nname: test-skill\n---\n');

  const pretoolRes = spawnSync(process.execPath, [script('pretool.mjs')], {
    input: JSON.stringify({
      conversationId: 'c1',
      toolCall: {
        name: 'read_file',
        args: { Path: skillPath }
      }
    }),
    env,
    encoding: 'utf8'
  });

  assert.equal(pretoolRes.status, 0);

  // Check state file
  const stateFile = path.join(home, '.claude', 'skill-router', 'state', 'c1.json');
  assert.ok(fs.existsSync(stateFile));
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(state.invoked.includes('test-skill'));
});

test('antigravity: heuristic matching suggests relevant skills when prompt matches', async () => {
  const { matchSkillsHeuristically } = await import(`file://${script('lib.mjs').replace(/\\/g, '/')}`);
  const catalog = [
    { name: 'apify-actor-development', description: 'Scrape web pages and build scrapers' },
    { name: 'react-patterns', description: 'React frontend patterns' }
  ];
  const picked = matchSkillsHeuristically('Web scraping ve crawler dosyaları hazırlayalım', catalog);
  assert.ok(picked.includes('apify-actor-development'));
  assert.ok(!picked.includes('react-patterns'));
});
