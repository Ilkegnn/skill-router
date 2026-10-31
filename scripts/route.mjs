// Universal UserPromptSubmit / PreInvocation hook:
// Dispatches to Gemini Flash (for Antigravity) or Claude Haiku (for Claude Code).
import {
  buildCatalog, loadProfile, loadOverrides, loadState, saveState,
  askFlash, extractJson, log, readStdin, detectPlatform,
} from './lib.mjs';

const MIN_PROMPT_CHARS = 25;
const MAX_PROMPT_CHARS = 16000;

// Filter out casual acknowledgements and chat messages that aren't new actionable tasks
const TRIVIAL_RE = /^(ok(ay)?|yes|no|yep|nope|sure|continue|go ahead|proceed|tamam|evet|hayır|devam|devam et|olur|tesekkur(ler)?|thanks?|ty|got it|anladım)\b[!.?]*$/i;

const SYSTEM = `You route tasks to skills for a coding agent.
You get a catalog of skills (name: description), optional user preferences, and a task message.
The task is often a long multi-step plan: consider every step, not just the first.
Return every skill that would materially help with some part of the task, including skills that make the work cheaper, faster or more reliable (planning, verification, token-saving).
Leave out skills whose domain does not occur in the task, and when two skills cover the same thing pick the better fit.
If the message is a question, a confirmation or conversation about the setup rather than a request to do work, reply [].
Order by when they are needed: skills that govern how the work starts come first.
Reply with only a JSON array of exact skill names from the catalog, e.g. ["a","b"]. Reply [] if nothing fits.`;

async function main() {
  if (process.env.SKILL_ROUTER_CHILD) return;
  const input = await readStdin();
  const platform = detectPlatform(input);

  const prompt = (input.lastUserInput || input.prompt || '').trim();
  if (prompt.length < MIN_PROMPT_CHARS || prompt.startsWith('/') || TRIVIAL_RE.test(prompt)) return;

  const sid = input.conversationId || input.session_id || 'default';
  const cwd = (input.workspacePaths && input.workspacePaths[0]) || input.cwd;

  const { ignore } = loadOverrides();
  const state = loadState(sid);
  const invokedShort = new Set((state.invoked || []).map(s => s.split(':').pop()));

  // Catalog filtering: exclude ignored skills and skills already loaded in this session
  const catalog = buildCatalog(cwd, platform).filter(s => !ignore.includes(s.name) && !invokedShort.has(s.name.split(':').pop()));
  const names = new Set(catalog.map(s => s.name));
  const hints = (loadProfile()?.hints || []).map(h => `${h.domain}: ${h.skills.join(', ')}`).join('\n');

  // Structured XML tags protect against prompt injection and distinguish skills cleanly
  const message = [
    'SKILL CATALOG:',
    ...catalog.map(s => `<skill name="${s.name}">\n<description>${s.description}</description>\n</skill>`),
    hints && `\nPREFERRED SKILLS PER DOMAIN:\n${hints}`,
    `\nTASK:\n${prompt.slice(0, MAX_PROMPT_CHARS)}`,
  ].filter(Boolean).join('\n');

  const started = Date.now();
  // Fast flash agent call (Gemini Flash on Antigravity, Claude Haiku on Claude Code)
  const res = await askFlash({ system: SYSTEM, message, timeout: 20000, platform });
  const picked = [...new Set((extractJson(res.text, '[') || []).filter(n => names.has(n)))];
  log(`route platform=${platform} session=${sid} ms=${Date.now() - started} status=${res.status} picked=${JSON.stringify(picked)}${res.error ? ' error=' + res.error : ''}`);
  if (!picked.length) return;

  state.routed = [...new Set([...(state.routed || []), ...picked])];
  saveState(sid, state);

  if (platform === 'antigravity') {
    // Antigravity PreInvocation output contract
    const context = `Skill router (Gemini Flash): Bu görev için ilgili beceriler (ihtiyaç sırasına göre): ${picked.join(', ')}.\nİşe başlarken ilk adımı yöneten beceriyi çağırın; diğerlerini sırası geldikçe devreye alın.`;
    process.stdout.write(JSON.stringify({
      injectSteps: [
        {
          ephemeralMessage: context
        }
      ]
    }));
  } else {
    // Claude Code UserPromptSubmit output contract
    const context = `Skill router (Haiku read this request against the installed skills) — relevant skills, in the order they are needed: ${picked.join(', ')}.
Before your first action, invoke with the Skill tool the ones that govern how this work starts. Invoke each of the others when you reach the step it covers. Skip any that turn out not to apply.`;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context
      }
    }));
  }
}

main().catch(err => log(`route crash ${err?.stack || err}`));
