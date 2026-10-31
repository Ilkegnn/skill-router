# skill-router (Universal)

Coding agents rarely invoke installed skills on their own. This router makes them use them — now supporting both **Claude Code** and **Antigravity**.

- **Fast, specialized routing per platform:**
  - In **Claude Code:** Claude Haiku analyzes your prompt.
  - In **Antigravity:** Gemini Flash analyzes your prompt in the background before the main agent generates its reply.
- **On every actionable request** (25+ characters, not a `/command` or casual chat), the fast model checks installed skills and tells the main model which ones the task needs, in the exact order it needs them.
- **While editing files**, each file write/edit is checked against the file kind (UI, tests, Swift, Kotlin, SQL, …). If a matching skill is not loaded yet, the agent gets a one-time reminder. This part runs locally and costs zero tokens.
- **Tuning:** Groups skills into domains, maps file kinds, and flags duplicated or deprecated skills. Review those with `/skill-router:cleanup`.

---

## Quick Install

### For Claude Code
Inside Claude Code:
```
/plugin marketplace add Ilkegnn/skill-router
/plugin install skill-router@skill-router
```
Or in a terminal:
```bash
claude plugin marketplace add Ilkegnn/skill-router
claude plugin install skill-router@skill-router
```

### For Antigravity
Run the one-click installer from this directory:
```bash
node scripts/install-antigravity.mjs
```
*This automatically registers `SessionStart`, `PreInvocation` (Gemini Flash routing), and `PreToolUse` (file reminders) into `~/.gemini/config/hooks.json` across all workspaces.*

To enable only for a specific workspace, copy `.agents/hooks.json` to your project root.

---

## Update

### Claude Code
Inside Claude Code:
```
/plugin marketplace update Ilkegnn/skill-router
/plugin update skill-router
```
Or in a terminal:
```bash
claude plugin marketplace update Ilkegnn/skill-router
claude plugin update skill-router@skill-router
```

### Antigravity
Simply pull the latest repository:
```bash
git pull
node scripts/install-antigravity.mjs
```

---

## Cost & Performance

- **Routing:** One fast call per actionable request (~8k input tokens with ~100 skills) via Haiku (Claude Code) or Gemini Flash (Antigravity). Already-invoked skills are skipped.
- **Tuning:** One background call per skill-set change (~30k input tokens with ~100 skills).
- **File reminders:** 100% local regex checking — zero tokens, zero delay.

---

## Files & Safety

All state and logs live in `~/.claude/skill-router/`:
- `profile.json` (the tuned setup, saved atomically)
- `router.log` (routing decisions, auto-rotated when > 1 MB)
- `state/` (per-session state, auto-cleaned after 7 days)

Delete `profile.json` to force a re-tune.

## Overrides (optional)

Create `~/.claude/skill-router/overrides.json` if you want manual overrides:

```json
{
  "protect": ["my-skill"],
  "ignore": ["skill-i-never-want-suggested"],
  "fileRules": { "ui": ["impeccable"] }
}
```

- `protect`: never offered for cleanup.
- `ignore`: never routed or reminded.
- `fileRules`: replaces the tuned skills for a file kind (`ui`, `motion`, `test`, `e2e`, `reactNative`, `swift`, `android`, `python`, `rust`, `go`, `sql`, `infra`, `llmApp`, `designSpec`, `skillFile`).

Requires Node.js on PATH.

## License

MIT
