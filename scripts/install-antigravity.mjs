// One-click installer for Antigravity: registers skill-router into ~/.gemini/config/hooks.json
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const geminiConfigDir = path.join(os.homedir(), '.gemini', 'config');
const hooksFile = path.join(geminiConfigDir, 'hooks.json');

const setupScript = path.join(rootDir, 'scripts', 'setup.mjs').replace(/\\/g, '/');
const routeScript = path.join(rootDir, 'scripts', 'route.mjs').replace(/\\/g, '/');
const pretoolScript = path.join(rootDir, 'scripts', 'pretool.mjs').replace(/\\/g, '/');

const hookConfig = {
  SessionStart: [
    {
      type: 'command',
      command: `node ${setupScript}`,
      timeout: 15,
    },
  ],
  PreInvocation: [
    {
      type: 'command',
      command: `node ${routeScript}`,
      timeout: 20,
    },
  ],
  PreToolUse: [
    {
      matcher: 'edit_file|write_file',
      hooks: [
        {
          type: 'command',
          command: `node ${pretoolScript}`,
          timeout: 10,
        },
      ],
    },
  ],
};

function main() {
  const isUninstall = process.argv.includes('--uninstall');
  fs.mkdirSync(geminiConfigDir, { recursive: true });

  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  } catch {}

  if (isUninstall) {
    if (existing['skill-router']) {
      delete existing['skill-router'];
      fs.writeFileSync(hooksFile, JSON.stringify(existing, null, 2), 'utf8');
      console.log('✅ skill-router successfully uninstalled from Antigravity hooks.json.');
    } else {
      console.log('ℹ️ skill-router was not found in Antigravity hooks.json.');
    }
    return;
  }

  existing['skill-router'] = hookConfig;
  fs.writeFileSync(hooksFile, JSON.stringify(existing, null, 2), 'utf8');
  console.log('🎉 skill-router successfully installed and enabled for Antigravity!');
  console.log(`Config written to: ${hooksFile}`);
  console.log('Hooks registered: SessionStart, PreInvocation (Gemini Flash routing), PreToolUse (file reminders).');
}

main();
