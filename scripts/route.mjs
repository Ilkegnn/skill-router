// UserPromptSubmit hook: asks Haiku which skills fit the request and hands the list to the main model.
import { buildCatalog, loadProfile, loadOverrides, loadState, saveState, askClaude, extractJson, log, readStdin } from './lib.mjs';

const MIN_PROMPT_CHARS = 25;
const MAX_PROMPT_CHARS = 16000;

// Filter out trivial confirmations and chat acknowledgements that do not represent new actionable tasks
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
  const prompt = (input.prompt || '').trim();
  if (prompt.length < MIN_PROMPT_CHARS || prompt.startsWith('/') || TRIVIAL_RE.test(prompt)) return;

  const { ignore } = loadOverrides();
  const state = loadState(input.session_id);
  const invokedShort = new Set((state.invoked || []).map(s => s.split(':').pop()));

  // Catalog filtering: exclude ignored skills and skills already loaded in this session
  const catalog = buildCatalog(input.cwd).filter(s => !ignore.includes(s.name) && !invokedShort.has(s.name.split(':').pop()));
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
  // Responsive timeout: 20s avoids blocking UX indefinitely
  const res = askClaude({ model: 'haiku', system: SYSTEM, message, timeout: 20000 });
  const picked = [...new Set((extractJson(res.text, '[') || []).filter(n => names.has(n)))];
  log(`route session=${input.session_id} ms=${Date.now() - started} status=${res.status} picked=${JSON.stringify(picked)}${res.error ? ' error=' + res.error : ''}`);
  if (!picked.length) return;

  state.routed = [...new Set([...(state.routed || []), ...picked])];
  saveState(input.session_id, state);

  const context = `Skill router (Haiku read this request against the installed skills) — relevant skills, in the order they are needed: ${picked.join(', ')}.
Before your first action, invoke with the Skill tool the ones that govern how this work starts. Invoke each of the others when you reach the step it covers. Skip any that turn out not to apply.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
}

main().catch(err => log(`route crash ${err?.stack || err}`));
