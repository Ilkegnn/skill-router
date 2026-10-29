# skill-router

Claude Code rarely invokes installed skills on its own. This plugin makes it use them.

- **On every work request** (200+ characters, not a `/command`), Haiku reads your message against all installed skills and tells the model which ones the task needs, in the order it needs them.
- **While the model works**, each Edit/Write is checked against the file kind (UI, tests, Swift, Kotlin, SQL, …). If a matching skill is not loaded yet, the model gets a one-time reminder. This part runs locally and costs no tokens.
- **It tunes itself to your setup.** On first start, and whenever your skill set changes, a background Sonnet pass groups your skills into domains, maps file kinds to them, and flags duplicated or deprecated skills. Review those with `/skill-router:cleanup`; nothing is removed without your OK.

## Install

```
/plugin marketplace add Ilkegnn/skill-router
/plugin install skill-router@skill-router
```

Or in a terminal:

```
claude plugin marketplace add Ilkegnn/skill-router
claude plugin install skill-router@skill-router
```

Start a new session. You will see one message while it tunes itself (about a minute, in the background).

## Cost

- Routing: one Haiku call per work request (~8k input tokens with ~100 skills), adds a few seconds before the reply.
- Tuning: one Sonnet call per skill-set change.
- File reminders: none.

## Files

Everything it writes lives in `~/.claude/skill-router/`:
`profile.json` (the tuned setup), `router.log` (every routing decision), `state/` (per-session record of loaded skills).
Delete `profile.json` to force a re-tune.

Requires Node.js on PATH.
