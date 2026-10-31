// Universal PreToolUse hook: records skill calls and reminds the model once per session about the
// skills mapped to the kind of file it is about to edit. Local only — no model call.
import path from 'node:path';
import {
  FILE_KINDS, buildCatalog, loadProfile, loadOverrides,
  loadState, saveState, log, readStdin, detectPlatform,
} from './lib.mjs';

async function main() {
  if (process.env.SKILL_ROUTER_CHILD) return;
  const input = await readStdin();
  const platform = detectPlatform(input);

  const sid = input.conversationId || input.session_id || 'default';
  const state = loadState(sid);
  const cwd = (input.workspacePaths && input.workspacePaths[0]) || input.cwd;

  // Extract tool name and arguments based on platform
  let toolName = '';
  let args = {};

  if (platform === 'antigravity') {
    toolName = input.toolCall?.name || '';
    args = input.toolCall?.args || {};
  } else {
    toolName = input.tool_name || '';
    args = input.tool_input || {};
  }

  // 1. Skill invocation tracking
  if (toolName === 'Skill' && args.skill) {
    const full = args.skill;
    const short = full.split(':').pop();
    if (!state.invoked.includes(full)) state.invoked.push(full);
    if (!state.invoked.includes(short)) state.invoked.push(short);
    saveState(sid, state);
    return;
  }

  // Antigravity skill read tracking (when agent inspects a SKILL.md file)
  if (platform === 'antigravity' && toolName === 'read_file' && args.Path && args.Path.endsWith('SKILL.md')) {
    const skillName = path.basename(path.dirname(args.Path));
    if (skillName && !state.invoked.includes(skillName)) {
      state.invoked.push(skillName);
      saveState(sid, state);
    }
    return;
  }

  // 2. File editing reminder check
  const isEditTool = platform === 'antigravity'
    ? (toolName === 'edit_file' || toolName === 'write_file')
    : (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName));

  if (!isEditTool) return;

  const profile = loadProfile();
  const file = args.file_path || args.notebook_path || args.Path || '';
  if (!profile || !file) return;

  const overrides = loadOverrides();
  const rules = { ...profile.fileRules, ...overrides.fileRules };
  const content = [
    args.content,
    args.Content,
    args.new_string,
    args.Replacement,
    ...(args.edits || []).map(e => e.new_string),
  ].filter(Boolean).join('\n');

  const matched = Object.entries(rules).filter(([kind]) => FILE_KINDS[kind]?.test(file, content)).flatMap(([, skills]) => skills);
  if (!matched.length) return;
  const known = new Set(buildCatalog(cwd, platform).map(s => s.name));

  // Avoid repetitive/spurious reminders: check both namespaced and short name
  const isDue = (s) => {
    const short = s.split(':').pop();
    if (overrides.ignore.includes(s) || overrides.ignore.includes(short)) return false;
    if (state.invoked.includes(s) || state.invoked.includes(short)) return false;
    if (state.reminded.includes(s) || state.reminded.includes(short)) return false;
    if ((state.routed || []).includes(s) || (state.routed || []).includes(short)) return false;
    return true;
  };

  const due = [...new Set(matched)].filter(s => known.has(s) && isDue(s));
  if (!due.length) return;

  for (const s of due) {
    state.reminded.push(s);
    const short = s.split(':').pop();
    if (!state.reminded.includes(short)) state.reminded.push(short);
  }
  saveState(sid, state);
  log(`remind platform=${platform} session=${sid} file=${path.basename(file)} skills=${JSON.stringify(due)}`);

  if (platform === 'antigravity') {
    // Antigravity PreToolUse response: allow with advisory reason
    const context = `Skill router: ${path.basename(file)} dosyasını düzenliyorsunuz. Bu dosya türü için şu beceriler öneriliyor ancak henüz yüklenmedi: ${due.join(', ')}. Gerekirse ilgili adımlarda bu becerileri uygulayın.`;
    process.stdout.write(JSON.stringify({
      decision: 'allow',
      reason: context
    }));
  } else {
    // Claude Code PreToolUse response
    const context = `Skill router: you are editing ${path.basename(file)}, and these skills cover this kind of file but are not loaded in this session: ${due.join(', ')}. Unless this is a trivial fix, invoke them with the Skill tool and apply them to this and the following edits.`;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: context
      }
    }));
  }
}

main().catch(err => log(`pretool crash ${err?.stack || err}`));
