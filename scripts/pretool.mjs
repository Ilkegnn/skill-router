// PreToolUse hook: records Skill calls and, mid-task, reminds the model once per session about the
// skills setup mapped to the kind of file it is about to edit. Local only — no model call.
import path from 'node:path';
import { FILE_KINDS, buildCatalog, loadProfile, loadOverrides, loadState, saveState, log, readStdin } from './lib.mjs';

async function main() {
  if (process.env.SKILL_ROUTER_CHILD) return;
  const input = await readStdin();
  const sid = input.session_id;
  const args = input.tool_input || {};
  const state = loadState(sid);

  if (input.tool_name === 'Skill') {
    if (args.skill && !state.invoked.includes(args.skill)) {
      state.invoked.push(args.skill);
      saveState(sid, state);
    }
    return;
  }

  const profile = loadProfile();
  const file = args.file_path || args.notebook_path || '';
  if (!profile || !file) return;
  const overrides = loadOverrides();
  const rules = { ...profile.fileRules, ...overrides.fileRules };
  const content = [args.content, args.new_string, ...(args.edits || []).map(e => e.new_string)].filter(Boolean).join('\n');

  const matched = Object.entries(rules).filter(([kind]) => FILE_KINDS[kind]?.test(file, content)).flatMap(([, skills]) => skills);
  if (!matched.length) return;
  const known = new Set(buildCatalog(input.cwd).map(s => s.name));
  const due = [...new Set(matched)].filter(s => known.has(s) && !overrides.ignore.includes(s) && !state.invoked.includes(s) && !state.reminded.includes(s));
  if (!due.length) return;

  state.reminded.push(...due);
  saveState(sid, state);
  log(`remind session=${sid} file=${path.basename(file)} skills=${JSON.stringify(due)}`);

  const context = `Skill router: you are editing ${path.basename(file)}, and these skills cover this kind of file but are not loaded in this session: ${due.join(', ')}. Unless this is a trivial fix, invoke them with the Skill tool and apply them to this and the following edits.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } }));
}

main().catch(err => log(`pretool crash ${err?.stack || err}`));
