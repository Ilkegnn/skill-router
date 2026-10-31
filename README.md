# skill-router

Claude Code rarely invokes installed skills on its own. This plugin makes it use them.

- **On every actionable request** (25+ characters, not a `/command` or casual acknowledgement), Haiku reads your message against installed skills and tells the model which ones the task needs, in the order it needs them.
- **While the model works**, each Edit/Write is checked against the file kind (UI, tests, Swift, Kotlin, SQL, …). If a matching skill is not loaded yet, the model gets a one-time reminder. This part runs locally and costs no tokens.
- **It tunes itself to your setup.** On first start, and whenever your skill set changes, a background Opus pass groups your skills into domains, maps file kinds to them, and flags duplicated or deprecated skills. Review those with `/skill-router:cleanup`; nothing is removed without your OK.

## Install

Inside Claude Code:

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

## Update

To update to the latest version:

Inside Claude Code:

```
/plugin marketplace update Ilkegnn/skill-router
/plugin update skill-router
```

Or in a terminal:

```
claude plugin marketplace update Ilkegnn/skill-router
claude plugin update skill-router@skill-router
```

The router automatically detects new setup versions and re-tunes itself in the background when your next session starts.

## Cost & Performance

- **Routing:** one fast Haiku call per actionable work request (~8k input tokens with ~100 skills), with an optimized timeout. Already-invoked skills are skipped.
- **Tuning:** one background Opus call per skill-set change (~30k input tokens with ~100 skills).
- **File reminders:** 100% local regex checking — zero tokens, zero delay.

## Files & Safety

Everything it writes lives in `~/.claude/skill-router/`:
- `profile.json` (the tuned setup, saved atomically)
- `router.log` (routing decisions, auto-rotated when > 1 MB)
- `state/` (per-session state, auto-cleaned after 7 days)

Delete `profile.json` to force a re-tune.

## Overrides (optional)

Not needed — everything above is automatic. If you want the last word on something, create `~/.claude/skill-router/overrides.json`:

```json
{
  "protect": ["my-skill"],
  "ignore": ["skill-i-never-want-suggested"],
  "fileRules": { "ui": ["impeccable"] }
}
```

- `protect`: never offered for cleanup (also auto-populated when you choose to keep a flagged skill in `/skill-router:cleanup`).
- `ignore`: never routed or reminded.
- `fileRules`: replaces the tuned skills for a file kind (`ui`, `motion`, `test`, `e2e`, `reactNative`, `swift`, `android`, `python`, `rust`, `go`, `sql`, `infra`, `llmApp`, `designSpec`, `skillFile`).

Requires Node.js on PATH.

## License

MIT
